import assert from "node:assert/strict";
import { test } from "node:test";
import { ansiCss, ansiSpans, hasAnsi, trimOutput } from "./ansi.ts";

test("SGR runs carry their style; other escapes vanish", () => {
  const spans = ansiSpans("\x1b[1;31merror\x1b[0m: \x1b]0;title\x07done\x1b[2K");
  assert.deepEqual(spans, [
    { text: "error", style: { bold: true, fg: "#c82829" } },
    { text: ": ", style: {} },
    { text: "done", style: {} },
  ]);
  assert.equal(hasAnsi("plain"), false);
  assert.equal(hasAnsi("\x1b[0m"), true);
});

test("256-color and truecolor, bright, resets and inverse", () => {
  const [cube, gray, rgb, bright] = ansiSpans("\x1b[38;5;196ma\x1b[48;5;244mb\x1b[39;49;38;2;1;2;255mc\x1b[0;95md");
  assert.equal(cube.style.fg, "#ff0000");
  assert.equal(gray.style.bg, "#808080");
  assert.deepEqual(rgb.style, { fg: "#0102ff" });
  assert.deepEqual(bright.style, { fg: "#b777db" });
  assert.deepEqual(ansiCss({ inverse: true, fg: "#c82829" }), { color: "Canvas", backgroundColor: "#c82829" });
  assert.deepEqual(ansiCss({ underline: true, strikethrough: true, dim: true }), { opacity: 0.7, textDecoration: "underline line-through" });
  assert.equal(ansiCss({}), undefined);
});

test("trailing blanks and the resets among them are trimmed", () => {
  assert.equal(trimOutput("ok\x1b[32m\n\x1b[0m  \n"), "ok");
});

test("a long blank run inside the output trims in linear time", () => {
  const text = `a${"\n".repeat(40_000)}b\x1b[0m \n`;
  const started = Date.now();
  assert.equal(trimOutput(text), `a${"\n".repeat(40_000)}b`);
  assert.ok(Date.now() - started < 100);
});

test("an OSC cut off before its terminator keeps the text after it", () => {
  const text = ansiSpans("start \x1b]0;title\nline2 important").map((span) => span.text).join("");
  assert.ok(text.endsWith("line2 important"));
});
