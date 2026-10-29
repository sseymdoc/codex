// Claude 4.29 side sessions (ccd_session start_session / dismiss_task) in codex-ui: the proposal
// queue, the card states and the rules that need no app state. Codex keeps none of this, so the
// app keeps it on this machine (store.ts proposals / proposalOutcomes / links, linked.ts).

import type { ThreadItem } from "@protocol/v2/ThreadItem";
import { PROPOSAL_MS, QUEUE_CAP, RESOLVED_CAP, isBrief } from "../../context/sessions.mjs";

export type Permission = "read-only" | "auto" | "full-access";

/** A start_session proposal waiting on its card (Claude backgroundTaskSuggestions entry). */
export interface Proposal {
  id: string;
  title: string;
  /** The brief; empty for an offer until its brief comes with proposal_id. */
  prompt: string;
  background?: string;
  context: "fresh" | "fork";
  useWorktree?: boolean;
  model?: string;
  effort?: string;
  permission?: Permission;
  target: "local" | "cloud";
  name?: string;
  wake?: true;
  /** An offer (initiation "offer"): its call waits on the card. */
  offer?: true;
  /** The user chose 新建会话 on the offer; its session waits for the brief. */
  accepted?: true;
  createdAt: number;
  expiresAt: number;
}

export type OutcomeState = "started" | "dismissed" | "expired" | "withdrawn" | "sent_here" | "kept_here" | "start_failed";

/** How a proposal left its queue (Claude resolvedBackgroundTaskSuggestions plus the card's own outcomes). */
export interface ProposalOutcome {
  state: OutcomeState;
  parentId: string;
  /** The session it started, or the Codex Cloud task. */
  sessionId?: string;
  cloud?: true;
  at: number;
}

/** A session another one started (Claude spawnedFrom). */
export interface SessionLink {
  parentId: string;
  taskId?: string;
  title: string;
  name: string;
  kind: "fresh" | "fork" | "handoff";
  at: number;
  /** Its first message is the brief: set once it is sent. */
  briefed?: true;
  /** wake_when_done: the parent goes on even when this one never gets its task. */
  wake?: true;
  /** An accepted offer whose turn ended before its brief came (Claude dropUnbriefedOffers). */
  unbriefed?: true;
}

