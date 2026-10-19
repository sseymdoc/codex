// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of panes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_PANES, columnFlex, fileRows, ignoreWhitespace, moveEdge, rowFlex, splitRows, withPane, withoutPane } from "./panes.ts";

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

test("whitespace-only rewrites become context; real changes stay", () => {
  assert.equal(ignoreWhitespace("@@ -1,2 +1,2 @@\n-a  b\n-c\n+a b\n+\tc\n"), "@@ -1,2 +1,2 @@\n a b\n \tc\n");
  assert.equal(ignoreWhitespace("@@ -1 +1 @@\n-a\n+b\n"), "@@ -1 +1 @@\n-a\n+b\n");
  assert.equal(ignoreWhitespace("--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- x\n+--  x\n"), "--- a/x\n+++ b/x\n@@ -1 +1 @@\n --  x\n");
});

test("hidden whitespace folds a card's rows, not its counts; with no change left it is whitespace only", () => {
  const card = (file, ws) => {
    const { rows, stats, whitespaceOnly } = fileRows(file, ws);
    return [rows.map((row) => row.kind).join(" "), stats, whitespaceOnly];
  };
  const spaces = { path: "a.txt", kind: "update", diff: "@@ -1,2 +1,2 @@\n-a b\n-c\n+a  b\n+\tc\n" };
  const mixed = { ...spaces, diff: "@@ -1,2 +1,3 @@\n-a b\n+a  b\n c\n+d\n" };
  const made = { path: "blank.txt", kind: "add", diff: "  \n", whole: true };
  const binary = { path: "x.png", kind: "update", diff: "Binary files a/x.png and b/x.png differ\n", binary: true };
  assert.deepEqual(card(spaces, false), ["del del add add", { added: 2, removed: 2 }, false]);
  assert.deepEqual(card(spaces, true), ["", { added: 2, removed: 2 }, true]);
  assert.deepEqual(card(mixed, true), ["ctx ctx add", { added: 2, removed: 1 }, false]);
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
