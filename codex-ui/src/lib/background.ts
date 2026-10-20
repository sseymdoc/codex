import type { BackgroundTerminal, ThreadState } from "./store";
import type { CollabAgentStatus } from "@protocol/v2/CollabAgentStatus";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { spawnOf } from "./session.ts";
import { commandDescription } from "./transcript.ts";

export interface ShellTask {
  itemId: string;
  processId: string;
  title: string;
  command: string;
  status: "running" | "completed" | "failed" | "unknown";
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  output: string;
  exitCode: number | null;
  cpuPercent: number | null;
}

/** Claude c62da1b56 retains task records after terminal events; the live registry is not history. */
export function shellTasks(thread: ThreadState): ShellTask[] {
  const live = new Map<string, BackgroundTerminal>(thread.background.map((task) => [task.itemId, task]));
  const tasks = new Map<string, ShellTask>();
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      // A write_stdin call has its own item but does not start a new shell task.
      if (item.type !== "commandExecution" || item.source === "unifiedExecInteraction" || item.source === "userShell") continue;
      const terminal = live.get(item.id);
      const confirmed = item.backgrounded === true || terminal?.backgrounded === true;
      if (item.backgrounded === false || (!confirmed && !terminal)) continue;
      const processId = item.processId ?? terminal?.processId;
      if (!processId) continue;
      const [startedAt, endedAt] = thread.timing[item.id] ?? [];
      const ended = item.status === "completed" || item.status === "failed" || item.status === "declined";
      tasks.set(item.id, {
        itemId: item.id,
        processId,
        // Claude c62da1b56: the tool call's description names the task; the command stays in its output.
        title: commandDescription(item.description) ?? (item.command || item.id),
        command: item.command,
        status: !confirmed ? "unknown" : ended ? item.status === "completed" ? "completed" : "failed" : terminal || thread.subscribed ? "running" : "unknown",
        startedAt,
        completedAt: ended ? endedAt : undefined,
        durationMs: ended ? item.durationMs ?? (startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined) : undefined,
        output: item.aggregatedOutput ?? "",
        exitCode: item.exitCode ?? null,
        cpuPercent: terminal?.cpuPercent ?? null,
      });
    }
  }
  for (const terminal of live.values()) {
    if (tasks.has(terminal.itemId) || terminal.backgrounded === false) continue;
    tasks.set(terminal.itemId, {
      itemId: terminal.itemId,
      processId: terminal.processId,
      title: terminal.command || terminal.itemId,
      command: terminal.command,
      status: terminal.backgrounded === true ? "running" : "unknown",
      startedAt: thread.timing[terminal.itemId]?.[0],
      output: "",
      exitCode: null,
      cpuPercent: terminal.cpuPercent,
    });
  }
  return [...tasks.values()];
}

export interface AgentTask {
  threadId: string;
  itemId: string;
  title: string;
  model: string | null;
  status: "running" | "completed" | "stopped" | "failed" | "unknown";
  startedAt?: number;
  completedAt?: number;
}

export const AGENT_TASK_STATUS: Record<AgentTask["status"], string> = {
  running: "运行中",
  completed: "已完成",
  stopped: "已停止",
  failed: "失败",
  unknown: "状态未知",
};

const COLLAB_STATUS: Record<CollabAgentStatus, AgentTask["status"]> = {
  pendingInit: "running",
  running: "running",
  interrupted: "stopped",
  completed: "completed",
  errored: "failed",
  shutdown: "stopped",
  notFound: "unknown",
};

/** A history page may contain a wait or a report while its spawn lives on an older page. */
export function agentThreadIds(items: ThreadItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.type === "subAgentActivity" ? [item.agentThreadId]
    : item.type === "collabAgentToolCall" ? [...item.receiverThreadIds, ...Object.keys(item.agentsStates ?? {})] : []))];
}

