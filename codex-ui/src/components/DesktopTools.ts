import { DESKTOP_PANES, desktopError, validateDesktopInput, type DesktopArgs, type DesktopPlanMode, type DesktopRenamed, type DesktopRequest, type DesktopResult, type DesktopStarted, type DesktopState, type DesktopTarget } from "../../context/desktop-tools.mjs";
import { START_REFUSED } from "../../context/sessions.mjs";
import { acceptOffer, awaitOffer, deliverBrief, dismissByModel, handOff, originOf, propose, sendPeerMessage, startCloudNow, startNow, startProposal, startsSince, startTargets, type Launched } from "../lib/linked";
import { activeTurn, attachBranchPr, bindPullRequest, closeSplit, defersWorktree, ensureThreads, openSplit, openThread, effectiveSettings, enterWorktree, errorMessage, forgetLazyWorktree, inWorktreeRoot, movingToWorktree, readPr, syncThreadWithBase, refreshAttachments, removePullRequest, renameThread, resumeInPlanMode, setOverride, setPrAutoMerge } from "../lib/codex";
import { LINES_DEFAULT, TERMINAL_TOOL_NAMES } from "../../context/terminal-tools.mjs";
import { PR_MAX, PR_TOOL_NAMES, type PrInfo } from "../../context/pr-tools.mjs";
import { WORKTREE_TOOL_NAMES } from "../../context/worktree-tools.mjs";
import { MODEL_SETTINGS, SETTINGS_TOOL_NAMES, valueLabel } from "../../context/settings-tools.mjs";
import { WINDOW_TOOL_NAMES } from "../../context/window-tools.mjs";
import { MANAGE_TOOL_NAMES } from "../../context/manage-tools.mjs";
import { manageRequest } from "./DesktopManage";
import { HOST_TOOL_NAMES } from "../../context/host-tools.mjs";
import { hostRequest } from "./DesktopHost";
import { sidebarTools } from "./Sidebar";
import type { AutomationArgs, CloudTaskArgs } from "../../context/automation-tools.mjs";
import { automationRequest, cloudTaskRequest } from "../lib/automation-requests";
import { threadTitle } from "../lib/format";
import { askPlanConsent, askSettingConsent, askTerminalConsent, askTitleConsent, getState, isShown, pullRequests, setState, splitColumns, type AttachedPullRequest, type ThreadState } from "../lib/store";
import { ghProblemText, githubRemote, parsePr, prIdentity, type PrStatus } from "../lib/pr";
import { isMonitored, setMonitored } from "../lib/pr-monitor";
import { layoutOf, openDiff, openPane } from "../lib/panes";
import { browserRequest, browserSnapshot } from "../lib/browser";
import { openBackgroundTask, visibleBackgroundTasks } from "../lib/background-view";
import { taskText } from "../lib/redact";
import { fileTargets, openFileTab } from "./FilePreview";
import { deferTerminalFocus, openToolTab, readTab, selectTerminal, stopTab, terminalTab, terminalTabs, terminalTargets, terminalWouldStart, typeInTab } from "./Terminal";
import { diffTargets } from "./Panes";
import { nextActions, readPrInto } from "./Rail";

/**
 * Claude 4.4212 set_session_title, for this chat or another (session_id): a name the user gave is
 * replaced only with their consent (not in full access), and only while it is still the name they
 * were asked about. The card shows in this chat; the receipt is this chat's.
 */
