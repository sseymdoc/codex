// Claude 4.29 side sessions, the app's half: start_session proposals and offers on their cards,
// the sessions they start, and what those leave for the session that started them. The model's
// half is codex_ui_desktop (context/sessions.mjs, components/DesktopTools.ts); Codex keeps none
// of it, so it lives in the store and on this machine (side-sessions.ts).

import type { StartArgs } from "../../context/desktop-tools.mjs";
import { desktopError } from "../../context/desktop-tools.mjs";
import { BACKGROUND_MIN, START_REFUSED, briefMessage, claimRefusal, linkedStatus, peerMessage, peerReminder, sessionName, sessionTitle, startedFromText, turnNote, unbriefedNote, wakeText } from "../../context/sessions.mjs";
import { activeTurn, effectiveSettings, errorMessage, isArchivedThread, renameThread, requestSessionId, sendMessage, startSideThread, type SideCheckout, type SideThreadSpec } from "./codex";
import { PLAN_RESUME, askingThreads } from "./questions";
import { cappedEffort, cappedPermission, claimOf, doHereText, enqueue, expiresAt, isExpired, newTaskId, readJson, remember, saveSideSessions, turnOrigin, writeJson, type OutcomeState, type Permission, type Proposal, type ProposalOutcome, type SessionLink, type TurnOrigin } from "./side-sessions";
import { getState, setState, toast, writePref, type AppState, type NewTaskPrompt } from "./store";

const save = () => saveSideSessions(getState());
const task = (proposal: Proposal) => ({ taskId: proposal.id, title: proposal.title });
const textInput = (text: string) => [{ type: "text" as const, text, text_elements: [] }];

/** Who opened the turn a call came in (Claude turnInput.person). */
export function originOf(threadId: string): TurnOrigin {
  const turn = activeTurn(getState().threads[threadId]);
  return turn ? turnOrigin(turn.items, [PLAN_RESUME]) : "app";
}

function setQueue(parentId: string, change: (queue: readonly Proposal[]) => readonly Proposal[]): void {
  setState((s) => {
    const next = { ...s.proposals, [parentId]: change(s.proposals[parentId] ?? []) };
    if (!next[parentId].length) delete next[parentId];
    return { proposals: next };
  });
}

/** A proposal leaves its queue for good, how it left kept (Claude resolvedBackgroundTaskSuggestions). */
function resolve(parentId: string, id: string, state: OutcomeState, extra: Pick<ProposalOutcome, "sessionId" | "cloud"> = {}): void {
  setQueue(parentId, (queue) => queue.filter((proposal) => proposal.id !== id));
  setState((s) => ({ proposalOutcomes: remember(s.proposalOutcomes, id, { state, parentId, at: Date.now(), ...extra }) }));
  save();
}

function spawning(id: string, on: boolean): void {
  setState((s) => {
    const next = new Set(s.spawning);
    if (on) next.add(id);
    else next.delete(id);
    return { spawning: next };
  });
}

const proposalOf = (parentId: string, id: string) => getState().proposals[parentId]?.find((proposal) => proposal.id === id);

/** Claude sweepExpiredProposals: a proposal unstarted for seven days leaves its card. */
export function sweepProposals(now = Date.now()): void {
  const { proposals, spawning: starting, offers } = getState();
  for (const [parentId, queue] of Object.entries(proposals))
    for (const proposal of queue) if (isExpired(proposal, now) && !starting.has(proposal.id) && offers[parentId] !== proposal.id) resolve(parentId, proposal.id, "expired");
}
// ponytail: a minute's sweep instead of Claude's timer at the earliest expiry; cards check the time themselves.
(setInterval(() => sweepProposals(), 60_000) as { unref?(): void }).unref?.();

// ---------------------------------------------------------------------------
// What a session is told with its next turn (Claude pendingSystemReminder): the app's reminders,
// the notes the sessions it started left (queuedSideSessionNotes), and its family's states.

const reminders = new Map<string, string[]>();

/** Notes by parent (at most 32 kept) and wakes since the user last wrote there, kept across restarts. */
const NOTES_KEY = "codex-ui:side-session-notes";
const NOTES_CAP = 32;
const WAKES_CAP = 10;
const notes: { notes: Record<string, string[]>; wakes: Record<string, number> } = (() => {
  const kept = readJson(NOTES_KEY) as { notes?: unknown; wakes?: unknown } | null;
  return { notes: (kept?.notes as Record<string, string[]>) ?? {}, wakes: (kept?.wakes as Record<string, number>) ?? {} };
})();
const saveNotes = () => writeJson(NOTES_KEY, notes);

