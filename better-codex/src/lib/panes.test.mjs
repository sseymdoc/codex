// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of panes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_PANES, columnFlex, fileRows, ignoreWhitespace, moveEdge, rowFlex, splitRows, streamedChange, withPane, withoutPane, changedWords, rowWords } from "./panes.ts";

test("pending diff selection is isolated between chats and consumed once", async t => {
  const { openDiff, openChanges, takePendingDiff, takePendingScope } = await import("./panes.ts");
  const previous = { window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame };
  globalThis.window = new EventTarget(); globalThis.requestAnimationFrame = () => 0;
  t.after(() => { for (const key of Object.keys(previous)) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key]; } });
  openDiff("one.ts", "one", true); openDiff("two.ts", "two");
  openChanges("all", "two");
  assert.deepEqual(takePendingDiff("one"), { path: "one.ts", preserveScope: true });
  assert.equal(takePendingScope("one"), null);
  assert.deepEqual(takePendingDiff("two"), { path: "two.ts", preserveScope: false });
  assert.equal(takePendingScope("two"), "all");
  assert.equal(takePendingDiff("one"), null);
});

test("panes stack in opening order; opening one drops the expanded state, closing clears its own", () => {
  const two = withPane(withPane(NO_PANES, "diff"), "terminal");
  assert.deepEqual(two, { open: ["diff", "terminal"], expanded: null });
  assert.equal(withPane(two, "diff"), two);
  assert.deepEqual(withPane({ ...two, expanded: "diff" }, "plan"), { open: ["diff", "terminal", "plan"], expanded: null });
  assert.deepEqual(withoutPane({ ...two, expanded: "diff" }, "diff"), { open: ["terminal"], expanded: null });
  assert.deepEqual(withoutPane({ ...two, expanded: "terminal" }, "diff"), { open: ["terminal"], expanded: "terminal" });
});

test("big panes open at 3 against the chat's 2, the others at 1", () => {
  assert.equal(columnFlex("diff"), 3);
  assert.equal(columnFlex("files"), 3);
  assert.equal(columnFlex("terminal"), 1);
  assert.equal(rowFlex("plan"), 1);
});

test("an edge move trades space between the neighbours and keeps both above the floor", () => {
  assert.deepEqual(moveEdge([2, 2], [400, 400], 100, 100), [2.5, 1.5]);
  assert.deepEqual(moveEdge([1, 1], [300, 300], -Infinity, 100), [1 / 3, 5 / 3]);
  assert.deepEqual(moveEdge([1, 1], [300, 300], Infinity, 100), [5 / 3, 1 / 3]);
  assert.deepEqual(moveEdge([1, 1], [50, 50], 40, 100), [1, 1]);
});

test("hidden whitespace folds runs that match but for their lines' ends, in the new text (vr)", () => {
  // Spaces, tabs and CRs at either end don't count; inside a line they do.
  assert.equal(ignoreWhitespace("@@ -1,4 +1,4 @@\n-a b\n-c\r\n+  a b\t\n+c\n x\n-a  b\n+a b\n"), "@@ -1,4 +1,4 @@\n   a b\t\n c\n x\n-a  b\n+a b\n");
  // A run of another length is diffed on its trimmed lines, as jsdiff's diffArrays aligns them.
  assert.equal(ignoreWhitespace("@@ -1,2 +1,3 @@\n-a\n-b\n+  a\n+x\n+b\t\n"), "@@ -1,2 +1,3 @@\n   a\n+x\n b\t\n");
  assert.equal(ignoreWhitespace("@@ -1,2 +1,2 @@\n-a\n-b\n+b\n+a\n"), "@@ -1,2 +1,2 @@\n-a\n b\n+a\n");
  // The header's ---/+++ lines are no change; a removed `--…` line in a hunk is one.
  assert.equal(ignoreWhitespace("--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--- x\n+-- x \n-y\n+z\n"), "--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n -- x \n-y\n+z\n");
});

