// codex_ui_desktop's scheduled-task tools on the page (components/DesktopTools.ts hands them over):
// automation_update on this computer's tasks, cloud_task_update on the user's ChatGPT ones, each
// change that needs the user's say on its card first.
import { desktopError, type DesktopRequest, type DesktopResult } from "../../context/desktop-tools.mjs";
import { LIST_MAX, automationAsks, kindFields, resultTask, type AutomationArgs, type AutomationTask, type CloudTask, type CloudTaskArgs, type LocalTask } from "../../context/automation-tools.mjs";
import { describeRrule, jitterSpan, nextRun, parseRrule } from "../../context/rrule.mjs";
import { automationsState, createAutomation, deleteAutomation, refreshAutomations, runNow, updateAutomation, type Automation, type AutomationInput } from "./automations";
import { cloudAutomationsState, cloudDraftOf, cloudProblem, cloudSchedule, refreshCloud, removeCloudAutomation, saveCloudAutomation, scheduleParts, schedulePolicy, setCloudRule, setCloudStatus, wallTime, zonedTime, type CloudAccess, type CloudAutomation } from "./cloud-automations";
import { ensureThreads, errorMessage, modelLabel } from "./codex";
import { EFFORT_LABELS, homeRelative, threadTitle } from "./format";
import { originOf } from "./linked";
import { cloudScheduleText, dayTime, defaultName, onceText, untilText, zoneLabel } from "./scheduled-view";
import { promptProblem } from "./scheduled-form";
import { askSettingConsent, getState, type ThreadState } from "./store";

const iso = (at: number | null) => (at == null ? null : new Date(at).toISOString());

/** A refusal or failure once the call's task is known names it: rpc.ts sends it on for the call's row (_meta, not the model's text). */
const naming = (failure: unknown, task: AutomationTask): Error => Object.assign(failure as Error, { task });

/** A local task as automation_update reports it; a list cuts each prompt short. */
function localTask(a: Automation, whole: boolean): LocalTask {
  return {
    id: a.id, kind: a.kind, name: a.name, prompt: a.prompt.slice(0, whole ? 20_000 : 300), status: a.status, schedule: describeRrule(a.rrule), rrule: a.rrule,
    nextRunAt: iso(a.nextRunAt), lastRunAt: iso(a.lastRunAt), notificationPolicy: a.notificationPolicy,
    ...(a.kind === "heartbeat" ? { targetThreadId: a.targetThreadId } : { cwds: a.cwds, executionEnvironment: a.executionEnvironment, model: a.model, reasoningEffort: a.reasoningEffort, autoArchive: a.autoArchive }),
  };
}

const refuseInput = (message: string): never => { throw desktopError("INVALID_INPUT", message); };

/**
 * What the model's fields set on a task (server/automations.mjs normalizes the rest): a heartbeat's
 * session (this chat unless named), a cron task's folder (the given one, else this chat's).
 */
async function automationFields(args: AutomationArgs, kind: "heartbeat" | "cron", creating: boolean, threadId: string, cwd: string): Promise<AutomationInput> {
  kindFields(kind, args);
  const s = getState();
  const input: AutomationInput = {};
  for (const key of ["name", "prompt", "rrule", "status", "notificationPolicy", "model", "reasoningEffort", "executionEnvironment", "autoArchive"] as const) if (args[key] !== undefined) Object.assign(input, { [key]: args[key] });
  if (kind === "heartbeat") {
    const target = args.targetThreadId ?? (creating ? threadId : undefined);
    if (target && target !== threadId) {
      await ensureThreads([target]);
      const thread = getState().threads[target];
      if (!thread || thread.meta.parentThreadId || thread.meta.ephemeral) refuseInput(`No session with id ${target} that a heartbeat can run in; use an id from a tool result or the Linked sessions note, or leave targetThreadId out for this chat.`);
    }
    if (target) input.targetThreadId = target;
    return input;
  }
  if (args.model && !s.models.some((m) => m.id === args.model || m.model === args.model)) refuseInput(`model must be one of this app's models: ${s.models.map((m) => m.id).join(", ")}.`);
  if (args.cwds !== undefined) input.cwds = args.cwds;
  else if (creating) input.cwds = [cwd];
  // ChatGPT's create runs a new cron task in the folder itself (a worktree only when asked).
  if (creating) input.executionEnvironment ??= "local";
  return input;
}

/**
 * The card's rows: what the call sets, as the 定时任务 page and form name it (a new task's name is
 * in the title); a model or effort alone shows with the task's other one.
 */
