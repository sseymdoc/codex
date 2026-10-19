import assert from "node:assert/strict";
import { test } from "node:test";
import { readGitSnapshot, gitContext } from "./git.ts";

const sha = "a".repeat(40);
const status = (branch = "main", paths = "") => `# branch.oid ${sha}\0# branch.head ${branch}\0${paths}`;
const result = (stdout, exitCode = 0, stderr = "") => ({ stdout, exitCode, stderr });
const exec = (output, remote = "", base = "") => async ({ command }) =>
  command.includes("status") ? output : command.includes("remote") ? result(remote, remote ? 0 : 2) : result(base, base ? 0 : 1);

test("local repositories need no remote; rename source paths cannot masquerade as branch headers", async () => {
  const snapshot = await readGitSnapshot("D:/repo", exec(result(status("main", "2 R. N... modes hashes R100 new\0# branch.head injected\0? name\nwith-newline\0"))));
  assert.equal(snapshot.state, "repository");
  assert.deepEqual(snapshot.info, { sha, branch: "main", originUrl: null });
  assert.equal(snapshot.files, 2);
});

test("detached HEAD and unborn branches remain Git repositories", async () => {
  const detached = await readGitSnapshot("D:/repo", exec(result(status("(detached)"))));
  assert.deepEqual(detached.info, { sha, branch: null, originUrl: null });
  const unborn = await readGitSnapshot("D:/repo", exec(result(status().replace(sha, "(initial)"))));
  assert.deepEqual(unborn.info, { sha: null, branch: "main", originUrl: null });
  assert.equal(unborn.files, 0);
});

test("remote credentials and query strings never reach the UI or model context", async () => {
  const snapshot = await readGitSnapshot("D:/repo", exec(result(status()), "https://user:secret@github.com/a/b.git?token=secret#secret", "origin/main\n"));
  assert.equal(snapshot.info.originUrl, "https://github.com/a/b.git");
  assert.equal(snapshot.base, "main");
  const context = gitContext(snapshot);
  assert.equal(context["codex-ui.git"].kind, "untrusted");
  assert.doesNotMatch(JSON.stringify(context), /secret/);
  const ssh = await readGitSnapshot("D:/repo", exec(result(status()), "git@github.com:a/b.git"));
  assert.equal(ssh.info.originUrl, "ssh://github.com/a/b.git");
});

test("a failed read is unknown, not a clean or absent repository", async () => {
  const denied = await readGitSnapshot("D:/repo", exec(result("", 128, "dubious ownership")));
  assert.equal(denied.state, "unavailable");
  assert.equal(denied.files, null);
  const absent = await readGitSnapshot("D:/plain", exec(result("", 128, "fatal: not a git repository")));
  assert.equal(absent.state, "not-repository");
  const timedOut = await readGitSnapshot("D:/repo", async () => { throw new Error("timeout"); });
  assert.equal(timedOut.state, "unavailable");
  const truncated = await readGitSnapshot("D:/repo", exec(result(status() + "1 .M partial")));
  assert.equal(truncated.info.branch, "main");
  assert.equal(truncated.files, null);
});

test("Git probes are bounded, read-only, and cannot invoke a configured fsmonitor hook", async () => {
  const calls = [];
  await readGitSnapshot("D:/repo", async (params) => { calls.push(params); return result(status()); });
  assert.equal(calls.length, 3);
  for (const params of calls) {
    assert.equal(params.cwd, "D:/repo");
    assert.deepEqual(params.command.slice(0, 4), ["git", "-c", "core.fsmonitor=false", "--no-optional-locks"]);
    assert.deepEqual(params.sandboxPolicy, { type: "readOnly", networkAccess: false });
    assert.equal(params.timeoutMs, 2000);
  }
});
