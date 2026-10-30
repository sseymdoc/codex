// App shell (claude.ai audit W1, W15; Claude Desktop 2.42304.0.0 main window where the audit
// is silent): the Windows chrome bar, the sign-in gate, sidebar | main | right pane, the boot
// skeleton and the load-error overlay, toasts, the desktop find bar and the overlays; in the
// desktop shell also the app menu's commands, 返回 / 前进, notifications, the jump list and
// the running work for keep-awake and the quit prompt (desktop/main.mjs is the other side).

import { shellTasks } from "./lib/background";
import { spawnRoot } from "./lib/session";
import { browserRequest } from "./lib/browser";
import { togglePane } from "./lib/panes";
import type { ServerRequest } from "@protocol/ServerRequest";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type DragEvent as ReactDragEvent, type ReactNode } from "react";
import { allowRequestOnce, PLAN_CONSENT_TITLE, settingConsentTitle, TERMINAL_CONSENT_TITLE } from "./components/Approvals";
import { CloudTaskView } from "./components/CloudTask";
import { chooseFolder } from "./components/Composer";
import { DotsView } from "./components/Dots";
import { ScheduledView } from "./components/Scheduled";
import { ImagesView } from "./components/Images";
import { Dialogs } from "./components/Dialogs";
import { FindBar, findCommand } from "./components/FindBar";
import { FileMenuHost } from "./components/FileMenu";
import { Lightbox } from "./components/Lightbox";
import { ChromeBar, Frame, navigate } from "./components/Frame";
import { ThreadView, Welcome } from "./components/Main";
import { Palette, openPalette, startSession, step, toggleDiff, useShortcuts } from "./components/Palette";
import { Panes } from "./components/Panes";
import { CustomizeView } from "./components/Customize";
import { LibraryUploads, LibraryView } from "./components/Library";
import { LoginView, SettingsDialog, openSettings } from "./components/Settings";
import { SESSION_DRAG, Sidebar, narrowQuery, readWidth, toggleSidebar } from "./components/Sidebar";
import { toggleTerminal } from "./components/Terminal";
import { Button, ColumnFocus, Icon, Kbd, Spinner, TooltipLayer, dialogOpen, useDockClearance } from "./components/ui";
import { activeTurn, closeSplit, connect, isArchivedThread, newChat, openDots, openScheduled, openSplit, openThread, requestSessionId, requestThreadId, supports } from "./lib/codex";
import { selectDot } from "./lib/dots";
import { basename, threadTitle } from "./lib/format";
import { askingThreads, continuesText, continuesTurn, planId, waitingPlan, waitingQuestions } from "./lib/questions";
import { blockedBox, blockedBoxThreads } from "./lib/wrap-up";
import { pollNow, startPrMonitor } from "./lib/pr-monitor";
import { automationNotice, onStartFailed, quietCompletion, startAutomations } from "./lib/automations";
import { startScratchSweep } from "./lib/scratch";
import {
  canStepRoute,
  dismissToast,
  focusSession,
  getState,
  holdToasts,
  isShown,
  readPref,
  splitColumns,
  useStore,
  writePref,
  type AppState,
  type ThreadState,
  type Toast,
} from "./lib/store";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;
// Whether the last session ended signed in (the boot skeleton leaves the sidebar out if not).
const SIGNED_IN_KEY = "codex-ui:signed-in";

/** At most `max` characters on one line, the last one an ellipsis when cut (lzaSYO3Q WKn / kz). */
function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/[\s\p{Cc}]+/gu, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : chars.join("");
}

// ---------------------------------------------------------------------------
// Toasts (CDS Toast, shared-19 qU / HU / MU / FU; store.ts toast()): the newest card in front,
// the two before it peeking out behind with their content hidden.

const TOAST_ICONS: Record<Toast["kind"], ReactNode> = {
  neutral: <Icon name="Info" size="md" />,
  warning: <Icon name="Warning" size="md" />,
  danger: <Icon name="WarningCircle" size="md" />,
};

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Focus in a field, which keeps Ctrl+Z and the like for itself (c39a247c4 ut). */
const inField = () => !!document.activeElement?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])");

function subscribeFocus(listener: () => void) {
  document.addEventListener("focusin", listener);
  document.addEventListener("focusout", listener);
  return () => {
    document.removeEventListener("focusin", listener);
    document.removeEventListener("focusout", listener);
  };
}

function pressAction(toast: Toast) {
  dismissToast(toast.id);
  toast.action?.run();
}

/**
 * What the stack rises over (useDockClearance): a composer dock, and the 资料库's upload panel (the
 * same corner, itself over the docks) and selection toolbar. ponytail: measured when the toasts
 * come and go, the window resizes or a dock does; a dialog opening, or a session switch, while a
 * toast shows leaves it where it was.
 */
