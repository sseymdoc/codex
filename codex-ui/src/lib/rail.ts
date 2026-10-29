// Session rail card order (cdae9a994 J / L, cf74bc599 FA) and a session's scheduled tasks (the
// 定时任务 card, the sidebar row's clock): pure helpers behind Rail.tsx and Sidebar.tsx.

import type { Automation, AutomationRun } from "./automations";

/**
 * The cards in their saved order: the saved ones fill their own default slots in the saved
 * sequence and the rest keep theirs, so a card the saved order has never seen lands where it
 * would by default.
 */
export function railOrder<T extends string>(defaults: readonly T[], saved: readonly string[]): T[] {
  const known = new Set<string>(defaults);
  const queue = [...new Set(saved)].filter((id): id is T => known.has(id));
  const kept = new Set<string>(queue);
  return defaults.map((id) => (kept.has(id) ? queue.shift()! : id));
}

/** dnd-kit's arrayMove: `from` taken out and put back at `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Same ids in the same order. */
export const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, index) => b[index] === id);

/** The heartbeat watching a session (the first, should there be more). */
export const heartbeatOn = (items: readonly Automation[] | null, threadId: string): Automation | undefined =>
  items?.find((task) => task.kind === "heartbeat" && task.targetThreadId === threadId);

/**
 * A session's scheduled tasks: the heartbeats watching it, then the cron task it is a run of (its
 * run's record says which, else `cronId`, the task its opening message names).
 */
export function sessionTasks(threadId: string, items: readonly Automation[], runs: readonly AutomationRun[], cronId: string | null = null): Automation[] {
  const owner = runs.find((run) => run.threadId === threadId)?.automationId ?? cronId;
  return [...items.filter((task) => task.kind === "heartbeat" && task.targetThreadId === threadId), ...items.filter((task) => task.kind === "cron" && task.id === owner)];
}

/** The next run a task shows (ChatGPT hWn): its time on the schedule, not the jitter's minutes before it. */
export const nextRunOf = (task: Pick<Automation, "nextRunAt" | "nextRunNominalAt">): number | null => (task.nextRunAt == null ? null : (task.nextRunNominalAt ?? task.nextRunAt));