async function renameSession(id: string, cwd: string, title: string, sessionId: string | undefined, check: () => ThreadState, signal: AbortSignal): Promise<DesktopRenamed> {
  const self = check();
  if (sessionId && !getState().threads[sessionId]) await ensureThreads([sessionId]);
  const thread = sessionId ? getState().threads[sessionId] : self;
  if (!thread || thread.meta.parentThreadId) throw desktopError("SESSION_NOT_FOUND", `No session with id ${sessionId}; use an id from list_sessions.`);
  const target = thread.meta.id;
  const previous = thread.meta.name?.trim() ? thread.meta.name : undefined;
  const source = getState().titleSources[target];
  const receipt = (outcome: DesktopRenamed["outcome"]): DesktopRenamed => ({
    threadId: self.meta.id, cwd, title, outcome,
    ...(previous !== undefined && previous.length <= 2000 && { previousTitle: previous, ...(source && { previousTitleSource: source }) }),
  });
  if (source === "user" && previous !== undefined) {
    if (previous.normalize("NFKC").trim() === title.normalize("NFKC")) return receipt("unchanged");
    if (effectiveSettings(self).permission !== "full-access") {
      const allowed = await askTitleConsent(self.meta.id, { id, title }, signal);
      check();
      if (getState().threads[target]?.meta.name !== previous) throw desktopError("TITLE_CHANGED", "The session was renamed while waiting for approval; nothing was changed. Call again if the rename is still wanted.");
      if (!allowed) return receipt("declined");
    }
  }
  await renameThread(target, title, "tool");
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

/** A bound pull request as the PR tools report it. */
function prInfo(threadId: string, key: string, status: PrStatus): PrInfo {
  return {
    url: status.url, number: parsePr(status.url)?.number ?? 0, title: status.title.slice(0, 1000), state: status.state,
    review_decision: status.review ?? null, checks: { ...status.ci, failing: status.ci.failing.map((name) => name.slice(0, 300)) },
    conflicts: status.conflicting, merge_state: status.mergeState?.slice(0, 40) ?? null, unresolved_threads: status.openThreads ?? null,
    auto_merge: status.autoMerge, auto_fix: isMonitored(threadId, key), head_sha: status.headSha, head_branch: status.headRef ?? null, base_branch: status.baseRef,
  };
}

/**
 * The pull request tools on this session's bound PRs (the rail's 更改 card), through gh. Turning
 * auto-merge or auto-fix on is the user's call: a turn the user did not start may only turn them off.
 */
async function prRequest(request: DesktopRequest, args: DesktopArgs, check: () => ThreadState): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  const thread = check();
  if (thread.attachments === null) await refreshAttachments(threadId);
  const bound = () => pullRequests(check());
  const remote = githubRemote(thread.meta.gitInfo?.originUrl);
  const repo = remote ? `${remote.host}/${remote.repo}` : null;
  /** The bound PR a selector names; none named, the only one bound. */
  const find = (selector?: string): AttachedPullRequest | null => {
    const prs = bound();
    if (!selector) {
      if (prs.length === 1) return prs[0];
      throw desktopError("PR_AMBIGUOUS", prs.length ? `Name the pull request (pr): this session has ${prs.length} bound: ${prs.map((pr) => pr.url).join(", ")}.` : "No pull request is bound to this session; bind one with bind_pr.");
    }
    const number = /^#?(\d+)$/.exec(selector)?.[1];
    const link = number ? null : parsePr(selector);
    const matches = prs.filter((pr) => (link ? pr.key === prIdentity(link) : parsePr(pr.url)?.number === Number(number)));
    if (matches.length > 1) throw desktopError("PR_AMBIGUOUS", `Several bound pull requests have number ${number}; pass the URL.`);
    return matches[0] ?? null;
  };
  const named = (selector?: string) => {
    const pr = find(selector);
    if (!pr) throw desktopError("PR_NOT_BOUND", "That pull request isn't bound to this session; bind it with bind_pr first.");
    return pr;
  };
  const askedByUser = () => {
    if (originOf(threadId) !== "person") throw desktopError("NOT_ASKED", "Only the user turns this on, and this turn did not come from them. Ask them in your reply.");
  };
  if (request.name === "get_pr_status") {
    let prs = args.pr ? [named(args.pr)] : bound();
    let problem: string | undefined;
    // None bound yet: the branch's open PR, as the 更改 card's lookup binds it.
    const branch = thread.meta.gitInfo?.branch;
    if (!prs.length && repo && branch && !/^#?\d+$/.test(branch)) {
      const found = await readPr(cwd, branch, repo);
      if (found.status) {
        await attachBranchPr(threadId, found.status, branch);
        prs = bound();
      } else if (found.problem) problem = ghProblemText(found.problem);
    }
    const reads = await Promise.all(prs.slice(0, PR_MAX).map(async (pr) => ({ pr, ...(await readPr(cwd, pr.url)) })));
    const failed = reads.find((read) => !read.status && read.problem)?.problem;
    if (failed) problem = ghProblemText(failed);
    return { threadId, cwd, pullRequests: reads.flatMap((read) => (read.status ? [prInfo(threadId, read.pr.key, read.status)] : [])), ...(problem && { problem: problem.slice(0, 500) }) };
  }
  if (request.name === "bind_pr") {
    const { status, identityKey, already } = await bindPullRequest(threadId, args.pr!).catch((error: unknown) => { throw desktopError("PR_NOT_FOUND", errorMessage(error)); });
    readPrInto(cwd, identityKey, status.url);
    return { threadId, cwd, outcome: already ? "already" : "bound", pullRequest: prInfo(threadId, identityKey, status) };
  }
  if (request.name === "unbind_pr") {
    const pr = find(args.pr);
    if (!pr) {
      const link = parsePr(args.pr!);
      if (!link) throw desktopError("PR_NOT_BOUND", "No bound pull request has that number; nothing changed.");
      return { threadId, cwd, outcome: "not_bound", url: link.url };
    }
    setMonitored(threadId, pr.key, pr.url, false);
    await removePullRequest(threadId, pr.key);
    await refreshAttachments(threadId);
    return { threadId, cwd, outcome: "unbound", url: pr.url };
  }
  const pr = named(args.pr);
  const url = parsePr(pr.url)?.url ?? pr.url;
  if (args.enabled) askedByUser();
  if (request.name === "set_pr_monitor") {
    if (isMonitored(threadId, pr.key) === args.enabled) return { threadId, cwd, outcome: "unchanged", url };
    setMonitored(threadId, pr.key, pr.url, args.enabled!);
    return { threadId, cwd, outcome: args.enabled ? "on" : "off", url };
  }
  const { status, problem } = await readPr(cwd, pr.url);
  if (!status) throw desktopError("GH_FAILED", problem ? `gh could not read the pull request: ${ghProblemText(problem)}` : "gh could not read the pull request.");
  if (status.state === "merged" || status.state === "closed") throw desktopError("PR_DONE", `The pull request is ${status.state}; auto-merge no longer applies.`);
  if (args.enabled && status.state === "draft") throw desktopError("PR_DRAFT", "A draft can't take auto-merge: it has to be marked ready for review first.");
  if (status.autoMerge === args.enabled) return { threadId, cwd, outcome: "unchanged", url };
  const done = await setPrAutoMerge(cwd, pr.url, args.enabled!, repo);
  readPrInto(cwd, pr.key, pr.url);
  if (!done.ok) throw desktopError("GH_FAILED", `gh could not change auto-merge${done.problem ? `: ${ghProblemText(done.problem)}` : "."}`);
  return { threadId, cwd, outcome: args.enabled ? "on" : "off", url };
}

