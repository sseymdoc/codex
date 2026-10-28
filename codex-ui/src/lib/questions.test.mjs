// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of questions.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPLEMENT_PLAN, PLAN_RESUME, WORKTREE_RESUME, enteredWorktree, answeredAsks, askingThreads, continuesText, continuesTurn, enteredPlanMode, parseReply, pendingQuestions, planApproved, planId, questionId, replyLabel, replyText, waitingPlan, waitingQuestions } from "./questions.ts";

const text = (value) => ({ type: "text", text: value, text_elements: [] });
const asking = (id, ...questions) => ({ type: "agentMessage", id, text: "", phase: "final_answer", memoryCitation: null, delivery: "async", questions });
const said = (id, value) => ({ type: "userMessage", id, clientId: null, content: [text(value)] });

test("a reply is the desktop's envelope and reads as the TUI shows it", () => {
  const replies = [{ questionItemId: questionId("call_1", 0), question: "Which environment?", answer: "Staging" }];
  assert.equal(replyText(replies), '<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"call_1\\",0]","question":"Which environment?","answer":"Staging"}]\n</send_user_message_question_reply>');
  assert.deepEqual(parseReply(replyText(replies)), replies);
  // TUI async_question_reply_tests: one reply or a list, extra fields and the IDE wrapper allowed.
  const reply = { questionItemId: '["request_user_input_async","item",0]', question: "Which environment?", answer: "Staging", extra: true };
  for (const payload of [reply, [reply]]) {
    assert.equal(replyLabel(` \n<send_user_message_question_reply>\n${JSON.stringify(payload)}\n</send_user_message_question_reply>\n `), "> Which environment?\n\nStaging");
  }
  assert.equal(
    replyLabel('<send_user_message_question_reply>[{"questionItemId":"one","question":"First?","answer":"Yes"},{"questionItemId":"two","question":"Second?","answer":"No"}]</send_user_message_question_reply>'),
    "> First?\n\nYes\n\n> Second?\n\nNo",
  );
  assert.equal(replyLabel(`# Context from my IDE setup:\n\n## Open tabs:\n- a.ts\n\n## My request for Codex:\n${replyText(replies)}`), "> Which environment?\n\nStaging");
  for (const plain of [
    "> Which environment?\n\nStaging",
    "<send_user_message_question_reply>[]</send_user_message_question_reply>",
    '<send_user_message_question_reply>[{"questionItemId":"one","question":"First?","answer":"Yes"},null]</send_user_message_question_reply>',
    'Quoted: <send_user_message_question_reply>{"questionItemId":"one","question":"First?","answer":"Yes"}</send_user_message_question_reply>',
    '<send_user_message_question_reply>{"questionItemId":"one","question":"First?","answer":"Yes"}</send_user_message_question_reply> trailing text',
  ]) {
    assert.equal(parseReply(plain), null, plain);
  }
});

test("the latest turn's questions wait until a reply names them", () => {
  const ask = asking("call_1", { title: "Which way?", options: ["Left", "Right"] }, { title: "How fast?", options: null });
  const open = pendingQuestions([{ items: [said("u1", "go"), ask] }]);
  assert.deepEqual(open, [
    { id: questionId("call_1", 0), itemId: "call_1", title: "Which way?", options: ["Left", "Right"] },
    { id: questionId("call_1", 1), itemId: "call_1", title: "How fast?", options: [] },
  ]);
  // Steered into the turn: the answered question goes, the other stays.
  const first = replyText([{ questionItemId: questionId("call_1", 0), question: "Which way?", answer: "Left" }]);
  assert.deepEqual(pendingQuestions([{ items: [ask, said("u2", first)] }]).map((question) => question.title), ["How fast?"]);
  // Waiting in the queue counts, and an older desktop reply names the whole message.
  assert.deepEqual(pendingQuestions([{ items: [ask] }], [{ input: [text(first)] }]).length, 1);
  const whole = replyText([{ questionItemId: "call_1", question: "Which way?", answer: "Left" }]);
  assert.deepEqual(pendingQuestions([{ items: [ask, said("u2", whole)] }]), []);
  // A plain message is no answer; a newer turn leaves the old questions behind.
  assert.equal(pendingQuestions([{ items: [ask, said("u2", "Left")] }]).length, 2);
  assert.deepEqual(pendingQuestions([{ items: [ask] }, { items: [said("u3", "never mind")] }]), []);
  assert.deepEqual(pendingQuestions([]), []);
});

