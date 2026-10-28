import { DESKTOP_PANES, desktopError, validateDesktopInput, type DesktopArgs, type DesktopPlanMode, type DesktopRenamed, type DesktopRequest, type DesktopResult, type DesktopStarted, type DesktopState, type DesktopTarget } from "../../context/desktop-tools.mjs";
import { START_REFUSED } from "../../context/sessions.mjs";
import { acceptOffer, awaitOffer, deliverBrief, dismissByModel, handOff, originOf, propose, sendPeerMessage, startCloudNow, startNow, startProposal, startsSince, startTargets, type Launched } from "../lib/linked";
import { activeTurn, effectiveSettings, renameThread, resumeInPlanMode, setOverride } from "../lib/codex";
import { LINES_DEFAULT, TERMINAL_TOOL_NAMES } from "../../context/terminal-tools.mjs";
import { askPlanConsent, askTerminalConsent, askTitleConsent, getState, setState, type ThreadState } from "../lib/store";
import { layoutOf, openDiff, openPane } from "../lib/panes";
import { browserRequest, browserSnapshot } from "../lib/browser";
import { openBackgroundTask, visibleBackgroundTasks } from "../lib/background-view";
import { taskText } from "../lib/redact";
import { fileTargets, openFileTab } from "./FilePreview";
import { deferTerminalFocus, openToolTab, readTab, selectTerminal, stopTab, terminalTab, terminalTabs, terminalTargets, terminalWouldStart, typeInTab } from "./Terminal";
import { diffTargets } from "./Panes";
import { nextActions } from "./Rail";

/**
 * Claude 3.6556 set_session_title for this chat: a name the user gave is replaced only with their
 * consent (not in full access), and only while it is still the name they were asked about.
 */
async function renameSelf(id: string, cwd: string, title: string, check: () => ThreadState, signal: AbortSignal): Promise<DesktopRenamed> {
  const thread = check();
  const threadId = thread.meta.id;
  const previous = thread.meta.name?.trim() ? thread.meta.name : undefined;
  const source = getState().titleSources[threadId];
  const receipt = (outcome: DesktopRenamed["outcome"]): DesktopRenamed => ({
    threadId, cwd, title, outcome,
    ...(previous !== undefined && previous.length <= 2000 && { previousTitle: previous, ...(source && { previousTitleSource: source }) }),
  });
  if (source === "user" && previous !== undefined) {
    if (previous.normalize("NFKC").trim() === title.normalize("NFKC")) return receipt("unchanged");
    if (effectiveSettings(thread).permission !== "full-access") {
      const allowed = await askTitleConsent(threadId, { id, title }, signal);
      if (check().meta.name !== previous) throw desktopError("TITLE_CHANGED", "The session was renamed while waiting for approval; nothing was changed. Call again if the rename is still wanted.");
      if (!allowed) return receipt("declined");
    }
  }
  await renameThread(threadId, title, "tool");
  return receipt("renamed");
}

/**
 * Claude Code EnterPlanMode for this chat: it asks first (Enter plan mode?), not in auto mode.
 * Allowed, plan mode holds from the next turn, which starts as soon as this one completes
 * (codex.ts resumeInPlanMode); declined, the agent goes on without it (No, start implementing now).
 */
async function enterPlan(id: string, cwd: string, check: () => ThreadState, signal: AbortSignal): Promise<DesktopPlanMode> {
  const thread = check();
  const threadId = thread.meta.id;
  const receipt = (outcome: DesktopPlanMode["outcome"]): DesktopPlanMode => ({ threadId, cwd, outcome });
  if (thread.planMode) return receipt("already");
  if (!getState().modes.some((mode) => mode.mode === "plan")) return receipt("unavailable");
  const settings = effectiveSettings(thread);
  if (settings.reviewer !== "auto_review" || settings.permission === "full-access") {
    const allowed = await askPlanConsent(threadId, id, signal);
    check();
    if (!allowed) return receipt("declined");
  }
  const turn = activeTurn(check());
  if (!(await setOverride(threadId, { planMode: true }))) throw desktopError("SETTINGS_FAILED", "Plan mode could not be turned on; this chat stays in its current mode.");
  if (turn) resumeInPlanMode(threadId, turn.id);
  return receipt("entered");
}

