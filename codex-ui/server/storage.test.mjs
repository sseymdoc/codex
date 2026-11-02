import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createWorktree } from "./git.mjs";
import { createStorage } from "./storage.mjs";

function repo(t) {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-storage-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = path.join(home, "project");
  mkdirSync(main);
  const git = (...args) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: main, stdio: "pipe" });
  git("init", "-q");
  writeFileSync(path.join(main, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-qm", "init");
  mkdirSync(path.join(home, "sessions"));
  writeFileSync(path.join(home, "sessions", "rollout.jsonl"), "x".repeat(100));
  return { home, main, root: path.join(home, "worktrees") };
}

test("usage counts the kinds of storage and lists the bucketed worktrees", async (t) => {
  const { home, main, root } = repo(t);
  const { worktree } = await createWorktree(main, null, root);
  const usage = await createStorage({ home }).usage({ root });
  assert.equal(usage.sessions, 100);
  assert.equal(usage.worktrees.length, 1);
  assert.equal(usage.worktrees[0].path, worktree);
  assert.equal(usage.worktrees[0].changes, 0);
  assert.ok(usage.worktrees[0].bytes > 0);
  await assert.rejects(createStorage({ home }).usage({ root: "relative" }), /绝对路径/);
});

test("only a clean linked worktree in a bucket is removed, and its bucket with it", async (t) => {
  const { home, main, root } = repo(t);
  const storage = createStorage({ home });
  const clean = (await createWorktree(main, null, root)).worktree;
  const dirty = (await createWorktree(main, null, root)).worktree;
  writeFileSync(path.join(dirty, "new.txt"), "work\n");
  const link = path.join(root, "beef");
  mkdirSync(link);
  symlinkSync(clean, path.join(link, "project"));
  const stray = path.join(root, "notabucket", "project");
  mkdirSync(stray, { recursive: true });
  const { removed, skipped } = await storage.removeWorktrees({ root, paths: [main, path.join(link, "project"), stray, dirty, clean] });
  assert.deepEqual(removed, [clean]);
  assert.deepEqual(skipped.map((entry) => entry.reason), ["outside the worktree folder", "not a worktree folder", "outside the worktree folder", "has uncommitted changes"]);
  assert.equal(existsSync(path.dirname(clean)), false);
  assert.ok(existsSync(path.join(main, "a.txt")), "the main checkout stays");
  // Forced, uncommitted work goes too.
  assert.deepEqual((await storage.removeWorktrees({ root, paths: [dirty], force: true })).removed, [dirty]);
});