function automationRows(kind: "heartbeat" | "cron", input: AutomationInput, old: Automation | undefined): [string, string][] {
  const rows: [string, string][] = [];
  if (input.name !== undefined && old) rows.push(["名称", input.name]);
  if (input.rrule !== undefined) {
    rows.push(["重复", describeRrule(input.rrule)]);
    // A rule anchored with DTSTART (suggested_create) first runs from there.
    // Its time is nominal: 约 when the saved task's runs are jittered, as its page says it (scheduled-view statusOf).
    const rule = parseRrule(input.rrule), next = rule?.dtstart && !rule.count ? nextRun(rule, Date.now()) : null;
    if (next != null) rows.push(["下次运行", dayTime(next, Date.now(), true, jitterSpan(rule!) > 0)]);
  }
  if (input.targetThreadId !== undefined) {
    const thread = getState().threads[input.targetThreadId];
    rows.push(["运行于", thread ? threadTitle(thread.meta) : input.targetThreadId]);
  }
  if (input.cwds !== undefined) rows.push(["文件夹", input.cwds.length ? input.cwds.map(homeRelative).join("\n") : "不在项目中工作"]);
  if (input.executionEnvironment !== undefined) rows.push(["工作树", input.executionEnvironment === "worktree" ? "已开启" : "已关闭"]);
  if (input.model !== undefined || input.reasoningEffort !== undefined) {
    const model = input.model ?? old?.model, effort = input.reasoningEffort ?? old?.reasoningEffort;
    rows.push(["模型", `${model ? modelLabel(model) : "默认"}${effort ? ` · ${EFFORT_LABELS[effort] ?? effort}` : ""}`]);
  }
  if (input.notificationPolicy !== undefined) rows.push(["通知", input.notificationPolicy === "failed_runs_only" ? "仅限未成功运行" : kind === "cron" ? "所有运行" : "重要更新"]);
  if (input.autoArchive !== undefined) rows.push(["归档成功运行记录", input.autoArchive ? "已开启" : "已关闭"]);
  if (input.status !== undefined) rows.push(["状态", input.status === "ACTIVE" ? "已启用" : "已暂停"]);
  if (input.prompt !== undefined) rows.push(["指令", input.prompt]);
  return rows;
}

/**
 * The task a scheduled-task call's row names: the one its result names in _meta (the task as saved,
 * or as it was when a card was declined or the call refused, so a declined rename keeps the old
 * name; a list names none), else its task's here by id (a running rename names the task its card
 * asks about), else the name a create gives.
 */
export function callTaskName(tool: string, args: { id?: unknown; name?: unknown; title?: unknown } | null, result: { _meta?: unknown } | null | undefined): string | undefined {
  const reported = resultTask(result)?.name;
  if (reported) return reported;
  const local = tool === "automation_update";
  const id = args?.id;
  const current = typeof id !== "string" ? undefined : local ? automationsState().items?.find((a) => a.id === id)?.name : cloudAutomationsState().items?.find((a) => a.id === id)?.title;
  const named = local ? args?.name : args?.title;
  return current ?? (typeof named === "string" ? named : undefined);
}

/**
 * automation_update on this computer's tasks. The user's own turn saves at once; a turn they did not
 * start (a heartbeat, a scheduled run, an event) may pause (status alone) or delete, but anything
 * else waits on their card (automationAsks), as suggested_* always does.
 */
