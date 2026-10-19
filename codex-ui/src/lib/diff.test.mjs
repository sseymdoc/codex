// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of diff.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { filesStats, outputFiles, parseDiff, splitUnifiedDiff, turnFiles } from "./diff.ts";

const turnDiff = [
  "diff --git a/hello.txt b/hello.txt",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/hello.txt",
  "@@ -0,0 +1,2 @@",
  "+Hello",
  "+World",
  "diff --git a/src/app.ts b/src/app.ts",
  "index 2222222..3333333 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -10,3 +10,3 @@ function main() {",
  " keep();",
  "-old();",
  "+fresh();",
  "\\ No newline at end of file",
  "",
].join("\n");

test("splits a turn diff per file and numbers hunk lines", () => {
  const files = splitUnifiedDiff(turnDiff);
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [["hello.txt", "add"], ["src/app.ts", "update"]]);

  const added = parseDiff(files[0].diff, files[0].kind);
  assert.deepEqual(added.map((r) => [r.kind, r.newNo ?? null, r.text]), [
    ["add", 1, "Hello"],
    ["add", 2, "World"],
  ]);

  const updated = parseDiff(files[1].diff, files[1].kind);
  assert.deepEqual(updated.map((r) => [r.kind, r.oldNo ?? null, r.newNo ?? null]), [
    ["ctx", 10, 10],
    ["del", 11, null],
    ["add", null, 11],
  ]);
});

test("hunks are separated by a gap row, with none before the first", () => {
  const rows = parseDiff("@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d\n", "update");
  assert.deepEqual(rows.map((r) => r.kind), ["del", "add", "gap", "del", "add"]);
  assert.equal(rows[3].oldNo, 9);
});

test("treats hunk-less content from file-change items as whole-file adds or deletes", () => {
  assert.deepEqual(parseDiff("a\nb\n", "add").map((r) => [r.kind, r.newNo]), [["add", 1], ["add", 2]]);
  assert.deepEqual(parseDiff("gone\n", "delete").map((r) => [r.kind, r.oldNo]), [["del", 1]]);
});

test("history turns fall back to completed file-change items for their changed files", () => {
  const change = (path, kind, diff) => ({ path, kind, diff });
  const turn = {
    items: [
      { type: "fileChange", status: "completed", changes: [
        change(String.raw`C:\repo\src\new.ts`, { type: "add" }, "one\ntwo\n"),
        change(String.raw`C:\repo\src\app.ts`, { type: "update", move_path: null }, "@@ -1,2 +1,2 @@\n-old\n+new\n keep\n"),
      ] },
      { type: "fileChange", status: "declined", changes: [change(String.raw`C:\repo\skip.ts`, { type: "delete" }, "x\n")] },
    ],
  };
  const files = turnFiles(turn, String.raw`C:\repo`);
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [["src/new.ts", "add"], ["src/app.ts", "update"]]);
  assert.deepEqual(filesStats(files), { added: 3, removed: 1 });
  assert.equal(turnFiles({ diff: turnDiff, items: turn.items }, String.raw`C:\repo`).length, 2);
});

test("history turns list a file changed twice once, with both changes' hunks and counts", () => {
  const change = (name, kind, diff) => ({ path: `C:\\repo\\${name}`, kind, diff });
  const update = { type: "update", move_path: null };
  const done = (...changes) => ({ type: "fileChange", status: "completed", changes });
  const turn = {
    items: [
      done(change("new.ts", { type: "add" }, "one\ntwo\n"), change("app.ts", update, "@@ -1,2 +1,2 @@\n-old\n+new\n keep\n")),
      done(change("new.ts", update, "@@ -2,1 +2,2 @@\n two\n+three\n"), change("a.ts", { type: "update", move_path: "C:\\repo\\b.ts" }, "@@ -1 +1 @@\n-x\n+y\n")),
      done(change("app.ts", { type: "delete" }, "new\nkeep\n"), change("b.ts", update, "@@ -1 +1 @@\n-y\n+z\n")),
    ],
  };
  const files = turnFiles(turn, String.raw`C:\repo`);
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.movePath]), [["new.ts", "add", null], ["app.ts", "delete", null], ["a.ts", "update", "b.ts"]]);
  assert.deepEqual(files.map((f) => filesStats([f])), [{ added: 3, removed: 0 }, { added: 1, removed: 3 }, { added: 2, removed: 2 }]);
  assert.deepEqual(parseDiff(files[0].diff, files[0].kind).map((r) => [r.kind, r.oldNo ?? null, r.newNo ?? null, r.text]), [
    ["add", null, 1, "one"],
    ["add", null, 2, "two"],
    ["gap", null, null, ""],
    ["ctx", 2, 2, "two"],
    ["add", null, 3, "three"],
  ]);
});

test("outputs: made files newest first, without temp, Codex's own files or code in the checkout", () => {
  const add = (path) => ({ path, kind: { type: "add" }, diff: "x\n" });
  const made = (...changes) => ({ type: "fileChange", status: "completed", changes });
  const image = String.raw`C:\Users\me\.codex\generated_images\cat.png`;
  const turns = [
    { items: [made(add(String.raw`C:\Repo\src\a.ts`), add(String.raw`C:\Repo\README.md`), { path: String.raw`C:\Repo\b.md`, kind: { type: "update", move_path: null }, diff: "" })] },
    {
      items: [
        { type: "imageGeneration", id: "i", status: "completed", savedPath: image },
        made(add(String.raw`C:\Users\me\AppData\Local\Temp\x.md`), add(String.raw`C:\Repo\.codex\notes.md`), add(String.raw`C:\Repo\AGENTS.md`), add(String.raw`D:\other\out.ts`)),
        { type: "fileChange", status: "declined", changes: [add(String.raw`C:\Repo\no.md`)] },
        made(add(String.raw`C:\Repo\README.md`)),
      ],
    },
  ];
  assert.deepEqual(outputFiles(turns, String.raw`c:\repo`, true), [String.raw`C:\Repo\README.md`, String.raw`D:\other\out.ts`, image]);
  assert.deepEqual(outputFiles(turns, "C:\\Repo\\", false), [String.raw`C:\Repo\README.md`, String.raw`D:\other\out.ts`, image, String.raw`C:\Repo\src\a.ts`]);
});
