// 存储 (Claude 4.4212 设置 › 这台电脑 › 存储, c71860c77 z7yp64+Mvf, and ccd_host get_storage_usage /
// clean_up_worktrees / discard_kept_worktree): how much space Codex takes on this computer, and
// removing the session worktrees Codex UI made. Only a linked Git worktree in a four-hex bucket
// under the worktree folder is ever removed, through `git worktree remove`; a main checkout, a
// symbolic link or anything elsewhere is refused whatever the page asks.
import { lstat, readdir, readFile, realpath, rmdir, statfs } from "node:fs/promises";
import path from "node:path";
import { codexHome } from "./automations.mjs";
import { runGit } from "./git.mjs";

const BUCKET = /^[0-9a-f]{4}$/;
const DEADLINE_MS = 10_000;
const CACHE_MS = 60_000;
const REMOVE_MAX = 50;

export function createStorage({ home = codexHome(), now = Date.now } = {}) {
  let cached = null;

  /** A tree's size, links not followed; null once `deadline` passes. */
  async function size(dir, deadline) {
    let bytes = 0;
    const walk = async (at) => {
      for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
        if (now() > deadline) throw new Error("deadline");
        const info = await lstat(path.join(at, entry.name)).catch(() => null);
        if (!info) continue;
        bytes += info.size;
        if (info.isDirectory()) await walk(path.join(at, entry.name));
      }
    };
    try {
      await walk(dir);
      return bytes;
    } catch {
      return null;
    }
  }

  /** A linked worktree of a repository, with its owning session, or null for anything else. */
  async function worktree(dir, signal) {
    const info = await lstat(dir).catch(() => null);
    if (!info?.isDirectory()) return null;
    const dirs = await runGit(dir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"], signal);
    if (dirs.code !== 0) return null;
    const [gitDir, commonDir, top] = dirs.stdout.trim().split(/\r?\n/);
    // The main checkout's own Git directory is its common one: that is the user's, never ours.
    if (!gitDir || !commonDir || path.resolve(gitDir) === path.resolve(commonDir) || path.resolve(top) !== (await realpath(dir))) return null;
    const owner = await readFile(path.join(gitDir, "codex-thread.json"), "utf8").then((text) => JSON.parse(text).ownerThreadId ?? null, () => null);
    const status = await runGit(dir, ["status", "--porcelain", "--untracked-files=normal"], signal);
    const changes = status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : null;
    return { path: dir, repository: path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir, owner, changes };
  }

  /** The bucketed worktrees under `root`, the folder session worktrees are made in. */
  async function worktrees(root, signal) {
    const found = [];
    for (const bucket of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!bucket.isDirectory() || !BUCKET.test(bucket.name)) continue;
      for (const entry of await readdir(path.join(root, bucket.name), { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const tree = await worktree(path.join(root, bucket.name, entry.name), signal);
        if (tree) found.push(tree);
      }
    }
    return found;
  }

  /** What Codex keeps on this computer, by kind, with the disk's free space; read at most once a minute. */
  async function usage({ root, refresh = false } = {}, signal) {
    if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("工作树文件夹必须是绝对路径。");
    if (!refresh && cached && cached.root === root && now() - cached.at < CACHE_MS) return cached.value;
    const deadline = now() + DEADLINE_MS;
    const trees = await worktrees(root, signal);
    for (const tree of trees) tree.bytes = await size(tree.path, deadline);
    const disk = await statfs(home).catch(() => null);
    const value = {
      home,
      worktreeRoot: root,
      sessions: await size(path.join(home, "sessions"), deadline),
      archivedSessions: await size(path.join(home, "archived_sessions"), deadline),
      attachments: await size(path.join(home, "attachments"), deadline),
      scratchWorkspaces: await size(path.join(home, "codex-ui", "scratch-workspaces"), deadline),
      worktrees: trees,
      free: disk ? disk.bavail * disk.bsize : null,
    };
    cached = { root, at: now(), value };
    return value;
  }

  /**
   * Removes worktrees `usage()` listed under `root`: each must still be a linked worktree directly in
   * a bucket there (after resolving links), and clean unless `force`. At most 50 a call; a bucket
   * left empty goes too. Returns what was removed and what was skipped, with why.
   */
  async function removeWorktrees({ root, paths, force = false } = {}, signal) {
    if (typeof root !== "string" || !path.isAbsolute(root) || !Array.isArray(paths) || paths.length > REMOVE_MAX) throw new Error("无效的清理请求。");
    const realRoot = await realpath(root).catch(() => null);
    const removed = [], skipped = [];
    for (const asked of paths) {
      const skip = (reason) => skipped.push({ path: asked, reason });
      if (typeof asked !== "string" || !path.isAbsolute(asked)) { skip("not a path"); continue; }
      const info = await lstat(asked).catch(() => null);
      if (!info || info.isSymbolicLink() || !info.isDirectory()) { skip("not a worktree folder"); continue; }
      const real = await realpath(asked).catch(() => null);
      const bucket = real && path.dirname(real);
      if (!realRoot || !real || path.dirname(bucket) !== realRoot || !BUCKET.test(path.basename(bucket))) { skip("outside the worktree folder"); continue; }
      const tree = await worktree(real, signal);
      if (!tree) { skip("not a linked Git worktree"); continue; }
      if (tree.changes === null || (tree.changes > 0 && !force)) { skip(tree.changes === null ? "could not be checked" : "has uncommitted changes"); continue; }
      const result = await runGit(tree.repository, ["worktree", "remove", ...(force ? ["--force"] : []), "--", real], signal, 60_000);
      if (result.code !== 0) { skip(result.stderr.trim().split("\n")[0] || "git worktree remove failed"); continue; }
      removed.push(asked);
      await rmdir(bucket).catch(() => {});
    }
    cached = null;
    return { removed, skipped };
  }

  return { usage, removeWorktrees };
}
