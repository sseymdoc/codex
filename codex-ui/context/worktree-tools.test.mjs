import assert from "node:assert/strict";
import { test } from "node:test";
import { DESKTOP_TOOLS, validateDesktopInput, validateDesktopResult } from "./desktop-tools.mjs";
import { WORKTREE_TOOL_NAMES, worktreeResult } from "./worktree-tools.mjs";

const check = (name, args, value) => validateDesktopResult(name, { threadId: "t", cwd: "/p", ...value }, { threadId: "t", cwd: "/p", name, args: validateDesktopInput(name, args) });

test("the worktree tools are offered with the other desktop tools", () => {
  for (const name of WORKTREE_TOOL_NAMES) assert.ok(DESKTOP_TOOLS.some((tool) => tool.name === name), name);
});

test("a base is a branch name; enter_worktree takes nothing", () => {
  assert.deepEqual(validateDesktopInput("sync_with_base_branch", {}), {});
  assert.deepEqual(validateDesktopInput("sync_with_base_branch", { base: " release/1.2 " }), { base: "release/1.2" });
  for (const base of ["", "-x", "--upload-pack=evil", "a b", "a..b", "x~1", "x:y"]) assert.throws(() => validateDesktopInput("sync_with_base_branch", { base }), /base must be a branch name/, base);
  assert.throws(() => validateDesktopInput("enter_worktree", { base: "main" }), /Unknown enter_worktree arguments: base/);
});

test("receipts answer their call", () => {
  assert.doesNotThrow(() => check("enter_worktree", {}, { outcome: "entered", worktree: "C:/w/ab12/repo", base: "main" }));
  assert.doesNotThrow(() => check("enter_worktree", {}, { outcome: "not_deferred" }));
  assert.throws(() => check("enter_worktree", {}, { outcome: "not_deferred", worktree: "x" }));
  assert.doesNotThrow(() => check("sync_with_base_branch", {}, { outcome: "conflicts", target: "origin/main", fetched: true, files: ["a.txt"] }));
  assert.doesNotThrow(() => check("sync_with_base_branch", {}, { outcome: "up_to_date", target: "main", fetched: null }));
  assert.throws(() => check("sync_with_base_branch", {}, { outcome: "rebased" }));
  assert.throws(() => check("sync_with_base_branch", {}, { outcome: "merged", head: "not-a-sha" }));
});

test("results say what to do next; entering carries the mark the transcript reads", () => {
  const entered = worktreeResult("enter_worktree", {}, { outcome: "entered", worktree: "C:/w/ab12/repo", base: "main" });
  assert.match(entered.content[0].text, /end this turn now with one short sentence and no further tool calls/);
  assert.deepEqual(entered._meta, { codexUiWorktree: "entered" });
  assert.equal(worktreeResult("enter_worktree", {}, { outcome: "not_deferred" })._meta, undefined);
  assert.match(worktreeResult("sync_with_base_branch", {}, { outcome: "conflicts", target: "origin/main", fetched: true, files: ["a.txt", "b.txt"] }).content[0].text, /conflicts in: a\.txt, b\.txt\. The merge is still under way/);
  assert.match(worktreeResult("sync_with_base_branch", {}, { outcome: "merged", target: "main", fetched: false, head: "a".repeat(40) }).content[0].text, /fetching it failed, so the local copy was used/);
  assert.match(worktreeResult("sync_with_base_branch", {}, { outcome: "dirty", count: 2 }).content[0].text, /never discard the user's changes/);
});
