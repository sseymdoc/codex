// App shell (claude.ai audit W1, W15): connection states, the sign-in gate, the Windows
// chrome bar, sidebar | main | right pane (diff or session details), and the overlays.

import { CircleAlert, CircleCheck, Info, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { DiffPanel, ThreadView, Welcome } from "./components/Main";
import { Dialogs } from "./components/Dialogs";
import { Palette } from "./components/Palette";
import { SessionRail } from "./components/Rail";
import { LoginView, SettingsDialog } from "./components/Settings";
import { Sidebar, SidebarToggle } from "./components/Sidebar";
import { Button, Spark, TooltipLayer } from "./components/ui";
import { connect, newChat } from "./lib/codex";
import { turnFiles } from "./lib/diff";
import { threadTitle } from "./lib/format";
import { getState, setState, useStore } from "./lib/store";

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

function Lightbox() {
  const src = useStore((s) => s.lightbox);
  useEffect(() => {
    if (!src) return;
    // Capture phase, so Esc closes the image instead of interrupting the turn in the composer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setState({ lightbox: null });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [src]);
  if (!src) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看图片" onClick={() => setState({ lightbox: null })}>
      <img src={src} alt="" />
      <Button variant="ghost" className="lightbox-close" icon={<X size={20} />} label="关闭" />
    </div>
  );
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <span className="splash-mark">
        <Spark size={40} />
      </span>
      {children}
    </div>
  );
}

/** Shortcuts that work anywhere: new session, sidebar, diff pane, settings. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const { activeId, panel, threads } = getState();
      if (event.shiftKey && key === "o") {
        newChat();
      } else if (!event.shiftKey && key === "b") {
        setState((s) => ({ sidebarOpen: !s.sidebarOpen }));
      } else if (event.shiftKey && key === "d" && activeId && threads[activeId]?.turns.some((turn) => turnFiles(turn, threads[activeId].meta.cwd).length)) {
        setState({ panel: panel === "diff" ? null : "diff" });
      } else if (!event.shiftKey && key === ",") {
        setState({ settings: "general" });
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}

function Workspace() {
  const activeId = useStore((s) => s.activeId);
  const thread = useStore((s) => (s.activeId ? s.threads[s.activeId] : undefined));
  const panel = useStore((s) => s.panel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const account = useStore((s) => s.account);
  const needsLogin = account !== null && !account.account && account.requiresOpenaiAuth;
  useShortcuts();

  useEffect(() => {
    document.title = thread ? `${threadTitle(thread.meta)} · Codex` : "Codex";
  }, [thread?.meta.name, thread?.meta.preview, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app">
      <div className="chrome-bar">
        <span className="chrome-mark">
          <Spark size={16} />
        </span>
        <span className="reveal">
          <SidebarToggle size="sm" />
        </span>
      </div>
      <div className="app-body">
        {sidebarOpen && (
          <>
            <Sidebar />
            <div className="sidebar-scrim" onClick={() => setState({ sidebarOpen: false })} />
          </>
        )}
        <main className="main">
          {needsLogin ? <LoginView /> : thread ? <ThreadView key={thread.meta.id} thread={thread} /> : <Welcome />}
          {!needsLogin && thread && panel === "details" && <SessionRail thread={thread} />}
        </main>
        {!needsLogin && thread && panel === "diff" && <DiffPanel key={thread.meta.id} thread={thread} />}
      </div>
      <Palette />
    </div>
  );
}

export function App() {
  const conn = useStore((s) => s.conn);
  return (
    <>
      {conn.status === "ready" ? (
        <Workspace />
      ) : conn.status === "connecting" ? (
        <Splash>
          <div className="splash-text">正在启动 Codex…</div>
        </Splash>
      ) : (
        <Splash>
          <div className="splash-error">
            <div className="splash-title">与 Codex 的连接已断开</div>
            <div className="muted">{conn.error}</div>
            {conn.detail && <pre className="code-pre splash-detail">{conn.detail}</pre>}
          </div>
          <Button variant="primary" icon={<RefreshCw size={16} />} onClick={connect}>
            重新连接
          </Button>
        </Splash>
      )}
      <SettingsDialog />
      <Dialogs />
      <Lightbox />
      <Toasts />
      <TooltipLayer />
    </>
  );
}
