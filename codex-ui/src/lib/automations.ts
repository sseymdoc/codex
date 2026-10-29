// 定时任务 (scheduled tasks) on this machine, the page's half: the store the 定时任务 page reads,
// and the runs. The bridge keeps the tasks and hands out due runs (server/automations.mjs); every
// 30 seconds, on focus and on waking from sleep a page claims them and runs them through its own
// app-server connection in the background: a cron task in a fresh session (thread/start with
// threadSource "automation"), a heartbeat as a <heartbeat> message into the session it watches.
// Nothing runs while no page is open; a missed run runs once.

import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { Model } from "@protocol/v2/Model";
import type { Project } from "@protocol/v2/Project";
import { CRON_GUIDANCE, HEARTBEAT_KEY, cronMessage, heartbeatDecision, heartbeatEnvelope, heartbeatGuidance, inboxItem, notificationDecision, parseCronMessage, parseHeartbeat, visibleReply } from "../../context/automations.mjs";
import { useSyncExternalStore } from "react";
import {
  PRESETS, activeTurn, archiveThread, connectionId, effectiveSettings, ensureThreads, errorMessage, isArchivedThread, markRead, openThread, projectFor,
  renameThread, sendAutomationTurn, startSideThread,
} from "./codex";
import { environmentOf } from "./environments";
import { joinPath, threadTitle } from "./format";
import { waitsOnUser } from "./linked";
import { actionToast, getState, isShown, toast, updateThread, type AppState, type PermissionPreset, type Reviewer, type ThreadState, type TurnState } from "./store";

type Kind = "cron" | "heartbeat";
type Trigger = "scheduled" | "run_now";

/** A task as GET /api/automations lists it (server/automations.mjs view). */
export interface Automation {
  id: string;
  kind: Kind;
  name: string;
  prompt: string;
  status: "ACTIVE" | "PAUSED";
  rrule: string;
  model: string | null;
  reasoningEffort: string | null;
  notificationPolicy: "failed_runs_only" | null;
  createdAt: number;
  updatedAt: number;
  /** cron */
  autoArchive?: boolean;
  target?: { type: "project"; projectId: string } | { type: "projectless" } | null;
  cwds?: string[];
  executionEnvironment?: "local" | "worktree";
  /** heartbeat */
  targetThreadId?: string;
  nextRunAt: number | null;
  nextRunNominalAt: number | null;
  lastRunAt: number | null;
  running: boolean;
  /** The task's folder (automation.toml, memory.md). */
  dir: string;
}

