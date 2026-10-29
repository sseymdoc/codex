// The 定时任务 page's list (components/Scheduled.tsx) and the sidebar row's mark, as pure functions:
// a local or cloud task's card (Claude cdbc75b4b Yr / cbd6c85c8 Zu over the ChatGPT app's fields),
// the list's search, filters and sort (cdbc75b4b $n / nr / tr), and the mark (shared-21 ZY).
// Schedules are context/rrule.mjs's; cloud tasks come typed only (lib/cloud-automations.ts), so this
// module stays loadable on its own.

import type { Project } from "@protocol/v2/Project";
import { describeRrule, oneShot, parseRrule } from "../../context/rrule.mjs";
import { basename, normalizePath, threadTitle } from "./format.ts";
import type { Automation, AutomationRun } from "./automations";
import type { CloudAutomation, CloudRun } from "./cloud-automations";
import type { ThreadState } from "./store";

/** Claude's ZY marks, as the sidebar's RowMark draws them: error, waiting on you (awaiting), new runs (ready), running. */
export type Mark = "error" | "blocked" | "unread" | "running";

export interface TaskCard {
  key: string;
  source: "local" | "cloud";
  id: string;
  name: string;
  /** The prompt; the card clamps it. */
  description: string;
  /** Completed: a one-time task that has run (ChatGPT's COUNT=1 cron with no next run). */
  status: "active" | "paused" | "completed";
  oneTime: boolean;
  nextRunAt: number | null;
  scheduleText: string;
  mark: Mark | null;
  /** The footer's place: this computer (a project, a folder, no project, a heartbeat's session) or the cloud. */
  place: { icon: "Laptop" | "Cloud"; label: string };
  /** 打开项目: the folder a cron task works in. */
  cwd: string | null;
  /** 打开会话: the session a heartbeat watches. */
  heartbeatThread: string | null;
  canRunNow: boolean;
  /** 暂停 / 启用 (not once completed). */
  canPause: boolean;
  /** A paused one-time cloud task past its time: 启用 is refused (expiredResume). */
  expired: boolean;
  canEdit: boolean;
  canShare: boolean;
  canDelete: boolean;
}

const unreadRun = (run: AutomationRun) => run.readAt == null && (run.status === "PENDING_REVIEW" || run.status === "ACCEPTED");

/**
 * The mark over these tasks and their runs, by Claude's ZY order (error > waiting > new runs >
 * running): a run's session failed (an unread or ongoing run's last turn, or the session's system
 * error), waits on approval or input, a run nobody read, a run under way (a heartbeat's too).
 */
export function navMark(items: readonly Automation[], runs: readonly AutomationRun[], threads: Readonly<Record<string, ThreadState>>): Mark | null {
  let blocked = false, unread = false, running = items.some((task) => task.running);
  for (const run of runs) {
    const thread = threads[run.threadId];
    const status = thread?.meta.status;
    const live = unreadRun(run) || run.status === "IN_PROGRESS";
    if (live && (status?.type === "systemError" || thread?.turns.at(-1)?.status === "failed")) return "error";
    // A run the user took over or read is theirs: its session waiting on them is not the task's.
    if (live && status?.type === "active" && status.activeFlags.length) blocked = true;
    if (unreadRun(run)) unread = true;
    if (run.status === "IN_PROGRESS") running = true;
  }
  return blocked ? "blocked" : unread ? "unread" : running ? "running" : null;
}

/** The project holding `cwd` (codex.ts projectFor over these projects). */
function projectOf(cwd: string, projects: readonly Project[]): Project | undefined {
  const target = normalizePath(cwd);
  return projects.find((project) => project.roots.some((root) => {
    const base = normalizePath(root.path);
    return target === base || target.startsWith(`${base}/`);
  }));
}

/** A local task's card. */
export function localCard(t: Automation, runs: readonly AutomationRun[], threads: Readonly<Record<string, ThreadState>>, projects: readonly Project[]): TaskCard {
  const rule = parseRrule(t.rrule);
  const completed = t.status === "ACTIVE" && t.nextRunAt === null && t.lastRunAt !== null;
  let label: string, cwd: string | null = null;
  if (t.kind === "heartbeat") {
    const thread = t.targetThreadId ? threads[t.targetThreadId] : undefined;
    label = `心跳 • ${thread ? threadTitle(thread.meta) : "会话不可用"}`;
  } else if (t.target?.type === "project") {
    const { projectId } = t.target;
    const project = projects.find((p) => p.id === projectId);
    label = project?.name ?? "项目不可用";
    cwd = project?.roots[0]?.path ?? null;
  } else if (t.cwds?.length) {
    cwd = t.cwds[0];
    label = projectOf(cwd, projects)?.name ?? basename(cwd);
  } else label = "不在项目中工作";
  return {
    key: `local:${t.id}`,
    source: "local",
    id: t.id,
    name: t.name || defaultName("", t.prompt),
    description: t.prompt.trim(),
    status: completed ? "completed" : t.status === "PAUSED" ? "paused" : "active",
    oneTime: !!rule && oneShot(rule),
    nextRunAt: t.nextRunAt,
    scheduleText: describeRrule(t.rrule),
    mark: navMark([t], runs.filter((run) => run.automationId === t.id), threads),
    place: { icon: "Laptop", label },
    cwd,
    heartbeatThread: t.kind === "heartbeat" ? (t.targetThreadId ?? null) : null,
    canRunNow: !!t.prompt.trim() && !t.running,
    canPause: !completed,
    expired: false,
    canEdit: true,
    canShare: false,
    canDelete: true,
  };
}

