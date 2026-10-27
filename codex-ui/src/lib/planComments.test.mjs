// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of planComments.ts).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { anchor, feedbackText, nearest, overlaps } from "./planComments.ts";

const comment = (startOffset, selectedText, text, id = String(startOffset)) => ({ id, startOffset, endOffset: startOffset + selectedText.length, selectedText, comment: text });

test("修订 sends each comment under its quoted text, in text order, then the feedback", () => {
  const two = [comment(20, "step two", "Use a queue"), comment(4, "step\r\none", "Too broad")];
  assert.equal(feedbackText(two, "  "), "On selected text:\n> step\n> one\nToo broad\n\nOn selected text:\n> step two\nUse a queue");
  assert.equal(feedbackText(two, " Also test it. "), `${feedbackText(two, "")}\n\n\nAlso test it.`);
  assert.equal(feedbackText([], " Just this "), "Just this");
  assert.equal(feedbackText([], ""), "");
});

// Claude's own As (cc32965c2), cut out of the installed Claude Desktop when it is there.
function claudeAs() {
  const dir = "C:/Program Files/WindowsApps/Claude_3.6556.2.0_x64__pzs8sxrjxfjjc/app/resources/ion-dist/assets/v1";
  const file = existsSync(dir) && readdirSync(dir).find((name) => name.startsWith("cc32965c2-") && name.endsWith(".js"));
  if (!file) return null;
  const source = readFileSync(path.join(dir, file), "utf8");
  const start = source.indexOf("function As(e,t){");
  const end = source.indexOf("var js=", start);
  if (start < 0 || end < 0) return null;
  const lines = new RegExp(`\r\n?|[\n${String.fromCharCode(0x2028, 0x2029)}]`, "g");
  return new Function("Aa", `${source.slice(start, end)}; return As;`)(lines);
}

test("the feedback is Claude's, word for word", { skip: !claudeAs() && "no Claude Desktop 3.6556.2 here" }, () => {
  const As = claudeAs();
  const pieces = ["plan", " ", "step", "\n", "\r\n", "\r", String.fromCharCode(0x2028), "> quoted", "  ", "中文", ""];
  let seed = 7;
  const pick = () => pieces[(seed = (seed * 1103515245 + 12345) % 2147483648) % pieces.length];
  const words = (n) => Array.from({ length: n }, pick).join("");
  for (let round = 0; round < 500; round += 1) {
    const comments = Array.from({ length: round % 4 }, (_, index) => comment((round * 7 + index * 13) % 50, words(1 + (index % 3)) || "x", words(2), `c${index}`));
    const feedback = words(round % 3);
    assert.equal(feedbackText(comments, feedback), As(comments, feedback), JSON.stringify({ comments, feedback }));
  }
});

test("a comment keeps its place while its text is there, else moves to the nearest copy", () => {
  const flat = "Add a cache. Then add a cache test.";
  assert.equal(nearest(flat, "add a cache", 30), 18);
  assert.equal(nearest(flat, "add a cache", 0), 18);
  assert.equal(nearest(flat, "missing", 0), -1);
  assert.equal(nearest(flat, "", 0), -1);
  // Still there (whitespace aside), moved, gone.
  assert.deepEqual(anchor(flat, [comment(4, "a\ncache", "x", "a")]), [{ id: "a", start: 4, end: 11 }]);
  assert.deepEqual(anchor(`Intro. ${flat}`, [comment(18, "add a cache", "x", "b")]), [{ id: "b", start: 25, end: 36 }]);
  assert.deepEqual(anchor(flat, [comment(0, "Remove it", "x", "c")]), []);
  // A new selection may not overlap one already commented.
  assert.equal(overlaps([comment(4, "a cache", "x")], 10, 14), true);
  assert.equal(overlaps([comment(4, "a cache", "x")], 11, 14), false);
});
