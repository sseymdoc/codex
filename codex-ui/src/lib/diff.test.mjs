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

test("--- and +++ inside a hunk are a removed and an added line, not file headers", () => {
  // YAML front matter turned to TOML: its "---" lines removed, "+++" ones added.
  const diff = "--- a/post.md\n+++ b/post.md\n@@ -1,3 +1,3 @@\n----\n++++\n title: x\n----\n++++\n";
  assert.deepEqual(parseDiff(diff, "update").map((r) => [r.kind, r.oldNo ?? null, r.newNo ?? null, r.text]), [
    ["del", 1, null, "---"],
    ["add", null, 1, "+++"],
    ["ctx", 2, 2, "title: x"],
    ["del", 3, null, "---"],
    ["add", null, 3, "+++"],
  ]);
  assert.deepEqual(filesStats([{ path: "post.md", kind: "update", diff }]), { added: 2, removed: 2 });
});

test("a move's closing Moved to: line is neither a row nor counted", () => {
  // codex-rs item_builders.rs format_file_change_diff ends a move's diff with it.
  const moved = (hunks) => ({ path: "a.ts", kind: "update", movePath: "b.ts", diff: `${hunks}\n\nMoved to: C:\\repo\\b.ts` });
  const edited = moved("@@ -1 +1 @@\n-x\n+y\n");
  const renamed = moved("");
  assert.deepEqual(parseDiff(edited.diff, "update").map((r) => [r.kind, r.text]), [["del", "x"], ["add", "y"]]);
  assert.deepEqual(parseDiff(renamed.diff, "update"), []);
  assert.deepEqual([edited, renamed].map((file) => filesStats([file])), [{ added: 1, removed: 1 }, { added: 0, removed: 0 }]);
});

test("treats a file-change item's add or delete content as the whole file", () => {
  assert.deepEqual(parseDiff("a\nb\n", "add", true).map((r) => [r.kind, r.newNo]), [["add", 1], ["add", 2]]);
  assert.deepEqual(parseDiff("gone\n", "delete", true).map((r) => [r.kind, r.oldNo]), [["del", 1]]);
});

test("an empty file made or deleted has no rows and counts nothing", () => {
  // History: a file-change item's add or delete carries the content as is (item_builders.rs
  // format_file_change_diff), "" for an empty file.
  const done = (...changes) => ({ type: "fileChange", status: "completed", changes });
  const history = turnFiles(
    {
      items: [
        done({ path: "C:\\repo\\empty.txt", kind: { type: "add" }, diff: "" }, { path: "C:\\repo\\gone.txt", kind: { type: "delete" }, diff: "" }),
        // Made empty, then written to: only the write's line.
        done({ path: "C:\\repo\\log.txt", kind: { type: "add" }, diff: "" }),
        done({ path: "C:\\repo\\log.txt", kind: { type: "update", move_path: null }, diff: "@@ -0,0 +1 @@\n+first\n" }),
      ],
    },
    "C:\\repo",
  );
  // Live: turn_diff_tracker.rs render_diff gives an empty file no hunk, and similar writes no
  // --- / +++ header without one.
  const live = splitUnifiedDiff(
    [
      "diff --git a/empty.txt b/empty.txt",
      "new file mode 100644",
      "index 0000000000000000000000000000000000000000..e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
      "diff --git a/gone.txt b/gone.txt",
      "deleted file mode 100644",
      "index e69de29bb2d1d6434b8b29ae775ad8c2e48c5391..0000000000000000000000000000000000000000",
      "",
    ].join("\n"),
  );
  const rows = (f) => parseDiff(f.diff, f.kind, f.whole).map((r) => [r.kind, r.text]);
  assert.deepEqual([...history, ...live].map((f) => [f.path, f.kind, rows(f), filesStats([f])]), [
    ["empty.txt", "add", [], { added: 0, removed: 0 }],
    ["gone.txt", "delete", [], { added: 0, removed: 0 }],
    ["log.txt", "add", [["add", "first"]], { added: 1, removed: 0 }],
    ["empty.txt", "add", [], { added: 0, removed: 0 }],
    ["gone.txt", "delete", [], { added: 0, removed: 0 }],
  ]);
});

test("a whole file made or deleted is its content as is, @@ lines and all", () => {
  // A .patch file: what decides content or hunks is where the diff came from, not how it looks.
  const lines = ["--- a/x", "+++ b/x", "@@ -1 +1 @@", "-old", "+new"];
  const patch = `${lines.join("\n")}\n`;
  const done = (...changes) => ({ type: "fileChange", status: "completed", changes });
  const [made, removed] = turnFiles(
    { items: [done({ path: "C:\\repo\\fix.patch", kind: { type: "add" }, diff: patch }, { path: "C:\\repo\\old.patch", kind: { type: "delete" }, diff: patch })] },
    "C:\\repo",
  );
  assert.deepEqual(parseDiff(made.diff, made.kind, made.whole).map((r) => [r.kind, r.newNo, r.text]), lines.map((text, i) => ["add", i + 1, text]));
  assert.deepEqual(parseDiff(removed.diff, removed.kind, removed.whole).map((r) => [r.kind, r.oldNo, r.text]), lines.map((text, i) => ["del", i + 1, text]));
  assert.deepEqual([made, removed].map((f) => filesStats([f])), [{ added: 5, removed: 0 }, { added: 0, removed: 5 }]);
  // The same file in a turn diff: one hunk with every line under a +.
  const [live] = splitUnifiedDiff(`diff --git a/fix.patch b/fix.patch\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/fix.patch\n@@ -0,0 +1,5 @@\n${lines.map((text) => `+${text}`).join("\n")}\n`);
  assert.deepEqual(parseDiff(live.diff, live.kind, live.whole).map((r) => [r.kind, r.newNo, r.text]), lines.map((text, i) => ["add", i + 1, text]));
  assert.deepEqual(filesStats([live]), { added: 5, removed: 0 });
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