test("a session waits on the user until its questions are answered or settled on the card", () => {
  const ask = asking("call_1", { title: "Which way?", options: null }, { title: "How fast?", options: null });
  const threads = { asking: { turns: [{ items: [ask] }], queue: [] }, idle: { turns: [], queue: [] } };
  assert.deepEqual(askingThreads(threads, new Set()), ["asking"]);
  // Closing or skipping one on the card settles it; the other still waits.
  assert.deepEqual(waitingQuestions(threads.asking, new Set([questionId("call_1", 0)])).map((question) => question.title), ["How fast?"]);
  assert.deepEqual(askingThreads(threads, new Set([questionId("call_1", 0), questionId("call_1", 1)])), []);
  // An answer waiting in the queue counts as given.
  const both = replyText([0, 1].map((index) => ({ questionItemId: questionId("call_1", index), question: "?", answer: "Yes" })));
  assert.deepEqual(askingThreads({ asking: { turns: threads.asking.turns, queue: [{ input: [text(both)] }] } }, new Set()), []);
  assert.deepEqual(waitingQuestions(undefined, new Set()), []);
});

test("an asking message folds into the reply's receipt once every question is answered", () => {
  const ask = asking("call_1", { title: "Which way?", options: null }, { title: "How fast?", options: null });
  const reply = (...indexes) => said("u2", replyText(indexes.map((index) => ({ questionItemId: questionId("call_1", index), question: "?", answer: "Yes" }))));
  // Steered into the asking turn or opening the next one, all answered: the row goes.
  assert.deepEqual(answeredAsks([{ items: [ask, reply(0, 1)] }]), ["call_1"]);
  assert.deepEqual(answeredAsks([{ items: [ask] }, { items: [reply(0, 1)] }]), ["call_1"]);
  // One skipped: the row stays, so that question is still in the transcript.
  assert.deepEqual(answeredAsks([{ items: [ask, reply(0)] }]), []);
  // An older desktop reply names the whole message; a plain message answers nothing.
  assert.deepEqual(answeredAsks([{ items: [ask, said("u2", replyText([{ questionItemId: "call_1", question: "?", answer: "Yes" }]))] }]), ["call_1"]);
  assert.deepEqual(answeredAsks([{ items: [ask, said("u2", "Yes")] }]), []);
});

test("a plan-mode turn's proposed plan waits on the user until settled, and its implementation turn approves it", () => {
  const plan = { type: "plan", id: "plan_1", text: "1. Do it" };
  const proposed = { id: "t1", status: "completed", items: [said("u1", "plan it"), plan] };
  const session = (o = {}) => ({ turns: [proposed], queue: [], planMode: true, ...o });
  assert.equal(waitingPlan(session(), new Set()), "t1");
  assert.deepEqual(askingThreads({ planning: session(), idle: { turns: [], queue: [] } }, new Set()), ["planning"]);
  // Settled on the card, out of plan mode, still running, queued past, or moved on: no wait.
  assert.equal(waitingPlan(session(), new Set([planId("t1")])), null);
  assert.equal(waitingPlan(session({ planMode: false }), new Set()), null);
  assert.equal(waitingPlan(session({ turns: [{ ...proposed, status: "inProgress" }] }), new Set()), null);
  assert.equal(waitingPlan(session({ queue: [{ input: [text("more")] }] }), new Set()), null);
  const implementing = { id: "t2", status: "completed", items: [said("u2", IMPLEMENT_PLAN)] };
  assert.equal(waitingPlan(session({ turns: [proposed, implementing] }), new Set()), null);
  // 已批准计划 only when the next turn opened with the card's 接受.
  assert.equal(planApproved([proposed, implementing], "plan_1"), true);
  assert.equal(planApproved([proposed], "plan_1"), false);
  assert.equal(planApproved([proposed, { ...implementing, items: [said("u2", "change step 2")] }], "plan_1"), false);
});

