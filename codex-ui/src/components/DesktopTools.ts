import { DESKTOP_PANES, desktopError, validateDesktopInput, type DesktopRequest, type DesktopShown, type DesktopState, type DesktopTarget } from "../../context/desktop-tools.mjs";
import { getState, setState } from "../lib/store";
import { layoutOf, openDiff, openPane } from "../lib/panes";
import { browserRequest, browserSnapshot } from "../lib/browser";
import { openBackgroundTask, visibleBackgroundTasks } from "../lib/background-view";
import { taskText } from "../lib/redact";
import { fileTargets, openFileTab } from "./FilePreview";
import { deferTerminalFocus, selectTerminal, terminalTargets, terminalWouldStart } from "./Terminal";
import { diffTargets } from "./Panes";

/** Only bounded display metadata leaves the renderer; targets stay scoped to this thread. */
export async function displayRequest(request: DesktopRequest, signal: AbortSignal): Promise<DesktopState | DesktopShown> {
  const args = validateDesktopInput(request.name, request.args);
  const { threadId, cwd } = request;
  const check = () => {
    const thread = getState().threads[threadId];
    if (signal.aborted || Date.now() >= request.deadline) throw desktopError("CANCELLED", "Display request expired.");
    if (!window.codexDesktop || !thread?.subscribed || thread.meta.parentThreadId || (thread.settings?.cwd ?? thread.meta.cwd) !== cwd) throw desktopError("UNAVAILABLE", "This chat has no local desktop binding.");
    return thread;
  };
  check();
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