const TOAST_DOCKS = ".dock, .library-uploads, .library-selection";

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  // Base UI's default limit of three; leaving cards keep their place while they fade.
  const shown = toasts.slice(-3).reverse();
  const front = shown.find((toast) => !toast.ending);
  const stack = useRef<HTMLDivElement>(null);
  const clearance = useDockClearance(stack, TOAST_DOCKS, shown.length, true);
  // c39a247c4 gt: the action's key hides, keeping its room, while a field has the key itself.
  const field = useSyncExternalStore(subscribeFocus, inField);
  const holds = useRef(new Map<string, () => void>());
  const hold = (why: "pointer" | "focus" | "window", on: boolean) => {
    const release = holds.current.get(why);
    if (on && !release) holds.current.set(why, holdToasts());
    else if (!on && release) {
      release();
      holds.current.delete(why);
    }
  };
  // c39a247c4 ft: the window losing focus holds the timers too.
  useEffect(() => {
    const sync = () => hold("window", !document.hasFocus());
    const releases = holds.current;
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      for (const release of releases.values()) release();
      releases.clear();
    };
  }, []);
  // A card that went away under the pointer or with focus sends no leave.
  useEffect(() => {
    if (front) return;
    hold("pointer", false);
    hold("focus", false);
  }, [front]);
  // c39a247c4 pt: the leading toast's key, unless a field, menu or dialog has the keyboard.
  useEffect(() => {
    const key = front?.action?.key;
    if (!front || !key) return;
    const onKey = (event: KeyboardEvent) => {
      const primary = MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (event.defaultPrevented || event.repeat || !primary || event.shiftKey || event.altKey || event.key.toLowerCase() !== key) return;
      if (inField() || document.querySelector(".popover, .dialog-backdrop")) return;
      event.preventDefault();
      pressAction(front);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [front]);
  let live = 0;
  return (
    <div
      ref={stack}
      className="toasts"
      // The viewport hangs off the app's CDS root, which is compact with a mouse (shared-frame io).
      data-density="compact"
      style={{ "--toast-clearance": `${clearance}px` } as CSSProperties}
      aria-live="polite"
      onPointerEnter={() => hold("pointer", true)}
      onPointerLeave={() => hold("pointer", false)}
      onFocus={() => hold("focus", true)}
      onBlur={(event) => event.currentTarget.contains(event.relatedTarget as Node | null) || hold("focus", false)}
    >
      {shown.map((toast, position) => {
        const index = toast.ending ? position : live++;
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            role="status"
            style={{ "--toast-index": index, zIndex: shown.length - position } as CSSProperties}
            data-front={(!toast.ending && index === 0) || undefined}
            data-behind={(!toast.ending && index > 0) || undefined}
            data-ending={toast.ending || undefined}
            onKeyDown={(event) => event.key === "Escape" && dismissToast(toast.id, true)}
          >
            <div className="toast-body">
              <span className="toast-icon">{TOAST_ICONS[toast.kind]}</span>
              <div className="toast-text">
                <div className="toast-title">
                  {toast.title}
                  {toast.count > 1 && ` (×${toast.count})`}
                </div>
                {toast.detail && <div>{toast.detail}</div>}
                {/* shared-19 wO: under the text; c39a247c4 gt: a secondary sm button, its key at the end. */}
                {toast.action && (
                  <div className="toast-action">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-keyshortcuts={toast.action.key && !field ? `${MAC ? "Meta" : "Control"}+${toast.action.key.toUpperCase()}` : undefined}
                      onClick={() => pressAction(toast)}
                    >
                      {toast.action.label}
                      {toast.action.key && (
                        <span className="toast-action-key" data-hidden={field || undefined} aria-hidden="true">
                          <Kbd>{`${MAC ? "⌘" : "ctrl"}+${toast.action.key}`}</Kbd>
                        </span>
                      )}
                    </Button>
                  </div>
                )}
              </div>
              <button type="button" className="toast-close" aria-label="关闭" onClick={() => dismissToast(toast.id, true)}>
                <Icon name="X" size="sm" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boot skeleton and load error

// Desktop boot placeholder (renderer/main_window/index.html): the default sidebar shape,
// rows 26px apart. [top, left, width, height, radius] in sidebar pixels; a width below 1 is
// a share of (sidebar width − 20).
const SKELETON: [number, number, number, number, number][] = [
  ...[36, 56, 60, 72].flatMap((width, row): [number, number, number, number, number][] => [
    [59 + row * 26, 14, 16, 16, 4],
    [60 + row * 26, 34, width, 13, 4],
  ]),
  [188, 14, 88, 10, 4],
  ...[0.68, 0.54, 0.44, 0.68, 0.54].flatMap((share, row): [number, number, number, number, number][] => [
    [221 + row * 26, 19, 6, 6, 3],
    [218 + row * 26, 38, share, 13, 4],
  ]),
];

/**
 * Until the first connection, and while app-server restarts: in the desktop shell a 48px drag
 * strip, and the sidebar's shape unless it is collapsed or the last session ended signed out
 * (lzaSYO3Q hZn). The narrow cut is the sidebar's: max(700, width + 329)px (shared-52).
 */
function Boot() {
  const width = readWidth();
  const open = useStore((s) => s.sidebarOpen);
  const shown = open && !matchMedia(narrowQuery(width)).matches && readPref(SIGNED_IN_KEY, ["true", "false"], "true") === "true";
  return (
    <div className="boot" aria-hidden="true">
      <div className="boot-drag" />
      {shown && (
        <div className="boot-sidebar" style={{ width }}>
          {SKELETON.map(([top, left, w, height, radius], index) => (
            <i key={index} style={{ top, left, width: w < 1 ? Math.round((width - 20) * w) : w, height, borderRadius: radius }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The load-error overlay (renderer/main_window MainWindowPage T): below the 36px title bar, a
 * 64px danger mark, title, explanation, the automatic retry line, 重新加载 / 重启 Codex. app-server's
 * last stderr lines, Codex's own, follow the explanation.
 */
function LoadError() {
  const conn = useStore((s) => s.conn);
  const fatal = conn.kind === "fatal";
  const retrying = conn.status === "connecting" || !!conn.retryAt;
  const title = fatal ? "Codex 无法启动" : conn.crashed ? "Codex 反复崩溃" : "无法连接到 Codex";
  const text = fatal
    ? `Codex 多次尝试启动均未成功。${conn.error ?? ""}`
    : conn.crashed
      ? "Codex 多次崩溃。请尝试重启应用。如果仍然崩溃，请检查 codex 可执行文件和 CODEX_HOME。"
      : conn.error || "请检查您的网络连接";
  // A failed start offers 重启 alone in the desktop shell (hideReload), a crash loop both.
  const restart = DESKTOP && (fatal || conn.crashed);
  return (
    <div className="load-error" data-load-error-overlay="">
      <div className="load-error-box">
        <div className="load-error-mark" aria-hidden="true">
          <Icon name="Warning" size="xxl" />
        </div>
        <h1 className="load-error-title">{title}</h1>
        <p className="load-error-text">{text}</p>
        {conn.detail && <pre className="load-error-detail">{conn.detail}</pre>}
        {retrying && (
          <p className="load-error-retry" role="status">
            <Spinner size={16} inherit />
            正在自动重试…
          </p>
        )}
        <div className="load-error-actions">
          {!(DESKTOP && fatal) && (
            <Button variant="secondary" onClick={connect}>
              重新加载
            </Button>
          )}
          {restart && (
            <Button variant="primary" onClick={() => window.codexDesktop?.relaunch()}>
              重启 Codex
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop shell (desktop/main.mjs, preload.cjs)

/** appMenu() items, and the keys the shell takes, by command. */
const MENU_COMMANDS: Record<string, () => void> = {
  new: newChat,
  // In split view the focused column closes, the other one fills the window.
  closeSession: () => {
    const { activeId, splitId } = getState();
    if (activeId && splitId) closeSplit(activeId);
    else newChat();
  },
  settings: () => openSettings("general"),
  about: () => openSettings("about"),
  find: () => findCommand(0),
  findNext: () => findCommand(1),
  findPrevious: () => findCommand(-1),
  palette: () => openPalette("command"),
  search: () => openPalette("search"),
  shortcuts: () => openPalette("shortcuts"),
  sidebar: toggleSidebar,
  terminal: () => {
    if (supports("process/spawn")) toggleTerminal(getState().activeId ?? "draft");
  },
  diff: toggleDiff,
  browser: () => togglePane("browser"),
  back: () => navigate(-1),
  forward: () => navigate(1),
  previousSession: () => step(-1),
  nextSession: () => step(1),
};

/** The top-level session a thread runs in: a sub-agent counts with it (parents walked as codex.ts does). */
function sessionOf(s: AppState, id: string): string {
  return spawnRoot(id, (at) => s.threads[at]?.meta.parentThreadId);
}

/**
 * Sessions with a turn in progress (3.1623.4 index.chunk-CDtK409T H0t working): keepAwake holds
 * the computer awake meanwhile and quitting asks first. Only subscribed threads count, and not
 * ones waiting on the user's approval or answer; a dropped connection leaves the others' turns stale.
 */
function workingSessions(s: AppState): number {
  const waiting = new Set(s.requests.map(requestThreadId));
  const running = Object.values(s.threads).filter((thread) => thread.subscribed && !!activeTurn(thread) && !waiting.has(thread.meta.id));
  return new Set(running.map((thread) => sessionOf(s, thread.meta.id))).size;
}

/**
 * Background commands still running, as the background tasks pane counts them (CDtK409T U0t
 * listShellKeys): "session\tthread:item" per line, so the selector stays stable.
 */
function runningShells(s: AppState): string {
  return Object.values(s.threads)
    .flatMap((thread) =>
      thread.subscribed
        ? shellTasks(thread)
            .filter((task) => task.status === "running")
            .map((task) => `${sessionOf(s, thread.meta.id)}\t${thread.meta.id}:${task.itemId}`)
        : [],
    )
    .join("\n");
}

/** "thread\tturn" per turn in progress; the turn-end notifications diff these. */
function runningTurns(s: AppState): string {
  return Object.values(s.threads)
    .flatMap((thread) => {
      const turn = thread.subscribed ? activeTurn(thread) : undefined;
      return turn ? [`${thread.meta.id}\t${turn.id}`] : [];
    })
    .join("\n");
}

/**
 * The jump list (lzaSYO3Q z0n): sessions with a request or a mid-turn question waiting, oldest
 * first; the latest folders; the latest session. JSON, so the selector stays stable; "" keeps the
 * last one.
 */
function jumpListJson(s: AppState): string {
  if (s.list.archived) return "";
  const recent = s.list.ids
    .filter((id) => !isArchivedThread(id))
    .map((id) => s.threads[id])
    .filter((thread): thread is ThreadState => !!thread && !thread.meta.parentThreadId)
    .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  // A sub-agent waits in the session it runs in.
  const waiting = new Set([...s.requests.map((request) => requestSessionId(request, s.threads)), ...Object.keys(s.titleConsents), ...Object.keys(s.planConsents), ...Object.keys(s.terminalConsents), ...Object.keys(s.settingConsents), ...Object.keys(s.offers), ...askingThreads(s.threads, s.settledQuestions), ...blockedBoxThreads(s.threads)]);
  const entry = (thread: ThreadState) => ({ id: thread.meta.id, title: threadTitle(thread.meta) });
  const list: CodexDesktopJumpList = {
    waiting: recent.filter((thread) => waiting.has(thread.meta.id)).reverse().map(entry),
    folders: [...new Set(recent.map((thread) => thread.meta.cwd).filter(Boolean))],
    last: recent[0] ? entry(recent[0]) : null,
  };
  return JSON.stringify(list);
}

/** The user is looking at this session (lzaSYO3Q isUserViewingSession), in either split column, so it needs no notification. */
function viewing(threadId: string): boolean {
  return document.hasFocus() && isShown(getState(), threadId);
}

/**
 * A waiting request as a notification (lzaSYO3Q showPermissionRequestNotification /
 * showAskUserQuestionNotification). Approvals are titled by folder and session and offer
 * 允许一次; questions by session. Claude's copy has no official translation.
 */
function requestNotification(request: ServerRequest): CodexDesktopNotification | null {
  const asking = requestThreadId(request);
  const thread = asking ? getState().threads[asking] : undefined;
  if (!asking || !thread) return null;
  // A sub-agent's request is the session's: titled by it, opening it (its card is docked there).
  const threadId = sessionOf(getState(), asking);
  const session = getState().threads[threadId] ?? thread;
  const tag = `request-${request.id}`;
  const title = threadTitle(session.meta);
  const approval = (body: string): CodexDesktopNotification => {
    const folder = basename(session.settings?.cwd ?? session.meta.cwd);
    return { tag, threadId, title: `${folder || "Codex"} · ${clip(title, 40)}`, body, allowOnce: request.id };
  };
  const question = (text: string): CodexDesktopNotification => ({ tag, threadId, title: clip(title, 100), body: clip(text, 100) || "Codex 正在向您提问" });
  switch (request.method) {
    case "item/commandExecution/requestApproval": {
      const { command, networkApprovalContext: network } = request.params;
      return approval(network ? `允许 Codex 访问 ${network.host}？` : command ? `允许 Codex 运行 ${clip(command, 100)}？` : "允许 Codex 运行命令？");
    }
    case "item/fileChange/requestApproval": {
      const { turnId, itemId } = request.params;
      const item = thread.turns.find((turn) => turn.id === turnId)?.items.find((candidate) => candidate.id === itemId);
      const files = item?.type === "fileChange" ? item.changes.map((change) => basename(change.path)).join("、") : "";
      return approval(files ? `允许 Codex 编辑 ${clip(files, 100)}？` : "允许 Codex 编辑文件？");
    }
    case "item/permissions/requestApproval":
      return approval("允许 Codex 使用额外权限？");
    case "item/tool/requestUserInput":
      return question(request.params.questions[0]?.question ?? "");
    case "mcpServer/elicitation/request":
      return question(request.params.message);
    default:
      return null;
  }
}

/** A mid-turn question waiting on the user, in any session (questionsJson). */
type OpenQuestion = { threadId: string; id: string; title: string };

/** Every session's mid-turn questions and proposed plans waiting on the user; JSON, so the selector stays stable. */
function questionsJson(s: AppState): string {
  const open = Object.values(s.threads).flatMap((thread): OpenQuestion[] => {
    const plan = waitingPlan(thread, s.settledQuestions);
    return [
      // One notification per asking message, as Claude posts one per AskUserQuestion: its first open question.
      ...waitingQuestions(thread, s.settledQuestions)
        .filter((question, index, open) => open.findIndex((other) => other.itemId === question.itemId) === index)
        .map((question) => ({ threadId: thread.meta.id, id: question.itemId, title: question.title })),
      // The plan card's title (cc32965c2 uwYMasx1yw).
      ...(plan ? [{ threadId: thread.meta.id, id: planId(plan), title: "Codex 提出了一个计划" }] : []),
      ...(s.titleConsents[thread.meta.id] ? [{ threadId: thread.meta.id, id: s.titleConsents[thread.meta.id].id, title: `允许 Codex 重命名此会话 至 “${s.titleConsents[thread.meta.id].title}” 吗？` }] : []),
      ...(s.planConsents[thread.meta.id] ? [{ threadId: thread.meta.id, id: s.planConsents[thread.meta.id], title: PLAN_CONSENT_TITLE }] : []),
      ...(s.terminalConsents[thread.meta.id] ? [{ threadId: thread.meta.id, id: s.terminalConsents[thread.meta.id].id, title: TERMINAL_CONSENT_TITLE }] : []),
      ...(s.settingConsents[thread.meta.id] ? [{ threadId: thread.meta.id, id: s.settingConsents[thread.meta.id].id, title: settingConsentTitle(s.settingConsents[thread.meta.id]) }] : []),
      // An offer on its card notifies once (Claude ki), titled by its heading.
      ...(s.offers[thread.meta.id] ? [{ threadId: thread.meta.id, id: s.offers[thread.meta.id], title: "要在单独的会话中启动吗？" }] : []),
      // A blocked next-step box notifies once, with its question.
      ...((box) => (box ? [{ threadId: thread.meta.id, id: box.id, title: box.ask }] : []))(blockedBox(thread.turns)),
    ];
  });
  return open.length ? JSON.stringify(open) : "";
}

/** A mid-turn question as a notification, titled by session as a requested one is (Codex desktop posts one too). */
function questionNotification({ threadId: asking, id, title }: OpenQuestion): CodexDesktopNotification | null {
  const threadId = sessionOf(getState(), asking);
  const thread = getState().threads[threadId];
  return thread ? { tag: `question-${id}`, threadId, title: clip(threadTitle(thread.meta), 100), body: clip(title, 100) || "Codex 正在向您提问" } : null;
}

/** The session is about to go on in a turn of its own making: the plan card's 接受 or the plan-mode resume. */
function goesOn(threadId: string): boolean {
  const s = getState();
  const [part, ...rest] = s.pendingMessages[threadId]?.item.content ?? [];
  const turns = s.threads[threadId]?.turns ?? [];
  return (!rest.length && part?.type === "text" && continuesText(part.text.trim())) || (turns.at(-1)?.status === "inProgress" && continuesTurn(turns, turns.length - 1));
}

/** Notification tags seen so far; each request or question notifies at most once, and its notification goes once answered or settled. */
const seenNotifications = new Set<string>();

/** The page's side of the desktop bridge; renders nothing. */
function DesktopShell() {
  const session = useStore((s) => s.activeId !== null);
  const sidebar = useStore((s) => s.sidebarOpen);
  const back = useStore((s) => canStepRoute(s, -1));
  const forward = useStore((s) => canStepRoute(s, 1));
  const working = useStore(workingSessions);
  const shells = useStore(runningShells);
  const awake = useStore((s) => s.keepAwake.size);
  const requests = useStore((s) => s.requests);
  const asked = useStore(questionsJson);
  const waiting = requests.length > 0 || asked !== "";
  const running = useStore(runningTurns);
  const jumpList = useStore(jumpListJson);
  const activeId = useStore((s) => s.activeId);
  const wasRunning = useRef(new Set<string>());

  // The menu, the jump list, Quick Entry and notification clicks; then whatever a jump-list
  // launch of the closed app asked for.
  useEffect(() => {
    const desktop = window.codexDesktop;
    if (!desktop) return;
    const subscriptions = [
      desktop.onMenuCommand((command) => MENU_COMMANDS[command]?.()),
      desktop.onNewSession((prompt, cwd) => {
        // A jump-list folder, picked as the composer's folder menu does.
        if (cwd && cwd !== getState().prefs.cwd) chooseFolder(cwd);
        void startSession(prompt);
      }),
      // A dot's notification names it as `dots:<id>`, a scheduled task's page as `scheduled:<id>`.
      desktop.onOpenThread((threadId) => {
        if (threadId.startsWith("scheduled:")) return openScheduled({ task: { id: threadId.slice(10), source: "local" } });
        if (!threadId.startsWith("dots:")) return void openThread(threadId);
        selectDot(threadId.slice(5));
        openDots();
      }),
      desktop.onNotificationAction(({ requestId }) => allowRequestOnce(requestId)),
    ];
    desktop.ready();
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, []);

  // 返回 / 前进 (lzaSYO3Q mEi: Alt+Left / Alt+Right), with no overlay up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.defaultPrevented) return;
      const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const { palette, settings, dialog } = getState();
      if (!direction || palette || settings || dialog || dialogOpen()) return;
      event.preventDefault();
      navigate(direction);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Leaving the workspace (connection lost, signed out): nothing runs, waits or goes back any more.
  useEffect(
    () => () => {
      window.codexDesktop?.setWorking(0, []);
      window.codexDesktop?.holdAwake?.(0);
      window.codexDesktop?.attention(false);
      window.codexDesktop?.setMenuState({ session: false, sidebar: getState().sidebarOpen, back: false, forward: false });
    },
    [],
  );
  useEffect(() => {
    window.codexDesktop?.setMenuState({ session, sidebar, back, forward });
  }, [session, sidebar, back, forward]);
  useEffect(() => {
    window.codexDesktop?.setWorking(working, shells ? shells.split("\n") : []);
  }, [working, shells]);
  // 保持计算机唤醒: the sessions that hold the computer awake by hand, idle or not.
  useEffect(() => {
    window.codexDesktop?.holdAwake?.(awake);
  }, [awake]);
  // An approval or a question is waiting: the taskbar button may flash while the window is in the background.
  useEffect(() => {
    window.codexDesktop?.attention(waiting);
  }, [waiting]);
  useEffect(() => {
    if (jumpList) window.codexDesktop?.setJumpList(JSON.parse(jumpList) as CodexDesktopJumpList);
  }, [jumpList]);

  useEffect(() => {
    const desktop = window.codexDesktop;
    if (!desktop) return;
    const due = new Map<string, () => CodexDesktopNotification | null>();
    for (const request of requests) due.set(`request-${request.id}`, () => requestNotification(request));
    for (const question of asked ? (JSON.parse(asked) as OpenQuestion[]) : []) due.set(`question-${question.id}`, () => questionNotification(question));
    for (const tag of seenNotifications) {
      if (due.has(tag)) continue;
      seenNotifications.delete(tag);
      desktop.closeNotification(tag);
    }
    for (const [tag, make] of due) {
      if (seenNotifications.has(tag)) continue;
      seenNotifications.add(tag);
      const notification = make();
      if (notification && !viewing(notification.threadId)) desktop.notify(notification);
    }
  }, [requests, asked]);

  // A turn ended (lzaSYO3Q showIdleNotification): finished quietly, or failed and waiting on
  // the user. Interrupted turns and sub-agents stay quiet.
  useEffect(() => {
    const desktop = window.codexDesktop;
    const now = new Set(running ? running.split("\n") : []);
    for (const key of wasRunning.current) {
      if (now.has(key) || !desktop) continue;
      const [threadId, turnId] = key.split("\t");
      const thread = getState().threads[threadId];
      const turn = thread?.turns.find((candidate) => candidate.id === turnId);
      if (!thread || !turn || thread.meta.parentThreadId || viewing(threadId)) continue;
      if (turn.status !== "completed" && turn.status !== "failed") continue;
      // A proposed plan notifies as its card (questionsJson); a plan card 接受 or the plan-mode resume goes straight on.
      if (waitingPlan(thread, getState().settledQuestions) === turnId || goesOn(threadId)) continue;
      // A quiet heartbeat or a success under failed_runs_only tells nobody; a scheduled turn says what it found.
      if (quietCompletion(thread, turnId)) continue;
      const failed = turn.status === "failed";
      const notice = automationNotice(thread, turnId);
      desktop.notify({
        tag: `idle-${threadId}`,
        threadId,
        title: clip(notice?.title ?? threadTitle(thread.meta), 100),
        body: notice ? clip(notice.body, 100) : failed ? "Codex 正在等待您的输入" : "Codex 已完成一项任务",
        silent: !failed,
        urgency: failed ? "normal" : "low",
      });
    }
    wasRunning.current = now;
  }, [running]);

  // A scheduled run that could not start, told as Claude's runner tells a run that failed
  // (c8d44c418 定时任务“{name}”失败) while the window is in the background (its toast says so on
  // screen); the notification opens the task's page.
  useEffect(
    () =>
      onStartFailed(({ automationId, name, trigger, message }) => {
        if (trigger !== "scheduled" || document.hasFocus()) return;
        window.codexDesktop?.notify({ tag: `scheduled-${automationId}`, threadId: `scheduled:${automationId}`, title: clip(`定时任务“${name}”失败`, 100), body: clip(message, 100) || "您可以尝试手动运行。", urgency: "normal" });
      }),
    [],
  );

  // Opening the session takes its turn-end notification away (closeIdleNotificationForSession).
  const splitId = useStore((s) => s.splitId);
  useEffect(() => {
    if (activeId) window.codexDesktop?.closeNotification(`idle-${activeId}`);
    if (splitId) window.codexDesktop?.closeNotification(`idle-${splitId}`);
  }, [activeId, splitId]);

  return null;
}

// ---------------------------------------------------------------------------
// Layout

/**
 * One column of split view: its session's chat and panes, with its titlebar over it. A press or a
 * focus inside makes it the focused column (activeId) before anything there reacts.
 */
function SessionColumn({ id }: { id: string }) {
  const thread = useStore((s) => s.threads[id]);
  const focused = useStore((s) => s.activeId === id);
  if (!thread) return null;
  return (
    <ColumnFocus value={focused}>
      <div className="main" data-density="compact" data-session={id} data-focused={focused || undefined} aria-label={threadTitle(thread.meta)} onPointerDownCapture={() => focusSession(id)} onFocusCapture={() => focusSession(id)}>
        <div className="shell-drag" aria-hidden="true" />
        <ThreadView thread={thread} />
        <Panes thread={thread} />
      </div>
    </ColumnFocus>
  );
}

/**
 * A session dragged from the sidebar onto a half of the main area: beside the open one on that
 * side, or in place of the column on that side.
 */
function useSessionDrop() {
  const [side, setSide] = useState<"left" | "right" | null>(null);
  const accepts = (event: ReactDragEvent<HTMLElement>) => event.dataTransfer.types.includes(SESSION_DRAG) && !!getState().activeId;
  const sideOf = (event: ReactDragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientX < box.left + box.width / 2 ? "left" : "right";
  };
  return {
    side,
    handlers: {
      onDragOver: (event: ReactDragEvent<HTMLElement>) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setSide(sideOf(event));
      },
      onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSide(null);
      },
      onDrop: (event: ReactDragEvent<HTMLElement>) => {
        setSide(null);
        if (!accepts(event)) return;
        event.preventDefault();
        const id = event.dataTransfer.getData(SESSION_DRAG);
        const left = sideOf(event) === "left";
        const { splitId, splitLeft } = getState();
        if (!id || isShown(getState(), id)) return;
        // In split view the column on that side takes it; otherwise it opens beside, on that side.
        if (splitId && left !== splitLeft) void openThread(id);
        else void openSplit(id, left);
      },
    },
  };
}

function Workspace() {
  const thread = useStore((s) => (s.activeId ? s.threads[s.activeId] : undefined));
  // Joined into a string, so the selector compares by value.
  const columns = useStore((s) => splitColumns(s).filter((id) => s.threads[id]).join(" "));
  const drop = useSessionDrop();
  // A Codex Cloud task takes the new-session page's place (lib/cloud.ts).
  const cloudTaskId = useStore((s) => (s.activeId ? null : s.cloudTaskId));
  // So does the 图像 page (lib/images.ts).
  const imagesOpen = useStore((s) => !s.activeId && s.imagesOpen);
  // So does the ChatGPT Dots page (lib/dots.ts).
  const dotsOpen = useStore((s) => !s.activeId && s.dotsOpen);
  // And the 定时任务 page (components/Scheduled.tsx).
  const scheduledOpen = useStore((s) => !s.activeId && s.scheduledRoute !== null);
  // And the 插件 page (components/Plugins.tsx).
  const customizeOpen = useStore((s) => !s.activeId && s.customizeRoute !== null);
  // And the 资料库 page (components/Library.tsx).
  const libraryOpen = useStore((s) => !s.activeId && s.libraryRoute !== null);
  useShortcuts();

  const browserCwd = useStore((s) => thread ? (thread.settings?.cwd ?? thread.meta.cwd) : s.prefs.cwd);
  useEffect(() => {
    if (DESKTOP && thread) void browserRequest(thread.meta.id, browserCwd, "current").catch(() => {});
  }, [thread?.meta.id, browserCwd]);

  // lzaSYO3Q mqa(): "<title> — Codex" in the desktop shell (80 characters at most), the web's "<title> - Codex".
  useEffect(() => {
    // The cloud task, 图像, Dots, 插件, 定时任务 and 资料库 views name the window themselves.
    if (!thread && (cloudTaskId || imagesOpen || dotsOpen || customizeOpen || scheduledOpen || libraryOpen)) return;
    document.title = thread ? `${clip(threadTitle(thread.meta), 80)}${DESKTOP ? " — " : " - "}Codex` : "Codex";
  }, [thread?.meta.name, thread?.meta.preview, thread?.meta.id, cloudTaskId, imagesOpen, dotsOpen, customizeOpen, scheduledOpen, libraryOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <Frame chrome={<ChromeBar toggle />} sidebar={<Sidebar />}>
        {/* The Code session view is compact (decisions §1): header, transcript, composer, panes. */}
        {thread && columns.includes(" ") ? (
          <div className="main" data-split="" {...drop.handlers}>
            {columns.split(" ").map((id) => <SessionColumn key={id} id={id} />)}
            {drop.side && <div className="split-drop" data-side={drop.side}>松开以在分屏中打开</div>}
          </div>
        ) : (
          <div className="main" data-density="compact" {...drop.handlers}>
            {/* shared-6 P_: the session header's blank space drags the window. */}
            <div className="shell-drag" aria-hidden="true" />
            {thread ? <ThreadView key={thread.meta.id} thread={thread} /> : cloudTaskId ? <CloudTaskView key={cloudTaskId} id={cloudTaskId} /> : imagesOpen ? <ImagesView /> : dotsOpen ? <DotsView /> : customizeOpen ? <CustomizeView /> : scheduledOpen ? <ScheduledView /> : libraryOpen ? <LibraryView /> : <Welcome />}
            {!cloudTaskId && !imagesOpen && !dotsOpen && !customizeOpen && !scheduledOpen && !libraryOpen && <Panes key={`panes:${thread?.meta.id ?? "draft"}`} thread={thread} />}
            {drop.side && <div className="split-drop" data-side={drop.side}>松开以在分屏中打开</div>}
          </div>
        )}
      </Frame>
      <Palette />
      {DESKTOP && <FindBar />}
      {DESKTOP && <DesktopShell />}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Frame chrome={<ChromeBar />}>{children}</Frame>
    </div>
  );
}

export function App() {
  const conn = useStore((s) => s.conn);
  const account = useStore((s) => s.account);
  const needsLogin = account !== null && !account.account && account.requiresOpenaiAuth;

  // 自动修复 reads its pull requests in the background, from the first ready connection on; scheduled tasks run from then on too.
  useEffect(() => {
    if (conn.status !== "ready") return;
    startPrMonitor();
    startAutomations();
    startScratchSweep();
    void pollNow();
  }, [conn.status]);

  // Signed out, the desktop shell opens the next launch as the 600×600 sign-in window, the boot
  // skeleton leaves the sidebar out and the jump list is cleared.
  useEffect(() => {
    if (!account) return;
    window.codexDesktop?.setAuthWindow(!needsLogin);
    writePref(SIGNED_IN_KEY, needsLogin ? "false" : "true");
    if (needsLogin) window.codexDesktop?.setJumpList(null);
  }, [account, needsLogin]);

  // Only a failure shows the overlay (lzaSYO3Q gqn): the first connection keeps the skeleton
  // however long it takes, and so does a quiet app-server restart.
  const failed = !conn.silent && (conn.status === "closed" || (conn.status === "connecting" && conn.kind !== undefined));
  return (
    <>
      {conn.status === "ready" ? (
        needsLogin ? (
          // Signed out: only the sign-in page, no sidebar, palette or panes.
          <Shell>
            <div className="main">
              <LoginView />
            </div>
          </Shell>
        ) : (
          <Workspace />
        )
      ) : failed ? (
        <Shell>
          <LoadError />
        </Shell>
      ) : (
        <Boot />
      )}
      <SettingsDialog />
      <Dialogs />
      <Lightbox />
      <FileMenuHost />
      <LibraryUploads />
      <Toasts />
      <TooltipLayer />
    </>
  );
}
