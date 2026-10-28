// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of wrap-up.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { WAITING_LINE, blockedBox, dismissWrapUp, nextStep, wrapReceipt } from "./wrap-up.ts";

const wrapUp = (id, args, extra = {}) => ({ type: "mcpToolCall", id, server: "codex_ui_desktop", tool: "wrap_up", status: "completed", arguments: args, result: null, error: null, ...extra });
const said = (text) => ({ type: "userMessage", id: `u-${text}`, clientId: null, content: [{ type: "text", text, text_elements: [] }] });
const turn = (items, status = "completed") => ({ id: `t-${items.map((item) => item.id).join("-")}`, status, items });
const ASK = { recap: "Fixed the parser. Nothing committed.", ask: "Commit it?", actions: [{ label: "Yes", message: "Commit the parser fix." }, { label: "Not now" }] };

test("the latest turn's last wrap_up makes the box once the turn is over", () => {
  const box = nextStep(turn([said("go"), wrapUp("w1", { recap: "Old." }), wrapUp("w2", ASK)]), "thread-a", [], []);
  assert.deepEqual(box, {
    callId: "w2", recap: ASK.recap, question: "Commit it?", asks: true, primary: true, blocked: false,
    chips: [{ kind: "reply", reply: { label: "Yes", message: "Commit the parser fix." } }, { kind: "reply", reply: { label: "Not now" } }],
  });
  assert.equal(nextStep(turn([wrapUp("w2", ASK)], "inProgress"), "thread-a", [], []), null, "hidden while the turn runs");
  assert.equal(nextStep(turn([wrapUp("w2", ASK, { status: "failed" })]), "thread-a", [], []), null, "a refused call draws nothing");
  assert.equal(nextStep(turn([wrapUp("w3", { recap: "Done." })]), "thread-a", [], []), null, "a recap alone draws no box");
});

test("app actions show only while they hold; an unavailable lead keeps the words and drops the buttons", () => {
  const args = { recap: "Done.", ask: "Open a PR?", actions: [{ action: "create_pr" }, { label: "Later" }] };
  assert.deepEqual(nextStep(turn([wrapUp("w", args)]), "thread-b", [], ["create_pr"]).chips, [{ kind: "app", action: "create_pr" }, { kind: "reply", reply: { label: "Later" } }]);
  const stands = nextStep(turn([wrapUp("w", args)]), "thread-b", [], []);
  assert.deepEqual({ recap: stands.recap, question: stands.question, chips: stands.chips }, { recap: "Done.", question: "Open a PR?", chips: [] });
});

test("a waiting proposal holds the box back unless it is blocked, and a blocked box has no dismissal", () => {
  const propose = { type: "mcpToolCall", id: "p", server: "codex_ui_desktop", tool: "start_session", status: "completed", arguments: { initiation: "own_initiative" }, result: { content: [], structuredContent: null, _meta: { codexUiSession: { outcome: "proposed", taskId: "task_0000aaaa", title: "x" } } }, error: null };
  const items = [propose, wrapUp("w", ASK)];
  assert.equal(nextStep(turn(items), "thread-c", [{ id: "task_0000aaaa" }], []), null);
  assert.ok(nextStep(turn(items), "thread-c", [], []));
  const blocked = turn([propose, wrapUp("w", { recap: "Need the key.", blocked: true, ask: "Which key?", actions: [{ label: "Staging" }] })]);
  assert.ok(nextStep(blocked, "thread-c", [{ id: "task_0000aaaa" }], []));
  dismissWrapUp("thread-c", "w", true);
  assert.ok(nextStep(blocked, "thread-c", [], []), "a blocked box cannot be dismissed");
  assert.deepEqual(blockedBox([blocked]), { id: "w", ask: "Which key?" });
  assert.deepEqual(blockedBox([turn([wrapUp("w9", { recap: "Need input.", blocked: true })])]), { id: "w9", ask: WAITING_LINE });
  assert.equal(blockedBox([blocked, turn([said("staging")], "inProgress")]), null, "a message answers it");
});

test("a dismissed box stays dismissed, and one whose question showed loses its receipt too", () => {
  const before = turn([wrapUp("w5", ASK)]);
  assert.ok(nextStep(before, "thread-d", [], []));
  dismissWrapUp("thread-d", "w5", false);
  assert.equal(nextStep(before, "thread-d", [], []), null);
  assert.deepEqual(wrapReceipt(before, "thread-d", "Commit the parser fix."), { recap: ASK.recap, question: "Commit it?", answer: "Yes" });
  dismissWrapUp("thread-d", "w5", true);
  assert.equal(wrapReceipt(before, "thread-d", "Commit the parser fix."), null);
});

test("the receipt names the button the next message matches, by its label or what it sent", () => {
  const before = turn([wrapUp("w6", ASK)]);
  assert.equal(wrapReceipt(before, "thread-e", "Not now").answer, "Not now");
  assert.equal(wrapReceipt(before, "thread-e", "something else").answer, null);
  assert.equal(wrapReceipt(turn([wrapUp("w7", { recap: "Done." })]), "thread-e", "x"), null, "no question, nothing to answer");
});
