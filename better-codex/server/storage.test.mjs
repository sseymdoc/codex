import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bindWorktree, createWorktree } from "./git.mjs";
import { createStorage } from "./storage.mjs";

function repo(t) {
  const home = mkdtempSync(path.join(tmpdir(), "better-codex-storage-"));
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

/** A session worktree as Better Codex makes one: cut, then bound to its session. */
async function sessionWorktree(main, root, owner = "thread-1") {
  const { worktree } = await createWorktree(main, null, root);
  await bindWorktree(worktree, owner);
  return worktree;
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
  await assert.rejects(createStorage({ home }).usage({ root: "relative" }), { code: "INVALID", message: /绝对路径/ });
  await assert.rejects(createStorage({ home }).removeWorktrees({ root, paths: Array(51).fill(worktree) }), { code: "INVALID" });
});

test("only a clean session worktree in a bucket is removed, and its bucket with it", async (t) => {
  const { home, main, root } = repo(t);
  const storage = createStorage({ home });
  const clean = await sessionWorktree(main, root);
  const dirty = await sessionWorktree(main, root, "thread-2");
  // Clean and bucketed, but no session owns it: someone else's worktree.
  const unowned = (await createWorktree(main, null, root)).worktree;
  writeFileSync(path.join(dirty, "new.txt"), "work\n");
  const link = path.join(root, "beef");
  mkdirSync(link);
  // A junction on Windows: a directory symlink there needs Developer Mode or admin rights.
  symlinkSync(clean, path.join(link, "project"), process.platform === "win32" ? "junction" : "dir");
  const stray = path.join(root, "notabucket", "project");
  mkdirSync(stray, { recursive: true });
  const { removed, skipped } = await storage.removeWorktrees({ root, paths: [main, path.join(link, "project"), stray, unowned, dirty, clean] });
  assert.deepEqual(removed, [clean]);
  assert.deepEqual(skipped.map((entry) => entry.reason), ["outside the worktree folder", "not a worktree folder", "outside the worktree folder", "not a Codex session worktree", "has uncommitted changes"]);
  assert.ok(existsSync(unowned), "a worktree no session owns stays");
  assert.deepEqual((await storage.removeWorktrees({ root, paths: [unowned], force: true })).removed, [], "even forced");
  assert.equal(existsSync(path.dirname(clean)), false);
  assert.ok(existsSync(path.join(main, "a.txt")), "the main checkout stays");
  // Forced, uncommitted work goes too.
  assert.deepEqual((await storage.removeWorktrees({ root, paths: [dirty], force: true })).removed, [dirty]);
});

test("a commit only the detached worktree holds counts as a change and keeps it", async (t) => {
  const { home, main, root } = repo(t);
  const worktree = await sessionWorktree(main, root);
  writeFileSync(path.join(worktree, "b.txt"), "b\n");
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: worktree, stdio: "pipe" });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "agent work"], { cwd: worktree, stdio: "pipe" });
  const storage = createStorage({ home });
  assert.equal((await storage.usage({ root })).worktrees[0].changes, 1);
  const { removed, skipped } = await storage.removeWorktrees({ root, paths: [worktree] });
  assert.deepEqual(removed, []);
  assert.deepEqual(skipped.map((entry) => entry.reason), ["has uncommitted changes"]);
});