export const newTaskId = (): string => `task_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Claude yx: the queue holds 20; the oldest go first, never one being started or waiting on its card. */
export function enqueue(queue: readonly Proposal[], proposal: Proposal, held: ReadonlySet<string>): { queue: Proposal[]; evicted: Proposal[] } {
  const next = [...queue, proposal];
  const evicted: Proposal[] = [];
  let over = next.length - QUEUE_CAP;
  for (let at = 0; over > 0 && at < next.length - 1; ) {
    if (held.has(next[at].id)) {
      at += 1;
      continue;
    }
    evicted.push(...next.splice(at, 1));
    over -= 1;
  }
  return { queue: next, evicted };
}

/** Claude bx: outcomes kept, the newest 100. */
export function remember(outcomes: Readonly<Record<string, ProposalOutcome>>, id: string, outcome: ProposalOutcome): Record<string, ProposalOutcome> {
  const next = { ...outcomes };
  delete next[id];
  next[id] = outcome;
  const ids = Object.keys(next);
  for (const old of ids.slice(0, Math.max(0, ids.length - RESOLVED_CAP))) delete next[old];
  return next;
}

export const expiresAt = (now: number): number => now + PROPOSAL_MS;
export const isExpired = (proposal: Proposal, now: number): boolean => proposal.expiresAt <= now;

export type ClaimOutcome = "already_started" | "already_dismissed" | "expired" | "spawn_in_flight" | "not_found";

/** Claude claimableProposal: why a proposal cannot be started or withdrawn now, or null when it can. */
export function claimOf(queue: readonly Proposal[] | undefined, outcome: ProposalOutcome | undefined, spawning: ReadonlySet<string>, id: string, now: number): ClaimOutcome | null {
  if (spawning.has(id)) return "spawn_in_flight";
  const proposal = queue?.find((entry) => entry.id === id);
  if (proposal) return isExpired(proposal, now) ? "expired" : null;
  return (outcome && CLAIMED[outcome.state]) ?? "not_found";
}

const CLAIMED: Record<OutcomeState, ClaimOutcome> = {
  started: "already_started",
  sent_here: "already_started",
  kept_here: "already_started",
  dismissed: "already_dismissed",
  withdrawn: "already_dismissed",
  start_failed: "already_dismissed",
  expired: "expired",
};

/** Claude's card states (c3fef5c6f by), kept_here drawing nothing, resolved the plain tool row. */
export type CardState = "unavailable" | "proposing" | "proposed" | "starting" | "briefing" | "cloud_pending" | "started" | "sent_here" | "dismissed" | "start_failed" | "kept_here" | "resolved";

/** c3fef5c6f by. */
export function cardState(i: {
  settled: boolean;
  failed: boolean;
  taskId?: string;
  queued?: Proposal;
  spawning: boolean;
  outcome?: ProposalOutcome;
}): CardState {
  const started = i.outcome?.state === "started";
  if (i.failed) return "unavailable";
  if (!i.settled && !(i.taskId && (i.queued || i.spawning || started))) return "proposing";
  if (!i.taskId) return "unavailable";
  if (started) return "started";
  if (i.outcome?.state === "sent_here") return "sent_here";
  if (i.spawning) return "starting";
  if (i.queued) return i.queued.accepted ? "briefing" : "proposed";
  const state = i.outcome?.state;
  return state === "dismissed" || state === "start_failed" || state === "kept_here" ? state : "resolved";
}

/**
 * Who opened a turn (Claude turnInput.person): the user at the composer, or the app, another
 * session, a brief or a side-sessions event. Only the user's own words may start a session.
 */
export type TurnOrigin = "person" | "brief" | "event" | "peer" | "app";

const OPENERS: [RegExp, TurnOrigin][] = [
  [/^<side-sessions-event>/, "event"],
  [/^<ci-monitor-event\b/, "event"],
  // A scheduled task's heartbeat envelope or cron header (context/automations.mjs).
  [/^<heartbeat>/i, "event"],
  [/^Automation: [^\n]*\nAutomation ID: /, "event"],
  [/^<session-message\b/, "peer"],
];

export function turnOrigin(items: readonly ThreadItem[], appTexts: readonly string[] = []): TurnOrigin {
  const opening = items.find((item): item is Extract<ThreadItem, { type: "userMessage" }> => item.type === "userMessage");
  if (!opening) return "app";
  const text = opening.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n").trim();
  if (isBrief(text)) return "brief";
  for (const [pattern, origin] of OPENERS) if (pattern.test(text)) return origin;
  return appTexts.includes(text) ? "app" : "person";
}

/** What the result of a codex_ui_desktop session call names (sessions.mjs sessionResult _meta). */
export interface SessionMeta {
  outcome: string;
  taskId?: string;
  sessionId?: string;
  title?: string;
  cloud?: boolean;
}

export function sessionMeta(item: Extract<ThreadItem, { type: "mcpToolCall" }>): SessionMeta | undefined {
  const meta = item.result?._meta;
  const session = meta && typeof meta === "object" && !Array.isArray(meta) ? meta.codexUiSession : undefined;
  if (!session || typeof session !== "object" || Array.isArray(session) || typeof session.outcome !== "string") return undefined;
  const text = (key: string) => (typeof session[key] === "string" ? (session[key] as string) : undefined);
  return { outcome: session.outcome, taskId: text("taskId"), sessionId: text("sessionId"), title: text("title"), ...(session.cloud === true && { cloud: true }) };
}

export type SessionCallKind = "propose" | "offer" | "brief" | "claim" | "start" | "dismiss" | "send" | "handoff" | "targets";

/** A codex_ui_desktop start_session call by what it does (Claude cb27dab29 K / Ye). */
export function sessionCall(item: ThreadItem): SessionCallKind | null {
  if (item.type !== "mcpToolCall" || item.server !== "codex_ui_desktop") return null;
  if (item.tool === "dismiss_task") return "dismiss";
  if (item.tool === "send_message") return "send";
  if (item.tool === "hand_off_to_session") return "handoff";
  if (item.tool === "list_start_targets") return "targets";
  if (item.tool !== "start_session") return null;
  const args = item.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments) ? (item.arguments as Record<string, unknown>) : {};
  const text = (key: string) => (typeof args[key] === "string" && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
  if (text("proposal_id")) return text("prompt") ? "brief" : "claim";
  return args.initiation === "own_initiative" ? "propose" : args.initiation === "offer" ? "offer" : "start";
}

/** A call's title argument, as its row shows it (Claude Cr(ot(input.title))). */
export function callTitle(item: Extract<ThreadItem, { type: "mcpToolCall" }>): string | undefined {
  const args = item.arguments && typeof item.arguments === "object" && !Array.isArray(item.arguments) ? (item.arguments as Record<string, unknown>) : {};
  const title = typeof args.title === "string" ? args.title.replace(/\s+/g, " ").trim() : "";
  return title || undefined;
}

const PERMISSION_RANK: Record<Permission, number> = { "read-only": 0, auto: 1, "full-access": 2 };
const EFFORT_RANK = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** A permission mode no higher than the parent's (Claude WL); null when the ask goes higher. */
export function cappedPermission(asked: Permission | undefined, parent: Permission | null): Permission | null | undefined {
  if (!asked) return undefined;
  if (!parent) return asked === "read-only" ? asked : null;
  return PERMISSION_RANK[asked] <= PERMISSION_RANK[parent] ? asked : null;
}

/** Reasoning effort at or below the parent's (Claude: higher ones fall back to the parent's). */
export function cappedEffort(asked: string | undefined, parent: string | null): string | undefined {
  if (!asked) return undefined;
  const a = EFFORT_RANK.indexOf(asked), p = parent ? EFFORT_RANK.indexOf(parent) : -1;
  return a >= 0 && (p < 0 || a <= p) ? asked : undefined;
}

/** c3fef5c6f RS / IS: the message 在此处操作 sends, titled by the card (title, its first line, the brief's). */
export function doHereText(proposal: Pick<Proposal, "title" | "prompt">): string {
  const title = (proposal.title || proposal.prompt.split("\n").find((line) => line.trim()) || "").trim().slice(0, 200).replace(/["“”「」]/g, "'");
  return `在这里完成此任务：“${title}”`;
}

// ---------------------------------------------------------------------------
// Kept on this machine: Codex stores no proposals or links, so a restart reads them back here.

const PROPOSALS_KEY = "codex-ui:session-proposals";
const LINKS_KEY = "codex-ui:linked-sessions";
const MUTED_KEY = "codex-ui:offers-muted";

export function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: they last for this page only.
  }
}

export const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

export interface SideSessions {
  proposals: Record<string, Proposal[]>;
  proposalOutcomes: Record<string, ProposalOutcome>;
  links: Record<string, SessionLink>;
  offersMuted: Set<string>;
}

/** What a restart reads back. Offers are left out: their calls died with the old connection. */
export function loadSideSessions(): SideSessions {
  const kept = record(readJson(PROPOSALS_KEY));
  const proposals: Record<string, Proposal[]> = {};
  for (const [parentId, queue] of Object.entries(record(kept.proposals))) {
    const live = (Array.isArray(queue) ? queue : []).filter((entry): entry is Proposal => !!entry && typeof entry.id === "string" && typeof entry.title === "string" && !entry.offer);
    if (live.length) proposals[parentId] = live;
  }
  const muted = readJson(MUTED_KEY);
  return {
    proposals,
    proposalOutcomes: record(kept.outcomes) as Record<string, ProposalOutcome>,
    links: record(readJson(LINKS_KEY)) as Record<string, SessionLink>,
    offersMuted: new Set(Array.isArray(muted) ? muted.filter((id): id is string => typeof id === "string") : []),
  };
}

export function saveSideSessions(state: Readonly<{ proposals: Readonly<Record<string, readonly Proposal[]>>; proposalOutcomes: Readonly<Record<string, ProposalOutcome>>; links: Readonly<Record<string, SessionLink>>; offersMuted: ReadonlySet<string> }>): void {
  writeJson(PROPOSALS_KEY, { proposals: state.proposals, outcomes: state.proposalOutcomes });
  writeJson(LINKS_KEY, state.links);
  writeJson(MUTED_KEY, [...state.offersMuted]);
}