test("the plan card's 接受 and the plan-mode resume carry on a turn with no prompt of their own", () => {
  const plan = { type: "plan", id: "plan_1", text: "1. Do it" };
  const proposed = { id: "t1", status: "completed", items: [said("u1", "plan it"), plan] };
  const turn = (id, value) => ({ id, status: "completed", items: [said(`u-${id}`, value)] });
  // The card's message, or the official VS Code extension's, right after the plan.
  const ide = ["PLEASE IMPLEMENT THIS PLAN:", "1. Do it"].join(String.fromCharCode(10));
  assert.equal(continuesTurn([proposed, turn("t2", ` ${IMPLEMENT_PLAN} `)], 1), true);
  assert.equal(continuesTurn([proposed, turn("t2", ide)], 1), true);
  assert.equal(planApproved([proposed, turn("t2", ide)], "plan_1"), true);
  // Not after a turn without a plan, not as the first turn, not with more than the text.
  assert.equal(continuesTurn([turn("t0", "hi"), turn("t2", IMPLEMENT_PLAN)], 1), false);
  assert.equal(continuesTurn([turn("t2", IMPLEMENT_PLAN)], 0), false);
  const withImage = { id: "t2", status: "completed", items: [{ ...said("u2", IMPLEMENT_PLAN), content: [text(IMPLEMENT_PLAN), { type: "image", url: "data:" }] }] };
  assert.equal(continuesTurn([proposed, withImage], 1), false);
  assert.equal(continuesTurn([proposed, turn("t2", "Implement the plan, but skip step 2.")], 1), false);
  // The resume follows only enter_plan_mode that switched the session.
  const call = (meta, status = "completed") => ({ type: "mcpToolCall", id: "m1", server: "codex_ui_desktop", tool: "enter_plan_mode", status, arguments: {}, result: { content: [], structuredContent: null, _meta: meta }, error: null });
  const entering = (item) => ({ id: "t1", status: "completed", items: [said("u1", "add auth"), item] });
  assert.equal(enteredPlanMode(call({ codexUiPlanMode: "entered" })), true);
  for (const item of [call(null), call({ codexUiPlanMode: "entered" }, "failed"), { ...call({ codexUiPlanMode: "entered" }), server: "other" }]) assert.equal(enteredPlanMode(item), false);
  assert.equal(continuesTurn([entering(call({ codexUiPlanMode: "entered" })), turn("t2", PLAN_RESUME)], 1), true);
  assert.equal(continuesTurn([entering(call(null)), turn("t2", PLAN_RESUME)], 1), false);
  assert.equal(continuesTurn([proposed, turn("t2", PLAN_RESUME)], 1), false);
  // Their local echo stays out too; anything else is a message of yours.
  assert.equal(continuesText(IMPLEMENT_PLAN) && continuesText(PLAN_RESUME), true);
  assert.equal(continuesText("Implement the plan"), false);
  // enter_worktree moves the session; its next turn opens with the resume, which no one typed.
  const worktree = (meta) => ({ ...call(meta), tool: "enter_worktree" });
  assert.equal(enteredWorktree(worktree({ codexUiWorktree: "entered" })), true);
  assert.equal(enteredWorktree(worktree({ codexUiPlanMode: "entered" })), false);
  assert.equal(continuesTurn([entering(worktree({ codexUiWorktree: "entered" })), turn("t2", WORKTREE_RESUME)], 1), true);
  assert.equal(continuesTurn([entering(worktree(null)), turn("t2", WORKTREE_RESUME)], 1), false);
  assert.equal(continuesTurn([entering(call({ codexUiPlanMode: "entered" })), turn("t2", WORKTREE_RESUME)], 1), false);
  assert.equal(continuesText(WORKTREE_RESUME), true);
});