export async function automationRequest(request: DesktopRequest, args: AutomationArgs, check: () => ThreadState, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  await refreshAutomations();
  const { items, error } = automationsState();
  if (!items) throw desktopError("UNAVAILABLE", `Codex UI could not read its scheduled tasks${error ? ` (${error})` : ""}; nothing was changed.`);
  // ponytail: a list stops at LIST_MAX tasks; page it should someone keep more.
  if (args.mode === "list") return { threadId, cwd, outcome: "listed", tasks: items.slice(0, LIST_MAX).map((a) => localTask(a, false)) };
  const creating = args.mode === "create" || args.mode === "suggested_create";
  const old = creating ? undefined : items.find((a) => a.id === args.id);
  if (!creating && !old) throw desktopError("NOT_FOUND", `No scheduled task has id ${args.id}; list them with mode "list".`);
  if (args.mode === "view") return { threadId, cwd, outcome: "viewed", task: localTask(old!, true) };
  // runs: ChatGPT automation_runs of a cron task, newest first (heartbeats keep none).
  if (args.mode === "runs") {
    const runs = automationsState().runs.filter((run) => run.automationId === old!.id).slice(0, 50).map((run) => ({
      sessionId: run.threadId, status: run.status, title: run.threadTitle ?? run.inboxTitle, startedAt: new Date(run.createdAt).toISOString(), updatedAt: new Date(run.updatedAt).toISOString(), read: run.readAt !== null, summary: run.inboxSummary,
    }));
    return { threadId, cwd, outcome: "runs", task: localTask(old!, false), runs };
  }
  // The task as the card names it: a new one by its name (create requires one), a change by the name it has now.
  const name = creating ? args.name! : old!.name;
  const task = { ...(old && { id: old.id }), name };
  try {
    if (args.mode === "delete") {
      await deleteAutomation(old!.id);
      return { threadId, cwd, outcome: "deleted", task: { id: old!.id, name: old!.name } };
    }
    // run: 立即运行; from a turn the user did not start, the user allows it first.
    if (args.mode === "run") {
      if (old!.status !== "ACTIVE") throw desktopError("PAUSED", `The scheduled task “${name}” is paused; resume it (update with status ACTIVE) before running it.`);
      if (automationAsks(args, originOf(threadId))) {
        const allowed = await askSettingConsent(threadId, { id: request.id, label: name, from: "", to: "", title: `允许 Codex 立即运行定时任务“${name}”吗？`, action: "运行定时任务", rows: [["任务", name]] }, signal);
        check();
        if (!allowed) return { threadId, cwd, outcome: "declined", task };
      }
      await runNow(old!.id);
      return { threadId, cwd, outcome: "started", task: { id: old!.id, name: old!.name } };
    }
    const kind = old?.kind ?? args.kind!;
    const input = await automationFields(args, kind, creating, threadId, cwd);
    if (automationAsks(args, originOf(threadId))) {
      const allowed = await askSettingConsent(threadId, {
        id: request.id, label: input.name ?? name, from: "", to: "",
        title: creating ? `允许 Codex 创建定时任务“${name}”吗？` : `允许 Codex 更新定时任务“${name}”吗？`,
        action: creating ? "创建定时任务" : "更新定时任务",
        rows: automationRows(kind, creating ? { ...input, status: input.status ?? "ACTIVE" } : input, old),
      }, signal);
      check();
      if (!allowed) return { threadId, cwd, outcome: "declined", task };
    }
    try {
      const saved = creating ? await createAutomation({ ...input, kind }) : await updateAutomation(old!.id, input);
      return { threadId, cwd, outcome: creating ? "created" : "updated", task: localTask(saved, true) };
    } catch (failure) {
      throw desktopError("SAVE_FAILED", `Codex UI could not save the scheduled task “${name}”: ${errorMessage(failure)}`);
    }
  } catch (failure) {
    throw naming(failure, task);
  }
}

/**
 * A cloud task as cloud_task_update reports it: its end date apart (YYYY-MM-DD), and the zone it is
 * saved on (its schedule text reads on UTC when Intl does not know that zone).
 */
function cloudTask(a: CloudAutomation, whole: boolean): CloudTask {
  const { until } = scheduleParts(a.schedule, a.timezone);
  return { id: a.id, title: a.title, prompt: a.prompt.slice(0, whole ? 20_000 : 300), schedule: cloudScheduleText(a), ...(until && { until }), timezone: a.savedTimezone, status: a.status, nextRunAt: iso(a.nextRunAt) };
}

const CLOUD_UNAVAILABLE: Record<CloudAccess, string> = {
  ok: "",
  unknown: "Codex UI has not read the account yet; try again in a moment.",
  signin: "Cloud scheduled tasks need Codex UI signed in with ChatGPT.",
  unavailable: "This account has no cloud scheduled tasks (another model provider, or none offered to it).",
  blocked: "ChatGPT turned the request away in browser mode; cloud scheduled tasks work in the Codex UI desktop app.",
  error: "ChatGPT could not be reached",
};

const CLOUD_VERBS = { create: "创建", update: "更新", pause: "暂停", resume: "启用", delete: "删除" } as const;

