import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
  return { sha, diff: await workingDiff(git, sha) };
}

/** The working tree against `sha`, untracked files included, within the preview budget. */
async function workingDiff(git, sha) {
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
  return diff;
}

/**
 * The changes pane's other scopes (Claude 4.4212 c9bd7af9c Kw): 未提交的更改 (against HEAD) or
 * 比较对象 (against where HEAD left `against`, its merge base), untracked files included.
 */
export async function gitDiffAgainst(cwd, { against } = {}, signal) {
  const git = (args) => runGit(cwd, args, signal);
  let sha;
  if (against === "HEAD") sha = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
  else {
    if (!branchName(against)) throw new Error("无效的分支名称。");
    sha = (await git(["merge-base", "--end-of-options", against, "HEAD"])).stdout.trim();
  }
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(against === "HEAD" ? "此仓库还没有提交。" : `无法与“${against}”比较。`);
  return { sha, diff: await workingDiff(git, sha) };
}

const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;

/** 提交 (Uw = 50): the newest commits on HEAD, for the changes pane's commit picker. */
export async function gitLog(cwd, _params, signal) {
  const result = await runGit(cwd, ["log", "-50", "--no-show-signature", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct"], signal);
  if (result.code !== 0) return { commits: [] };
  return {
    commits: result.stdout.split("\n").filter(Boolean).map((line) => {
      const [sha, short, subject, author, time] = line.split("\x1f");
      return { sha, short, subject, author, time: Number(time) };
    }),
  };
}

/** One commit's changes (a merge against its first parent), for 提交 › a commit. */
export async function gitShow(cwd, { sha } = {}, signal) {
  if (typeof sha !== "string" || !COMMIT_SHA.test(sha)) throw new Error("无效的提交。");
  const result = await runGit(cwd, ["show", "--no-textconv", "--no-ext-diff", "-m", "--first-parent", "--format=", "--end-of-options", sha, "--"], signal);
  if (result.code !== 0) throw new Error("无法读取此提交。");
  if (Buffer.byteLength(result.stdout) > MAX_DIFF_BYTES) throw tooLarge();
  return { sha, diff: result.stdout };
}

/** The environment dialog's branch picker (ca690a791 Mt / Me): local branches, HEAD and the default one. */
export async function gitBranches(cwd, signal) {
  const text = async (args) => {
    const result = await runGit(cwd, args, signal);
    return result.code === 0 ? result.stdout.trim() : "";
  };
  // The root in cwd's own spelling: --show-toplevel resolves symlinks (macOS /tmp → /private/tmp),
  // and the page matches it as a prefix of its folders.
  const cdup = await runGit(cwd, ["rev-parse", "--show-cdup"], signal);
  if (cdup.code !== 0) return { inRepo: false, root: null, head: null, defaultBranch: null, branches: [] };
  const branches = (await text(["for-each-ref", "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean);
  const head = (await text(["symbolic-ref", "--quiet", "--short", "HEAD"])) || null;
  const origin = await text(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  const defaultBranch = origin.startsWith("origin/") ? origin.slice("origin/".length) : null;
  return { inRepo: true, root: path.resolve(cwd, cdup.stdout.trim()), head, defaultBranch, branches };
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
  // cwd's place in the repository from Git itself: the toplevel comes back with symlinks resolved
  // (macOS /tmp → /private/tmp), so path.relative() against cwd would climb out of it.
  const top = await runGit(cwd, ["rev-parse", "--show-toplevel", "--show-prefix"], signal);
  if (top.code !== 0) throw new Error("不是 Git 仓库。");
  const [toplevel, prefix = ""] = top.stdout.split(/\r?\n/);
  const repository = path.resolve(toplevel);
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
  // The branch it was cut from, for 与基础分支同步: the one picked, else the checkout's own branch,
  // else what the checkout (itself a worktree) recorded.
  const from = base || (await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], signal)).stdout.trim() || (await recordedBase(cwd, signal));
  if (from && branchName(from)) await writeBase(worktree, from, signal).catch(() => {});
  return { cwd: path.resolve(worktree, prefix), worktree, repository, base: from || null };
}

/** Where codex-ui keeps a worktree's base branch: beside codex-thread.json, which only Codex's own fields may fill. */
async function baseFile(cwd, signal) {
  const located = await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "codex-ui-base.json"], signal);
  return located.code === 0 ? located.stdout.trim() : null;
}

async function writeBase(cwd, base, signal) {
  const file = await baseFile(cwd, signal);
  if (file) fs.writeFileSync(file, JSON.stringify({ version: 1, base }));
}

async function recordedBase(cwd, signal) {
  const file = await baseFile(cwd, signal);
  try {
    const base = file ? JSON.parse(fs.readFileSync(file, "utf8")).base : null;
    return branchName(base) ? base : null;
  } catch {
    return null;
  }
}

/** The files a merge left conflicted. */
async function conflicted(cwd, signal) {
  const listed = await runGit(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"], signal);
  return listed.stdout.split("\0").filter(Boolean);
}

/**
 * 与基础分支同步: merges the branch this worktree was cut from (or `base`; else origin's default
 * branch, else main / master) into HEAD, after fetching it when it has a remote. Refuses with
 * uncommitted changes or a merge still under way; on conflicts the merge stays under way with its
 * files listed, for whoever resolves them. Hooks stay off (SAFE_GIT).
 */
export async function syncWithBase(cwd, base, signal) {
  if (base !== undefined && base !== null && !branchName(base)) throw new Error("无效的分支名称。");
  const text = async (args, timeout) => {
    const result = await runGit(cwd, args, signal, timeout);
    return result.code === 0 ? result.stdout.trim() : "";
  };
  if (!(await text(["rev-parse", "--show-toplevel"]))) throw new Error("不是 Git 仓库。");
  if ((await runGit(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], signal)).code === 0) return { outcome: "merging", files: await conflicted(cwd, signal) };
  const dirty = (await text(["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean).length;
  if (dirty) return { outcome: "dirty", count: dirty };
  let branch = base || (await recordedBase(cwd, signal));
  if (!branch) {
    const origin = await text(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    branch = origin.startsWith("origin/") ? origin.slice("origin/".length) : null;
    for (const name of ["main", "master"]) if (!branch && (await text(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]))) branch = name;
  }
  if (!branch) throw new Error("不知道此工作树的基础分支。");
  const remotes = (await text(["remote"])).split("\n").filter(Boolean);
  const remote = (await text(["config", "--get", `branch.${branch}.remote`])) || (remotes.includes("origin") ? "origin" : "");
  let fetched = null;
  if (remote && remotes.includes(remote)) fetched = (await runGit(cwd, ["fetch", "--no-tags", remote, branch], signal, 60_000)).code === 0;
  const remoteRef = remote && (await text(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`])) ? `${remote}/${branch}` : null;
  const target = remoteRef ?? ((await text(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) ? branch : null);
  if (!target) throw new Error(`找不到分支“${branch}”。`);
  if ((await runGit(cwd, ["merge-base", "--is-ancestor", target, "HEAD"], signal)).code === 0) return { outcome: "up_to_date", target, fetched };
  const merged = await runGit(cwd, ["merge", "--no-edit", target], signal, 120_000);
  if (merged.code === 0) return { outcome: "merged", target, fetched, head: await text(["rev-parse", "HEAD"]) };
  const files = await conflicted(cwd, signal);
  if ((await runGit(cwd, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], signal)).code === 0 && files.length) return { outcome: "conflicts", target, fetched, files };
  throw new Error(`无法合并 ${target}：${merged.stderr.trim().split("\n")[0] || "git merge 失败"}`);
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

/**
 * A Codex Cloud task's diff applied to a local checkout, as `codex apply` does: checked whole
 * first, so a patch that does not fit changes nothing.
 */
export async function applyPatch(cwd, diff, signal) {
  if (typeof diff !== "string" || !diff.trim()) throw new Error("没有可应用的更改。");
  if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) throw tooLarge();
  const file = path.join(os.tmpdir(), `codex-ui-${randomUUID()}.patch`);
  fs.writeFileSync(file, diff.endsWith("\n") ? diff : `${diff}\n`);
  try {
    const check = await runGit(cwd, ["apply", "--check", "--whitespace=nowarn", file], signal, 60_000);
    if (check.code !== 0) throw new Error("更改与本地文件冲突，无法应用。请先提交或暂存本地更改，或换到任务所基于的分支。");
    const applied = await runGit(cwd, ["apply", "--whitespace=nowarn", file], signal, 60_000);
    if (applied.code !== 0) throw new Error("无法应用更改。");
  } finally {
    fs.rmSync(file, { force: true });
  }
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

export function runGit(cwd, args, signal, timeout = 5000) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => execFile("git", [...SAFE_GIT, ...args], {
    // No credential prompt: a fetch that needs one fails instead of waiting for a terminal.
    cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" }, timeout, maxBuffer: MAX_DIFF_BYTES, windowsHide: true, signal,
  }, (error, stdout, stderr) => {
    if (signal?.aborted) return reject(signal.reason);
    if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(tooLarge());
    // A killed git exits 1 on Windows, which must not pass for a successful diff.
    resolve({ code: error ? (error.killed ? null : error.code) : 0, stdout, stderr });
  }));
}
