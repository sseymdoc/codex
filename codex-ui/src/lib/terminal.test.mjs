import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalLinkId, terminalText } from "./terminal.ts";

const rows = (...lines) => lines.map((line) => (typeof line === "string" ? { text: line, wrapped: false } : line));

test("wrapped rows join their line and blank rows under the output go", () => {
  const out = terminalText(rows("PS C:\\> npm run dev", "> vite", { text: "  ready in 300 ms, http://localho", wrapped: false }, { text: "st:5173/", wrapped: true }, "   ", ""), 100);
  assert.deepEqual(out, { text: "PS C:\\> npm run dev\n> vite\n  ready in 300 ms, http://localhost:5173/", lines: 3, truncated: false });
});

test("only the last lines are kept, each and all of them cut to size", () => {
  assert.deepEqual(terminalText(rows("one", "two", "three"), 2), { text: "two\nthree", lines: 2, truncated: true });
  const long = terminalText(rows("x".repeat(2500)), 10);
  assert.equal(long.text.length, 2001);
  assert.equal(long.truncated, true);
  const many = terminalText(rows(...Array.from({ length: 1000 }, (_, i) => `${i}`.padEnd(1000, "."))), 1000);
  assert.ok(many.text.length <= 64 * 1024);
  assert.equal(many.truncated, true);
  assert.match(many.text, /^9\d\d\.+/m);
  assert.ok(many.text.endsWith("999".padEnd(1000, ".")));
  assert.deepEqual(terminalText([], 100), { text: "", lines: 0, truncated: false });
});

test("secrets printed in a terminal are redacted", () => {
  const out = terminalText(rows("export OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"), 10);
  assert.doesNotMatch(out.text, /abcdefghijklmnopqrstuvwxyz0123456789/);
});

test("terminal links name an eight-digit tab id and nothing else", () => {
  assert.equal(terminalLinkId("#terminal/ab12cd34"), "ab12cd34");
  for (const href of ["#terminal/", "#terminal/ab12cd3", "#terminal/AB12CD34", "#terminal/../ab12cd34", "#terminal/ab12cd345", "terminal/ab12cd34", "https://x/#terminal/ab12cd34"]) assert.equal(terminalLinkId(href), null, href);
});