export interface SideContext {
  entries: Record<string, { kind: "untrusted" | "application"; value: string }>;
  reminders: string[];
  notes: string[];
}

/**
 * The context a session's next turn or steer carries, until sentSideContext drops it: the app's
 * reminders and the family's states as application context, the notes as untrusted data (they
 * quote the sessions' own words).
 */
export function sideContext(threadId: string): SideContext | null {
  const pending = reminders.get(threadId) ?? [];
  const left = notes.notes[threadId] ?? [];
  if (!pending.length && !left.length) return null;
  const status = familyStatus(threadId);
  const application = [...pending, ...(status ? [status] : [])];
  return {
    entries: {
      ...(application.length && { "codex-ui.linked-sessions": { kind: "application" as const, value: application.join("\n\n") } }),
      ...(left.length && { "codex-ui.side-sessions": { kind: "untrusted" as const, value: left.join("\n\n") } }),
    },
    reminders: pending,
    notes: left,
  };
}

export function sentSideContext(threadId: string, side: SideContext | null): void {
  if (!side) return;
  const pending = (reminders.get(threadId) ?? []).filter((text) => !side.reminders.includes(text));
  if (pending.length) reminders.set(threadId, pending);
  else reminders.delete(threadId);
  if (!side.notes.length) return;
  const left = (notes.notes[threadId] ?? []).filter((text) => !side.notes.includes(text));
  if (left.length) notes.notes[threadId] = left;
  else delete notes.notes[threadId];
  saveNotes();
}

function remind(threadId: string, text: string): void {
  reminders.set(threadId, [...(reminders.get(threadId) ?? []), text]);
}

function note(parentId: string, text: string): void {
  notes.notes[parentId] = [...(notes.notes[parentId] ?? []), text].slice(-NOTES_CAP);
  saveNotes();
}

/** The session a family hangs from: up the links, as Claude's linkedFamilyRoot walks (32 at most). */
function familyRoot(id: string): string {
  let root = id;
  for (let depth = 0; depth < 32; depth += 1) {
    const up = getState().links[root]?.parentId;
    if (!up) break;
    root = up;
  }
  return root;
}

/** The sessions started from this one. */
const childrenOf = (parentId: string) => Object.keys(getState().links).filter((id) => getState().links[id].parentId === parentId);

export type ChildState = "starting" | "working" | "needs_you" | "done" | "failed" | "start_failed" | "archived";

/** Waits on the user: a request, a question, a consent or an offer card in it. */
function waitsOnUser(s: AppState, id: string): boolean {
  const thread = s.threads[id];
  return s.requests.some((request) => requestSessionId(request, s.threads) === id) || !!s.titleConsents[id] || !!s.planConsents[id] || !!s.offers[id] || (!!thread && askingThreads({ [id]: thread }, s.settledQuestions).length > 0);
}

/** A started session's state as its row and the Linked sessions note say it (c3fef5c6f Ln). */
export function childState(s: AppState, id: string): ChildState {
  const thread = s.threads[id];
  if (isArchivedThread(id)) return "archived";
  if (!thread) return "starting";
  if (waitsOnUser(s, id)) return "needs_you";
  if (activeTurn(thread) || thread.meta.status.type === "active") return "working";
  if (s.pendingMessages[id]) return thread.turns.length ? "working" : "starting";
  if (s.links[id]?.unbriefed && !thread.turns.length) return "start_failed";
  const last = thread.turns.at(-1);
  if (last?.status === "failed" || thread.meta.status.type === "systemError") return "failed";
  return last || thread.meta.status.type !== "idle" || thread.meta.preview ? "done" : "starting";
}

const STATUS_WORD: Record<ChildState, string> = { starting: "working", working: "working", needs_you: "needs the user", done: "done", failed: "failed", start_failed: "failed", archived: "archived" };