/** 与基础分支同步 for a worktree session, and the worktree a deferring session makes before it changes files. */
async function worktreeRequest(request: DesktopRequest, args: DesktopArgs): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  if (request.name === "enter_worktree") {
    if (!defersWorktree(threadId)) return { threadId, cwd, outcome: inWorktreeRoot(cwd) || movingToWorktree(threadId) ? "already" : "not_deferred" };
    try {
      const made = await enterWorktree(threadId, request.id);
      return { threadId, cwd, outcome: "entered", worktree: made.worktree, base: made.base };
    } catch (error) {
      const message = errorMessage(error);
      if (/不是 Git 仓库/.test(message)) {
        forgetLazyWorktree(threadId);
        throw desktopError("NOT_REPOSITORY", "This folder is not in a Git repository, so there is no worktree to make; work here.");
      }
      throw desktopError("WORKTREE_FAILED", `Codex UI could not create the worktree (${message}); nothing moved. Tell the user before you change files in their checkout.`);
    }
  }
  if (!inWorktreeRoot(cwd)) throw desktopError("NOT_WORKTREE", "This session works in the user's own checkout, not in a worktree Codex UI made, so sync_with_base_branch doesn't apply. Merge with git yourself only if the user asks.");
  try {
    return { threadId, cwd, ...(await syncThreadWithBase(threadId, args.base)) };
  } catch (error) {
    throw desktopError("SYNC_FAILED", `Syncing failed: ${errorMessage(error)}`);
  }
}

/** get_settings / set_setting: the listed preferences, each change only once the user allows it on a card. */
async function settingsRequest(request: DesktopRequest, args: DesktopArgs, check: () => ThreadState, signal: AbortSignal): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  const { readModelSettings, writeModelSetting } = await import("./Settings");
  const values = await readModelSettings();
  if (request.name === "get_settings") return { threadId, cwd, values };
  const key = args.key!, value = args.value!;
  const previous = values[key];
  if (previous === undefined) throw desktopError("UNAVAILABLE", "That setting can't be read here (the desktop app did not answer); nothing was changed.");
  if (previous === value) return { threadId, cwd, key, value, previous, outcome: "unchanged" };
  const allowed = await askSettingConsent(threadId, { id: request.id, label: MODEL_SETTINGS[key].label, from: valueLabel(key, previous), to: valueLabel(key, value) }, signal);
  check();
  if (!allowed) return { threadId, cwd, key, value, previous, outcome: "declined" };
  await writeModelSetting(key, value);
  return { threadId, cwd, key, value, previous, outcome: "changed" };
}

