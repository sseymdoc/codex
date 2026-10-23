import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gitDiffToRemote } from "./git.mjs";

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
