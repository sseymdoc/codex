// Main column of the Code session view (compact density, decisions §1): the session
// titlebar over the transcript and the composer dock, the new-session (draft) page, the
// changes pane and the terminal panel. Structure and copy follow Claude Desktop
// 2.42304.0.0's Code chunks (ion-dist cc43287c9 / c73f45bc3 / shared-6), noted per part.

import {
  Archive,
  ChevronDown,
  CircleAlert,
  Copy,
  Diff,
  Download,
  Eye,
  GitFork,
  GitPullRequest,
  Goal,
  Laptop,
  MessageSquareDot,
  Minimize2,
  MousePointer2,
  PencilLine,
  ScanSearch,
  SquareMenu,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  PRESETS,
  activeTurn,
  archiveThread,
  compactThread,
  effectiveSettings,
  errorMessage,
  forkThread,
  loadTurns,
  modelLabel,
  openThread,
  projectFor,
  renameThread,
  requestThreadId,
} from "../lib/codex";
import { filesStats, turnFiles } from "../lib/diff";
import { basename, threadMarkdown, threadTitle } from "../lib/format";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, isUnread, pullRequests, setState, toast, updateThread, useStore, writePref, type AppState, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer, setComposerDraft } from "./Composer";
import { FileDiffCard } from "./content";
import { FilePreview } from "./FilePreview";
import { LandingTexture } from "./LandingTexture";
import { TerminalPanel, TerminalToggle, useTerminalShortcut } from "./Terminal";
import { Transcript } from "./Transcript";
import { Button, MenuItem, MenuSep, Popover, Spark, Submenu } from "./ui";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";

const fail = (title: string) => (error: unknown) => toast("error", title, errorMessage(error));

export const VIEW_LABELS: Record<TranscriptView, string> = { normal: "标准", thinking: "思考", verbose: "详细" };

export const GOAL_LABELS: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "额度受限",
  budgetLimited: "预算用尽",
  complete: "已完成",
};

export function setThreadView(threadId: string, view: TranscriptView) {
  updateThread(threadId, (t) => ({ ...t, view }));
}