/** Claude cccc2cf0a ND / hD: agents share the task list with shells and open their transcript. */
export function agentTasks(thread: ThreadState, threads: Record<string, ThreadState>): AgentTask[] {
  const tasks = new Map<string, AgentTask>();
  const children = new Map<string, ThreadState[]>();
  const parentOf = (meta: ThreadState["meta"]) => meta.parentThreadId ?? spawnOf(meta)?.parent_thread_id;
  for (const child of Object.values(threads)) {
    const parent = parentOf(child.meta);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), child]);
  }
  const ancestors = new Set([thread.meta.id]);
  for (let id = parentOf(thread.meta); id && !ancestors.has(id); id = threads[id] && parentOf(threads[id].meta)) ancestors.add(id);
  const add = (id: string, ownerId: string, itemId = "") => {
    const meta = threads[id]?.meta;
    // Communication and inherited history cannot override a thread's actual spawn parent.
    if (ancestors.has(id) || (meta && parentOf(meta) !== ownerId)) return;
    let task = tasks.get(id);
    if (!task) {
      const spawn = meta && spawnOf(meta);
      task = {
        threadId: id,
        itemId,
        title: meta?.name || spawn?.agent_path?.split("/").pop() || meta?.agentNickname || spawn?.agent_nickname || "子代理",
        model: meta?.model ?? null,
        status: "unknown",
        startedAt: meta?.createdAt ? meta.createdAt * 1000 : undefined,
      };
      tasks.set(id, task);
    }
    return task;
  };
  const pending = [thread];
  const seen = new Set([thread.meta.id]);
  for (let i = 0; i < pending.length; i++) {
    const owner = pending[i];
    for (const child of children.get(owner.meta.id) ?? []) add(child.meta.id, owner.meta.id);
    for (const turn of owner.turns) {
      for (const item of turn.items) {
        if (item.type === "subAgentActivity") {
          const task = add(item.agentThreadId, owner.meta.id, item.id);
          if (!task) continue;
          task.title = threads[task.threadId]?.meta.name || item.agentPath.split("/").pop() || task.title;
          if (item.kind === "started") {
            task.itemId = item.id;
            task.model = item.model ?? task.model;
            task.startedAt = owner.timing[item.id]?.[0] ?? task.startedAt;
            task.status = "running";
          } else if (item.kind === "completed") task.status = "completed";
          else if (item.kind === "interrupted") task.status = "stopped";
        } else if (item.type === "collabAgentToolCall") {
          if (item.senderThreadId && item.senderThreadId !== owner.meta.id) continue;
          // Old pages can start at a wait; message recipients alone are not child tasks.
          if (item.tool === "wait")
            for (const id of agentThreadIds([item])) add(id, owner.meta.id);
          if (item.tool === "spawnAgent")
            for (const id of item.receiverThreadIds) {
              const task = add(id, owner.meta.id, item.id);
              if (!task) continue;
              task.itemId = item.id;
              task.model = item.model ?? task.model;
              task.startedAt = owner.timing[item.id]?.[0] ?? task.startedAt;
              task.status = "running";
            }
          for (const [id, state] of Object.entries(item.agentsStates ?? {})) {
            const task = tasks.get(id);
            if (!task || !state) continue;
            task.status = COLLAB_STATUS[state.status];
          }
        }
      }
    }
    for (const task of tasks.values()) {
      if (seen.has(task.threadId)) continue;
      seen.add(task.threadId);
      const child = threads[task.threadId];
      if (child) pending.push(child);
    }
  }
  for (const task of tasks.values()) {
    const child = threads[task.threadId];
    if (!child) continue;
    // Runtime metadata, refreshed even for agents with no public spawn item, wins over old calls.
    const status = child.meta.status.type;
    if (status === "active") task.status = "running";
    else if (status === "systemError") task.status = "failed";
    else if (status === "idle" || status === "notLoaded") {
      const ended = child.agentTurn && child.agentTurn.updatedAt === child.meta.updatedAt ? child.agentTurn.status : child.turns.at(-1)?.status;
      if (ended === "interrupted") task.status = "stopped";
      else if (ended === "failed") task.status = "failed";
      else if (ended === "completed") task.status = "completed";
      else if (ended === "inProgress") task.status = "unknown";
      else if (status === "notLoaded" && task.status === "running") task.status = "unknown";
      else if (status === "idle" && task.status !== "stopped" && task.status !== "failed") task.status = "completed";
    }
    task.model = child.meta.model ?? task.model;
    if (task.status === "completed" || task.status === "stopped" || task.status === "failed") task.completedAt = child.meta.updatedAt ? child.meta.updatedAt * 1000 : undefined;
  }
  return [...tasks.values()];
}

export type BackgroundTask = (ShellTask & { kind: "shell" } | AgentTask & { kind: "agent" }) & { key: string; ownerId: string; parentKey?: string; runId?: string };
export interface TaskFamily {
  task: BackgroundTask;
  children: BackgroundTask[];
  live: boolean;
  endedAt: number;
}

/** Claude's session-presets layout groups direct leaves, promoting parents with children. */
export function backgroundTasks(thread: ThreadState, threads: Record<string, ThreadState>): BackgroundTask[] {
  const agents = agentTasks(thread, threads);
  const tasks: BackgroundTask[] = agents.map((task) => {
    const child = threads[task.threadId];
    const meta = child?.meta;
    const parent = meta && (meta.parentThreadId ?? spawnOf(meta)?.parent_thread_id);
    return { ...task, kind: "agent", key: `agent:${task.threadId}`, runId: child?.agentTurn?.id ?? child?.turns.at(-1)?.id ?? task.itemId, ownerId: parent ?? thread.meta.id, parentKey: parent && parent !== thread.meta.id ? `agent:${parent}` : undefined };
  });
  for (const owner of [thread, ...agents.flatMap((task) => threads[task.threadId] ? [threads[task.threadId]] : [])]) {
    for (const task of shellTasks(owner)) tasks.push({ ...task, kind: "shell", key: `shell:${owner.meta.id}:${task.itemId}`, ownerId: owner.meta.id, parentKey: owner === thread ? undefined : `agent:${owner.meta.id}` });
  }
  return tasks.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
}

export function taskFamilies(tasks: BackgroundTask[]): { running: TaskFamily[]; finished: TaskFamily[]; unknown: TaskFamily[] } {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const children = new Map<string, BackgroundTask[]>();
  const parents = new Map<string, string>();
  for (const task of tasks) {
    const seen = new Set([task.key]);
    let parent = task.parentKey;
    while (parent && byKey.has(parent) && !seen.has(parent)) { seen.add(parent); parent = byKey.get(parent)?.parentKey; }
    if (parent && seen.has(parent)) continue;
    if (task.parentKey && byKey.has(task.parentKey)) {
      parents.set(task.key, task.parentKey);
      children.set(task.parentKey, [...(children.get(task.parentKey) ?? []), task]);
    }
  }
  const families = tasks.filter((task) => !parents.has(task.key) || children.has(task.key)).map((task) => {
    const leaves = (children.get(task.key) ?? []).filter((child) => !children.has(child.key));
    return { task, children: leaves, live: [task, ...leaves].some((item) => item.status === "running"), endedAt: Math.max(...[task, ...leaves].map((item) => item.completedAt ?? -Infinity)) };
  });
  const unknown = (family: TaskFamily) => [family.task, ...family.children].some((task) => task.status === "unknown");
  return {
    running: families.filter((family) => family.live),
    finished: families.filter((family) => !family.live && !unknown(family)).reverse().sort((a, b) => b.endedAt - a.endedAt),
    unknown: families.filter((family) => !family.live && unknown(family)),
  };
}