/** Claude's "Linked sessions now" line: the family but this session, null for a session in none. */
function familyStatus(threadId: string): string | null {
  const s = getState();
  const root = familyRoot(threadId);
  const members = [root, ...Object.keys(s.links).filter((id) => familyRoot(id) === root)].filter((id) => id !== threadId);
  if (!members.length || (root === threadId && !childrenOf(threadId).length)) return null;
  return linkedStatus(members.map((id) => ({ name: s.links[id]?.name ?? "top", id, state: STATUS_WORD[childState(s, id)] })));
}

/**
 * Once none of the sessions a parent started is working and the parent itself is idle with
 * nothing of the user's pending, the app continues it with what they reported (Claude
 * maybeWakeParentAfterSideSessions): ten times at most until the user writes there again, never
 * after the user stopped its last turn.
 */
function tryWake(parentId: string): void {
  const s = getState();
  const parent = s.threads[parentId];
  if (!notes.notes[parentId]?.length || !parent || isArchivedThread(parentId)) return;
  if (activeTurn(parent) || s.pendingMessages[parentId] || parent.queue.length || waitsOnUser(s, parentId)) return;
  if (parent.turns.at(-1)?.status === "interrupted" || (notes.wakes[parentId] ?? 0) >= WAKES_CAP) return;
  const children = childrenOf(parentId);
  if (children.some((id) => !!activeTurn(s.threads[id]) || !!s.pendingMessages[id])) return;
  notes.wakes[parentId] = (notes.wakes[parentId] ?? 0) + 1;
  saveNotes();
  const waiting = children.some((id) => waitsOnUser(s, id));
  void sendMessage(parentId, textInput(wakeText(waiting))).catch((error) => toast("warning", "发送失败", errorMessage(error)));
}

// ---------------------------------------------------------------------------
// Proposals and the sessions they start

/** Sessions started since the user last wrote, by session (Claude sideSessionStartsSinceUserMessage). */
const startsSinceMessage = new Map<string, number>();

/** A start_session proposal, own_initiative or offer, in its session's queue (Claude proposeSideSession). */
export function propose(parentId: string, args: StartArgs, offer = false): { proposal: Proposal; displaced: { taskId: string; title: string }[]; waiting: { taskId: string; title: string }[] } {
  sweepProposals();
  const now = Date.now();
  const proposal: Proposal = {
    id: newTaskId(),
    title: sessionTitle(args.title!),
    prompt: offer ? "" : args.prompt!,
    ...(!offer && args.background && { background: args.background }),
    context: args.context ?? "fresh",
    target: args.target ?? "local",
    ...(args.use_worktree !== undefined && { useWorktree: args.use_worktree }),
    ...(args.model && { model: args.model }),
    ...(args.effort && { effort: args.effort }),
    ...(args.permission_mode && { permission: args.permission_mode }),
    ...(args.name && { name: args.name }),
    ...(args.wake_when_done && { wake: true as const }),
    ...(offer && { offer: true as const }),
    createdAt: now,
    expiresAt: expiresAt(now),
  };
  const { proposals, spawning: starting, offers } = getState();
  const { queue, evicted } = enqueue(proposals[parentId] ?? [], proposal, new Set([...starting, ...Object.values(offers)]));
  setState((s) => ({
    proposals: { ...s.proposals, [parentId]: queue },
    proposalOutcomes: evicted.reduce((outcomes, old) => remember(outcomes, old.id, { state: "withdrawn", parentId, at: now }), s.proposalOutcomes),
  }));
  save();
  return { proposal, displaced: evicted.map(task), waiting: queue.filter((entry) => entry !== proposal && !entry.offer).map(task) };
}

/** Choices on a card's 选项 (Claude proposalPicks). */
export interface StartPicks {
  context?: "fresh" | "fork";
  useWorktree?: boolean;
  model?: string;
  effort?: string;
  permission?: Permission;
}

/**
 * What a session starts with: the picks over what was proposed, within the parent's limits. A
 * model asking for a higher permission mode is refused (Claude WL); a card's pick falls back.
 */
