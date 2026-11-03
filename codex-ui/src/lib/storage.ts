// 存储 through the bridge (server/storage.mjs): what Codex keeps on this computer, and removing the
// worktrees of sessions no one has used for a while. The settings page and the host tools share it.

import { connectionId, threadCwd, worktreeRoot } from "./codex";
import { normalizePath } from "./format";
import { getState, type ThreadState } from "./store";

export interface StoredWorktree { path: string; repository: string; owner: string | null; changes: number | null; bytes: number | null }
export interface StorageUsage {
  home: string;
  worktreeRoot: string;
  sessions: number | null;
  archivedSessions: number | null;
  attachments: number | null;
  scratchWorkspaces: number | null;
  worktrees: StoredWorktree[];
  free: number | null;
}

const failed = async (response: Response) => new Error((await response.text().catch(() => "")) || `存储请求失败（${response.status}）`);

export async function readStorage(refresh = false): Promise<StorageUsage> {
  const query = new URLSearchParams({ c: connectionId() ?? "", root: worktreeRoot(), ...(refresh && { refresh: "1" }) });
  const response = await fetch(`/api/storage?${query}`);
  if (!response.ok) throw await failed(response);
  return response.json();
}

export async function removeWorktrees(paths: string[], force: boolean): Promise<{ removed: string[]; skipped: { path: string; reason: string }[] }> {
  const response = await fetch(`/api/storage/worktrees/remove?${new URLSearchParams({ c: connectionId() ?? "" })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: worktreeRoot(), paths, force }),
  });
  if (!response.ok) throw await failed(response);
  return response.json();
}

/** Whether folder `cwd` is worktree `tree` or inside it. */
export const inWorktree = (cwd: string, tree: string): boolean => normalizePath(cwd) === normalizePath(tree) || normalizePath(cwd).startsWith(`${normalizePath(tree)}/`);

/**
 * The worktrees cleaning may offer (c71860c77 清理不活跃的会话): owned by a session that is idle,
 * not on screen, not pinned and inactive for `days` days, and so is every other loaded session
 * working inside it (a fork keeps its parent's folder). A worktree with no known owner is left
 * out (its session cannot be checked).
 */
export function inactiveWorktrees(usage: StorageUsage, days: number, pinned: readonly string[], now = Date.now()): StoredWorktree[] {
  const { threads, activeId, splitId } = getState();
  const idle = (thread: ThreadState) => !thread.turns.some((turn) => turn.status === "inProgress") && thread.meta.status.type !== "active";
  return usage.worktrees.filter((tree) => {
    if (!tree.owner || !threads[tree.owner]) return false;
    const users = Object.values(threads).filter((thread) => thread.meta.id === tree.owner || inWorktree(threadCwd(thread), tree.path));
    return users.every((thread) => idle(thread) && thread.meta.id !== activeId && thread.meta.id !== splitId && !pinned.includes(thread.meta.id) && now - (thread.meta.recencyAt ?? thread.meta.updatedAt) * 1000 >= days * 86_400_000);
  });
}
