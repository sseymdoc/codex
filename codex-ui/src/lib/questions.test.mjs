// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of questions.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { askingThreads, parseReply, pendingQuestions, questionId, replyLabel, replyText, waitingQuestions } from "./questions.ts";

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
