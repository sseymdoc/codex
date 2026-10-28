// The next-step box wrap_up fills (Claude live c4ea84cb3 Ir / jr / Dr / fr / Ar, cb27dab29 De / Ee,
// c4de0b325 g0): the latest turn's call, whether the box shows, the dismissals, and the receipts of
// boxes a later message answered. Pure apart from the dismissal record; the box is TurnBox.tsx.

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { boxShows, drawableReply, parseWrapUp, replyText, type WrapUp, type WrapUpAction, type WrapUpReply } from "../../context/turn.mjs";
import { readJson, sessionCall, sessionMeta, writeJson, type Proposal } from "./side-sessions.ts";

type McpItem = Extract<ThreadItem, { type: "mcpToolCall" }>;
interface TurnLike { id: string; status: string; items: ThreadItem[] }

export const isWrapUpCall = (item: ThreadItem): item is McpItem => item.type === "mcpToolCall" && item.server === "codex_ui_desktop" && item.tool === "wrap_up";

/** A turn's last wrap_up that went through (Dr): failed or refused calls draw nothing. */
export function turnWrapUp(turn: TurnLike | undefined): { item: McpItem; wrap: WrapUp } | null {
  for (const item of [...(turn?.items ?? [])].reverse()) {
    if (!isWrapUpCall(item) || item.status !== "completed" || item.error) continue;
    const wrap = parseWrapUp(item.arguments);
    if (wrap) return { item, wrap };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dismissals (fr): the last one per session in memory, and those whose question was on show kept
// on this machine (Claude's epitaxy.dismissedTurnReceipts), 200 a session, 100 sessions.

const DISMISSED_KEY = "codex-ui:dismissed-turn-receipts";
const lastDismissed = new Map<string, string>();
let kept = (() => {
  const saved = readJson(DISMISSED_KEY);
  return saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Record<string, string[]>) : {};
})();
const listeners = new Set<() => void>();
let version = 0;

export function subscribeDismissals(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const dismissalsVersion = () => version;

export function dismissWrapUp(threadId: string, callId: string, questionShown: boolean): void {
  lastDismissed.set(threadId, callId);
  if (lastDismissed.size > 100) lastDismissed.delete(lastDismissed.keys().next().value!);
  if (questionShown) {
    const ids = [...(kept[threadId] ?? []).filter((id) => id !== callId), callId].slice(-200);
    const { [threadId]: _, ...rest } = kept;
    kept = Object.fromEntries([...Object.entries(rest), [threadId, ids]].slice(-100));
    writeJson(DISMISSED_KEY, kept);
  }
  version += 1;
  for (const listener of listeners) listener();
}

const dismissed = (threadId: string, callId: string) => lastDismissed.get(threadId) === callId || !!kept[threadId]?.includes(callId);

// ---------------------------------------------------------------------------
// The box (mN over the latest turn).

export type BoxChip = { kind: "reply"; reply: WrapUpReply } | { kind: "app"; action: "commit" | "create_pr" | "archive" };

export interface NextStep {
  callId: string;
  recap: string | null;
  question: string | null;
  /** The ask itself was on show (it keeps a dismissal on this machine). */
  asks: boolean;
  chips: BoxChip[];
  /** The first chip is the recommendation (briefHolds). */
  primary: boolean;
  blocked: boolean;
}

/** Codex's words for Claude's kRoFBJb/rf, the line a blocked box asks without its own question. */
export const WAITING_LINE = "Codex 正在等待您。请选择一条回复或自行输入。";

/** A proposal card from this turn still waits on the user (turnHasPendingSuggestion). */
function proposalWaits(turn: TurnLike, proposals: readonly Proposal[] | undefined): boolean {
  const open = new Set((proposals ?? []).filter((proposal) => !proposal.accepted).map((proposal) => proposal.id));
  return turn.items.some((item) => sessionCall(item) === "propose" && item.type === "mcpToolCall" && open.has(sessionMeta(item)?.taskId ?? ""));
}

/** The chip an answer makes (je / g0): a reply the box may draw, or an app action that holds now. */
function chipOf(entry: WrapUpAction, available: readonly string[]): BoxChip | null {
  if ("action" in entry) return entry.action !== "new_session" && available.includes(entry.action) ? { kind: "app", action: entry.action as "commit" | "create_pr" | "archive" } : null;
  return drawableReply(entry) ? { kind: "reply", reply: entry } : null;
}

/**
 * What the latest turn's box shows (mN), or null: hidden while the turn runs, held back by this
 * turn's waiting proposal unless blocked, gone once dismissed (a blocked box has no ×).
 */
export function nextStep(turn: TurnLike | undefined, threadId: string, proposals: readonly Proposal[] | undefined, available: readonly string[]): NextStep | null {
  if (!turn || turn.status === "inProgress") return null;
  const found = turnWrapUp(turn);
  if (!found) return null;
  const { item, wrap } = found;
  if (!wrap.blocked && (proposalWaits(turn, proposals) || dismissed(threadId, item.id))) return null;
  if (!boxShows(wrap)) return null;
  const answers = wrap.next?.actions ?? [];
  const lead = answers[0] ? chipOf(answers[0], available) : null;
  const chips = answers.flatMap((entry) => chipOf(entry, available) ?? []).slice(0, 2);
  const ask = wrap.next?.ask ?? null;
  const briefHolds = !!lead && !!ask;
  const leadDropped = !!answers[0] && !lead;
  const leads = chips.length > 0 && !leadDropped;
  const wordsStand = leadDropped && "action" in answers[0] && !wrap.blocked && !!ask;
  const shown = leads ? chips : [];
  const question = (shown.length && briefHolds) || ((wrap.blocked || wordsStand) && ask) ? ask : shown.length && wrap.blocked ? WAITING_LINE : null;
  const recap = leads || wrap.blocked || wordsStand ? wrap.recap : null;
  if (!question && (!recap || (!shown.length && !wrap.blocked))) return null;
  return { callId: item.id, recap, question, asks: question === ask && !!ask, chips: shown, primary: shown.length > 0 && briefHolds, blocked: wrap.blocked };
}

/**
 * A blocked box the latest turn left that nobody answered yet (a message starts the next turn):
 * the session waits on the user. Its id and the question it asks, for one notification.
 */
export function blockedBox(turns: readonly TurnLike[] | undefined): { id: string; ask: string } | null {
  const turn = turns?.at(-1);
  if (!turn || turn.status === "inProgress") return null;
  const found = turnWrapUp(turn);
  return found?.wrap.blocked && boxShows(found.wrap) ? { id: found.item.id, ask: found.wrap.next?.ask ?? WAITING_LINE } : null;
}

/** The sessions a blocked box waits on. */
export const blockedBoxThreads = (threads: Readonly<Record<string, { meta: { id: string }; turns: readonly TurnLike[] }>>): string[] =>
  Object.values(threads).flatMap((thread) => (blockedBox(thread.turns) ? [thread.meta.id] : []));

// ---------------------------------------------------------------------------
// Receipts (Ar / kr): a box the next message answered shows above it, its recap and question and
// the button that message matches.

export interface WrapReceipt { recap: string; question: string; answer: string | null }

export function wrapReceipt(previous: TurnLike | undefined, threadId: string, prompt: string): WrapReceipt | null {
  const found = turnWrapUp(previous);
  if (!found) return null;
  const { item, wrap } = found;
  const ask = wrap.next?.ask;
  const first = wrap.next?.actions[0];
  const settles = !!ask && boxShows(wrap) && (wrap.blocked || (!!first && ("action" in first ? first.action !== "new_session" : drawableReply(first))));
  if (!settles || kept[threadId]?.includes(item.id)) return null;
  const text = prompt.trim();
  const answer = wrap.next!.actions.find((entry): entry is WrapUpReply => !("action" in entry) && (entry.label === text || replyText(entry) === text));
  return { recap: wrap.recap, question: ask, answer: answer?.label ?? null };
}
