// App shell (claude.ai audit W1, W15; Claude Desktop 2.42304.0.0 main window where the audit
// is silent): the Windows chrome bar, the sign-in gate, sidebar | main | right pane, the boot
// skeleton and the load-error overlay, toasts, the desktop find bar and the overlays; in the
// desktop shell also the app menu's commands, 返回 / 前进, notifications, the jump list and
// keep-awake (desktop/main.mjs is the other side).

import type { ServerRequest } from "@protocol/ServerRequest";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { allowRequestOnce } from "./components/Approvals";
import { Dialogs } from "./components/Dialogs";
import { FindBar, findCommand } from "./components/FindBar";
import { Lightbox } from "./components/Lightbox";
import { ThreadView, Welcome, registerTitleSlot } from "./components/Main";
import { Palette, openPalette, startSession, step, toggleDiff, useShortcuts } from "./components/Palette";
import { Panes } from "./components/Panes";
import { LoginView, SettingsDialog, openSettings } from "./components/Settings";
import { Sidebar, SidebarToggle, toggleSidebar } from "./components/Sidebar";
import { toggleTerminal } from "./components/Terminal";
import { Button, Icon, Spinner, TooltipLayer } from "./components/ui";
import { activeTurn, connect, isArchivedThread, newChat, openThread, refreshConfig, refreshPermissionProfiles, requestThreadId, supports } from "./lib/codex";
import { basename, threadTitle } from "./lib/format";
import {
  canStepRoute,
  dismissToast,
  getState,
  readPref,
  setState,
  stepRoute,
  useStore,
  writePref,
  type AppState,
  type ThreadState,
  type Toast,
} from "./lib/store";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;
const WIDTH_KEY = "codex-ui:sidebar-width";
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

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  // Base UI's default limit of three; leaving cards keep their place while they fade.
  const shown = toasts.slice(-3).reverse();
  let live = 0;
  return (
    <div className="toasts" aria-live="polite">
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
            onKeyDown={(event) => event.key === "Escape" && dismissToast(toast.id)}
          >
            <div className="toast-body">
              <span className="toast-icon">{TOAST_ICONS[toast.kind]}</span>
              <div className="toast-text">
                <div className="toast-title">
                  {toast.title}
                  {toast.count > 1 && ` (×${toast.count})`}
                </div>
                {toast.detail && <div>{toast.detail}</div>}
              </div>
              <button type="button" className="toast-close" aria-label="关闭" onClick={() => dismissToast(toast.id)}>
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
// Chrome bar and history

/** 返回 (-1) / 前进 (1) through openThread / newChat, which then record nothing. */
function navigate(direction: -1 | 1) {
  const route = stepRoute(direction);
  if (route === null) newChat();
  else if (route !== undefined) void openThread(route);
}

/** shared-20 Ap: ghost arrows 2px apart; with nowhere to go they stay, dimmed and inert. */
function NavButtons() {
  const back = useStore((s) => canStepRoute(s, -1));
  const forward = useStore((s) => canStepRoute(s, 1));
  return (
    <span className="chrome-nav">
      <Button variant="ghost" size="sm" icon={<Icon name="ArrowLeft" size={16} />} label="返回" kbd="Alt+←" tipSide="bottom" aria-disabled={!back || undefined} onClick={back ? () => navigate(-1) : undefined} />
      <Button variant="ghost" size="sm" icon={<Icon name="ArrowRight" size={16} />} label="前进" kbd="Alt+→" tipSide="bottom" aria-disabled={!forward || undefined} onClick={forward ? () => navigate(1) : undefined} />
    </span>
  );
}

/**
 * The Windows / Linux chrome bar ([data-wco], shared-22 LN): 菜单 (shared-1 KV: no tooltip, the
 * app menu at the pointer), then with a sidebar its switch and 返回 / 前进.
 */
function ChromeBar({ toggle = false }: { toggle?: boolean }) {
  return (
    <div className="chrome-bar">
      <span className="chrome-lead">
        <Button
          variant="ghost"
          size="sm"
          icon={<Icon name="Menu" size="sm" />}
          label="菜单"
          tip=""
          data-app-menu-trigger=""
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => window.codexDesktop?.popupMenu()}
        />
        {toggle && <SidebarToggle place="chrome" />}
        {toggle && <NavButtons />}
      </span>
      <div className="chrome-title-slot" ref={registerTitleSlot} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boot skeleton and load error

function sidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (value) return Math.min(420, Math.max(200, value));
  } catch {
    // Private mode: the default width.
  }
  return 288;
}

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
  const width = sidebarWidth();
  const open = useStore((s) => s.sidebarOpen);
  const shown = open && window.innerWidth > Math.max(700, Math.ceil(width) + 329) && readPref(SIGNED_IN_KEY, ["true", "false"], "true") === "true";
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
  closeSession: newChat,
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
  back: () => navigate(-1),
  forward: () => navigate(1),
  previousSession: () => step(-1),
  nextSession: () => step(1),
};

