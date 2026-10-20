import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTitle, TITLE_INSTRUCTIONS } from "../../server/title.mjs";
import { requestTitle } from "./titles.ts";
import { threadTitle } from "./format.ts";

test("generated titles require a single nonempty tagged title within the safety limit", () => {
  assert.equal(parseTitle("<title>  思考动画与 Token 计数  </title>"), "思考动画与 Token 计数");
  for (const text of [null, {}, 12, "", "a title", "<title> </title>", "<title>one\ntwo</title>", `<title>${"字".repeat(201)}</title>`, "<title>first</title><title>second</title>"]) {
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

test("title client truncates descriptions, validates responses and propagates cancellation", async (t) => {
  const signal = new AbortController().signal;
  let request;
  let title = "消息发送";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ title }) };
  });
  assert.equal(await requestTitle("字".repeat(3999) + "😀", "test-model", signal), "消息发送");
  assert.equal(request.url, "/api/title");
  assert.equal(request.signal, signal);
  assert.deepEqual(JSON.parse(request.body), { description: "字".repeat(3999), model: "test-model" });
  for (title of [null, {}, "", "字".repeat(201), "two\nlines", "<title>unexpected</title>"]) assert.equal(await requestTitle("描述", null, signal), null);
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 502 }));
  await assert.rejects(requestTitle("描述", null, signal), /502/);
});