test("hidden whitespace drops a hunk left with no change and keeps a run whose last newline differs", () => {
  assert.equal(ignoreWhitespace("@@ -1 +1 @@\n-a\n+a \n@@ -9 +9 @@\n-b\n+c\n"), "@@ -9 +9 @@\n-b\n+c\n");
  const noEol = "\\ No newline at end of file";
  assert.equal(ignoreWhitespace(`@@ -1 +1 @@\n-a\n${noEol}\n+a\n`), `@@ -1 +1 @@\n-a\n${noEol}\n+a\n`);
  // Both sides end without one: context, marked once.
  assert.equal(ignoreWhitespace(`@@ -1,2 +1,2 @@\n-b\n+c\n x\n-a\n${noEol}\n+a \n${noEol}\n`), `@@ -1,2 +1,2 @@\n-b\n+c\n x\n a \n${noEol}\n`);
});

test("a streamed patch gets its context back from apply_patch's old lines then new ones, matched exactly", () => {
  const update = (diff) => ({ path: "a.py", kind: { type: "update", move_path: null }, diff });
  // The model wrote "@@ def f():\n a\n-b\n+B\n c" then "@@\n x\n-y\n z\n-w\n+W\n*** End of File".
  const streamed = "@@ def f():\n-a\n-b\n-c\n+a\n+B\n+c\n@@\n-x\n-y\n-z\n-w\n+x\n+z\n+W\n*** End of File\n";
  assert.equal(streamedChange(update(streamed)).diff, "@@ def f():\n a\n-b\n+B\n c\n@@\n x\n-y\n z\n-w\n+W\n*** End of File\n");
  // Only whitespace differs: a change still.
  assert.equal(streamedChange(update("@@\n-a\n+a \n")).diff, "@@\n-a\n+a \n");
  // A hunk of only its context so far changes nothing yet; an add or a delete is its file as is.
  assert.equal(streamedChange(update("@@\n-a\n+a\n")).diff, "\n");
  const add = { path: "n.txt", kind: { type: "add" }, diff: "-a\n+a\n" };
  assert.equal(streamedChange(add), add);
});

test("hidden whitespace diffs a run of at most 2000 lines and 400 edits", () => {
  const range = (n, line) => Array.from({ length: n }, (_, i) => line(i));
  // The run's lines that become context; "x " and "x" match.
  const kept = (dels, adds) =>
    ignoreWhitespace(`@@ -1 +1 @@\n${[...dels.map((line) => `-${line}`), ...adds.map((line) => `+${line}`)].join("\n")}\n`)
      .split("\n")
      .filter((line) => line.startsWith(" ")).length;
  assert.equal(kept(["x ", ...range(200, (i) => `a${i}`)], ["x", ...range(200, (i) => `b${i}`)]), 1);
  assert.equal(kept(["x ", ...range(201, (i) => `a${i}`)], ["x", ...range(201, (i) => `b${i}`)]), 0);
  assert.equal(kept(["x ", ...range(999, (i) => `a${i}`)], ["x", ...range(998, (i) => `a${i}`), "z"]), 999);
  assert.equal(kept(["x ", ...range(1000, (i) => `a${i}`)], ["x", ...range(999, (i) => `a${i}`)]), 0);
});