/** A time zone's short name on the zh-CN clock (GMT+8, UTC), or the zone itself. */
export function zoneLabel(tz: string): string {
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

/**
 * A cloud task's schedule as its card and page say it (shared-2 Cp / Op): its rule on its own time
 * zone (an end date left out; the page names it), its one run's time there, or 由事件触发.
 */
export function cloudScheduleText(a: CloudAutomation): string {
  if (a.triggered) return "由事件触发";
  const tz = zoneLabel(a.timezone);
  if (/^RRULE:/im.test(a.schedule)) return describeRrule(a.schedule.replace(/;UNTIL=[^;\r\n]*|UNTIL=[^;\r\n]*;/gi, ""), { tz });
  if (a.onceAt === null) return "运行一次";
  const at = new Intl.DateTimeFormat("zh-CN", { timeZone: a.timezone, dateStyle: "medium", timeStyle: "short" }).format(a.onceAt);
  return `于 ${at} ${tz} 运行一次`;
}

/** Why a paused one-time cloud task past its time cannot resume (inbox.automations.status.expiredResume, 你 as 您). */
export const EXPIRED = "此任务的预定执行时间已过。请先编辑任务，将执行时间改为未来的时间，再恢复任务。";

/** A cloud task's mark from the runs its page read (none until then): a failed run unread, a run unread, one under way. */
export function cloudMark(runs: readonly CloudRun[] | undefined): Mark | null {
  if (!runs) return null;
  if (runs.some((run) => run.unread && run.status === "failed")) return "error";
  return runs.some((run) => run.unread) ? "unread" : runs.some((run) => run.status === "in_progress") ? "running" : null;
}

/**
 * A cloud task's card: managing it (owner or editor) runs, pauses and edits it, an event-triggered
 * one only pauses and deletes (no run now, no schedule to edit).
 */
export function cloudCard(a: CloudAutomation, runs: readonly CloudRun[] | undefined, now: number): TaskCard {
  return {
    key: `cloud:${a.id}`,
    source: "cloud",
    id: a.id,
    name: a.title || defaultName("", a.prompt),
    description: a.prompt.trim(),
    status: a.status,
    oneTime: !a.triggered && !/^RRULE:/im.test(a.schedule),
    nextRunAt: a.nextRunAt,
    scheduleText: cloudScheduleText(a),
    mark: cloudMark(runs),
    place: { icon: "Cloud", label: "云端" },
    cwd: null,
    heartbeatThread: null,
    canRunNow: a.canManage && !a.triggered && !!a.prompt.trim(),
    canPause: a.canManage && a.status !== "completed",
    expired: a.status === "paused" && a.onceAt !== null && a.onceAt <= now,
    canEdit: a.canManage && !a.triggered,
    canShare: a.canShare,
    canDelete: a.canDelete,
  };
}

export interface ListView {
  query: string;
  runsOn: "all" | "local" | "cloud";
  schedule: "all" | "recurring" | "once";
  status: "all" | "active" | "paused" | "completed";
  sort: "nextRun" | "name";
  showCompleted: boolean;
}

/** Claude's Tu: nothing searched or filtered, the next run first, completed tasks hidden. */
export const DEFAULT_VIEW: ListView = { query: "", runsOn: "all", schedule: "all", status: "all", sort: "nextRun", showCompleted: false };

/** The filters set (the filter button's label counts them). */
export const filterCount = (v: ListView): number => [v.runsOn, v.schedule, v.status].filter((value) => value !== "all").length;

/**
 * The cards the list shows, and how many completed ones it hides (包含已完成 off; filtering for
 * 已完成 shows them regardless). By next run, paused and completed tasks last (nr / tr), ties and
 * the 名称 sort by name in Chinese order. The search reads names and prompts, any case.
 */
export function viewCards(cards: readonly TaskCard[], v: ListView): { shown: TaskCard[]; hiddenCompleted: number } {
  const term = v.query.trim().toLowerCase();
  const matching = cards.filter((c) =>
    (v.runsOn === "all" || c.source === v.runsOn)
    && (v.schedule === "all" || c.oneTime === (v.schedule === "once"))
    && (v.status === "all" || c.status === v.status)
    && (!term || c.name.toLowerCase().includes(term) || c.description.toLowerCase().includes(term)));
  const shown = v.status === "completed" || v.showCompleted ? matching : matching.filter((c) => c.status !== "completed");
  const byName = (a: TaskCard, b: TaskCard) => a.name.localeCompare(b.name, "zh-CN");
  const due = (c: TaskCard) => (c.status === "active" ? (c.nextRunAt ?? Infinity) : Infinity);
  // Infinity - Infinity is NaN, which falls through to the name as a tie does.
  const order = v.sort === "name" ? byName : (a: TaskCard, b: TaskCard) => due(a) - due(b) || byName(a, b);
  return { shown: [...shown].sort(order), hiddenCompleted: matching.length - shown.length };
}

/** A task's name as the server would save it (mTt): the name, else the start of its prompt. */
export const defaultName = (name: string, prompt: string): string => name.trim() || prompt.trim().replace(/\s+/g, " ").slice(0, 80);

// ---------------------------------------------------------------------------
// A task's page (components/ScheduledDetail.tsx; Claude cfc18e0f4 Xe)

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/**
 * A moment as Claude's detail page says it (shared-2 Lp): 今天, 明天 (ahead) or 昨天 (past), else the
 * date (with the year when it is another one), then the time. `approx` marks a jittered time, in
 * Claude's zh-Hans as it is: 约 after 明天 and a date, ~ after 今天 and 昨天.
 */
export function dayTime(at: number, now: number, ahead: boolean, approx = false): string {
  const date = new Date(at), today = new Date(now);
  const time = date.toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" });
  const near = new Date(today);
  near.setDate(today.getDate() + (ahead ? 1 : -1));
  if (sameDay(date, today)) return `今天 ${approx ? "~" : ""}${time}`;
  if (sameDay(date, near)) return ahead ? `明天 ${approx ? "约 " : ""}${time}` : `昨天 ${approx ? "~" : ""}${time}`;
  const day = date.toLocaleDateString("zh-CN", { month: "short", day: "numeric", ...(date.getFullYear() !== today.getFullYear() && { year: "numeric" }) });
  return `${day} ${approx ? "约 " : ""}${time}`;
}

/** A run counts as missed this long past its time (Claude's Je: two minutes). */
const DUE_MS = 2 * 60_000;

/**
 * The 状态 section (Qe and the footnote under it): 已启用, 已暂停 or 已运行 (a one-time task that ran),
 * and when it runs next (its nominal time, 约 when jittered; 运行时间 for a one-time task), or was due
 * when no page ran it.
 */
export function statusOf(t: Automation, now: number): { chip: "active" | "paused" | "completed"; note: string | null } {
  if (t.status === "PAUSED") return { chip: "paused", note: null };
  if (t.nextRunAt === null) return t.lastRunAt === null ? { chip: "active", note: null } : { chip: "completed", note: "此一次性任务已运行。如需再次运行，请设置新的计划。" };
  const at = t.nextRunNominalAt ?? t.nextRunAt, approx = at !== t.nextRunAt;
  if (t.nextRunAt < now - DUE_MS) return { chip: "active", note: `原定于 ${dayTime(at, now, false, approx)} 运行` };
  const rule = parseRrule(t.rrule);
  return { chip: "active", note: `${rule && oneShot(rule) ? "运行时间：" : "下次运行："}${dayTime(at, now, true, approx)}` };
}

/** A row of a cron task's 历史记录 (tt / H). */
export interface RunRow {
  threadId: string;
  at: number;
  state: "running" | "failed" | "done";
  /** The run's ::inbox-item, when it wrote one. */
  title: string | null;
  summary: string | null;
  unread: boolean;
  archived: boolean;
}

/**
 * This task's runs, newest first. A run under way is running; one whose session failed (a system
 * error or a failed last turn, as navMark reads it) failed.
 * ponytail: a run's record keeps no outcome, so a session this page has not loaded reads as done.
 */
export function runRows(runs: readonly AutomationRun[], id: string, threads: Readonly<Record<string, ThreadState>>): RunRow[] {
  return runs.filter((run) => run.automationId === id).sort((a, b) => b.createdAt - a.createdAt).map((run) => {
    const thread = threads[run.threadId];
    const failed = thread?.meta.status.type === "systemError" || thread?.turns.at(-1)?.status === "failed";
    return {
      threadId: run.threadId,
      at: run.createdAt,
      state: run.status === "IN_PROGRESS" ? "running" : failed ? "failed" : "done",
      title: run.inboxTitle,
      summary: run.inboxSummary,
      unread: unreadRun(run),
      archived: run.status === "ARCHIVED",
    };
  });
}