/**
 * A turn is in progress in some session: keepAwake holds the computer awake meanwhile. Only
 * subscribed threads count; a dropped connection leaves the others' turns stale.
 */
/** Keep awake counts sessions that are running, not ones waiting on the user's approval or answer. */
function isWorking(s: AppState): boolean {
  const waiting = new Set(s.requests.map(requestThreadId));
  return Object.values(s.threads).some((thread) => thread.subscribed && !!activeTurn(thread) && !waiting.has(thread.meta.id));
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
 * The jump list (lzaSYO3Q z0n): sessions with a request waiting, oldest first; the latest
 * folders; the latest session. JSON, so the selector stays stable; "" keeps the last one.
 */
function jumpListJson(s: AppState): string {
  if (s.list.archived) return "";
  const recent = s.list.ids
    .filter((id) => !isArchivedThread(id))
    .map((id) => s.threads[id])
    .filter((thread): thread is ThreadState => !!thread && !thread.meta.parentThreadId)
    .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  const waiting = new Set(s.requests.map(requestThreadId));
  const entry = (thread: ThreadState) => ({ id: thread.meta.id, title: threadTitle(thread.meta) });
  const list: CodexDesktopJumpList = {
    waiting: recent.filter((thread) => waiting.has(thread.meta.id)).reverse().map(entry),
    folders: [...new Set(recent.map((thread) => thread.meta.cwd).filter(Boolean))],
    last: recent[0] ? entry(recent[0]) : null,
  };
  return JSON.stringify(list);
}

/** The user is looking at this session (lzaSYO3Q isUserViewingSession), so it needs no notification. */
function viewing(threadId: string): boolean {
  return document.hasFocus() && getState().activeId === threadId;
}

/**
 * A waiting request as a notification (lzaSYO3Q showPermissionRequestNotification /
 * showAskUserQuestionNotification). Approvals are titled by folder and session and offer
 * 允许一次; questions by session. Claude's copy has no official translation.
 */
function requestNotification(request: ServerRequest): CodexDesktopNotification | null {
  const threadId = requestThreadId(request);
  const thread = threadId ? getState().threads[threadId] : undefined;
  if (!threadId || !thread) return null;
  const tag = `request-${request.id}`;
  const title = threadTitle(thread.meta);
  const approval = (body: string): CodexDesktopNotification => {
    const folder = basename(thread.settings?.cwd ?? thread.meta.cwd);
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

/** Requests seen so far; each notifies at most once, and its notification goes once answered. */
const seenRequests = new Set<ServerRequest["id"]>();

/** The page's side of the desktop bridge; renders nothing. */
function DesktopShell() {
  const session = useStore((s) => s.activeId !== null);
  const sidebar = useStore((s) => s.sidebarOpen);
  const back = useStore((s) => canStepRoute(s, -1));
  const forward = useStore((s) => canStepRoute(s, 1));
  const working = useStore(isWorking);
  const waiting = useStore((s) => s.requests.length > 0);
  const requests = useStore((s) => s.requests);
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
        if (cwd && cwd !== getState().prefs.cwd) {
          setState((s) => ({ prefs: { ...s.prefs, cwd, projectId: null } }));
          void refreshConfig();
          void refreshPermissionProfiles();
        }
        void startSession(prompt);
      }),
      desktop.onOpenThread((threadId) => void openThread(threadId)),
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
      if (!direction || palette || settings || dialog) return;
      event.preventDefault();
      navigate(direction);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Leaving the workspace (connection lost, signed out): nothing runs, waits or goes back any more.
  useEffect(
    () => () => {
      window.codexDesktop?.setWorking(false);
      window.codexDesktop?.attention(false);
      window.codexDesktop?.setMenuState({ session: false, sidebar: getState().sidebarOpen, back: false, forward: false });
    },
    [],
  );
  useEffect(() => {
    window.codexDesktop?.setMenuState({ session, sidebar, back, forward });
  }, [session, sidebar, back, forward]);
  useEffect(() => {
    window.codexDesktop?.setWorking(working);
  }, [working]);
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
    const live = new Set(requests.map((request) => request.id));
    for (const id of seenRequests) {
      if (live.has(id)) continue;
      seenRequests.delete(id);
      desktop.closeNotification(`request-${id}`);
    }
    for (const request of requests) {
      if (seenRequests.has(request.id)) continue;
      seenRequests.add(request.id);
      const notification = requestNotification(request);
      if (notification && !viewing(notification.threadId)) desktop.notify(notification);
    }
  }, [requests]);

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
      const failed = turn.status === "failed";
      desktop.notify({
        tag: `idle-${threadId}`,
        threadId,
        title: clip(threadTitle(thread.meta), 100),
        body: failed ? "Codex 正在等待您的输入" : "Codex 完成了一项任务",
        silent: !failed,
        urgency: failed ? "normal" : "low",
      });
    }
    wasRunning.current = now;
  }, [running]);

  // Opening the session takes its turn-end notification away (closeIdleNotificationForSession).
  useEffect(() => {
    if (activeId) window.codexDesktop?.closeNotification(`idle-${activeId}`);
  }, [activeId]);

  return null;
}