/** A cron run, keyed by its session (ChatGPT automation_runs). Heartbeats keep none. */
export interface AutomationRun {
  threadId: string;
  automationId: string;
  status: "IN_PROGRESS" | "PENDING_REVIEW" | "ACCEPTED" | "ARCHIVED";
  readAt: number | null;
  threadTitle: string | null;
  sourceCwd: string | null;
  inboxTitle: string | null;
  inboxSummary: string | null;
  archivedUserMessage: string | null;
  archivedAssistantMessage: string | null;
  archivedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** What a new task or an edit sets (the server fills and checks the rest). */
export type AutomationInput = Partial<Pick<Automation, "kind" | "name" | "prompt" | "status" | "rrule" | "model" | "reasoningEffort" | "notificationPolicy" | "autoArchive" | "cwds" | "executionEnvironment" | "targetThreadId">>;

interface Claim {
  token: string;
  trigger: Trigger;
  automation: Automation;
  lastRunAt: number | null;
  nominalAt: number | null;
}

export interface AutomationsState {
  /** Null until the first read. */
  items: Automation[] | null;
  /** Folders that do not read as a task, and why (ChatGPT's reason names). */
  invalid: { id: string; reason: string }[];
  runs: AutomationRun[];
  unread: { total: number; automationIds: string[] };
  stamp: number;
  error: string | null;
}

let state: AutomationsState = { items: null, invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 0, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<AutomationsState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useAutomations<T>(pick: (s: AutomationsState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const automationsState = () => state;

/** One /api/automations call for this page's connection: GET without a body, else a POST verb. */
async function api<T>(verb: string, body?: unknown): Promise<T> {
  const id = connectionId();
  if (!id) throw new Error("未连接到 app-server");
  const response = await fetch(`/api/automations${verb ? `/${verb}` : ""}?c=${encodeURIComponent(id)}`,
    body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.text()) || `定时任务请求失败（${response.status}）`);
  return (await response.json()) as T;
}

const UNREAD: AutomationRun["status"][] = ["PENDING_REVIEW", "ACCEPTED"];
const unreadRun = (run: AutomationRun) => run.readAt == null && UNREAD.includes(run.status);

let reads = 0;
export async function refreshAutomations(): Promise<void> {
  const read = ++reads;
  try {
    const answer = await api<Omit<AutomationsState, "error">>("");
    if (read !== reads) return;
    set({ items: answer.items, invalid: answer.invalid, runs: answer.runs, unread: answer.unread, stamp: answer.stamp, error: null });
    markUnreadRuns();
  } catch (error) {
    if (read === reads) set({ error: errorMessage(error) });
  }
}

/**
 * A cron session has no read receipt on the server (threadSource "automation" is not eligible):
 * its unread runs mark the loaded sessions, which therefore come back unread after a reload.
 */
function markUnreadRuns(): void {
  const s = getState();
  for (const run of state.runs) {
    const thread = s.threads[run.threadId];
    if (unreadRun(run) && thread && !thread.unread && !thread.readState && !isShown(s, run.threadId)) updateThread(run.threadId, (t) => ({ ...t, unread: true }));
  }
}

const putRun = (run: AutomationRun) => set({ runs: [run, ...state.runs.filter((r) => r.threadId !== run.threadId)] });
const patchRun = (threadId: string, patch: Partial<AutomationRun>) => set({ runs: state.runs.map((run) => (run.threadId === threadId ? { ...run, ...patch } : run)) });

async function change<T>(verb: string, body: unknown): Promise<T> {
  const answer = await api<T>(verb, body);
  await refreshAutomations();
  return answer;
}

export const createAutomation = (input: AutomationInput) => change<{ item: Automation }>("create", { input }).then((answer) => answer.item);
export const updateAutomation = (id: string, patch: AutomationInput) => change<{ item: Automation }>("update", { id, patch }).then((answer) => answer.item);
export const deleteAutomation = (id: string) => change<{ deleted: boolean }>("delete", { id }).then((answer) => answer.deleted);
export const setAutomationStatus = (id: string, status: Automation["status"]) => change<{ item: Automation }>("set-status", { id, status }).then((answer) => answer.item);
/** 全部标记为已读: every unread run. */
export const markRunsRead = () => change<{ count: number }>("runs/read-all", {}).then((answer) => answer.count);

// ---------------------------------------------------------------------------
// Running

let ticking = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Claims and runs due tasks from now on; App calls it once the connection is ready. */
export function startAutomations(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), 30_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void tick(); });
  window.addEventListener("focus", () => void tick());
  // Waking from sleep: the missed run starts now, not at the next tick.
  window.codexDesktop?.onPowerResume?.(() => void tick());
  void refreshAutomations().then(() => tick());
}

/**
 * One round: the due runs the bridge hands this page (three at most, each once across pages and
 * processes), cron runs one after another, heartbeats without waiting (ChatGPT Sse). Exported for
 * the page and tests.
 */
export async function tick(now = Date.now()): Promise<void> {
  const s = getState();
  const signedOut = s.account !== null && !s.account.account && s.account.requiresOpenaiAuth;
  // The managed requirement in_app_local_automation = false turns local tasks off.
  const off = s.features.some((feature) => feature.name === "in_app_local_automation" && !feature.enabled);
  if (ticking || s.conn.status !== "ready" || signedOut || off) return;
  ticking = true;
  try {
    const { claims, stamp } = await api<{ claims: Claim[]; stamp: number }>("claim", {});
    if (stamp !== state.stamp) await refreshAutomations();
    else markUnreadRuns();
    for (const claim of claims) {
      if (claim.automation.kind === "cron") await runCron(claim, now);
      else void runHeartbeat(claim);
    }
  } catch (error) {
    console.warn("codex-ui: scheduled tasks", errorMessage(error));
  } finally {
    ticking = false;
  }
}

/** 立即运行. A cron task's schedule moves on; a heartbeat's once it started. */
export async function runNow(id: string): Promise<void> {
  const { claim } = await api<{ claim: Claim }>("run-now", { id });
  await (claim.automation.kind === "cron" ? runCron(claim, Date.now()) : runHeartbeat(claim));
}

const report = (token: string, outcome: "started" | "retry" | "failed" | "paused", extra: Record<string, unknown> = {}) =>
  api("report", { token, outcome, ...extra }).catch((error) => console.warn("codex-ui: scheduled task report", errorMessage(error)));

// ponytail: a scheduled run counts as missed ten minutes past its time (jitter is five at most);
// Claude marks it so from the minute it was due.
const MISSED_MS = 10 * 60_000;

