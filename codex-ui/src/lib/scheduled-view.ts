// The 定时任务 page's list (components/Scheduled.tsx) and the sidebar row's mark, as pure functions:
// a task's card (Claude cdbc75b4b Yr / cbd6c85c8 Zu over the ChatGPT app's fields), the list's
// search, filters and sort (cdbc75b4b $n / nr / tr), and the mark (shared-21 ZY). Schedules are
// context/rrule.mjs's.

import type { Project } from "@protocol/v2/Project";
import { describeRrule, oneShot, parseRrule } from "../../context/rrule.mjs";
import { basename, normalizePath, threadTitle } from "./format.ts";
import type { Automation, AutomationRun } from "./automations";
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
    if (status?.type === "active" && status.activeFlags.length) blocked = true;
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
    canEdit: true,
    canShare: false,
    canDelete: true,
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
