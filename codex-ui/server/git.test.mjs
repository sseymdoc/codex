import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyPatch, bindWorktree, createWorktree, gitBranches, gitDiffToRemote, switchBranch } from "./git.mjs";

function repository() {
  const cwd = mkdtempSync(path.join(tmpdir(), "codex-ui-git-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (name, text) => writeFileSync(path.join(cwd, name), text);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  write("tracked.txt", "base\n");
  git("add", "tracked.txt");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", cwd);
  git("update-ref", "refs/remotes/origin/main", base);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { cwd, git, write, base };
}

test("preview includes tracked, staged, renamed, binary and quoted untracked files once", async () => {
  const { cwd, git, write, base } = repository();
  git("config", "core.quotePath", "true");
  git("mv", "tracked.txt", "renamed.txt");
  write("staged.txt", "staged\n");
  git("add", "staged.txt");
  write("new.txt", "new\n");
  write("带 空格.txt", "中文内容\n");
  write("-flag.txt", "option-safe\n");
  write("二进制.bin", Buffer.from([0, 1, 2, 3]));
  const { sha, diff } = await gitDiffToRemote(cwd);
  assert.equal(sha, base);
  for (const text of ["rename from tracked.txt", "+staged", "+new", "+中文内容", "+option-safe", "Binary files"]) {
    assert.equal(diff.split(text).length - 1, 1, text);
  }
  assert.doesNotMatch(diff, /GIT binary patch/);
});

test("remote base follows branch ancestry, origin priority and detached HEAD candidates", async () => {
  const { cwd, git, write, base } = repository();
  git("switch", "-qc", "feature");
  write("tracked.txt", "feature\n");
  git("commit", "-qam", "feature");
  const head = git("rev-parse", "HEAD");
  assert.equal((await gitDiffToRemote(cwd)).sha, base);
  git("update-ref", "refs/remotes/origin/feature", head);
  assert.equal((await gitDiffToRemote(cwd)).sha, head);
  git("remote", "add", "aaa", cwd);
  git("update-ref", "refs/remotes/aaa/feature", base);
  assert.equal((await gitDiffToRemote(cwd)).sha, head);
  git("update-ref", "-d", "refs/remotes/origin/feature");
  git("update-ref", "-d", "refs/remotes/aaa/feature");
  git("update-ref", "refs/remotes/origin/release", head);
  git("switch", "--detach", "-q", head);
  assert.equal((await gitDiffToRemote(cwd)).sha, head);
  git("update-ref", "-d", "refs/remotes/origin/release");
  assert.equal((await gitDiffToRemote(cwd)).sha, base);
});

test("missing remote and non-repository paths fail without returning an empty success", async () => {
  const { cwd, git } = repository();
  git("remote", "remove", "origin");
  await assert.rejects(gitDiffToRemote(cwd), /远端提交/);
  const empty = mkdtempSync(path.join(tmpdir(), "codex-ui-no-git-"));
  await assert.rejects(gitDiffToRemote(empty), /远端提交/);
});

test("preview fails within its budget for a single huge text file", async () => {
  const { cwd, write } = repository();
  write("tracked.txt", "x\n".repeat(5 * 1024 * 1024));
  await assert.rejects(gitDiffToRemote(cwd), /8 MiB/);
});

test("preview bounds the aggregate even when each file fits", async () => {
  const { cwd, write } = repository();
  write("one.txt", "a".repeat(5 * 1024 * 1024));
  write("two.txt", "b".repeat(5 * 1024 * 1024));
  await assert.rejects(gitDiffToRemote(cwd), /8 MiB/);
});

test("Git preview can be cancelled before or during a read", async () => {
  const { cwd } = repository();
  await assert.rejects(gitDiffToRemote(cwd, AbortSignal.abort()), { name: "AbortError" });
  const abort = new AbortController();
  const pending = gitDiffToRemote(cwd, abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("branch picker lists local branches, HEAD and origin's default; a plain folder is no repository", async () => {
  const { cwd, git } = repository();
  git("branch", "feature");
  const info = await gitBranches(cwd);
  assert.deepEqual({ ...info, root: path.basename(info.root), branches: info.branches.sort() }, {
    inRepo: true, root: path.basename(cwd), head: "main", defaultBranch: "main", branches: ["feature", "main"],
  });
  git("checkout", "-q", "--detach");
  assert.equal((await gitBranches(cwd)).head, null);
  const empty = mkdtempSync(path.join(tmpdir(), "codex-ui-no-git-"));
  assert.deepEqual(await gitBranches(empty), { inRepo: false, root: null, head: null, defaultBranch: null, branches: [] });
});

test("worktrees land in a four-hex bucket, detached at the base, and record their thread once", async () => {
  const { cwd, git, write } = repository();
  mkdirSync(path.join(cwd, "sub"));
  write("sub/file.txt", "in sub\n");
  git("add", ".");
  git("commit", "-qm", "sub");
  git("branch", "old", "HEAD~1");
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-worktrees-"));
  const made = await createWorktree(path.join(cwd, "sub"), "main", root);
  const [bucket, folder, ...rest] = path.relative(root, made.worktree).split(path.sep);
  assert.deepEqual([/^[0-9a-f]{4}$/.test(bucket), folder, rest], [true, path.basename(cwd), []]);
  assert.equal(made.cwd, path.join(made.worktree, "sub"));
  assert.equal(readFileSync(path.join(made.cwd, "file.txt"), "utf8").replace(/\r/g, ""), "in sub\n");
  const head = spawnSync("git", ["status", "--porcelain=v2", "--branch"], { cwd: made.worktree, encoding: "utf8" }).stdout;
  assert.match(head, /# branch\.head \(detached\)/);
  const older = await createWorktree(cwd, "old", root);
  assert.equal(existsSync(path.join(older.cwd, "sub")), false);
  await bindWorktree(made.cwd, "thread-1");
  await bindWorktree(made.cwd, "thread-1");
  await assert.rejects(bindWorktree(made.cwd, "thread-2"), /其他会话/);
  const owner = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-path", "codex-thread.json"], { cwd: made.cwd, encoding: "utf8" }).stdout.trim();
  assert.deepEqual(JSON.parse(readFileSync(owner, "utf8")), { version: 1, ownerThreadId: "thread-1" });
});

test("a bad base or root makes no worktree and leaves no bucket behind", async () => {
  const { cwd } = repository();
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-worktrees-"));
  await assert.rejects(createWorktree(cwd, "missing", root), /找不到分支/);
  await assert.rejects(createWorktree(cwd, "--orphan", root), /无效的分支名称/);
  await assert.rejects(createWorktree(cwd, undefined, "relative"), /绝对路径/);
  assert.deepEqual(readdirSync(root), []);
});

test("switching a folder's branch refuses option-like names and reports a blocked checkout", async () => {
  const { cwd, git, write } = repository();
  git("branch", "other");
  await switchBranch(cwd, "other");
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD"), "other");
  await assert.rejects(switchBranch(cwd, "-c"), /无效的分支名称/);
  write("tracked.txt", "local edit\n");
  git("checkout", "-q", "main");
  write("tracked.txt", "conflict\n");
  git("commit", "-qam", "main moves");
  write("tracked.txt", "dirty\n");
  await assert.rejects(switchBranch(cwd, "other"), /无法切换/);
});

test("a cloud task's diff applies whole or not at all", async () => {
  const { cwd, git, write } = repository();
  const diff = [
    "diff --git a/tracked.txt b/tracked.txt",
    "--- a/tracked.txt",
    "+++ b/tracked.txt",
    "@@ -1 +1 @@",
    "-base",
    "+from the cloud",
    "diff --git a/added.txt b/added.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/added.txt",
    "@@ -0,0 +1 @@",
    "+new",
    "",
  ].join("\n");
  write("tracked.txt", "local edit\n");
  await assert.rejects(applyPatch(cwd, diff), /冲突/);
  assert.equal(existsSync(path.join(cwd, "added.txt")), false);
  git("checkout", "--", "tracked.txt");
  await applyPatch(cwd, diff);
  assert.equal(readFileSync(path.join(cwd, "tracked.txt"), "utf8").replace(/\r/g, ""), "from the cloud\n");
  assert.equal(readFileSync(path.join(cwd, "added.txt"), "utf8").replace(/\r/g, ""), "new\n");
  await assert.rejects(applyPatch(cwd, "  "), /没有可应用/);
});