function specOf(parentId: string, asked: StartPicks & { context: "fresh" | "fork" }, refuseHigher: boolean): SideThreadSpec {
  const settings = effectiveSettings(getState().threads[parentId] ?? null);
  const permission = cappedPermission(asked.permission, settings.permission);
  if (permission === null && refuseHigher)
    throw desktopError("PERMISSION_TOO_HIGH", `permission_mode "${asked.permission}" would let the new session do more without asking than this session may (${settings.permission ?? "a custom permissions profile"}). Omit permission_mode to start it in this session's mode, or pass a lower one.`);
  const fresh = asked.context === "fresh";
  const model = fresh && asked.model && getState().models.some((m) => m.id === asked.model || m.model === asked.model) ? asked.model : undefined;
  return {
    context: asked.context,
    ...(fresh && asked.useWorktree !== undefined && { useWorktree: asked.useWorktree }),
    ...(model && { model }),
    ...(fresh && cappedEffort(asked.effort, settings.effort) && { effort: cappedEffort(asked.effort, settings.effort) }),
    ...(permission && { permission }),
  };
}

export interface Launched {
  sessionId: string;
  name: string;
  title: string;
  checkout: SideCheckout;
}

function link(childId: string, entry: SessionLink): void {
  setState((s) => ({ links: { ...s.links, [childId]: entry } }));
  save();
}

function setLink(childId: string, change: (entry: SessionLink) => SessionLink): void {
  const entry = getState().links[childId];
  if (entry) link(childId, change(entry));
}

/** Opens the session, links, names and (with a prompt) briefs it (Claude startSideSession). */
async function launch(parentId: string, source: { title: string; prompt: string; background?: string; name?: string; taskId?: string; wake?: boolean; kind: SessionLink["kind"] }, spec: SideThreadSpec): Promise<Launched> {
  const title = sessionTitle(source.title);
  const { id, checkout } = await startSideThread(parentId, spec);
  const taken = new Set(Object.values(getState().links).filter((entry) => entry.parentId === parentId).map((entry) => entry.name));
  const name = sessionName(source.name, title, (candidate) => taken.has(candidate));
  link(id, { parentId, ...(source.taskId && { taskId: source.taskId }), title, name, kind: source.kind, at: Date.now(), ...(source.wake && { wake: true as const }) });
  await renameThread(id, title, "tool").catch((error) => console.warn("codex-ui: naming the session failed", errorMessage(error)));
  startsSinceMessage.set(parentId, (startsSinceMessage.get(parentId) ?? 0) + 1);
  remind(id, startedFromText({ parentId, shared: checkout !== "own" }));
  if (source.prompt) await brief(id, briefMessage({ prompt: source.prompt, background: source.background, context: spec.context }));
  return { sessionId: id, name, title, checkout };
}

async function brief(childId: string, text: string): Promise<void> {
  await sendMessage(childId, textInput(text));
  setLink(childId, (entry) => ({ ...entry, briefed: true }));
}

const refused = (taskId: string) => {
  const { proposals, proposalOutcomes, spawning: starting } = getState();
  const parentId = proposalOutcomes[taskId]?.parentId ?? Object.keys(proposals).find((id) => proposals[id].some((proposal) => proposal.id === taskId));
  return claimOf(parentId ? proposals[parentId] : undefined, proposalOutcomes[taskId], starting, taskId, Date.now());
};

/** A proposal started from its card or by the model's proposal_id (Claude startProposedSideSession). */
export async function startProposal(parentId: string, taskId: string, via: "card" | "model", picks: StartPicks = {}): Promise<Launched> {
  sweepProposals();
  const proposal = proposalOf(parentId, taskId);
  const claim = proposal ? claimOf(getState().proposals[parentId], undefined, getState().spawning, taskId, Date.now()) : refused(taskId) ?? "not_found";
  if (claim || !proposal) throw desktopError(`PROPOSAL_${(claim ?? "not_found").toUpperCase()}`, claimRefusal(claim ?? "not_found", taskId));
  spawning(taskId, true);
  try {
    const spec = specOf(parentId, { ...proposal, ...picks, context: picks.context ?? proposal.context }, false);
    const started = await launch(parentId, { ...proposal, taskId, kind: spec.context }, spec);
    resolve(parentId, taskId, "started", { sessionId: started.sessionId });
    if (via === "card") remind(parentId, `The user started your proposal ${taskId} ("${proposal.title}") as session ${started.sessionId}. It runs on its own; a note reaches you when it ends a turn.`);
    return started;
  } catch (error) {
    if (via === "card") {
      resolve(parentId, taskId, "start_failed");
      toast("warning", "无法启动建议的任务。", errorMessage(error));
    }
    throw error;
  } finally {
    spawning(taskId, false);
  }
}