/** A session start as start_session's result names it (sessions.mjs started). */
const started = (launched: Launched): Omit<DesktopStarted, "threadId" | "cwd"> =>
  launched.cloud ? { outcome: "cloud", taskId: launched.sessionId, title: launched.title } : { outcome: "started", sessionId: launched.sessionId, name: launched.name, title: launched.title, worktree: launched.checkout };

/**
 * Claude 4.29 start_session: a proposal card (own_initiative), an offer whose call waits on its
 * card, a start on the user's words (user_asked), or a proposal started or briefed by its id.
 */
async function startSession(cwd: string, args: DesktopArgs, check: () => ThreadState, signal: AbortSignal): Promise<DesktopStarted> {
  const threadId = check().meta.id;
  const receipt = (fields: Omit<DesktopStarted, "threadId" | "cwd">): DesktopStarted => ({ threadId, cwd, ...fields });
  if (args.proposal_id) {
    const taskId = args.proposal_id;
    if (getState().proposals[threadId]?.some((proposal) => proposal.id === taskId && proposal.offer)) return receipt(started(await deliverBrief(threadId, taskId, args)));
    if (args.prompt || args.background || args.context) throw desktopError("INVALID_INPUT", "proposal_id starts the proposal exactly as proposed \u2014 drop prompt, background and context. To run it differently, dismiss_task the proposal and call start_session with the new details.");
    if (originOf(threadId) !== "person") throw desktopError("START_REFUSED", START_REFUSED);
    return receipt(started(await startProposal(threadId, taskId, "model")));
  }
  if (args.initiation === "user_asked") return receipt(args.target === "cloud" ? { outcome: "cloud", ...(await startCloudNow(threadId, args)) } : started(await startNow(threadId, args)));
  if (args.initiation === "own_initiative") {
    const { proposal, displaced, waiting } = propose(threadId, args);
    return receipt({ outcome: "proposed", taskId: proposal.id, title: proposal.title, ...(displaced.length && { displaced }), ...(waiting.length && { waiting }) });
  }
  // An offer (Claude sideSessionOfferCanAsk): nobody to ask, muted here, or the setting answers it.
  const s = getState();
  if (originOf(threadId) !== "person") return receipt({ outcome: "no_card", reason: "nobody" });
  if (s.offersMuted.has(threadId)) return receipt({ outcome: "no_card", reason: "muted" });
  if (s.newTaskPrompt === "here") return receipt({ outcome: "no_card", reason: "always_here" });
  if (s.offers[threadId]) throw desktopError("OFFER_WAITING", `An offer is already on its card (${s.offers[threadId]}); carry on here \u2014 the user answers that one, or dismiss_task it first if this request replaced it.`);
  const { proposal } = propose(threadId, args, true);
  const answering = awaitOffer(threadId, proposal.id, signal);
  if (s.newTaskPrompt === "new_session" && startsSince(threadId) < 10) void acceptOffer(threadId, proposal.id);
  const answer = await answering;
  const taskId = proposal.id;
  switch (answer.kind) {
    case "accepted": return receipt({ outcome: "offer_accepted", taskId, title: proposal.title, ...(answer.cloud && { cloud: true }) });
    case "kept": return receipt({ outcome: "kept", taskId });
    case "typed_past": return receipt({ outcome: "typed_past", taskId });
    case "unstarted": return receipt({ outcome: "unstarted", taskId });
    default: return receipt({ outcome: "abandoned", taskId });
  }
}

/**
 * The terminal tools on this chat's tabs. run_in_terminal types into the user's own shell, outside
 * the sandbox: outside full access the user first allows the exact command on a card.
 */
