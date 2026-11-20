import assert from "node:assert/strict";
import { test } from "node:test";
import { boxShows, displayText, drawableReply, parseWrapUp, replyText, wrapUpResult } from "./turn.mjs";

const NEXT = "Do not call wrap_up again this turn; the advice that follows is for your next call.";
const ASKED = "Your closing message is your answer to the user: write it now, in full, as the last thing you say this turn. The box asks your question, so do not ask it again.";
const QUESTION_THERE = "Write your closing message now, as the last thing you say this turn, and put your question to the user there.";

test("wrap_up answers in Claude's sentences: shown, nothing pending, no box", () => {
  assert.deepEqual(wrapUpResult({ recap: "Fixed it. Tests pass.", ask: "Commit?", actions: [{ label: "Yes", message: "Commit the fix." }] }, { available: [] }), { text: `Shown in the next-step box. ${ASKED}` });
  assert.deepEqual(wrapUpResult({ recap: "Answered the question." }, { available: [] }), { text: "Nothing is pending, so the app draws no box. Your closing message is your answer to the user: write it now, as the last thing you say this turn." });
  // Blocked shows the box even without buttons, and says so.
  assert.equal(wrapUpResult({ recap: "Stuck on the key.", ask: "Which key?", blocked: true }).text.startsWith("Shown in the next-step box."), true);
  // An ask without buttons draws none: the advice, and the question goes in the message.
  assert.deepEqual(wrapUpResult({ recap: "Done.", ask: "Ship it?" }), {
    text: `The app draws no box for this call. ${NEXT} The box drew no buttons: it needs ask and at least one entry in actions ({"action": "create_pr"} or {"label": "Yes, do it", "message": "\u2026"}); when nothing is left for the user, the recap alone (no ask, no actions, not blocked) is the whole call. ${QUESTION_THERE}`,
  });
});

test("wrap_up refuses what Claude refuses: no recap, an app action that does not hold, the box switched off", () => {
  assert.deepEqual(wrapUpResult({ ask: "x" }), { error: "recap is required: what is now true or changed and where it stands, said to the user in two or three sentences." });
  assert.deepEqual(wrapUpResult({ recap: "x" }, { enabled: false }), { error: "wrap_up is turned off right now; write it as text instead." });
  assert.deepEqual(wrapUpResult({ recap: "Done.", ask: "PR?", actions: [{ action: "create_pr" }, { action: "merge" }] }, { available: ["commit", "archive"] }), {
    error: 'Not shown: create_pr, merge do not hold right now (app actions available: commit, archive), so the app could not draw that button and would drop your question with it. Call wrap_up again with only available app actions, or say it as a reply ({"label": "\u2026", "message": "\u2026"}) \u2014 for something you can do yourself when clicked, the message asks you to.',
  });
  // Unknown availability refuses nothing; a third button is past the two that count.
  assert.ok("text" in wrapUpResult({ recap: "Done.", ask: "PR?", actions: [{ action: "create_pr" }] }));
  assert.ok("text" in wrapUpResult({ recap: "Done.", ask: "PR?", actions: [{ label: "a" }, { label: "b" }, { action: "merge" }] }, { available: [] }));
});

test("wrap_up's advice for its next call, each in Claude's words", () => {
  const advice = (args) => wrapUpResult(args, { available: ["commit"] }).text;
  assert.match(advice({ recap: "Done.", ask: "x".repeat(101), actions: [{ label: "Yes" }] }), /ask is the decision alone, in one short sentence \(about 100 characters\) with no reason or recommendation; this one ran 101\./);
  assert.match(advice({ recap: "Done.", ask: "Which?", actions: [{ label: "A" }, { label: "B" }, { label: "C" }] }), /actions is 1\u20132 buttons; this call had 3, and the app drops every one past the first 2\./);
  assert.match(advice({ recap: "Done.", ask: "Run?", actions: [{ label: "/run" }] }), /The app drops a reply whose label or message starts with "\/" or "!"/);
  assert.match(advice({ recap: "Done.", ask: "Run?", actions: [{ label: "Yes, fix the first one now" }] }), /A reply label is a button, 1\u20133 words \(4 at most, 24 characters\); "Yes, fix the first one now" is too long/);
  assert.match(advice({ recap: "Done.", ask: "Go?", actions: [{ label: "Yes", message: "m".repeat(301) }] }), /A reply's message is cut at 300 characters mid-sentence; keep it under\./);
  assert.match(advice({ recap: "r".repeat(301) }), /recap is two or three sentences \(about 300 characters\); this one ran 301\./);
  assert.match(advice({ outcome: "Done.", next_ask: "Commit?", next_actions: [{ action: "commit" }] }), /^Shown in the next-step box\. Do not call wrap_up again this turn; the advice that follows is for your next call\. This call used the previous field names/);
  assert.match(advice({ recap: "Done.", ask: "Next?", actions: [{ action: "new_session" }] }), /new_session is not an action: your start_session proposal shows as a card in the transcript/);
  assert.doesNotMatch(advice({ recap: "Done.", ask: "Commit?", actions: [{ action: "commit" }] }), /Do not call wrap_up again/);
});

test("the box a call makes: an ask carries its answers, two at most, leaked markup cut", () => {
  assert.equal(parseWrapUp({ ask: "x" }), null);
  assert.deepEqual(parseWrapUp({ recap: " Done. ", actions: [{ label: "Yes" }] }), { recap: "Done.", blocked: false });
  assert.deepEqual(parseWrapUp({ recap: "Done.</recap><ask>Go?", ask: "Go?", actions: [{ label: "Yes", message: "Yes" }, { action: "merge" }, { action: "deploy" }, { label: "No" }] }), {
    recap: "Done.", blocked: false, next: { ask: "Go?", actions: [{ label: "Yes" }, { action: "merge" }] },
  });
  assert.deepEqual(parseWrapUp({ outcome: "Old.", next_ask: "Go?", next_actions: [{ label: "Ok" }], needs_user: "yes" }), { recap: "Old.", blocked: true, next: { ask: "Go?", actions: [{ label: "Ok" }] } });
  assert.equal(boxShows(parseWrapUp({ recap: "Done.", ask: "Go?", actions: [{ action: "new_session" }] })), false);
  assert.equal(boxShows(parseWrapUp({ recap: "Done.", blocked: true })), true);
  assert.equal(boxShows(parseWrapUp({ recap: "Done.", ask: "Go?", actions: [{ label: "Yes" }] })), true);
});

test("a reply the box may draw sends its message, else its label", () => {
  assert.equal(drawableReply({ label: "Yes" }), true);
  assert.equal(drawableReply({ label: "!rm" }), false);
  assert.equal(drawableReply({ label: "Yes", message: "/clear" }), false);
  assert.equal(drawableReply({ label: "Ye\u200bs" }), false);
  assert.equal(replyText({ label: "Yes, fix 1", message: "Fix the null check in parse() first." }), "Fix the null check in parse() first.");
  assert.equal(replyText({ label: "Not now" }), "Not now");
  assert.equal(displayText("a\u2028b\u202e  c"), "a b c");
  assert.equal(displayText("x".repeat(501)), `${"x".repeat(500)}\u2026`);
});