/** start_session with initiation "user_asked": only on the user's own words in this chat. */
export async function startNow(parentId: string, args: StartArgs): Promise<Launched> {
  if (originOf(parentId) !== "person") throw desktopError("START_REFUSED", START_REFUSED);
  if (args.cwd && !/^(?:[a-zA-Z]:[\\/]|\/|\\\\)/.test(args.cwd)) throw desktopError("INVALID_CWD", "cwd must be an absolute path to a folder on this computer.");
  const spec = { ...specOf(parentId, { context: args.context ?? "fresh", useWorktree: args.use_worktree, model: args.model, effort: args.effort, permission: args.permission_mode }, true), ...(args.cwd && { cwd: args.cwd }) };
  return launch(parentId, { title: args.title!, prompt: args.prompt!, background: args.background, name: args.name, wake: args.wake_when_done, kind: spec.context }, spec);
}

/** 在此处操作 on a proposal card: the task comes to this session as your message (c3fef5c6f RS). */
export async function doItHere(parentId: string, taskId: string): Promise<void> {
  const proposal = proposalOf(parentId, taskId);
  if (!proposal) return;
  resolve(parentId, taskId, "sent_here");
  try {
    await sendMessage(parentId, textInput(doHereText(proposal)));
  } catch (error) {
    // Still suggested: the card comes back as it was.
    setQueue(parentId, (queue) => [...queue, proposal]);
    setState((s) => {
      const next = { ...s.proposalOutcomes };
      delete next[taskId];
      return { proposalOutcomes: next };
    });
    save();
    toast("warning", "发送失败", errorMessage(error));
  }
}

/** ✕ on a proposal card (Claude popBackgroundTaskSuggestionById with launched false). */
export function dismissFromCard(parentId: string, taskId: string): void {
  if (proposalOf(parentId, taskId)) resolve(parentId, taskId, "dismissed");
}

export type DismissOutcome = "dismissed" | "already_started" | "already_dismissed" | "expired" | "spawn_in_flight" | "not_found";

/** dismiss_task (Claude dismissBackgroundTaskSuggestionById): a waiting offer's call learns it was withdrawn. */
export function dismissByModel(parentId: string, taskId: string): DismissOutcome {
  sweepProposals();
  const claim = proposalOf(parentId, taskId) ? claimOf(getState().proposals[parentId], undefined, getState().spawning, taskId, Date.now()) : refused(taskId) ?? "not_found";
  if (claim) return claim;
  resolve(parentId, taskId, "withdrawn");
  offerAnswers.get(taskId)?.({ kind: "abandoned" });
  return "dismissed";
}

// ---------------------------------------------------------------------------
// Offers: the call waits on its card (Claude awaitSideSessionOffer / offerAnswer)

export type OfferAnswer = { kind: "accepted"; cloud?: boolean } | { kind: "kept" } | { kind: "typed_past" } | { kind: "unstarted" } | { kind: "abandoned" };
const offerAnswers = new Map<string, (answer: OfferAnswer) => void>();
/** Offers whose session is open and waits for its brief, by task id (Claude offerBriefs). */
const openedOffers = new Map<string, Launched>();

/** No timer, as in Claude: an answer, the call cancelled (turn stopped, disconnected) or the offer withdrawn. */
export function awaitOffer(parentId: string, taskId: string, signal: AbortSignal): Promise<OfferAnswer> {
  return new Promise((done) => {
    const settle = (answer: OfferAnswer) => {
      if (!offerAnswers.delete(taskId)) return;
      signal.removeEventListener("abort", abort);
      setState((s) => {
        if (s.offers[parentId] !== taskId) return {};
        const offers = { ...s.offers };
        delete offers[parentId];
        return { offers };
      });
      if (answer.kind !== "accepted" && proposalOf(parentId, taskId)) resolve(parentId, taskId, answer.kind === "unstarted" ? "start_failed" : answer.kind === "abandoned" ? "withdrawn" : "kept_here");
      done(answer);
    };
    const abort = () => settle({ kind: "abandoned" });
    offerAnswers.set(taskId, settle);
    signal.addEventListener("abort", abort, { once: true });
    setState((s) => ({ offers: { ...s.offers, [parentId]: taskId } }));
    if (signal.aborted) abort();
  });
}

