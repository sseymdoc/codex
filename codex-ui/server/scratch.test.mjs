// Run with `node --test server/scratch.test.mjs`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgs } from "./bridge.mjs";
import { createScratch } from "./scratch.mjs";

const HOUR = 3_600_000, DAY = 24 * HOUR;

function fixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-scratch-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const now = Date.now();
  return { home, now, scratch: createScratch({ home, now: () => now }) };
}

/** A workspace under the root, its tree's times `ages` ago (ms; the folder itself last). */
function workspace(root, name, files, folderAge) {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, age] of Object.entries(files)) {
    const where = path.join(dir, file);
    mkdirSync(path.dirname(where), { recursive: true });
    writeFileSync(where, "x");
    const at = new Date(Date.now() - age);
    utimesSync(where, at, at);
    if (path.dirname(where) !== dir) utimesSync(path.dirname(where), at, at);
  }
  const at = new Date(Date.now() - folderAge);
  utimesSync(dir, at, at);
  return dir;
}

test("create makes a fresh dated folder under CODEX_HOME/codex-ui/scratch-workspaces each time", async (t) => {
  const { home, scratch } = fixture(t);
  const a = (await scratch.create()).cwd, b = (await scratch.create()).cwd;
  assert.notEqual(a, b);
  for (const dir of [a, b]) {
    assert.equal(path.dirname(dir), path.join(home, "codex-ui", "scratch-workspaces"));
    assert.match(path.basename(dir), /^scratch-\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/);
    assert.ok(existsSync(dir));
  }
});

test("stale lists an empty workspace after an hour and another after a week with nothing changed in it", async (t) => {
  const { scratch } = fixture(t);
  const root = scratch.root;
  const fresh = workspace(root, "scratch-2026-10-30-000001", {}, 10 * 60_000);
  const empty = workspace(root, "scratch-2026-10-30-000002", {}, 2 * HOUR);
  const idle = workspace(root, "scratch-2026-10-20-000003", { "a.txt": 9 * DAY, "sub/b.txt": 8 * DAY }, 8 * DAY);
  const deepChange = workspace(root, "scratch-2026-10-20-000004", { "a.txt": 9 * DAY, "sub/b.txt": DAY }, 9 * DAY);
  const foreign = workspace(root, "notes", {}, 30 * DAY);
  const { paths } = await scratch.stale();
  assert.deepEqual(paths.sort(), [empty, idle].sort());
  for (const kept of [fresh, deepChange, foreign]) assert.ok(!paths.includes(kept));
});

test("remove drops only a stale workspace of its own root", async (t) => {
  const { home, scratch } = fixture(t);
  const idle = workspace(scratch.root, "scratch-2026-10-20-00000a", { "a.txt": 9 * DAY }, 9 * DAY);
  const busy = workspace(scratch.root, "scratch-2026-10-30-00000b", { "a.txt": HOUR }, 9 * DAY);
  const outside = workspace(home, "scratch-2026-10-20-00000c", {}, 9 * DAY);
  const odd = workspace(scratch.root, "keep", {}, 9 * DAY);
  for (const dir of [busy, outside, odd, path.join(scratch.root, "scratch-2026-10-20-00000a", ".."), 42]) assert.deepEqual(await scratch.remove(dir), { removed: false });
  for (const dir of [busy, outside, odd]) assert.ok(existsSync(dir));
  assert.deepEqual(await scratch.remove(idle), { removed: true });
  assert.ok(!existsSync(idle));
});

test("only --cwd names the folder new chats start in", () => {
  assert.equal(parseArgs([], {}).folder, undefined);
  const dir = path.resolve("some-folder");
  assert.deepEqual([parseArgs(["--cwd", "some-folder"], {}).cwd, parseArgs(["--cwd", "some-folder"], {}).folder], [dir, dir]);
});