test("hidden whitespace folds a card's rows, not its counts; with no change left it is whitespace only", () => {
  const card = (file, ws) => {
    const { rows, stats, whitespaceOnly } = fileRows(file, ws);
    return [rows.map((row) => row.kind).join(" "), stats, whitespaceOnly];
  };
  const spaces = { path: "a.txt", kind: "update", diff: "@@ -1,2 +1,2 @@\n-a b\n-c\n+a b  \n+\tc\n" };
  const mixed = { ...spaces, diff: "@@ -1,2 +1,3 @@\n-a b\n+a b \n c\n+d\n" };
  const inner = { ...spaces, diff: "@@ -1 +1 @@\n-a b\n+a  b\n" };
  const made = { path: "blank.txt", kind: "add", diff: "  \n", whole: true };
  const binary = { path: "x.png", kind: "update", diff: "Binary files a/x.png and b/x.png differ\n", binary: true };
  assert.deepEqual(card(spaces, false), ["del del add add", { added: 2, removed: 2 }, false]);
  assert.deepEqual(card(spaces, true), ["", { added: 2, removed: 2 }, true]);
  assert.deepEqual(card(mixed, true), ["ctx ctx add", { added: 2, removed: 1 }, false]);
  assert.deepEqual(card(inner, true), ["del add", { added: 1, removed: 1 }, false]);
  assert.deepEqual(card(made, true), ["add", { added: 1, removed: 0 }, false]);
  assert.deepEqual(card(binary, true), ["", { added: 0, removed: 0 }, false]);
});

test("side by side pairs removed lines with the added ones after them", () => {
  const rows = [
    { kind: "ctx", oldNo: 1, newNo: 1, text: "a" },
    { kind: "gap", text: "" },
    { kind: "del", oldNo: 2, text: "b" },
    { kind: "del", oldNo: 3, text: "c" },
    { kind: "add", newNo: 2, text: "B" },
  ];
  assert.deepEqual(splitRows(rows), [
    { left: { kind: "ctx", no: 1, text: "a" }, right: { kind: "ctx", no: 1, text: "a" } },
    { gap: true },
    { left: { kind: "del", no: 2, text: "b" }, right: { kind: "add", no: 2, text: "B" } },
    { left: { kind: "del", no: 3, text: "c" }, right: null },
  ]);
});

test("changed words follow the diffs library's word-alt joins", () => {
  // One word swapped: only it is marked on either side.
  assert.deepEqual(changedWords("const a = 1;", "const b = 1;"), { del: [[6, 7]], add: [[6, 7]] });
  // A one-character gap after a change joins it ("bar " / "qux quux "); the last piece stands alone.
  assert.deepEqual(changedWords("foo bar baz", "foo qux quux baz"), { del: [[4, 8]], add: [[4, 13]] });
  // Identical lines mark nothing; a line past 1000 characters is not compared.
  assert.deepEqual(changedWords("same", "same"), { del: [], add: [] });
  assert.equal(changedWords("x".repeat(1001), "y"), undefined);
});

test("row words pair the n-th removed line of a run with the n-th added one", () => {
  const rows = [
    { kind: "ctx", text: "keep" },
    { kind: "del", text: "let x = 1" },
    { kind: "del", text: "let y = 2" },
    { kind: "add", text: "let x = 3" },
    { kind: "ctx", text: "keep" },
  ];
  assert.deepEqual([...rowWords(rows)], [[1, [[8, 9]]], [3, [[8, 9]]]]);
});

test("changed files sort into tests, build files and generated files", async () => {
  const { fileKind, byFolder } = await import("./panes.ts");
  assert.equal(fileKind("src/lib/panes.test.mjs"), "test");
  assert.equal(fileKind("pkg/server_test.go"), "test");
  assert.equal(fileKind("tests/fixtures/a.json"), "test");
  assert.equal(fileKind("pnpm-lock.yaml"), "generated");
  assert.equal(fileKind("api/v1/user.pb.go"), "generated");
  assert.equal(fileKind("Dockerfile"), "build");
  assert.equal(fileKind(".github/workflows/ci.yml"), "build");
  assert.equal(fileKind("src/main.ts"), null);
  assert.deepEqual(byFolder([{ path: "src/b.ts" }, { path: "README.md" }, { path: "src/a.ts" }]).map(([folder, files]) => [folder, files.map((f) => f.path)]), [["", ["README.md"]], ["src", ["src/b.ts", "src/a.ts"]]]);
});
