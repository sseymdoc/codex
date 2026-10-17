// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of diff.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDiff, splitUnifiedDiff } from "./diff.ts";

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
    ["hunk", null, "@@ -0,0 +1,2 @@"],
    ["add", 1, "Hello"],
    ["add", 2, "World"],
  ]);

  const updated = parseDiff(files[1].diff, files[1].kind);
  assert.deepEqual(updated.map((r) => [r.kind, r.oldNo ?? null, r.newNo ?? null]), [
    ["hunk", null, null],
    ["ctx", 10, 10],
    ["del", 11, null],
    ["add", null, 11],
  ]);
});

test("treats hunk-less content from file-change items as whole-file adds or deletes", () => {
  assert.deepEqual(parseDiff("a\nb\n", "add").map((r) => [r.kind, r.newNo]), [["add", 1], ["add", 2]]);
  assert.deepEqual(parseDiff("gone\n", "delete").map((r) => [r.kind, r.oldNo]), [["del", 1]]);
});
