import type { ThreadState } from "./store";
import type { CollabAgentStatus } from "@protocol/v2/CollabAgentStatus";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { spawnOf } from "./session.ts";

export interface AgentTask {
  threadId: string;
  itemId: string;
  title: string;
  model: string | null;
  status: "running" | "completed" | "stopped" | "failed" | "unknown";
  startedAt?: number;
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
  }
  return [...tasks.values()];
}