/** Downloads the whole thread, paging in older turns first. */
async function exportThread(id: string): Promise<void> {
  while (getState().threads[id]?.olderCursor) await loadTurns(id, true);
  const thread = getState().threads[id];
  if (!thread) return;
  const title = threadTitle(thread.meta);
  const url = URL.createObjectURL(new Blob([threadMarkdown(title, thread.turns)], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|\s]+/g, " ").trim().slice(0, 80) || "codex"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

// remoteControl/status: the titlebar shows the link only while it is on (c73f45bc3 copy).
const REMOTE_LABELS: Record<string, string> = {
  connecting: "正在通过远程控制连接…",
  connected: "已通过远程控制连接",
  errored: "未通过远程控制连接",
};

/** Inline rename (c9543da06 Od: the title button starts editing; Enter commits, Esc cancels). */
function TitleInput({ threadId, initial, onDone }: { threadId: string; initial: string; onDone(): void }) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);
  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (commit && name && name !== initial) renameThread(threadId, name).catch(fail("重命名失败"));
    onDone();
  };
  return (
    <input
      className="title-input"
      autoFocus
      value={value}
      maxLength={200}
      aria-label="会话名称"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

/**
 * Session titlebar (cc43287c9 wW): lead = run-location box + title split (title, caret
 * menu) + remote-control link; cluster = session-rail toggle (shared-1 `ListCard`, 显示 /
 * 隐藏会话栏), then the pane toggles 终端 (Ctrl+`) and 更改 (Ctrl+Shift+D) (c73f45bc3 Rh).
 */
function ChatHeader({ thread }: { thread: ThreadState }) {
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const panel = useStore((s) => s.panel);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const defaultView = useStore((s) => s.defaultView);
  const goals = useStore((s) => s.features.some((feature) => feature.name === "goals" && feature.enabled));
  const remote = useStore((s) => s.remoteControl);
  const { meta } = thread;
  const view = thread.view ?? defaultView;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const title = threadTitle(meta);
  const prs = pullRequests(thread);
  const remoteLabel = remote ? REMOTE_LABELS[remote.status] : undefined;
  const railOpen = panel === "details";
  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  return (
    <header className="chat-header" data-collapsed={!sidebarOpen || undefined}>
      <div className="header-lead">
        <span className="header-origin" data-tip={`会话运行位置：本机 · ${cwd}`}>
          <Laptop size={16} />
        </span>
        <div className="title-split">
          {editing ? (
            <TitleInput threadId={meta.id} initial={title} onDone={() => setEditing(false)} />
          ) : (
            <Button
              variant="ghost"
              className="title-btn"
              tip="重命名"
              aria-label={`${title}，重命名会话`}
              onPointerEnter={(event) => {
                // Tooltip: the full title when it is cut off, 重命名 otherwise.
                const label = event.currentTarget.firstElementChild as HTMLElement | null;
                event.currentTarget.dataset.tip = label && label.scrollWidth > label.clientWidth ? title : "重命名";
              }}
              onClick={() => setEditing(true)}
            >
              <span className="btn-label">{title}</span>
            </Button>
          )}
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            placement="bottom-start"
            className="menu-wide"
            anchor={<Button variant="ghost" icon={<ChevronDown size={16} className="caret" />} label="会话菜单" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
          >
            {prs.length > 0 && (
              <>
                <MenuItem icon={<GitPullRequest size={16} />} label="打开 PR" onClick={act(() => window.open(prs[0], "_blank", "noopener"))} />
                <MenuSep />
              </>
            )}
            <MenuItem icon={<PencilLine size={16} />} label="重命名" onClick={act(() => setEditing(true))} />
            <MenuItem icon={<GitFork size={16} />} label="创建分支会话" kbd="/fork" onClick={act(() => forkThread(meta.id).catch(fail("创建分支失败")))} />
            <MenuItem icon={<Download size={16} />} label="导出为 Markdown" onClick={act(() => exportThread(meta.id).catch(fail("导出失败")))} />
            <MenuItem
              icon={<Copy size={16} />}
              label="复制会话 ID"
              onClick={act(() => {
                void navigator.clipboard.writeText(meta.id);
                toast("success", "已复制会话 ID");
              })}
            />
            <MenuSep />
            <Submenu icon={<Eye size={16} />} label="对话视图" value={VIEW_LABELS[view]} className="menu-model">
              {VIEWS.map((v) => (
                <MenuItem key={v} label={VIEW_LABELS[v]} kbd={v === view ? "Ctrl + O" : undefined} checked={v === view} onClick={act(() => setThreadView(meta.id, v))} />
              ))}
              {view !== defaultView && (
                <>
                  <MenuSep />
                  <MenuItem
                    label={`将「${VIEW_LABELS[view]}」设为默认`}
                    onClick={act(() => {
                      writePref("codex-ui:view", view);
                      setState({ defaultView: view });
                    })}
                  />
                </>
              )}
            </Submenu>
            <MenuSep />
            <MenuItem icon={<ScanSearch size={16} />} label="审查代码" kbd="/review" onClick={act(() => setState({ dialog: { type: "review", threadId: meta.id } }))} />
            <MenuItem icon={<Minimize2 size={16} />} label="压缩上下文" kbd="/compact" onClick={act(() => compactThread(meta.id).catch(fail("压缩失败")))} />
            {goals && !thread.goal && <MenuItem icon={<Goal size={16} />} label="设定目标" kbd="/goal" onClick={act(() => setComposerDraft("/goal "))} />}
            <MenuSep />
            <MenuItem icon={<Archive size={16} />} label="归档" onClick={act(() => archiveThread(meta.id).catch(fail("归档失败")))} />
            <MenuItem icon={<Trash2 size={16} />} label="删除" danger onClick={act(() => setState({ dialog: { type: "delete", threadId: meta.id } }))} />
          </Popover>
        </div>
        {remoteLabel && <Button variant="ghost" icon={<MousePointer2 size={18} />} label={remoteLabel} onClick={() => setState({ panel: "details" })} />}
      </div>
      <span className="spacer" />
      <div className="header-actions">
        <Button
          variant="ghost"
          icon={<SquareMenu size={18} />}
          label={railOpen ? "隐藏会话栏" : "显示会话栏"}
          active={railOpen}
          aria-pressed={railOpen}
          aria-expanded={railOpen}
          data-shine={thread.background.length > 0 || undefined}
          onClick={() => setState({ panel: railOpen ? null : "details" })}
        />
        <TerminalToggle termKey={meta.id} />
        <Button
          variant="ghost"
          icon={<Diff size={18} />}
          label="更改"
          kbd="Ctrl + Shift + D"
          active={panel === "diff"}
          aria-pressed={panel === "diff"}
          onClick={() => setState({ panel: panel === "diff" ? null : "diff" })}
        />
      </div>
    </header>
  );
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  useTerminalShortcut(thread.meta.id);
  return (
    <>
      <div className="main-col">
        <ChatHeader thread={thread} />
        <Transcript thread={thread} />
        <div className="dock">
          <Approvals threadId={thread.meta.id} cwd={cwd} />
          <Composer threadId={thread.meta.id} form="reply" autoFocus />
        </div>
        <TerminalPanel termKey={thread.meta.id} cwd={cwd} />
      </div>
      <FilePreview thread={thread} />
    </>
  );
}

// ---------------------------------------------------------------------------
// New-session (draft) page: cc43287c9 jU (mark + title) and c73f45bc3 Nc (turn zero).

interface OpenRow {
  id: string;
  title: string;
  reason: string;
  blocked: boolean;
  at: number;
}

/** Threads that want the user, blocked first (cc43287c9 bU / _U: blocked, then unread). */
function openRows(s: Pick<AppState, "threads" | "list" | "requests">): OpenRow[] {
  if (s.list.archived) return [];
  const waiting = new Set(s.requests.map(requestThreadId));
  const rows: OpenRow[] = [];
  for (const id of s.list.ids) {
    const thread = s.threads[id];
    if (!thread) continue;
    const status = thread.meta.status;
    const flags = status.type === "active" ? status.activeFlags : [];
    const at = thread.meta.updatedAt;
    const title = threadTitle(thread.meta);
    if (flags.includes("waitingOnApproval") || waiting.has(id)) rows.push({ id, title, reason: "等你批准", blocked: true, at });
    else if (flags.includes("waitingOnUserInput")) rows.push({ id, title, reason: "等你回答", blocked: true, at });
    else if (isUnread(thread) && status.type !== "active" && !activeTurn(thread)) rows.push({ id, title, reason: "有新回复", blocked: false, at });
  }
  return rows.sort((a, b) => Number(b.blocked) - Number(a.blocked) || b.at - a.at);
}

const SHOWN_ROWS = 3;

/** Turn zero (c73f45bc3 Nc / Fc / Ic): where the session will start, then what is open. */
function TurnZero({ rows }: { rows: OpenRow[] }) {
  const [all, setAll] = useState(false);
  // effectiveSettings / modelLabel read these from the store.
  const prefs = useStore((s) => s.prefs);
  const projects = useStore((s) => s.projects);
  useStore((s) => s.config);
  useStore((s) => s.models);
  const settings = effectiveSettings(null);
  const place = (projects.find((p) => p.id === prefs.projectId) ?? projectFor(prefs.cwd))?.name ?? basename(prefs.cwd);
  // A custom permissions profile has no preset (permission is null): it is named by its id.
  const mode = settings.planMode
    ? "，计划模式"
    : settings.permission
      ? `，${PRESETS[settings.permission].label}模式`
      : settings.permissionProfile
        ? `，权限档「${settings.permissionProfile}」`
        : "";
  const shown = all ? rows : rows.slice(0, SHOWN_ROWS);
  return (
    <div className="turn-zero">
      <p className="turn-zero-sentence">
        {place ? (
          <>
            已在 <span className="turn-zero-place">{place}</span> 就绪
          </>
        ) : (
          "已就绪"
        )}
        ，使用 {modelLabel(settings.model)}
        {mode}。{rows.length > 0 ? "这里还有这些在进行：" : "告诉我接下来做什么。"}
      </p>
      {shown.length > 0 && (
        <div className="turn-zero-rows">
          {shown.map((row) => (
            <button key={row.id} type="button" className="turn-zero-row" onClick={() => void openThread(row.id)}>
              {row.blocked ? <CircleAlert size={16} /> : <MessageSquareDot size={16} />}
              <span className="turn-zero-title">{row.title}</span>
              <span className="turn-zero-reason">· {row.reason}</span>
            </button>
          ))}
          {!all && rows.length > SHOWN_ROWS && (
            <button type="button" className="turn-zero-row" data-more onClick={() => setAll(true)}>
              再显示 {rows.length - SHOWN_ROWS} 个
            </button>
          )}
        </div>
      )}
      {rows.length > 0 && <p>选一个继续，或者告诉我接下来做什么。</p>}
    </div>
  );
}

/** Landing header (cc43287c9 jU): 22px mark that pulses on a repeat 新建, then the title. */
function LandingHead({ clear }: { clear: boolean }) {
  const account = useStore((s) => s.account?.account);
  const epoch = useStore((s) => s.draftEpoch);
  const mounted = useRef(epoch);
  const name = account?.type === "chatgpt" && account.email ? account.email.split("@")[0] : null;
  const text = clear ? (name ? `接下来做什么，${name}？` : "接下来做什么？") : name ? `欢迎回来，${name}` : "欢迎回来";
  return (
    <header className="landing-head">
      <span key={epoch} className="landing-mark" data-pulse={epoch !== mounted.current || undefined}>
        <Spark size={22} />
      </span>
      <h1 className="landing-title">{text}</h1>
    </header>
  );
}

export function Welcome() {
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const cwd = useStore((s) => s.prefs.cwd);
  const threads = useStore((s) => s.threads);
  const list = useStore((s) => s.list);
  const requests = useStore((s) => s.requests);
  const rows = useMemo(() => openRows({ threads, list, requests }), [threads, list, requests]);
  useTerminalShortcut("draft");
  return (
    <div className="main-col">
      <LandingTexture />
      <header className="chat-header" data-collapsed={!sidebarOpen || undefined}>
        <span className="header-draft-title">新会话</span>
        <span className="spacer" />
        <div className="header-actions">
          <TerminalToggle termKey="draft" />
        </div>
      </header>
      <div className="landing">
        <div className="landing-col">
          <LandingHead clear={rows.length === 0} />
          <TurnZero rows={rows} />
          <div className="home-composer">
            <Approvals threadId={null} cwd={cwd} />
            <Composer threadId={null} form="home" autoFocus />
          </div>
        </div>
      </div>
      <TerminalPanel termKey="draft" cwd={cwd} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Changes pane (the 更改 / "Changes" pane, Ctrl+Shift+D)

export function DiffPanel({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const turns = thread.turns.filter((turn) => turnFiles(turn, cwd).length > 0);
  const [selected, setSelected] = useState<string | null>(null);
  const turn = turns.find((t) => t.id === selected) ?? turns.at(-1);
  const files = turn ? turnFiles(turn, cwd) : [];
  const stats = files.length ? filesStats(files) : null;
  return (
    <aside className="side-panel" aria-label="更改">
      <div className="side-head">
        <h2 className="side-title">更改</h2>
        {stats && (
          <span className="diff-stat">
            <span className="plus">+{stats.added}</span>
            <span className="minus">−{stats.removed}</span>
          </span>
        )}
        <span className="spacer" />
        <Button variant="ghost" muted icon={<X size={16} />} label="关闭面板" onClick={() => setState({ panel: null })} />
      </div>
      {turns.length > 1 && (
        <div className="side-turns">
          {turns.map((t, index) => (
            <Button key={t.id} variant={t === turn ? "secondary" : "ghost"} size="xs" ink2={t !== turn} onClick={() => setSelected(t.id)}>
              第 {thread.turns.indexOf(t) + 1} 轮{index === turns.length - 1 ? "（最新）" : ""}
            </Button>
          ))}
        </div>
      )}
      <div className="side-body scroll-fade-y">
        {files.length === 0 && <div className="side-empty">这个会话还没有文件改动</div>}
        {files.map((file) => (
          <FileDiffCard key={file.path} file={file} defaultOpen={files.length <= 4} />
        ))}
      </div>
    </aside>
  );
}
