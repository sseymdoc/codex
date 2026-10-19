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

test("a binary file's section is marked binary, with no rows and no counts", () => {
  // gitDiffToRemote (git-utils info.rs diff_against_sha): `git diff` says a tracked binary file
  // differs; `git diff --binary --no-index` gives an untracked one's base85 patch.
  const files = splitUnifiedDiff(
    [
      "diff --git a/gone.bin b/gone.bin",
      "deleted file mode 100644",
      "index 83658a8..0000000",
      "Binary files a/gone.bin and /dev/null differ",
      "diff --git a/mod.png b/mod.png",
      "index beb58e6..f5d2bd3 100644",
      "Binary files a/mod.png and b/mod.png differ",
      "diff --git a/a.txt b/a.txt",
      "index 8e27be7..c45acb2 100644",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      " text",
      "+more",
      "diff --git a/new.png b/new.png",
      "new file mode 100644",
      "index 0000000000000000000000000000000000000000..4e6f65bd4a316165d607a499efd25ae959656a95",
      "GIT binary patch",
      "literal 7",
      "OcmWIb3khQ2<NyE%Gyz)x",
      "",
      "literal 0",
      "HcmV?d00001",
      "",
      "",
    ].join("\n"),
  );
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.binary ?? false, parseDiff(f.diff, f.kind, f.whole).length, filesStats([f])]), [
    ["gone.bin", "delete", true, 0, { added: 0, removed: 0 }],
    ["mod.png", "update", true, 0, { added: 0, removed: 0 }],
    ["a.txt", "update", false, 2, { added: 1, removed: 0 }],
    ["new.png", "add", true, 0, { added: 0, removed: 0 }],
  ]);
});

test("git's rename lines say where a file moved from, its mode lines the executable bit", () => {
  // gitDiffToRemote is a plain `git diff <sha>`, which finds renames (diff.renames is on by
  // default): git 2.56 after `git mv` and `git update-index --chmod`.
  const files = splitUnifiedDiff(
    [
      "diff --git a/docs/guide.md b/notes/guide.md",
      "similarity index 85%",
      "rename from docs/guide.md",
      "rename to notes/guide.md",
      "index e88c482..38c8a48 100644",
      "--- a/docs/guide.md",
      "+++ b/notes/guide.md",
      "@@ -1,7 +1,7 @@",
      " alpha",
      " beta",
      " gamma",
      "-delta",
      "+DELTA",
      " epsilon",
      " zeta",
      " eta",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "diff --git a/tool.sh b/tool.sh",
      "old mode 100755",
      "new mode 100644",
      "",
    ].join("\n"),
  );
  assert.deepEqual(files.map((f) => [f.path, f.movePath, f.kind, f.executable, parseDiff(f.diff, f.kind).length, filesStats([f])]), [
    ["docs/guide.md", "notes/guide.md", "update", undefined, 8, { added: 1, removed: 1 }],
    ["run.sh", null, "update", true, 0, { added: 0, removed: 0 }],
    ["src/old.ts", "src/new.ts", "update", undefined, 0, { added: 0, removed: 0 }],
    ["tool.sh", null, "update", false, 0, { added: 0, removed: 0 }],
  ]);
});

test("git's C-quoted paths are the names they quote, at either end of a header and in its rename lines", () => {
  // gitDiffToRemote for a Windows checkout under git 2.56's defaults (core.quotePath on): `git diff
  // <sha>` after `git mv`s and edits, then the untracked `new file.txt`'s `git diff --binary
  // --no-index`. Last, the same for an untracked 新文件.txt, which info.rs itself drops for now:
  // it hands on the name as `git ls-files` quotes it.
  const files = splitUnifiedDiff(
    [
      'diff --git "a/docs/\\350\\215\\211\\347\\250\\277 \\344\\270\\200.txt" "b/docs/\\350\\215\\211\\347\\250\\277 \\344\\272\\214.txt"',
      "similarity index 54%",
      'rename from "docs/\\350\\215\\211\\347\\250\\277 \\344\\270\\200.txt"',
      'rename to "docs/\\350\\215\\211\\347\\250\\277 \\344\\272\\214.txt"',
      "index 94ebaf9..c33d498 100644",
      '--- "a/docs/\\350\\215\\211\\347\\250\\277 \\344\\270\\200.txt"\t',
      '+++ "b/docs/\\350\\215\\211\\347\\250\\277 \\344\\272\\214.txt"\t',
      "@@ -1,4 +1,4 @@",
      " 1",
      " 2",
      " 3",
      "-4",
      "+four",
      "diff --git a/my notes.txt b/my notes.txt",
      "index b77b4eb..7061c57 100644",
      "--- a/my notes.txt\t",
      "+++ b/my notes.txt\t",
      "@@ -1,2 +1,2 @@",
      " x",
      "-y",
      "+Y",
      'diff --git "a/\\346\\227\\247\\346\\226\\207\\344\\273\\266.md" b/plain.md',
      "similarity index 100%",
      'rename from "\\346\\227\\247\\346\\226\\207\\344\\273\\266.md"',
      "rename to plain.md",
      'diff --git a/ascii.md "b/\\344\\270\\255\\346\\226\\207\\345\\220\\215.md"',
      "similarity index 100%",
      "rename from ascii.md",
      'rename to "\\344\\270\\255\\346\\226\\207\\345\\220\\215.md"',
      'diff --git "a/\\346\\212\\245\\345\\221\\212.md" "b/\\346\\212\\245\\345\\221\\212.md"',
      "index de98044..7be73ce 100644",
      '--- "a/\\346\\212\\245\\345\\221\\212.md"',
      '+++ "b/\\346\\212\\245\\345\\221\\212.md"',
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      'diff --git "a/\\350\\257\\264\\346\\230\\216.md" "b/\\346\\226\\207\\346\\241\\243.md"',
      "similarity index 100%",
      'rename from "\\350\\257\\264\\346\\230\\216.md"',
      'rename to "\\346\\226\\207\\346\\241\\243.md"',
      "diff --git a/new file.txt b/new file.txt",
      "new file mode 100644",
      "index 0000000..5626abf",
      "--- /dev/null",
      "+++ b/new file.txt\t",
      "@@ -0,0 +1 @@",
      "+one",
      'diff --git "a/\\346\\226\\260\\346\\226\\207\\344\\273\\266.txt" "b/\\346\\226\\260\\346\\226\\207\\344\\273\\266.txt"',
      "new file mode 100644",
      "index 0000000..856af18",
      "--- /dev/null",
      '+++ "b/\\346\\226\\260\\346\\226\\207\\344\\273\\266.txt"',
      "@@ -0,0 +1 @@",
      "+新",
      "",
    ].join("\n"),
  );
  assert.deepEqual(files.map((f) => [f.path, f.movePath, f.kind, parseDiff(f.diff, f.kind).length, filesStats([f])]), [
    ["docs/草稿 一.txt", "docs/草稿 二.txt", "update", 5, { added: 1, removed: 1 }],
    ["my notes.txt", null, "update", 3, { added: 1, removed: 1 }],
    ["旧文件.md", "plain.md", "update", 0, { added: 0, removed: 0 }],
    ["ascii.md", "中文名.md", "update", 0, { added: 0, removed: 0 }],
    ["报告.md", null, "update", 4, { added: 1, removed: 1 }],
    ["说明.md", "文档.md", "update", 0, { added: 0, removed: 0 }],
    ["new file.txt", null, "add", 1, { added: 1, removed: 0 }],
    ["新文件.txt", null, "add", 1, { added: 1, removed: 0 }],
  ]);
});