function when(at: number): string {
  const date = new Date(at);
  const today = date.toDateString() === new Date().toDateString();
  return date.toLocaleString("zh-CN", today ? { hour: "2-digit", minute: "2-digit" } : { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The toast a started run shows (Claude shared-16 / cbd6c85c8). */
export function startText(name: string, trigger: Trigger, missedAt: number | null): string {
  if (trigger === "run_now") return `“${name}”已启动。`;
  return missedAt != null ? `定时任务“${name}”错过了 ${when(missedAt)} 的运行。现在开始运行。` : `定时任务“${name}”已启动。`;
}

const started = (title: string, threadId: string) => actionToast(title, { label: "查看", run: () => void openThread(threadId) });
const failedToStart = (name: string, error: unknown) => toast("warning", `定时任务“${name}”无法启动。您可以尝试手动运行。`, errorMessage(error));

/**
 * Where a cron run works: its project's first folder, else its first folder, else (projectless)
 * the task's own folder. A project in an SSH or cloud environment cannot run one.
 * ponytail: projectless runs in the task folder, where ChatGPT makes one under Documents/Codex.
 */
export function cronPlace(a: Pick<Automation, "target" | "cwds" | "dir">, projects: readonly Project[]): { cwd: string; projectId: string | null } {
  if (a.target?.type === "project") {
    const { projectId } = a.target;
    const project = projects.find((p) => p.id === projectId);
    if (!project?.roots.length) throw new Error("找不到此定时任务的项目。");
    if (environmentOf(project).kind !== "local") throw new Error("此环境不支持定时任务。");
    return { cwd: project.roots[0].path, projectId };
  }
  return { cwd: a.cwds?.[0] || a.dir, projectId: null };
}

/** The task's model and effort when the catalog has them (else the defaults, as linked.ts specOf does). */
export function cronModel(a: Pick<Automation, "model" | "reasoningEffort">, models: readonly Model[], fallback: string | null): { model?: string; effort?: string } {
  const picked = a.model ? models.find((m) => m.id === a.model || m.model === a.model) : undefined;
  const model = picked ?? models.find((m) => m.id === fallback || m.model === fallback);
  const effort = a.reasoningEffort && model?.supportedReasoningEfforts.some((o) => o.reasoningEffort === a.reasoningEffort) ? a.reasoningEffort : undefined;
  return { ...(picked && { model: picked.id }), ...(effort && { effort }) };
}

/**
 * ChatGPT vse: nobody watches a run, so it asks for no approvals (never) where the requirements
 * allow that, in the user's default sandbox (workspace-write when none is set) or permissions
 * profile. With auto-review on, or never forbidden, the preset's approvals stay.
 */
export function cronPermissions(settings: { permission: PermissionPreset | null; permissionProfile: string | null; reviewer: Reviewer }, allowed: readonly AskForApproval[] | null | undefined): { permission?: PermissionPreset; approvalPolicy: AskForApproval | null } {
  const permission = settings.permissionProfile ? undefined : (settings.permission ?? "auto");
  const never = (!allowed || allowed.includes("never")) && settings.reviewer === "user";
  return { ...(permission && { permission }), approvalPolicy: never ? "never" : permission ? PRESETS[permission].approval : null };
}

async function runCron(claim: Claim, now: number): Promise<void> {
  const { automation: a, token, trigger } = claim;
  let threadId: string | null = null;
  try {
    const s = getState();
    const place = cronPlace(a, s.projects);
    const settings = effectiveSettings(null);
    const { permission, approvalPolicy } = cronPermissions(settings, s.requirements?.allowedApprovalPolicies);
    const { id } = await startSideThread(null, {
      context: "fresh", cwd: place.cwd, projectId: place.projectId ?? projectFor(place.cwd)?.id ?? null, useWorktree: a.executionEnvironment === "worktree",
      ...cronModel(a, s.models, settings.model), ...(permission && { permission }), approvalPolicy,
      threadSource: "automation", instructions: CRON_GUIDANCE, roots: [a.dir],
    });
    threadId = id;
    await renameThread(id, a.name, "tool").catch(() => {});
    // Recorded before the turn starts, so its completion finds the run.
    await report(token, "started", { threadId: id, threadTitle: a.name, sourceCwd: place.cwd });
    await sendAutomationTurn(id, cronMessage({ name: a.name, id: a.id, memory: joinPath(a.dir, "memory.md"), lastRunAt: claim.lastRunAt, prompt: a.prompt }), { turnTrigger: `automation_cron_${trigger}` });
    const missedAt = claim.nominalAt != null && now - claim.nominalAt > MISSED_MS ? claim.nominalAt : null;
    started(startText(a.name, trigger, missedAt), id);
  } catch (error) {
    await report(token, "failed", { threadId });
    if (threadId) await api("runs", { threadId, event: "completed", failed: true }).catch(() => {});
    failedToStart(a.name, error);
  }
}

/**
 * What keeps a heartbeat from its session now: gone, archived, or busy (a turn, a message on its
 * way or queued, or something waiting on the user). Busy runs again a minute later.
 */
export function heartbeatBlocker(s: AppState, threadId: string): "missing" | "archived" | "busy" | null {
  const thread = s.threads[threadId];
  if (!thread) return "missing";
  if (isArchivedThread(threadId)) return "archived";
  const busy = !!activeTurn(thread) || thread.meta.status.type === "active" || thread.sending || !!s.pendingMessages[threadId] || thread.queue.length > 0 || waitsOnUser(s, threadId);
  return busy ? "busy" : null;
}

const BLOCKED = { missing: "找不到此会话", archived: "此会话已归档", busy: "会话正忙" };

async function runHeartbeat(claim: Claim): Promise<void> {
  const { automation: a, token, trigger } = claim;
  const target = a.targetThreadId ?? "";
  let blocker: keyof typeof BLOCKED | null = null;
  try {
    await ensureThreads([target]);
    blocker = heartbeatBlocker(getState(), target);
    if (!blocker) {
      // automation_update is no desktop tool yet: the guidance names no tool.
      await sendAutomationTurn(target, heartbeatEnvelope(a.id, new Date().toISOString(), a.prompt), {
        turnTrigger: `automation_heartbeat_${trigger}`,
        context: { [HEARTBEAT_KEY]: { kind: "application", value: heartbeatGuidance(false) } },
      });
      await report(token, "started");
      if (trigger === "run_now") started(startText(a.name, trigger, null), target);
      return;
    }
  } catch (error) {
    // A turn that started meanwhile is busy; resuming an archived session says so.
    blocker = activeTurn(getState().threads[target]) ? "busy" : /is archived/.test(errorMessage(error)) ? "archived" : null;
    if (!blocker) {
      await report(token, "failed");
      if (trigger === "run_now") failedToStart(a.name, error);
      return;
    }
  }
  await report(token, blocker === "busy" ? "retry" : blocker === "archived" ? "paused" : "failed");
  if (trigger === "run_now") toast("warning", `无法启动“${a.name}”。${BLOCKED[blocker]}。`);
}

// ---------------------------------------------------------------------------
// Turns the scheduler started, as they end

const textOf = (turn: TurnState | undefined) => {
  const opening = turn?.items.find((item) => item.type === "userMessage");
  return opening?.type === "userMessage" ? opening.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n") : "";
};
const replyOf = (turn: TurnState) => {
  const item = turn.items.findLast((entry) => entry.type === "agentMessage");
  return item?.type === "agentMessage" ? item.text : "";
};

/** The scheduled task that opened this turn, read off its first message (so it holds after a reload too). */
export function automationOf(thread: ThreadState | undefined, turnId: string): { kind: Kind; id: string | null; name: string | null } | null {
  const text = textOf(thread?.turns.find((turn) => turn.id === turnId));
  const heartbeat = text ? parseHeartbeat(text) : null;
  if (heartbeat) return { kind: "heartbeat", id: heartbeat.automationId, name: null };
  const cron = text ? parseCronMessage(text) : null;
  return cron && { kind: "cron", id: cron.id, name: cron.name };
}

const taskOf = (id: string | null) => state.items?.find((a) => a.id === id);

/** A finished scheduled turn the user is not to hear of: a DONT_NOTIFY heartbeat, a success under failed_runs_only. */
export function quietCompletion(thread: ThreadState | undefined, turnId: string): boolean {
  const auto = automationOf(thread, turnId);
  const turn = thread?.turns.find((t) => t.id === turnId);
  return !!auto && !!turn && notificationDecision(auto.kind, taskOf(auto.id)?.notificationPolicy, turn.status, replyOf(turn)) === "DONT_NOTIFY";
}

/**
 * A scheduled turn's notification: a heartbeat's <message> under the session's title, a cron
 * run's ::inbox-item title under the task's name, a failure named as the task's. Null for other turns.
 */
export function automationNotice(thread: ThreadState | undefined, turnId: string, items: readonly Automation[] | null = state.items): { title: string; body: string } | null {
  const auto = automationOf(thread, turnId);
  const turn = thread?.turns.find((t) => t.id === turnId);
  if (!thread || !auto || !turn) return null;
  const name = items?.find((a) => a.id === auto.id)?.name ?? auto.name ?? auto.id ?? "";
  if (turn.status === "failed") return { title: `定时任务“${name}”失败`, body: turn.error?.message || "打开该运行记录以查看发生了什么。" };
  const reply = replyOf(turn);
  if (auto.kind === "cron") return { title: name, body: inboxItem(reply)?.title ?? "Codex 已完成一项任务" };
  return { title: threadTitle(thread.meta), body: heartbeatDecision(reply)?.message || visibleReply(reply).slice(0, 100) || "Codex 已完成一项任务" };
}

/**
 * Whether a finished cron run's session goes to the archive (归档成功运行): the task asks for it, the
 * turn completed, nobody carried on in it (ACCEPTED), no heartbeat watches it, nothing of the user's
 * waits there, and it is not on screen.
 */
export function autoArchives(s: AppState, items: readonly Automation[], task: Automation | undefined, run: AutomationRun, status: string): boolean {
  const { threadId } = run;
  return task?.kind === "cron" && !!task.autoArchive && status === "completed" && run.status === "PENDING_REVIEW"
    && !items.some((a) => a.kind === "heartbeat" && a.status === "ACTIVE" && a.targetThreadId === threadId)
    && !s.pendingMessages[threadId] && !s.threads[threadId]?.queue.length && !isShown(s, threadId);
}

/** turn/completed of a scheduled turn: the run's record, its quiet receipt, the auto-archive. */
export async function automationTurnCompleted(threadId: string, turnId: string): Promise<void> {
  const s = getState();
  const thread = s.threads[threadId];
  const turn = thread?.turns.find((t) => t.id === turnId);
  const auto = automationOf(thread, turnId);
  if (!thread || !turn || !auto) return;
  const task = taskOf(auto.id);
  // In place of the generic 轮次失败.
  if (turn.status === "failed" && !isShown(s, threadId)) toast("warning", `定时任务“${task?.name ?? auto.name ?? auto.id}”失败`, turn.error?.message);
  if (auto.kind === "heartbeat") {
    // The server reads only an exact <decision>DONT_NOTIFY</decision>: a variant got this turn marked unread.
    const first = thread.readState?.firstUnread;
    if (quietCompletion(thread, turnId) && first?.type === "turn" && first.turnId === turnId) void markRead(threadId);
    return;
  }
  const reply = replyOf(turn), item = inboxItem(reply);
  try {
    const { run } = await api<{ run: AutomationRun | null }>("runs", { threadId, event: "completed", failed: turn.status === "failed", ...(item?.title && { inboxTitle: item.title }), ...(item?.summary && { inboxSummary: item.summary }) });
    if (!run) return;
    putRun(run);
    // Seen as it finished.
    if (isShown(getState(), threadId)) noteRead(threadId);
    if (!autoArchives(getState(), state.items ?? [], task, run, turn.status)) return;
    putRun((await api<{ run: AutomationRun }>("runs", { threadId, event: "archived", archivedReason: "auto", archivedUserMessage: task?.prompt ?? "", archivedAssistantMessage: visibleReply(reply) })).run);
    await archiveThread(threadId);
  } catch (error) {
    console.warn("codex-ui: scheduled run", errorMessage(error));
  }
}

/** The user wrote in a cron run's session: it is theirs now (ACCEPTED), and stays out of the archive. */
export function noteUserTurn(threadId: string): void {
  const run = state.runs.find((r) => r.threadId === threadId);
  if (run?.status !== "IN_PROGRESS" && run?.status !== "PENDING_REVIEW") return;
  patchRun(threadId, { status: "ACCEPTED" });
  void api("runs", { threadId, event: "accepted" }).catch(() => {});
}

/** A cron run's session was read: so is its run. */
export function noteRead(threadId: string): void {
  if (!state.runs.some((run) => run.threadId === threadId && unreadRun(run))) return;
  patchRun(threadId, { readAt: Date.now() });
  void api("runs", { threadId, event: "read" }).catch(() => {});
}

/** A session was archived, unarchived or deleted: its run follows, heartbeats on it pause or go. */
export function automationThreadEvent(threadId: string, event: "archived" | "unarchived" | "deleted"): void {
  if (connectionId()) void api("thread", { threadId, event }).catch(() => {});
}