// ---------------------------------------------------------------------------
// Layout

function Workspace() {
  const thread = useStore((s) => (s.activeId ? s.threads[s.activeId] : undefined));
  useShortcuts();

  // lzaSYO3Q mqa(): "<title> — Codex" in the desktop shell (80 characters at most), the web's "<title> - Codex".
  useEffect(() => {
    document.title = thread ? `${clip(threadTitle(thread.meta), 80)}${DESKTOP ? " — " : " - "}Codex` : "Codex";
  }, [thread?.meta.name, thread?.meta.preview, thread?.meta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <ChromeBar toggle />
      {/* The Code session view is compact (decisions §1): sidebar, header, transcript, composer, panes. */}
      <div className="app-body" data-density="compact">
        <Sidebar />
        <main className="main">
          {/* shared-6 P_: the session header's blank space drags the window. */}
          <div className="shell-drag" aria-hidden="true" />
          {thread ? <ThreadView key={thread.meta.id} thread={thread} /> : <Welcome />}
          <Panes key={`panes:${thread?.meta.id ?? "draft"}`} thread={thread} />
        </main>
      </div>
      <Palette />
      {DESKTOP && <FindBar />}
      {DESKTOP && <DesktopShell />}
    </div>
  );
}

/** Signed out: only the sign-in page, no sidebar, palette or panes. */
function SignIn() {
  return (
    <Shell>
      <div className="app-body">
        <main className="main">
          <LoginView />
        </main>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <ChromeBar />
      {children}
    </div>
  );
}

export function App() {
  const conn = useStore((s) => s.conn);
  const account = useStore((s) => s.account);
  const needsLogin = account !== null && !account.account && account.requiresOpenaiAuth;

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
          <SignIn />
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
      <Toasts />
      <TooltipLayer />
    </>
  );
}