async function terminalRequest(request: DesktopRequest, args: DesktopArgs, check: () => ThreadState, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  // check() holds the chat to this folder.
  const folder = cwd;
  switch (request.name) {
    case "list_terminal_tabs": return { threadId, cwd, tabs: terminalTabs(threadId, folder) };
    case "open_terminal_tab": return { threadId, cwd, outcome: "opened", tab: openToolTab(threadId, folder, args.title, args.cwd) };
    case "read_terminal": return { threadId, cwd, ...(await readTab(threadId, args.tab_id!, folder, args.lines ?? LINES_DEFAULT, args.wait_for_output_ms ?? 0, signal)) };
    case "stop_terminal_tab": return { threadId, cwd, ...stopTab(threadId, args.tab_id!, folder, args.mode ?? "interrupt") };
  }
  const command = args.command!;
  const target = args.tab_id ? terminalTab(threadId, args.tab_id, folder) : null;
  if (effectiveSettings(check()).permission !== "full-access") {
    const allowed = await askTerminalConsent(threadId, { id: request.id, command, tab: target?.label ?? null, folder: args.cwd ?? folder }, signal);
    check();
    if (!allowed) return { threadId, cwd, outcome: "declined" };
  }
  const tab = typeInTab(threadId, folder, command, { id: args.tab_id, title: args.title, cwd: args.cwd });
  const wait = args.wait_for_output_ms ?? 0;
  if (!wait) return { threadId, cwd, outcome: "ran", tab };
  const read = await readTab(threadId, tab.tab_id, folder, LINES_DEFAULT, wait, signal);
  return { threadId, cwd, outcome: "ran", ...read };
}