/**
 * Split view: what is on screen, another session beside this chat or in its column, and the split
 * closed again. The layout changes at once; a session shown beside loads in the background.
 */
async function windowRequest(request: DesktopRequest, args: DesktopArgs): Promise<DesktopResult> {
  const { threadId, cwd } = request;
  const s = getState();
  if (request.name === "get_window_layout") {
    const columns = splitColumns(s).filter((id) => s.threads[id]).map((id) => ({ sessionId: id, title: taskText(threadTitle(s.threads[id].meta)).slice(0, 200), focused: id === s.activeId }));
    return { threadId, cwd, columns, sidebarCollapsed: !s.sidebarOpen };
  }
  // Claude 4.4212 set_sidebar_collapsed: only while this chat is on screen.
  if (request.name === "set_sidebar_collapsed") return { threadId, cwd, outcome: isShown(s, threadId) ? sidebarTools.setCollapsed(args.collapsed!) : "not_shown" };
  if (!isShown(s, threadId)) throw desktopError("NOT_ON_SCREEN", "This chat isn't on screen, so it can't arrange the window; the user opens it first.");
  const focused = s.activeId === threadId;
  const other = focused ? s.splitId : s.activeId;
  if (request.name === "close_split") {
    if (!other) return { threadId, cwd, outcome: "no_split" };
    closeSplit(other);
    return { threadId, cwd, outcome: "closed" };
  }
  const target = args.session_id!, place = args.place ?? "beside";
  if (target === threadId) throw desktopError("INVALID_INPUT", "That is this chat itself.");
  if (!s.threads[target]) await ensureThreads([target]);
  const shown = getState().threads[target];
  if (!shown || shown.meta.parentThreadId) throw desktopError("SESSION_NOT_FOUND", `No session with id ${target} that can be shown in a column; use an id from a tool result, the Linked sessions note or get_window_layout.`);
  const opened = { threadId, cwd, sessionId: target, place };
  if (place === "beside") {
    if (other === target) return { ...opened, outcome: "already" };
    // The column beside this chat takes it: the split one, or the focused one when this chat is the split one.
    void (focused ? openSplit(target) : openThread(target));
  } else if (other === target) closeSplit(threadId);
  else void (focused ? openThread(target) : openSplit(target, getState().splitLeft));
  return { ...opened, outcome: "opened" };
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
  if (request.name === "set_session_title") return renameSession(request.id, cwd, args.title!, (args as { session_id?: string }).session_id, check, signal);
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
  if ((PR_TOOL_NAMES as readonly string[]).includes(request.name)) return prRequest(request, args, check);
  if ((WORKTREE_TOOL_NAMES as readonly string[]).includes(request.name)) return worktreeRequest(request, args);
  if ((SETTINGS_TOOL_NAMES as readonly string[]).includes(request.name)) return settingsRequest(request, args, check, signal);
  if ((WINDOW_TOOL_NAMES as readonly string[]).includes(request.name)) return windowRequest(request, args);
  if ((MANAGE_TOOL_NAMES as readonly string[]).includes(request.name)) return manageRequest(request, args as Record<string, unknown>, check, signal);
  if ((HOST_TOOL_NAMES as readonly string[]).includes(request.name)) return hostRequest(request, args as Record<string, unknown>, check, signal);
  // The scheduled-task args take their own shape: their mode is not a terminal tool's.
  if (request.name === "automation_update") return automationRequest(request, args as unknown as AutomationArgs, check, signal);
  if (request.name === "cloud_task_update") return cloudTaskRequest(request, args as unknown as CloudTaskArgs, check, signal);
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
    const state: DesktopState = { threadId, cwd, currentView: isShown(getState(), threadId),
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
    if (isShown(getState(), threadId) && !document.hidden) {
      await new Promise<void>(resolve => {
        let frame = 0;
        const done = () => { cancelAnimationFrame(frame); signal.removeEventListener("abort", done); resolve(); };
        signal.addEventListener("abort", done, { once: true });
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
      });
      check();
    }
    const element = document.querySelector(`[data-view="${CSS.escape(threadId)}"][data-pane="${pane}"]`);
    return { threadId, cwd, pane, applied: true, displayed: isShown(getState(), threadId) && !document.hidden && !!element?.getClientRects().length };
  } finally { releaseFocus(); }
}
