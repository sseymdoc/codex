// App shell: connection states, sign-in gate, three-pane layout and overlays.

import { CircleAlert, CircleCheck, Info, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { DiffPanel, ThreadView, Welcome } from "./components/Main";
import { Dialogs } from "./components/Dialogs";
import { LoginView, SettingsDialog } from "./components/Settings";
import { Sidebar } from "./components/Sidebar";
import { Button, QuietDots } from "./components/ui";
import { connect } from "./lib/codex";
import { threadTitle } from "./lib/format";
import { setState, useStore } from "./lib/store";

const TOAST_ICONS = {
  info: <Info size={15} />,
  success: <CircleCheck size={15} />,
  warning: <TriangleAlert size={15} />,
  error: <CircleAlert size={15} />,
};

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">{TOAST_ICONS[toast.kind]}</span>
          <div className="toast-text">
            <div className="toast-title">{toast.title}</div>
            {toast.detail && <div className="toast-detail">{toast.detail}</div>}
          </div>
          <button
            type="button"
            className="icon-btn icon-btn-sm"
            aria-label="关闭"
            onClick={() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== toast.id) }))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function Splash({ children }: { children: ReactNode }) {
  return (
    <div className="splash">
      <img src="/favicon.svg" alt="" width={40} height={40} className="splash-mark" />
      {children}
    </div>
  );
}

function Workspace() {
  const activeId = useStore((s) => s.activeId);
  const thread = useStore((s) => (s.activeId ? s.threads[s.activeId] : undefined));
  const panel = useStore((s) => s.panel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const account = useStore((s) => s.account);
  const needsLogin = account !== null && !account.account && account.requiresOpenaiAuth;

  useEffect(() => {
    document.title = thread ? `${threadTitle(thread.meta)} · Codex` : "Codex";
  }, [thread?.meta.name, thread?.meta.preview, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`app ${sidebarOpen ? "with-sidebar" : ""}`}>
      {sidebarOpen && (
        <>
          <Sidebar />
          <div className="sidebar-scrim" onClick={() => setState({ sidebarOpen: false })} />
        </>
      )}
      <main className="main">
        {needsLogin ? <LoginView /> : thread ? <ThreadView key={thread.meta.id} thread={thread} /> : <Welcome />}
      </main>
      {panel === "diff" && thread && <DiffPanel key={thread.meta.id} thread={thread} />}
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
          <div className="splash-text">
            <QuietDots /> 正在启动 Codex…
          </div>
        </Splash>
      ) : (
        <Splash>
          <div className="splash-error">
            <div className="splash-title">与 Codex 的连接已断开</div>
            <div className="muted">{conn.error}</div>
            {conn.detail && <pre className="code-pre splash-detail">{conn.detail}</pre>}
          </div>
          <Button variant="primary" icon={<RefreshCw size={14} />} onClick={connect}>
            重新连接
          </Button>
        </Splash>
      )}
      <SettingsDialog />
      <Dialogs />
      <Toasts />
    </>
  );
}