/** Only bounded display metadata leaves the renderer; targets stay scoped to this thread. */
export async function displayRequest(request: DesktopRequest, signal: AbortSignal): Promise<DesktopResult> {
  const args = validateDesktopInput(request.name, request.args);
  const { threadId, cwd } = request;
  const check = () => {
    const thread = getState().threads[threadId];
    if (signal.aborted || Date.now() >= request.deadline) throw desktopError("CANCELLED", "Display request expired.");
    if (!window.codexDesktop || !thread?.subscribed || thread.meta.parentThreadId || (thread.settings?.cwd ?? thread.meta.cwd) !== cwd) throw desktopError("UNAVAILABLE", "This chat has no local desktop binding.");
    return thread;
  };
  check();
  if (request.name === "set_session_title") return renameSelf(request.id, cwd, args.title!, check, signal);
  if (request.name === "enter_plan_mode") return enterPlan(request.id, cwd, check, signal);
  // Claude ccd_session mark_chapter: the call is the heading (transcript.ts agentChapters); the session start is the first chapter already.
  if (request.name === "mark_chapter") return { threadId, cwd, outcome: check().turns.length > 1 ? "marked" : "first_message" };
  if (request.name === "start_session") return startSession(cwd, args, check, signal);
  if (request.name === "dismiss_task") return { threadId, cwd, taskId: args.task_id!, outcome: dismissByModel(threadId, args.task_id!) };
  if (request.name === "hand_off_to_session") {
    const launched = await handOff(threadId, args.title!, args.remaining_plan!);
    return { threadId, cwd, outcome: "handed_off", sessionId: launched.sessionId, title: launched.title, worktree: launched.checkout === "own" ? "own" : "fork" };
  }
  if (request.name === "list_start_targets") return { threadId, cwd, ...(await startTargets(threadId)) };
  // wrap_up (Claude ccd_turn): its box is the plan card's turn box, and the app actions are the ones that hold now.
  if (request.name === "wrap_up") return { threadId, cwd, enabled: getState().planCard, available: nextActions(check()) };
  if (request.name === "send_message") {
    const sent = await sendPeerMessage(threadId, args.to!, args.message!);
    return { threadId, cwd, outcome: "sent", sessionId: args.to!, title: sent.title, busy: sent.busy };
  }
  if ((TERMINAL_TOOL_NAMES as readonly string[]).includes(request.name)) return terminalRequest(request, args, check, signal);
  if (args.pane === "browser" && request.browserEnabled) await browserRequest(threadId, cwd, "state");
  const thread = check();
  const tasks = visibleBackgroundTasks(thread, getState().threads);
  const available = (pane: typeof DESKTOP_PANES[number]) => pane === "browser" ? request.browserEnabled : pane === "terminal" ? terminalTargets(threadId).length > 0 : true;
  const targets = (): DesktopTarget[] => {
    switch (args.pane) {
      case "files": return fileTargets(threadId);
      case "diff": return diffTargets(thread);
      case "terminal": return terminalTargets(threadId);
      case "background": return tasks.map(task => ({ id: task.key, label: task.kind === "shell" && task.title === task.command ? "终端任务" : task.title }));
      case "browser": return request.browserEnabled ? (browserSnapshot(threadId)?.tabs ?? []).map(tab => ({ id: tab.id, label: tab.title || "浏览器标签页" })) : [];
      default: return [];
    }
  };
  if (request.name === "get_ui_state") {
    const layout = layoutOf(threadId);
    const state: DesktopState = { threadId, cwd, currentView: getState().activeId === threadId,
      panes: DESKTOP_PANES.map(pane => ({ pane, available: available(pane), open: layout.open.includes(pane), expanded: layout.expanded === pane })) };
    if (args.pane) {
      const all = targets().filter(target => target.id.length <= 4096 && !/[\x00-\x1f]/.test(target.id));
      const offset = args.offset ?? 0, end = Math.min(offset + 50, all.length);
      Object.assign(state, { pane: args.pane, offset, targets: all.slice(offset, end).map(target => ({ id: target.id, label: taskText(target.label).slice(0, 512) })), total: all.length, nextOffset: end < all.length ? end : null });
    }
    return state;
  }
  const pane = args.pane!;
  if (!available(pane)) throw desktopError("UNAVAILABLE", "This pane is unavailable; no resource was created.");
  if (args.targetId && !targets().some(target => target.id === args.targetId)) throw desktopError("TARGET_NOT_FOUND", "The target no longer exists in this chat.");
  const checkLayout = () => {
    const layout = layoutOf(threadId);
    // Revealing another pane can also remount a hidden terminal with a never-started tab.
    if (pane !== "terminal" && layout.open.includes("terminal") && layout.expanded && layout.expanded !== pane && terminalWouldStart(threadId)) throw desktopError("UNAVAILABLE", "Revealing these panes would start an uninitialized terminal; select an existing terminal first.");
  };
  checkLayout();
  const releaseFocus = deferTerminalFocus(threadId);
  try {
    if (pane === "files" && (args.path || args.targetId)) openFileTab(threadId, args.path ?? args.targetId!, args.line);
    if (pane === "diff" && args.targetId) openDiff(args.targetId, threadId, true);
    if (pane === "terminal" && !selectTerminal(threadId, args.targetId)) throw desktopError("TARGET_NOT_FOUND", "No initialized terminal exists in this chat.");
    if (pane === "background" && args.targetId) openBackgroundTask(threadId, tasks.find(task => task.key === args.targetId)!, tasks);
    if (pane === "browser" && args.targetId) await browserRequest(threadId, cwd, "select", { tabId: args.targetId });
    check();
    checkLayout();
    openPane(pane, threadId);
    const layout = layoutOf(threadId);
    if (layout.expanded && layout.expanded !== pane) setState(state => ({ panes: { ...state.panes, [threadId]: { ...layout, expanded: null } } }));
    // Inactive views keep their layout without switching chats. Active views acknowledge a DOM commit.
    if (getState().activeId === threadId && !document.hidden) {
      await new Promise<void>(resolve => {
        let frame = 0;
        const done = () => { cancelAnimationFrame(frame); signal.removeEventListener("abort", done); resolve(); };
        signal.addEventListener("abort", done, { once: true });
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
      });
      check();
    }
    const element = document.querySelector(`[data-view="${CSS.escape(threadId)}"][data-pane="${pane}"]`);
    return { threadId, cwd, pane, applied: true, displayed: getState().activeId === threadId && !document.hidden && !!element?.getClientRects().length };
  } finally { releaseFocus(); }
}