/** cloud_task_update: the user's ChatGPT tasks, every change only once they allow it on a card. */
export async function cloudTaskRequest(request: DesktopRequest, args: CloudTaskArgs, check: () => ThreadState, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  await refreshCloud();
  const { access, items, error } = cloudAutomationsState();
  if (access !== "ok" || !items) throw desktopError("UNAVAILABLE", `${CLOUD_UNAVAILABLE[access]}${access === "error" ? `${error ? ` (${error})` : ""}.` : ""} Nothing was changed.`);
  if (args.mode === "list") return { threadId, cwd, outcome: "listed", tasks: items.slice(0, LIST_MAX).map((a) => cloudTask(a, false)) };
  const old = args.mode === "create" ? null : items.find((a) => a.id === args.id) ?? null;
  if (args.mode !== "create" && !old) throw desktopError("NOT_FOUND", `No cloud scheduled task has id ${args.id}; list them with mode "list".`);
  // The card's title names the task: a new one by its title (else its prompt's start), a change by the name it has now (its new one in a row).
  const name = defaultName(old?.title ?? args.title ?? "", old?.prompt ?? args.prompt ?? "");
  try {
    if (old && !(args.mode === "delete" ? old.canDelete : old.canManage)) throw desktopError("NOT_ALLOWED", "This account may not change that task; nothing was changed.");
    const base = args.mode === "create" || args.mode === "update" ? cloudDraftOf(old) : null;
    const draft = base && { ...base };
    const rows: [string, string][] = [];
    if (draft) {
      if (args.title !== undefined) draft.name = args.title;
      if (args.prompt !== undefined) draft.prompt = args.prompt;
      if (args.timezone !== undefined) draft.timezone = args.timezone;
      if (args.rrule !== undefined) {
        setCloudRule(draft, args.rrule);
        if (/UNTIL=/i.test(args.rrule) && !draft.until) refuseInput("UNTIL must be a date such as UNTIL=20271231.");
      }
      // A new schedule is saved on the draft's zone, which is UTC when Intl does not know the saved one (knownZone).
      if (old && old.savedTimezone !== old.timezone && (args.rrule !== undefined || args.fireAt !== undefined) && args.timezone === undefined)
        refuseInput(`This task is saved on the time zone ${old.savedTimezone}, which Codex UI cannot read; pass timezone with the new schedule.`);
      if (args.fireAt !== undefined) Object.assign(draft, { repeat: false, ...wallTime(Date.parse(args.fireAt), draft.timezone) });
      // As the form: an edit checks a schedule it changed only, so a one-time run that has passed (or an
      // end date that has) still takes a new title or prompt; the account's shortest interval unread, the server judges.
      const fresh = !old || draft.timezone !== base!.timezone || cloudSchedule(draft) !== cloudSchedule(base!);
      const policy = fresh && args.rrule !== undefined ? await schedulePolicy().catch(() => null) : null;
      const problem = fresh ? cloudProblem(draft, policy, Date.now()) : promptProblem(draft.prompt);
      if (problem) refuseInput(`ChatGPT would not take this task: ${problem}`);
      if (old && args.title !== undefined) rows.push(["名称", defaultName(draft.name, draft.prompt)]);
      if (args.rrule !== undefined || args.fireAt !== undefined || args.timezone !== undefined || !old)
        rows.push(["重复", draft.repeat ? describeRrule(draft.rrule, { tz: zoneLabel(draft.timezone) }) + untilText(draft.until) : onceText(zonedTime(draft.date, draft.time, draft.timezone), draft.timezone)]);
      if (args.prompt !== undefined) rows.push(["指令", draft.prompt]);
    } else rows.push(["重复", cloudScheduleText(old!)]);
    const verb = CLOUD_VERBS[args.mode];
    const allowed = await askSettingConsent(threadId, { id: request.id, label: name, from: "", to: "", title: `允许 Codex ${verb}云端定时任务“${name}”吗？`, action: `${verb}云端定时任务`, rows }, signal);
    check();
    if (!allowed) return { threadId, cwd, outcome: "declined", task: { ...(old && { id: old.id }), title: name } };
    try {
      if (args.mode === "delete") {
        await removeCloudAutomation(old!.id);
        return { threadId, cwd, outcome: "deleted", task: { id: old!.id, title: name } };
      }
      if (draft) {
        const saved = await saveCloudAutomation(draft, old);
        return { threadId, cwd, outcome: old ? "updated" : "created", task: cloudTask(saved, true) };
      }
      const saved = await setCloudStatus(old!.id, args.mode === "resume");
      return { threadId, cwd, outcome: args.mode === "resume" ? "resumed" : "paused", task: cloudTask(saved, true) };
    } catch (failure) {
      throw desktopError("CLOUD_FAILED", `ChatGPT did not take the change to “${name}”: ${errorMessage(failure)}`);
    }
  } catch (failure) {
    throw naming(failure, { ...(old && { id: old.id }), name });
  }
}