/** Sessions started here since the user's last message: past ten, 始终新建会话 asks again (Claude). */
export const startsSince = (threadId: string): number => startsSinceMessage.get(threadId) ?? 0;

/** 新建会话 on an offer: its session opens now and waits for the brief the model writes next. */
export async function acceptOffer(parentId: string, taskId: string, picks: StartPicks = {}): Promise<boolean> {
  const proposal = proposalOf(parentId, taskId);
  const settle = offerAnswers.get(taskId);
  if (!proposal?.offer || proposal.accepted || !settle) {
    toast("warning", "该卡片已作答，或其回合已结束。请重新发送任务以开始。");
    return false;
  }
  spawning(taskId, true);
  try {
    // The brief comes fresh (Claude: "That session already started fresh").
    const spec = specOf(parentId, { ...proposal, ...picks, context: "fresh" }, false);
    const opened = await launch(parentId, { title: proposal.title, prompt: "", name: proposal.name, taskId, wake: proposal.wake, kind: "fresh" }, spec);
    openedOffers.set(taskId, opened);
    setQueue(parentId, (queue) => queue.map((entry) => (entry.id === taskId ? { ...entry, accepted: true as const } : entry)));
    save();
    settle({ kind: "accepted" });
    return true;
  } catch (error) {
    toast("warning", "无法启动建议的任务。", errorMessage(error));
    settle({ kind: "unstarted" });
    return false;
  } finally {
    spawning(taskId, false);
  }
}

/** 在此处操作 on an offer, or a message sent instead of an answer (Claude kept / typedPast). */
export function keepOffer(taskId: string, typedPast = false): void {
  offerAnswers.get(taskId)?.({ kind: typedPast ? "typed_past" : "kept" });
}

/** The brief for an offer the user accepted: proposal_id with prompt and background (Claude sendOfferBrief). */
export async function deliverBrief(parentId: string, taskId: string, args: StartArgs): Promise<Launched> {
  const proposal = proposalOf(parentId, taskId);
  const opened = openedOffers.get(taskId);
  if (!proposal?.offer) {
    const claim = refused(taskId) ?? "not_found";
    throw desktopError(`PROPOSAL_${claim.toUpperCase()}`, claimRefusal(claim, taskId));
  }
  if (!proposal.accepted || !opened) throw desktopError("OFFER_ON_CARD", `Offer ${taskId} is still on its card: nothing starts until the user presses New session there. Carry on with whatever else the turn needs, or end it.`);
  if (originOf(parentId) !== "person") throw desktopError("START_REFUSED", `This call sent nothing: the brief for ${taskId}, the offer the user accepted, is sent only on a turn the user typed to you here, and the app does not count this turn as one. Once you stop, treat the offer as lapsed: start that task only if they ask again.`);
  if (args.context === "fork") throw desktopError("BRIEF_FORK", `That session already started fresh; send prompt and background for ${taskId} instead of context "fork".`);
  if (!args.prompt || (args.background ?? "").length < BACKGROUND_MIN) throw desktopError("BRIEF_MISSING", `The user chose New session for ${taskId} and it is already open: call start_session with proposal_id "${taskId}", prompt, and a background of at least ${BACKGROUND_MIN} characters — nothing else.`);
  spawning(taskId, true);
  try {
    await brief(opened.sessionId, briefMessage({ prompt: args.prompt, background: args.background, context: "fresh" }));
    openedOffers.delete(taskId);
    resolve(parentId, taskId, "started", { sessionId: opened.sessionId });
    return opened;
  } catch (error) {
    throw desktopError("BRIEF_FAILED", `The session "${opened.title}" (${opened.sessionId}) is open but its brief could not be delivered (${errorMessage(error)}). Re-send it with send_message (\`to\`: ${opened.sessionId}), or do the task here.`);
  } finally {
    spawning(taskId, false);
  }
}

/**
 * A turn of a session ended. An offer accepted in it whose brief never came lapses, and its session
 * says so (Claude dropUnbriefedOffers; with wake_when_done the parent hears it too). A session
 * another one started leaves that one a note of the turn, unless the user drove it there or stopped
 * it (Claude notifyParentOfSideSessionTurn); then the parent may go on (tryWake).
 */
