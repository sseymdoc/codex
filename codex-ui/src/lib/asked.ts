// Codex's blocking questions (request_user_input) settled and drawn as Claude Desktop 3.6556 does
// AskUserQuestion: ✕ and a message sent instead answer every question in Claude's own words
// (shared-5 VA / HA) rather than stopping the turn, and the transcript keeps the 已提问 row and its
// receipt (c52b02f3f, cb6930dae Da / $i). Codex keeps no item for them, so store.ts recordAsked does.

import type { ServerRequest } from "@protocol/ServerRequest";
import type { ToolRequestUserInputResponse } from "@protocol/v2/ToolRequestUserInputResponse";
import { resolveRequest } from "./codex";
import { getState, recordAsked, type Asked } from "./store";

type QuestionRequest = Extract<ServerRequest, { method: "item/tool/requestUserInput" }>;

/** shared-5 VA: the card's ✕. */
export const DISMISSED = "[User dismissed — do not proceed, wait for next instruction]";
/** shared-5 HA: a message sent from the composer while the question waits. */
export const REPLIED = "[User did not answer this question — they sent a message instead. Treat that message as their response; do not re-ask.]";

/** A question the backend lets the user pick several options for (experimental backend). */
export const multiSelect = (question: object): boolean => (question as { multiSelect?: boolean }).multiSelect === true;

/** The response: each question's answers by id, a skipped one empty. */
export function responseOf(questions: readonly { id: string }[], answers: readonly (string[] | undefined)[]): ToolRequestUserInputResponse {
  return { answers: Object.fromEntries(questions.map((question, index) => [question.id, { answers: answers[index] ?? [] }])) };
}

/** Answers the request and keeps its record, placed after the turn's last item so far. */
export function settleAsk(request: QuestionRequest, answers: readonly (string[] | undefined)[], how: Asked["how"]): void {
  const { threadId, turnId, itemId, questions } = request.params;
  const said = how === "dismissed" ? DISMISSED : REPLIED;
  resolveRequest(request.id, responseOf(questions, how === "answered" ? answers : questions.map(() => [said])));
  recordAsked(threadId, {
    itemId,
    turnId,
    after: getState().threads[threadId]?.turns.find((turn) => turn.id === turnId)?.items.at(-1)?.id ?? null,
    questions: questions.map((question) => ({ header: question.header, question: question.question, ...(multiSelect(question) && { multiSelect: true }) })),
    answers: questions.map((_, index) => (how === "answered" ? (answers[index] ?? []) : [])),
    how,
    at: Date.now(),
  });
}

/** Claude's dismissPendingAskUserQuestion: a message sent to the session answers its waiting questions first. */
export function answerWithMessage(threadId: string): void {
  for (const request of getState().requests) {
    if (request.method === "item/tool/requestUserInput" && request.params.threadId === threadId) settleAsk(request, [], "replied");
  }
}

/** cb6930dae $i: why a question has no answer. */
export const unansweredLabel = (how: Asked["how"]): string => (how === "dismissed" ? "未回答" : how === "replied" ? "已在对话中回复" : "已跳过");

/** c52b02f3f: the row's meta, the first question's header, or how many there were. */
export const askedMeta = (questions: readonly { header: string; question: string }[]): string =>
  questions.length > 1 ? `${questions.length} 个问题` : (questions[0]?.header || questions[0]?.question || "");

/** c96d752d0 SZe: a receipt once anything was answered; otherwise the row says why. */
export const answeredSome = (asked: Asked): boolean => asked.answers.some((answer) => answer.length > 0);

/** cb6930dae Da: each question over its answers, comma-joined, or why it has none. */
export function receiptRows(asked: Asked): { question: string; answer: string; answered: boolean }[] {
  return asked.questions.map((question, index) => {
    const answer = asked.answers[index] ?? [];
    return { question: question.question, answer: answer.length ? answer.join(", ") : unansweredLabel(asked.how), answered: answer.length > 0 };
  });
}
