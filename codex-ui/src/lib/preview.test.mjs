// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of preview.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_MARKS, addedRanges, docLevels, nextMarks, splitHighlighted } from "./preview.ts";

test("added lines become merged character ranges of the new text", () => {
  assert.deepEqual(addedRanges("a\nb\nc\n", "a\nb\nc\n"), []);
  assert.deepEqual(addedRanges("a\nc\n", "a\nb\nc\n"), [[2, 4]]);
  assert.deepEqual(addedRanges("a\nb\nc\nd\n", "a\nx\nc\ny\n"), [[2, 4], [6, 8]]);
  assert.deepEqual(addedRanges("a\nb\n", "a\nb\nc\nd"), [[4, 7]]);
  assert.deepEqual(addedRanges("a\nb\nc\n", "a\nc\n"), []);
});

test("a rewrite marks only when under half the file is new, alternating the stamp", () => {
  const first = nextMarks("one\ntwo\nthree\nfour\n", "one\ntwo\nTHREE\nfour\n", NO_MARKS);
  assert.deepEqual(first, { ranges: [[8, 14]], stamp: "b" });
  assert.equal(nextMarks("one\ntwo\nthree\nfour\n", "one\ntwo\nthree\nfive\n", first).stamp, "a");
  assert.equal(nextMarks("short\n", "entirely different text\n", first), NO_MARKS);
});

test("highlighted HTML splits into lines with balanced spans", () => {
  assert.deepEqual(splitHighlighted('<span class="c">/* a\nb */</span>\nx'), ['<span class="c">/* a</span>', '<span class="c">b */</span>', "x"]);
  assert.deepEqual(splitHighlighted("a &lt; b"), ["a &lt; b"]);
});

test("rail levels follow the shallowest heading, skipping a lone title", () => {
  assert.deepEqual(docLevels([1, 2, 2, 3]), [0, 0, 0, 1]);
  assert.deepEqual(docLevels([2, 2, 3, 3]), [0, 0, 1, 1]);
  assert.deepEqual(docLevels([1, 3, 3, 1]), [0, 2, 2, 0]);
});
