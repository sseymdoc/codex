import { DESKTOP_PANES, desktopError, validateDesktopInput, type DesktopPlanMode, type DesktopRenamed, type DesktopRequest, type DesktopResult, type DesktopState, type DesktopTarget } from "../../context/desktop-tools.mjs";
import { activeTurn, effectiveSettings, renameThread, resumeInPlanMode, setOverride } from "../lib/codex";
import { askPlanConsent, askTitleConsent, getState, setState, type ThreadState } from "../lib/store";
import { layoutOf, openDiff, openPane } from "../lib/panes";
import { browserRequest, browserSnapshot } from "../lib/browser";
import { openBackgroundTask, visibleBackgroundTasks } from "../lib/background-view";
import { taskText } from "../lib/redact";
import { fileTargets, openFileTab } from "./FilePreview";
import { deferTerminalFocus, selectTerminal, terminalTargets, terminalWouldStart } from "./Terminal";
import { diffTargets } from "./Panes";

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