export function turnEnded(threadId: string): void {
  for (const proposal of getState().proposals[threadId] ?? []) {
    const opened = openedOffers.get(proposal.id);
    if (!proposal.accepted || !opened) continue;
    openedOffers.delete(proposal.id);
    resolve(threadId, proposal.id, "start_failed");
    setLink(opened.sessionId, (entry) => ({ ...entry, unbriefed: true }));
    if (proposal.wake) note(threadId, unbriefedNote({ title: opened.title, id: opened.sessionId }));
  }
  const s = getState();
  const link = s.links[threadId];
  const thread = s.threads[threadId];
  const turn = thread?.turns.at(-1);
  if (link && turn && turn.status !== "interrupted" && turnOrigin(turn.items, [PLAN_RESUME]) !== "person") {
    const report = turn.items.findLast((item) => item.type === "agentMessage" && !!item.text.trim());
    note(link.parentId, turnNote({
      title: thread.meta.name?.trim() || link.title,
      id: threadId,
      how: turn.status === "failed" ? "failed" : "completed",
      waiting: waitsOnUser(s, threadId),
      report: report?.type === "agentMessage" ? report.text : turn.error?.message ?? "",
    }));
  }
  tryWake(threadId);
  if (link) tryWake(link.parentId);
}

/** You wrote in a session: a waiting offer is answered by it, and its counts start over. */
export function noteUserMessage(threadId: string): void {
  const taskId = getState().offers[threadId];
  if (taskId) keepOffer(taskId, true);
  startsSinceMessage.delete(threadId);
  if (notes.wakes[threadId]) {
    delete notes.wakes[threadId];
    saveNotes();
  }
}

/**
 * send_message: a message to a session of this one's family, marked as sent by it (Claude
 * SendMessage). A busy session reads it in its running turn, an idle one starts a turn on it.
 */
export async function sendPeerMessage(fromId: string, to: string, message: string): Promise<{ title: string; busy: boolean }> {
  const s = getState();
  const target = s.threads[to];
  if (to === fromId) throw desktopError("INVALID_TARGET", "send_message cannot send to this session itself.");
  if (!target || familyRoot(to) !== familyRoot(fromId)) throw desktopError("INVALID_TARGET", `No session with id ${to} in this one's family (the sessions it started, the one that started it, and that one's others). Use an id from a start_session result, your first message or the Linked sessions note.`);
  const title = target.meta.name?.trim() || s.links[to]?.title || "session";
  if (isArchivedThread(to)) throw desktopError("ARCHIVED", `The session "${title}" (${to}) is archived; nothing was sent.`);
  // ponytail: a session not loaded here would have to open in the user's view to take it; resume it quietly when that matters.
  if (!target.subscribed) throw desktopError("NOT_LOADED", `The session "${title}" (${to}) isn't open in Codex UI right now, so nothing was sent. Tell the user in one line, or do the step here.`);
  const from = s.threads[fromId]?.meta.name?.trim() || s.links[fromId]?.title || "session";
  const busy = !!activeTurn(target);
  remind(to, peerReminder({ from: fromId, title: from }));
  await sendMessage(to, textInput(peerMessage({ from: fromId, title: from, message })));
  return { title, busy };
}

/** Settings → Codex → 当您请求无关的任务时, and the offer card's 不再询问 menu. */
export function setNewTaskPrompt(value: NewTaskPrompt): void {
  writePref("codex-ui:new-task-prompt", value);
  setState({ newTaskPrompt: value });
}

/** 不再询问 → 始终在此处执行: no more offers in this session (Claude muteSideSessionOffers). */
export function muteOffers(threadId: string): void {
  if (getState().offersMuted.has(threadId)) return;
  setState((s) => ({ offersMuted: new Set([...s.offersMuted, threadId]) }));
  save();
}

/** A deleted session takes its proposals, links and mute with it. */
export function forgetSession(threadId: string): void {
  const s = getState();
  if (!s.proposals[threadId] && !s.links[threadId] && !s.offersMuted.has(threadId)) return;
  const proposals = { ...s.proposals };
  delete proposals[threadId];
  const links = { ...s.links };
  delete links[threadId];
  const offersMuted = new Set(s.offersMuted);
  offersMuted.delete(threadId);
  setState({ proposals, links, offersMuted });
  save();
}
