import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
const SAFE_GIT = ["-c", "safe.bareRepository=explicit", "-c", `core.hooksPath=${NULL_DEVICE}`, "-c", "core.fsmonitor=false"];
// Even worst-case JSON escaping stays below the transport's 64 MiB message limit.
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
const tooLarge = () => new Error("更改内容过大，无法预览（上限 8 MiB）。请使用外部 Git 工具查看；会话可继续使用。");

/** UI preview only: retain binary file markers, never serialize their patch payloads. */
export async function gitDiffToRemote(cwd, signal) {
  const git = (args) => runGit(cwd, args, signal);
  const sha = await closestRemote(git);
  if (!sha) throw new Error("无法确定用于对比的远端提交。");
  const checked = async (args, diff = false) => {
    const result = await git(args);
    if (result.code !== 0 && !(diff && result.code === 1)) throw new Error("无法读取 Git 更改，请稍后重试。");
    return result.stdout;
  };
  const options = ["diff", "--no-textconv", "--no-ext-diff"];
  let diff = await checked([...options, sha, "--"], true);
  let bytes = Buffer.byteLength(diff);
  // NUL-delimited names also include the quoted/non-ASCII files omitted by older app-servers.
  const names = (await checked(["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (let i = 0; i < names.length; i += 8) {
    const extras = await Promise.all(names.slice(i, i + 8).map((name) => checked([...options, "--no-index", "--", NULL_DEVICE, name], true)));
    for (const extra of extras) {
      bytes += Buffer.byteLength(extra);
      if (bytes > MAX_DIFF_BYTES) throw tooLarge();
      diff += extra;
    }
  }
  return { sha, diff };
}

/** The environment dialog's branch picker (ca690a791 Mt / Me): local branches, HEAD and the default one. */
export async function gitBranches(cwd, signal) {
  const text = async (args) => {
    const result = await runGit(cwd, args, signal);
    return result.code === 0 ? result.stdout.trim() : "";
  };
  const root = await text(["rev-parse", "--show-toplevel"]);
  if (!root) return { inRepo: false, root: null, head: null, defaultBranch: null, branches: [] };
  const branches = (await text(["for-each-ref", "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean);
  const head = (await text(["symbolic-ref", "--quiet", "--short", "HEAD"])) || null;
  const origin = await text(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const defaultBranch = origin.startsWith("origin/") ? origin.slice("origin/".length) : null;
  return { inRepo: true, root: path.resolve(root), head, defaultBranch, branches };
}

const branchName = (name) => typeof name === "string" && name !== "" && !name.startsWith("-") && !/\s/.test(name) && !name.includes(String.fromCharCode(0));

/**
 * A worktree the way Codex's desktop app and codex-worktree make one: a random four-hex bucket
 * under `root` holding the repository's folder, detached at `base` (HEAD when absent). Returns
 * the folder matching `cwd` inside it, the worktree and the repository it came from.
 */
export async function createWorktree(cwd, base, root, signal) {
  if (typeof root !== "string" || !path.isAbsolute(root)) throw new Error("工作树文件夹必须是绝对路径。");
  if (base !== undefined && base !== null && !branchName(base)) throw new Error("无效的分支名称。");
  const top = await runGit(cwd, ["rev-parse", "--show-toplevel"], signal);
  if (top.code !== 0) throw new Error("不是 Git 仓库。");
  const repository = path.resolve(top.stdout.trim());
  const relative = path.relative(repository, path.resolve(cwd));
  const sha = await runGit(repository, ["rev-parse", "--verify", "--end-of-options", `${base || "HEAD"}^{commit}`], signal);
  if (sha.code !== 0) throw new Error(`找不到分支“${base || "HEAD"}”。`);
  fs.mkdirSync(root, { recursive: true });
  let bucket;
  for (;;) {
    bucket = path.join(root, randomUUID().replace(/-/g, "").slice(0, 4));
    try {
      fs.mkdirSync(bucket);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const worktree = path.join(bucket, path.basename(repository));
  const added = await runGit(repository, ["worktree", "add", "--detach", worktree, sha.stdout.trim()], signal, 120_000);
  if (added.code !== 0) {
    fs.rmSync(bucket, { recursive: true, force: true });
    throw new Error("无法创建工作树。");
  }
  return { cwd: path.join(worktree, relative), worktree, repository };
}

/** codex-worktree metadata.rs: record the owning thread in the worktree's Git directory, never replacing another. */
export async function bindWorktree(cwd, threadId, signal) {
  if (typeof threadId !== "string" || !threadId) throw new Error("缺少会话 ID。");
  const located = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "codex-thread.json"], signal);
  if (located.code !== 0) throw new Error("不是 Git 工作树。");
  const file = located.stdout.trim();
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, ownerThreadId: threadId }), { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST" || JSON.parse(fs.readFileSync(file, "utf8")).ownerThreadId !== threadId) throw new Error("工作树已属于其他会话。");
  }
}

/** Claude's "Switch this folder to": check the branch out in place before the session starts. */
export async function switchBranch(cwd, branch, signal) {
  if (!branchName(branch)) throw new Error("无效的分支名称。");
  const result = await runGit(cwd, ["switch", branch], signal, 60_000);
  if (result.code !== 0) throw new Error(`无法切换到“${branch}”：请先提交或暂存本地更改。`);
}

/** Same candidate order as git-utils: current branch, default branch, branches containing HEAD. */
async function closestRemote(git) {
  const text = async (args) => {
    const result = await git(args);
    return result.code === 0 ? result.stdout.trim() : "";
  };
  const remotes = (await text(["remote"])).split("\n").filter(Boolean);
  const origin = remotes.indexOf("origin");
  if (origin > 0) remotes.unshift(...remotes.splice(origin, 1));
  if (!remotes.length) return null;
  const branches = new Set();
  const current = await text(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current && current !== "HEAD") branches.add(current);
  let defaultBranch;
  for (const remote of remotes) {
    const ref = await text(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
    defaultBranch = ref ? ref.slice(`refs/remotes/${remote}/`.length) : /^\s*HEAD branch: (.+)$/m.exec(await text(["remote", "show", remote]))?.[1]?.trim();
    if (defaultBranch) break;
  }
  if (!defaultBranch) {
    for (const branch of ["main", "master"]) {
      if (await text(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) { defaultBranch = branch; break; }
    }
  }
  if (defaultBranch) branches.add(defaultBranch);
  for (const remote of remotes) {
    const refs = await text(["for-each-ref", "--format=%(refname:short)", "--contains=HEAD", `refs/remotes/${remote}`]);
    for (const ref of refs.split("\n")) if (ref.startsWith(`${remote}/`)) branches.add(ref.slice(remote.length + 1));
  }
  let closest, distance = Infinity;
  for (const branch of branches) {
    for (const remote of remotes) {
      const ref = `refs/remotes/${remote}/${branch}`;
      const sha = await text(["rev-parse", "--verify", "--quiet", ref]);
      if (!sha) continue;
      const count = await text(["rev-list", "--count", `${branch}..HEAD`]) || await text(["rev-list", "--count", `${ref}..HEAD`]);
      if (/^\d+$/.test(count) && Number(count) < distance) { closest = sha; distance = Number(count); }
      break;
    }
  }
  return closest;
}

function runGit(cwd, args, signal, timeout = 5000) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => execFile("git", [...SAFE_GIT, ...args], {
    cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout, maxBuffer: MAX_DIFF_BYTES, windowsHide: true, signal,
  }, (error, stdout) => {
    if (signal?.aborted) return reject(signal.reason);
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(tooLarge());
    // A killed git exits 1 on Windows, which must not pass for a successful diff.
    resolve({ code: error ? (error.killed ? null : error.code) : 0, stdout });
  }));
}
