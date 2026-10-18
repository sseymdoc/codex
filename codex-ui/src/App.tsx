// App shell (claude.ai audit W1, W15; Claude Desktop 2.42304.0.0 main window where the audit
// is silent): the Windows chrome bar, the sign-in gate, sidebar | main | right pane, the boot
// skeleton and the load-error overlay, the desktop find bar and the overlays.

import { CircleAlert, CircleCheck, Info, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { FindBar } from "./components/FindBar";
import { Lightbox } from "./components/Lightbox";
import { DiffPanel, ThreadView, Welcome } from "./components/Main";
import { Dialogs } from "./components/Dialogs";
import { Palette, startSession, useShortcuts } from "./components/Palette";
import { SessionRail } from "./components/Rail";
import { LoginView, SettingsDialog } from "./components/Settings";
import { Sidebar, SidebarToggle } from "./components/Sidebar";
import { Button, Spark, Spinner, TooltipLayer } from "./components/ui";
import { connect } from "./lib/codex";
import { threadTitle } from "./lib/format";
import { setState, useStore } from "./lib/store";

const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;
const WIDTH_KEY = "codex-ui:sidebar-width";

const TOAST_ICONS = {
  info: <Info size={14} />,
  success: <CircleCheck size={14} />,
  warning: <TriangleAlert size={14} />,
  error: <CircleAlert size={14} />,
};

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
          <span className="toast-icon">{TOAST_ICONS[toast.kind]}</span>
          <div className="toast-text">
            <div>{toast.title}</div>
            {toast.detail && <div className="toast-detail">{toast.detail}</div>}
          </div>
          <Button
            variant="ghost"
            size="xs"
            muted
            icon={<X size={14} />}
            label="关闭"
            onClick={() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) }))}
          />
        </div>
      ))}
    </div>
  );
}

/** The Windows / Linux chrome bar ([data-wco]): the spark, then the sidebar switch when there is a sidebar. */
function ChromeBar({ toggle = false }: { toggle?: boolean }) {
  return (
    <div className="chrome-bar">
      <span className="chrome-lead">
        <span className="chrome-mark">
          <Spark size={16} />
        </span>
        {toggle && <SidebarToggle place="chrome" />}
      </span>
    </div>
  );
}

function sidebarWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (value) return Math.min(420, Math.max(232, value));
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

/** Until the first connection: the sidebar's shape and, in the desktop shell, a 48px drag strip. */
function Boot() {
  const width = sidebarWidth();
  const collapsed = !useStore((s) => s.sidebarOpen) || window.innerWidth <= Math.max(700, width + 329);
  return (
    <div className="boot" aria-busy="true" aria-label="正在启动 Codex">
      <div className="boot-drag" />
      {!collapsed && (
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
 * The load-error overlay (renderer/main_window MainWindowPage): below the 36px title bar, a
 * 64px danger mark, title, explanation, the automatic retry line, Reload / Restart.
 */
function LoadError() {
  const conn = useStore((s) => s.conn);
  const crashed = conn.kind === "exited" && (conn.exits ?? 0) >= 3;
  const retrying = conn.status === "connecting" || !!conn.retryAt;
  const title =
    conn.kind === "fatal" ? "Codex 无法启动" : crashed ? "Codex 反复崩溃" : conn.kind === "exited" ? "与 Codex 的连接已断开" : "无法连接到 Codex";
  const detail = crashed ? "app-server 多次意外退出。试试重启 Codex；如果仍然崩溃，检查 codex 可执行文件与 CODEX_HOME。" : conn.error;
  const restart = DESKTOP && (crashed || conn.kind === "fatal");
  return (
    <div className="load-error" data-load-error-overlay="">
      <div className="load-error-mark" aria-hidden="true">
        !
      </div>
      <h1 className="load-error-title">{title}</h1>
      {detail && <p className="load-error-text">{detail}</p>}
      {conn.detail && <pre className="code-pre load-error-detail">{conn.detail}</pre>}
      {retrying && (
        <p className="load-error-retry" role="status">
          <Spinner size={14} />
          正在自动重试…
        </p>
      )}
      <div className="load-error-actions">
        <Button variant={restart ? "secondary" : "primary"} size="sm" icon={<RotateCcw size={14} />} onClick={connect}>
          重新加载
        </Button>
        {restart && (
          <Button variant="primary" size="sm" onClick={() => window.codexDesktop?.relaunch?.()}>
            重启 Codex
          </Button>
        )}
      </div>
    </div>
  );
}

function Workspace() {
  const thread = useStore((s) => (s.activeId ? s.threads[s.activeId] : undefined));
  const panel = useStore((s) => s.panel);
  const waiting = useStore((s) => s.requests.length > 0);
  useShortcuts();

  useEffect(() => {
    document.title = thread ? `Codex — ${threadTitle(thread.meta)}` : "Codex";
  }, [thread?.meta.name, thread?.meta.preview, thread?.meta.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The jump list's「新建会话」and Quick Entry (desktop/main.mjs) start sessions here.
  useEffect(() => window.codexDesktop?.onNewSession((prompt) => void startSession(prompt)), []);

  // An approval or a question is waiting: flash the taskbar button while the window is in the background.
  useEffect(() => {
    window.codexDesktop?.attention?.(waiting);
  }, [waiting]);

  return (
    <div className="app">
      <ChromeBar toggle />
      {/* The Code session view is compact (decisions §1): sidebar, header, transcript, composer, panes. */}
      <div className="app-body" data-density="compact">
        <Sidebar />
        <main className="main">
          {thread ? <ThreadView key={thread.meta.id} thread={thread} /> : <Welcome />}
          {thread && panel === "details" && <SessionRail thread={thread} />}
        </main>
        {thread && panel === "diff" && <DiffPanel key={thread.meta.id} thread={thread} />}
      </div>
      <Palette />
      {DESKTOP && <FindBar />}
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

  // The desktop shell opens the next launch as the 600×600 sign-in window while signed out.
  useEffect(() => {
    if (account) window.codexDesktop?.setAuthWindow?.(!needsLogin);
  }, [account, needsLogin]);

  // A retry after a failure keeps the overlay up; only the very first connection shows the skeleton.
  const failed = conn.status === "closed" || (conn.status === "connecting" && conn.kind !== undefined);
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
