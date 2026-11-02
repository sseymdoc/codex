// 存储 through the bridge (server/storage.mjs): what Codex keeps on this computer, and removing the
// worktrees of sessions no one has used for a while. The settings page and the host tools share it.

import { connectionId, worktreeRoot } from "./codex";
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

/**
 * The worktrees cleaning may offer (c71860c77 清理不活跃的会话): owned by a session that is idle,
 * not on screen, not pinned and inactive for `days` days. A worktree with no known owner is left
 * out (its session cannot be checked).
 */
export function inactiveWorktrees(usage: StorageUsage, days: number, pinned: readonly string[], now = Date.now()): StoredWorktree[] {
  const { threads, activeId, splitId } = getState();
  const idle = (thread: ThreadState | undefined) => !!thread && !thread.turns.some((turn) => turn.status === "inProgress") && thread.meta.status.type !== "active";
  return usage.worktrees.filter((tree) => {
    const thread = tree.owner ? threads[tree.owner] : undefined;
    if (!tree.owner || !thread || !idle(thread) || tree.owner === activeId || tree.owner === splitId || pinned.includes(tree.owner)) return false;
    return now - (thread.meta.recencyAt ?? thread.meta.updatedAt) * 1000 >= days * 86_400_000;
  });
}