test("a quoted path's escapes: a tab, a newline, a double quote and a backslash; a copy's quoted name", () => {
  // Names no Windows checkout holds, so git 2.56 under diff.renames=copies between two commits
  // built from the index.
  const files = splitUnifiedDiff(
    [
      'diff --git "a/back\\\\slash.txt" "b/back\\\\slash.txt"',
      "deleted file mode 100644",
      "index 6178079..0000000",
      '--- "a/back\\\\slash.txt"',
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-b",
      'diff --git "a/new\\nline.txt" "b/new\\nline.txt"',
      "new file mode 100644",
      "index 0000000..8ba3a16",
      "--- /dev/null",
      '+++ "b/new\\nline.txt"',
      "@@ -0,0 +1 @@",
      "+n",
      'diff --git "a/say \\"hi\\".txt" "b/say \\"bye\\".txt"',
      "similarity index 100%",
      'rename from "say \\"hi\\".txt"',
      'rename to "say \\"bye\\".txt"',
      'diff --git "a/tab\\there.txt" "b/tab\\there.txt"',
      "index ba21892..46a7cd0 100644",
      '--- "a/tab\\there.txt"',
      '+++ "b/tab\\there.txt"',
      "@@ -1,2 +1,2 @@",
      " t1",
      "-t2",
      "+T2",
      'diff --git "a/tab\\there.txt" "b/\\345\\211\\257\\346\\234\\254.txt"',
      "similarity index 100%",
      'copy from "tab\\there.txt"',
      'copy to "\\345\\211\\257\\346\\234\\254.txt"',
      "",
    ].join("\n"),
  );
  assert.deepEqual(files.map((f) => [f.path, f.movePath, f.kind, filesStats([f])]), [
    ["back\\slash.txt", null, "delete", { added: 0, removed: 1 }],
    ["new\nline.txt", null, "add", { added: 1, removed: 0 }],
    ['say "hi".txt', 'say "bye".txt', "update", { added: 0, removed: 0 }],
    ["tab\there.txt", null, "update", { added: 1, removed: 1 }],
    ["副本.txt", null, "add", { added: 0, removed: 0 }],
  ]);
});

test("a turn diff's move is its header's two paths; a copy is a new file; other prefixes are no file", () => {
  const files = splitUnifiedDiff(
    [
      // turn_diff_tracker.rs render_diff writes a move with no rename lines.
      "diff --git a/src.txt b/dst.txt",
      "index 1111111..2222222",
      "--- a/src.txt",
      "+++ b/dst.txt",
      "@@ -1 +1 @@",
      "-line",
      "+line2",
      // A folder named "x b": the same path twice is no move.
      "diff --git a/x b/y.ts b/x b/y.ts",
      "index 3333333..4444444 100644",
      "--- a/x b/y.ts",
      "+++ b/x b/y.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      // diff.renames=copies: what it copied stays.
      "diff --git a/a.txt b/b.txt",
      "similarity index 100%",
      "copy from a.txt",
      "copy to b.txt",
      // diff.mnemonicPrefix names `git diff <sha>`'s two ends c/ and w/; its lines are not b.txt's.
      "diff --git c/my notes.txt w/my notes.txt",
      "index b77b4eb..7061c57 100644",
      "--- c/my notes.txt\t",
      "+++ w/my notes.txt\t",
      "@@ -1,2 +1,2 @@",
      " x",
      "-y",
      "+Y",
      "",
    ].join("\n"),
  );
  assert.deepEqual(files.map((f) => [f.path, f.movePath, f.kind, filesStats([f])]), [
    ["src.txt", "dst.txt", "update", { added: 1, removed: 1 }],
    ["x b/y.ts", null, "update", { added: 1, removed: 1 }],
    ["b.txt", null, "add", { added: 0, removed: 0 }],
  ]);
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
