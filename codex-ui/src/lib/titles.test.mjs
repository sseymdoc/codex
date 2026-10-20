import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTitle, TITLE_INSTRUCTIONS } from "./titles.ts";
import { threadTitle } from "./format.ts";

test("generated titles require a single nonempty tagged title within the safety limit", () => {
  assert.equal(parseTitle("<title>  思考动画与 Token 计数  </title>"), "思考动画与 Token 计数");
  for (const text of ["", "a title", "<title> </title>", "<title>one\ntwo</title>", `<title>${"字".repeat(201)}</title>`, "<title>first</title><title>second</title>"]) {
    assert.equal(parseTitle(text), null, text);
  }
  assert.equal(parseTitle(`<title>${"字".repeat(200)}</title>`), "字".repeat(200));
  assert.match(TITLE_INSTRUCTIONS, /2-5 words/);
});

test("unnamed sessions have a short Unicode-safe fallback while saved titles and agent names stay intact", () => {
  const text = "修复" + "😀".repeat(35);
  assert.equal(threadTitle({ preview: text }), "修复" + "😀".repeat(28) + "…");
  assert.equal(threadTitle({ name: text, preview: "fallback" }), text);
  assert.equal(threadTitle({ agentNickname: "Gauss", preview: text }), "Gauss");
  assert.equal(threadTitle({ preview: "first line\nsecond line" }), "first line");
});
