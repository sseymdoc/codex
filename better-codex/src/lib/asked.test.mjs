// Run with `pnpm test`. asked.ts imports codex.ts, whose siblings load without an extension and whose
// rpc.ts has parameter properties: these hooks add ".ts" and transform with esbuild (as codex.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "esbuild";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { emptyThreadState, forgetAsked, getState, recordAsked, setState } = await import("./store.ts");
const { DISMISSED, REPLIED, answerWithMessage, answeredSome, askedMeta, receiptRows, settleAsk, unansweredLabel } = await import("./asked.ts");

const questions = [
  { id: "auth", header: "认证方式", question: "用哪种认证？", isOther: true, isSecret: false, options: [{ label: "JWT (Recommended)", description: "" }, { label: "Session", description: "" }] },
  { id: "scope", header: "范围", question: "顺便改哪些页？", isOther: true, isSecret: false, multiSelect: true, options: [{ label: "设置", description: "" }, { label: "侧栏", description: "" }] },
];
const ask = (id, threadId = "chat") => ({ id, method: "item/tool/requestUserInput", params: { threadId, turnId: "turn-1", itemId: `call-${id}`, questions, isBlocking: true, autoResolutionMs: null } });
const record = (o = {}) => ({ itemId: "call", turnId: "turn-1", after: null, questions: questions.map(({ header, question }) => ({ header, question })), answers: [[], []], how: "answered", at: 1, ...o });

function fixture(t) {
  const sent = [];
  t.mock.method(Rpc.prototype, "respond", (id, result) => sent.push({ id, result }));
  const thread = { ...emptyThreadState({ id: "chat", preview: "", ephemeral: false, modelProvider: "", createdAt: 0, updatedAt: 0, status: { type: "idle" }, path: null, cwd: "D:/x", cliVersion: "", source: "appServer", gitInfo: null, name: null, turns: [] }), turns: [{ id: "turn-1", status: "inProgress", items: [{ type: "reasoning", id: "r1", summary: [], content: [] }] }] };
  setState({ threads: { chat: thread }, requests: [ask(1), ask(2, "other")], askedQuestions: {} });
  return sent;
}

test("the receipt answers each question, comma-joined, or says why not; the row says why when nothing was", () => {
  const answered = record({ answers: [["JWT (Recommended)"], ["设置", "侧栏"]] });
  assert.deepEqual(receiptRows(answered).map((row) => row.answer), ["JWT (Recommended)", "设置, 侧栏"]);
  assert.equal(answeredSome(answered), true);
  const partly = record({ answers: [["Session"], []] });
  assert.deepEqual(receiptRows(partly).map((row) => [row.answer, row.answered]), [["Session", true], ["已跳过", false]]);
  for (const [how, label] of [["answered", "已跳过"], ["dismissed", "未回答"], ["replied", "已在对话中回复"]]) {
    assert.equal(answeredSome(record({ how })), false);
    assert.equal(unansweredLabel(how), label);
  }
  assert.equal(askedMeta(questions), "2 个问题");
  assert.equal(askedMeta(questions.slice(0, 1)), "认证方式");
});

test("answering, ✕ and a message sent instead each settle the request and keep a record", (t) => {
  const sent = fixture(t);
  settleAsk(ask(1), [["JWT (Recommended)"], ["设置", "侧栏"]], "answered");
  assert.deepEqual(sent.at(-1), { id: 1, result: { answers: { auth: { answers: ["JWT (Recommended)"] }, scope: { answers: ["设置", "侧栏"] } } } });
  let kept = getState().askedQuestions.chat;
  assert.deepEqual(kept.map(({ itemId, after, how, answers }) => ({ itemId, after, how, answers })), [{ itemId: "call-1", after: "r1", how: "answered", answers: [["JWT (Recommended)"], ["设置", "侧栏"]] }]);
  assert.equal(kept[0].questions[1].multiSelect, true);
  // ✕: Claude's words for every question, no answers kept.
  settleAsk(ask(1), [], "dismissed");
  assert.deepEqual(sent.at(-1).result, { answers: { auth: { answers: [DISMISSED] }, scope: { answers: [DISMISSED] } } });
  assert.deepEqual(getState().askedQuestions.chat.map((entry) => [entry.how, entry.answers]), [["dismissed", [[], []]]], "the same call keeps one record");
  // A message sent: only this session's waiting questions, in Claude's words.
  setState({ requests: [ask(1), ask(2, "other")] });
  answerWithMessage("chat");
  assert.deepEqual(sent.at(-1), { id: 1, result: { answers: { auth: { answers: [REPLIED] }, scope: { answers: [REPLIED] } } } });
  assert.equal(sent.filter((entry) => entry.id === 2).length, 0);
  assert.deepEqual(getState().requests.map((request) => request.id), [2]);
  kept = getState().askedQuestions.chat;
  assert.equal(kept.at(-1).how, "replied");
});

test("records keep the newest 200 across sessions and go with a deleted session", (t) => {
  fixture(t);
  for (let at = 0; at < 205; at += 1) recordAsked(at % 2 ? "a" : "b", record({ itemId: `c${at}`, at }));
  const all = Object.values(getState().askedQuestions).flat();
  assert.equal(all.length, 200);
  assert.equal(Math.min(...all.map((entry) => entry.at)), 5);
  forgetAsked("a");
  assert.equal(getState().askedQuestions.a, undefined);
  assert.equal(getState().askedQuestions.b.length, 100);
});
