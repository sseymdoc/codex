// Codex's mid-turn questions (request_user_input_async; Codex desktop's sendUserMessageQuestion):
// the agent asks without waiting, as an agentMessage carrying `questions`, and the answers go back
// as an ordinary user message in the desktop's reply envelope (webview r8t / i8t, TUI
// async_question_reply.rs), steered into the running turn or opening the next one. codex-ui docks
// them in Claude's question card (Approvals.tsx), and until they are settled the session waits on
// the user as for a request: the sidebar mark, notifications, the jump list, the start page.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { UserInput } from "@protocol/v2/UserInput";

const OPEN = "<send_user_message_question_reply>";
const CLOSE = "</send_user_message_question_reply>";
// The VS Code extension's prompt wrapper, which the TUI looks past.
const IDE_CONTEXT = "# Context from my IDE setup:\n";
const IDE_REQUEST = "\n## My request for Codex:\n";

export interface AsyncQuestion {
  id: string;
  /** The agentMessage that asked it. */
  itemId: string;
  title: string;
  options: string[];
}

export interface QuestionReply {
  questionItemId: string;
  question: string;
  answer: string;
}

/** A question's id, as the desktop names it (webview n8t) and the TUI matches it. */
export const questionId = (itemId: string, index: number): string => JSON.stringify(["request_user_input_async", itemId, index]);

/** The answers as one user message (webview r8t). */
export const replyText = (replies: QuestionReply[]): string => `${OPEN}\n${JSON.stringify(replies)}\n${CLOSE}`;

const isReply = (value: unknown): value is QuestionReply => {
  const reply = value as Partial<QuestionReply> | null;
  return typeof reply === "object" && reply !== null && typeof reply.questionItemId === "string" && typeof reply.question === "string" && typeof reply.answer === "string";
};

/** A whole message that is one reply envelope: its answers (one reply or a non-empty list), else null. */
export function parseReply(text: string): QuestionReply[] | null {
  let body = text.trim();
  if (body.startsWith(IDE_CONTEXT)) {
    const at = body.lastIndexOf(IDE_REQUEST);
    if (at < 0) return null;
    body = body.slice(at + IDE_REQUEST.length).trim();
  }
  if (!body.startsWith(OPEN) || !body.endsWith(CLOSE)) return null;
  let value: unknown;
  try {
    value = JSON.parse(body.slice(OPEN.length, -CLOSE.length));
  } catch {
    return null;
  }
  const replies: unknown[] = Array.isArray(value) ? value : [value];
  return replies.length > 0 && replies.every(isReply) ? replies : null;
}

/** A reply as the transcript shows it: each question quoted, its answer under it (TUI display_text). */
export const replyLabel = (text: string): string | null =>
  parseReply(text)?.map((reply) => `> ${reply.question}\n\n${reply.answer}`).join("\n\n") ?? null;

/** A message's answers when its only text is a reply (mentions and skills aside, as the TUI reads it). */
function inputReplies(input: UserInput[]): QuestionReply[] {
  const parts = input.filter((part) => part.type !== "mention" && part.type !== "skill");
  return parts.length === 1 && parts[0].type === "text" ? (parseReply(parts[0].text) ?? []) : [];
}

/**
 * The latest turn's questions still open: no reply in that turn or the queue names them (or, as
 * older desktop replies do, the message that asked them). A later turn means the talk moved on.
 */
export function pendingQuestions(turns: readonly { items: ThreadItem[] }[], queue: readonly { input: UserInput[] }[] = []): AsyncQuestion[] {
  const items = turns.at(-1)?.items ?? [];
  const asked = items.flatMap((item) =>
    item.type === "agentMessage" && item.questions?.length
      ? item.questions.map((question, index) => ({ id: questionId(item.id, index), itemId: item.id, title: question.title, options: question.options ?? [] }))
      : [],
  );
  if (!asked.length) return asked;
  const replies = [...items.flatMap((item) => (item.type === "userMessage" ? inputReplies(item.content) : [])), ...queue.flatMap((queued) => inputReplies(queued.input))];
  const answered = new Set(replies.map((reply) => reply.questionItemId));
  return asked.filter((question) => !answered.has(question.id) && !answered.has(question.itemId));
}

/**
 * The asking messages a reply in these turns answers in full (every question named, or the
 * message as older desktop replies do): Claude's receipt takes the asked row's place, so the
 * transcript leaves their row out and the reply's receipt (items.tsx UserBubble) carries both.
 */
export function answeredAsks(turns: readonly { items: ThreadItem[] }[]): string[] {
  const items = turns.flatMap((turn) => turn.items);
  const named = new Set(items.flatMap((item) => (item.type === "userMessage" ? inputReplies(item.content) : [])).map((reply) => reply.questionItemId));
  if (!named.size) return [];
  return items.flatMap((item) =>
    item.type === "agentMessage" && item.questions?.length && (named.has(item.id) || item.questions.every((_, index) => named.has(questionId(item.id, index)))) ? [item.id] : [],
  );
}

/** What the questions are read from: a session (store.ts ThreadState). */
type Asking = { turns: readonly { items: ThreadItem[] }[]; queue: readonly { input: UserInput[] }[] };

/** A session's questions waiting on the user: open, and not answered, skipped or closed on the card (store.ts settledQuestions). */
export function waitingQuestions(thread: Asking | undefined, settled: ReadonlySet<string>): AsyncQuestion[] {
  return thread ? pendingQuestions(thread.turns, thread.queue).filter((question) => !settled.has(question.id)) : [];
}

/** The sessions with a question waiting on the user. */
export function askingThreads(threads: Record<string, Asking>, settled: ReadonlySet<string>): string[] {
  return Object.keys(threads).filter((id) => waitingQuestions(threads[id], settled).length > 0);
}
