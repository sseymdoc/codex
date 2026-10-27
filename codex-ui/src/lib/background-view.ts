import { useEffect, useMemo, useSyncExternalStore } from "react";
import { backgroundTasks, taskFamilies, type BackgroundTask } from "./background.ts";
import { openPane } from "./panes.ts";
import { spawnPath } from "./session.ts";
import { getState, useStore, writePref, type ThreadState } from "./store.ts";

export interface BackgroundView {
  expanded: boolean;
  open: string[];
  finished: boolean;
  dismissed: string[];
  focus: string | null;
  /** Sub-agent records pushed over the list (Claude paneViewStacks, kind "subagent"), the shown one last. */
  agents: string[];
}
const EMPTY: BackgroundView = { expanded: false, open: [], finished: false, dismissed: [], focus: null, agents: [] };
const KEY = "codex-ui:background-views";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((key): key is string => typeof key === "string").slice(-1000) : [];

function readViews(): Record<string, BackgroundView> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).slice(-100).flatMap(([id, value]) => {
      if (!value || typeof value !== "object") return [];
      return [[id, { expanded: value.expanded === true, open: strings(value.open), finished: value.finished === true, dismissed: strings(value.dismissed), focus: null, agents: [] }]];
    }));
  } catch { return {}; }
}
let views = readViews();
const listeners = new Set<() => void>();
const outputPositions = new Map<string, { following: boolean; top: number }>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function backgroundOutputPosition(key: string) {
  let position = outputPositions.get(key);
  if (!position) { position = { following: true, top: 0 }; outputPositions.set(key, position); }
  return position;
}

export const backgroundDismissalKey = (task: BackgroundTask): string => `${task.key}/${task.runId || task.completedAt || task.itemId}`;

/**
 * Stops in flight (Claude c6b8adeaf Ro: the pending stop mutations) and the shells app-server killed
 * at the user's request (Vo's synthetic "stopped" notification), shared by the rail and the pane and
 * never saved: after a reload a killed shell reads as its exit left it.
 */
let stopping: ReadonlySet<string> = new Set();
let stopped: ReadonlySet<string> = new Set();
const stopListeners = new Set<() => void>();
const subscribeStops = (listener: () => void) => { stopListeners.add(listener); return () => { stopListeners.delete(listener); }; };

export function setStopping(key: string, on: boolean): void {
  if (stopping.has(key) === on) return;
  stopping = new Set(on ? [...stopping, key] : [...stopping].filter((item) => item !== key));
  for (const listener of stopListeners) listener();
}

export function markStopped(key: string): void {
  stopped = new Set([...stopped, key]);
  for (const listener of stopListeners) listener();
}

export const isStopping = (key: string): boolean => stopping.has(key);
export const useStopping = (): ReadonlySet<string> => useSyncExternalStore(subscribeStops, () => stopping);

const withStops = (tasks: BackgroundTask[], marks: ReadonlySet<string>) => marks.size ? tasks.map((task) => task.kind === "shell" && marks.has(task.key) ? { ...task, status: "stopped" as const } : task) : tasks;

export function visibleBackgroundTasks(thread: ThreadState, threads: Record<string, ThreadState>) {
  const dismissed = views[thread.meta.id]?.dismissed ?? [];
  return withStops(backgroundTasks(thread, threads), stopped).filter(task => task.status === "running" || !dismissed.includes(backgroundDismissalKey(task)));
}

export function updateBackgroundView(id: string, patch: Partial<BackgroundView>): void {
  const next = { ...(views[id] ?? EMPTY), ...patch };
  next.open = [...new Set(next.open)].slice(-1000);
  next.dismissed = [...new Set(next.dismissed)].slice(-1000);
  // Claude bounds per-session UI history; old task records themselves are never deleted.
  const entries = Object.entries(views).filter(([key]) => key !== id);
  views = Object.fromEntries([...entries, [id, next]].slice(-100));
  writePref(KEY, JSON.stringify(Object.fromEntries(Object.entries(views).map(([key, value]) => [key, { ...value, focus: null, agents: [] }]))));
  for (const listener of listeners) listener();
}

export const backgroundView = (id: string): BackgroundView => views[id] ?? EMPTY;

export function useBackgroundView(id: string): BackgroundView {
  return useSyncExternalStore(subscribe, () => backgroundView(id));
}

export function useBackgroundTasks(thread: ThreadState) {
  const threads = useStore((state) => state.threads);
  const view = useBackgroundView(thread.meta.id);
  const marks = useSyncExternalStore(subscribeStops, () => stopped);
  const all = useMemo(() => withStops(backgroundTasks(thread, threads), marks), [thread, threads, marks]);
  const tasks = useMemo(() => all.filter((task) => task.status === "running" || !view.dismissed.includes(backgroundDismissalKey(task))), [all, view.dismissed]);
  const groups = useMemo(() => taskFamilies(tasks), [tasks]);
  useEffect(() => {
    const revived = all.filter((task) => task.status === "running").map((task) => `${task.key}/`);
    if (view.dismissed.some((key) => revived.some((prefix) => key.startsWith(prefix)))) updateBackgroundView(thread.meta.id, { dismissed: view.dismissed.filter((key) => !revived.some((prefix) => key.startsWith(prefix))) });
  }, [all, view.dismissed, thread.meta.id]);
  return { tasks, groups, view };
}

export function toggleBackgroundTask(id: string, key: string): void {
  const view = views[id] ?? EMPTY;
  if (view.open.includes(key)) outputPositions.delete(key);
  updateBackgroundView(id, { open: view.open.includes(key) ? view.open.filter((item) => item !== key) : [...view.open, key] });
}

export function openBackgroundTask(id: string, task: BackgroundTask, tasks: BackgroundTask[]): void {
  const keys = new Set([task.key]);
  const byKey = new Map(tasks.map((item) => [item.key, item]));
  for (let parent = task.parentKey; parent && !keys.has(parent); parent = byKey.get(parent)?.parentKey) keys.add(parent);
  const view = views[id] ?? EMPTY;
  updateBackgroundView(id, { focus: task.key, open: [...view.open, ...keys], finished: task.status !== "running" || view.finished });
  openPane("background", id);
}

/** c63275c0a bh: 查看实时输出 on a call's row opens its shell in 后台任务, else the pane as it is. */
export function openShellOutput(sessionId: string, itemId: string): void {
  const { threads } = getState();
  const thread = threads[sessionId];
  const tasks = thread ? backgroundTasks(thread, threads) : [];
  const task = tasks.find((item) => item.kind === "shell" && item.itemId === itemId);
  if (task) openBackgroundTask(sessionId, task, tasks);
  else openPane("background", sessionId);
}

export function openFinishedBackground(id: string): void {
  updateBackgroundView(id, { finished: true });
  openPane("background", id);
}

/** c5259f582 A: a sub-agent opens as a record in the 后台任务 pane of the session it runs in, over the agents that spawned it. */
export function showAgent(sessionId: string, agentId: string): void {
  const { threads } = getState();
  updateBackgroundView(sessionId, { agents: spawnPath(agentId, (id) => threads[id]?.meta.parentThreadId) });
  openPane("background", sessionId);
}

/** The record's 返回: back to the agent under it, or to the task list. */
export function popAgent(sessionId: string): void {
  updateBackgroundView(sessionId, { agents: (views[sessionId] ?? EMPTY).agents.slice(0, -1) });
}
