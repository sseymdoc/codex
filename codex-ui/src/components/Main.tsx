// Main column of the Code session view (compact density, decisions §1): the session
// titlebar over the transcript and the composer dock, and the new-session (draft) page. The
// panes beside it are Panes.tsx's. Structure and copy follow Claude Desktop 2.42304.0.0's Code
// chunks (ion-dist cc43287c9 / c73f45bc3 / shared-6), noted per part.

import { ChevronDown, ChevronRight, Diff, EllipsisVertical, Folder, FolderKanban, Laptop, Layers, ListChecks, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  activeTurn,
  archiveThread,
  errorMessage,
  forkThread,
  isArchivedThread,
  loadTurns,
  markRead,
  openThread,
  projectFor,
  refreshLanding,
  renameThread,
  requestThreadId,
  setRemoteControl,
  supports,
} from "../lib/codex";
import { basename, threadMarkdown, threadTitle } from "../lib/format";
import { attentionRows, projectRows, projectSessions, relativeTime, repoSlug, rowLimit, type ProjectRow, type SessionFacts } from "../lib/landing";
import { togglePane } from "../lib/panes";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, isUnread, pullRequests, setSessionView, setState, toast, useStore, writePref, type PaneId, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer } from "./Composer";
import { ListCard, SessionRail, useRail, type RailState } from "./Rail";
import { openSessionMenu } from "./Sidebar";
import { TERMINAL_KBD, TerminalToggle, openTerminalTab, useTerminalShortcut } from "./Terminal";
import { Transcript } from "./Transcript";
import { Button, MenuItem, MenuSep, Popover, Spark, Submenu } from "./ui";
import type { Project } from "@protocol/v2/Project";

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

export const VIEW_LABELS: Record<TranscriptView, string> = { normal: "标准", thinking: "思考", verbose: "详细" };

export const setThreadView = setSessionView;

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
 * Origin box (c73f45bc3 Zg / Qg / hg): this computer's glyph, 本地 in its tooltip. While the
 * server offers Remote Control it is a button opening the Remote Control switch, pressed while
 * connected. Codex reports no session link, so the menu has no 打开 / 复制链接 rows.
 */
function OriginBox() {
  const remote = useStore((s) => s.remoteControl);
  const allowed = useStore((s) => s.requirements?.allowRemoteControl !== false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!remote || !allowed)
    return (
      <span className="header-origin">
        <span className="origin-glyph" role="img" aria-label="本地" data-tip="本地" data-tip-side="bottom">
          <Laptop size={18} />
        </span>
      </span>
    );
  const on = remote.status !== "disabled";
  return (
    <span className="header-origin">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={<Button variant="ghost" icon={<Laptop size={18} />} label="Remote Control" tipSide="bottom" active={remote.status === "connected"} onClick={() => setOpen(!open)} />}
      >
        <MenuItem
          label="Remote Control"
          toggle
          checked={on}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setRemoteControl(!on)
              .catch(fail("Remote Control 切换失败"))
              .finally(() => setBusy(false));
          }}
        />
      </Popover>
    </span>
  );
}

/**
 * Repository pill (c73f45bc3 b_ / c227f4d5e pL): the folder's name, its path in the tooltip; the
 * menu copies the path and branch and opens a terminal there. A right click opens it too.
 */
function RepoPill({ thread, cwd }: { thread: ThreadState; cwd: string }) {
  const [open, setOpen] = useState(false);
  const branch = thread.meta.gitInfo?.branch ?? null;
  const copy = (text: string, done: string) => {
    setOpen(false);
    navigator.clipboard.writeText(text).then(() => toast("neutral", done), fail("复制失败"));
  };
  if (!cwd) return null;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      anchor={
        <button
          type="button"
          className="header-pill"
          data-tip={cwd}
          data-tip-side="bottom"
          onClick={() => setOpen(!open)}
          onContextMenu={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <span className="header-pill-label">{basename(cwd)}</span>
        </button>
      }
    >
      {branch ? (
        <Submenu label="复制">
          <MenuItem label="路径" onClick={() => copy(cwd, "路径已复制到剪贴板。")} />
          <MenuItem label="分支名" onClick={() => copy(branch, "分支名已复制到剪贴板。")} />
        </Submenu>
      ) : (
        <MenuItem label="复制路径" onClick={() => copy(cwd, "路径已复制到剪贴板。")} />
      )}
      {supports("process/spawn") && (
        <>
          <MenuSep />
          <MenuItem
            label="在终端中打开"
            onClick={() => {
              setOpen(false);
              openTerminalTab(thread.meta.id, cwd);
            }}
          />
        </>
      )}
    </Popover>
  );
}

interface PaneToggle {
  pane: PaneId;
  icon: ReactNode;
  label: string;
  kbd?: string;
}

/**
 * Session titlebar (cc43287c9 wW): lead = origin box, title split (title, caret menu), project
 * badge, repository pill; cluster = the session-rail toggle (EH) and a rule, the pane toggles 终端
 * (Ctrl+`), 更改 (Ctrl+Shift+D) and 文件 (Ctrl+Shift+F) (c73f45bc3 Rh), then 视图选项. When the
 * title would be cut short the rail toggle folds into 视图选项 first (cd54a5401 en), then the pane
 * toggles, inactive ones first (jh).
 */
function ChatHeader({ thread, rail }: { thread: ThreadState; rail: RailState }) {
  const [menu, setMenu] = useState(false);
  const [views, setViews] = useState(false);
  const [editing, setEditing] = useState(false);
  const [hidden, setHidden] = useState(0);
  const header = useRef<HTMLElement>(null);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const defaultView = useStore((s) => s.defaultView);
  const open = useStore((s) => s.panes[thread.meta.id]?.open);
  useStore((s) => s.projects);
  const { meta } = thread;
  const key = meta.id;
  const view = thread.view ?? defaultView;
  const cwd = thread.settings?.cwd ?? meta.cwd;
  const title = threadTitle(meta);
  const named = !!(meta.name?.trim() || meta.preview?.trim());
  const prs = pullRequests(thread);
  const project = projectFor(cwd);
  const isOpen = (pane: PaneId) => !!open?.includes(pane);

  const toggles: PaneToggle[] = [
    ...(supports("process/spawn") ? [{ pane: "terminal" as const, icon: <SquareTerminal size={18} />, label: "终端", kbd: TERMINAL_KBD }] : []),
    { pane: "diff", icon: <Diff size={18} />, label: "更改", kbd: "Ctrl + Shift + D" },
    { pane: "files", icon: <Folder size={18} />, label: "文件", kbd: "Ctrl + Shift + F" },
  ];
  const railFolded = hidden > 0;
  const folded = new Set([...toggles.filter((t) => !isOpen(t.pane)), ...toggles.filter((t) => isOpen(t.pane))].slice(0, Math.max(0, hidden - 1)).map((t) => t.pane));
  const railLabel = rail.onScreen ? "隐藏会话栏" : "显示会话栏";
  const planned = !!thread.goal || thread.turns.some((turn) => turn.plan || turn.items.some((item) => item.type === "plan"));
  const extra: PaneToggle[] = [
    ...(thread.background.length > 0 || isOpen("background") ? [{ pane: "background" as const, icon: <Layers size={18} />, label: "后台任务" }] : []),
    ...(planned || isOpen("plan") ? [{ pane: "plan" as const, icon: <ListChecks size={18} />, label: "计划" }] : []),
  ];
  const menuItems = [...toggles.filter((t) => folded.has(t.pane)), ...extra];

  // Fold one more toggle while the title is cut short with no room left; unfold while there is.
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () => {
      const label = el.querySelector<HTMLElement>(".title-btn .btn-label");
      const cut = !!label && label.scrollWidth > label.clientWidth + 1;
      const free = el.querySelector<HTMLElement>(":scope > .spacer")?.offsetWidth ?? 0;
      setHidden((n) => (cut && free < 1 && n <= toggles.length ? n + 1 : !cut && n > 0 && free >= 38 ? n - 1 : n));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, toggles.length, editing, title]);

  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const rename = () => setEditing(true);
  const fork = () => forkThread(meta.id).catch(fail("派生失败"));
  const exportIt = () => exportThread(meta.id).catch(fail("导出失败"));
  const archive = () => archiveThread(meta.id).catch(fail("归档失败"));
  const remove = () => setState({ dialog: { type: "delete", threadId: meta.id } });
  const openPr = () => window.open(prs[0], "_blank", "noopener");
  // One key runs a row while the menu is open (ce4f4374c ze).
  const keys = useRef<Record<string, () => void>>({});
  keys.current = { r: rename, f: fork, e: exportIt, a: archive, d: remove, ...(prs.length ? { g: openPr } : {}) };
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key.length !== 1) return;
      const run = keys.current[event.key.toLowerCase()];
      if (!run) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(false);
      void run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [menu]);

  return (
    <header ref={header} className="chat-header" data-collapsed={!sidebarOpen || undefined}>
      <div className="header-lead">
        <OriginBox />
        <div className="header-titles">
          <div className="title-split">
            {editing ? (
              <TitleInput threadId={meta.id} initial={title} onDone={() => setEditing(false)} />
            ) : (
              <Button
                variant="ghost"
                className="title-btn"
                tip="重命名"
                tipSide="bottom"
                aria-label={`${title}，重命名会话`}
                onPointerEnter={(event) => {
                  // Tooltip: the full title when it is cut off, 重命名 otherwise.
                  const label = event.currentTarget.firstElementChild as HTMLElement | null;
                  event.currentTarget.dataset.tip = label && label.scrollWidth > label.clientWidth ? title : "重命名";
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(true);
                }}
                onClick={rename}
              >
                <span className="btn-label">{title}</span>
              </Button>
            )}
            <Popover
              open={menu}
              onClose={() => setMenu(false)}
              placement="bottom-start"
              anchor={
                <Button
                  variant="ghost"
                  icon={<ChevronDown size={16} className="caret" />}
                  label={named ? `“${title}”的更多选项` : "更多选项"}
                  tipSide="bottom"
                  onClick={() => setMenu(!menu)}
                />
              }
            >
              {prs.length > 0 && (
                <>
                  <MenuItem label="打开 PR" kbd="G" onClick={act(openPr)} />
                  <MenuSep />
                </>
              )}
              <MenuItem label="重命名" kbd="R" onClick={act(rename)} />
              <MenuItem label="派生" kbd="F" onClick={act(fork)} />
              <MenuSep />
              <MenuItem label="导出" kbd="E" onClick={act(exportIt)} />
              <MenuSep />
              <Submenu label="对话视图">
                {VIEWS.map((v) => (
                  <MenuItem key={v} label={VIEW_LABELS[v]} checked={v === view} onClick={act(() => setThreadView(meta.id, v))} />
                ))}
                {view !== defaultView && (
                  <>
                    <MenuSep />
                    <MenuItem
                      label={`将${VIEW_LABELS[view]}设为默认`}
                      onClick={act(() => {
                        writePref("codex-ui:view", view);
                        setState({ defaultView: view });
                        toast("neutral", `${VIEW_LABELS[view]}现已设为默认视图。`);
                      })}
                    />
                  </>
                )}
              </Submenu>
              <MenuSep />
              <MenuItem label="归档" kbd="A" onClick={act(archive)} />
              <MenuItem label="删除" kbd="D" danger onClick={act(remove)} />
            </Popover>
          </div>
          {project && (
            <span className="header-pill" data-static="">
              <FolderKanban size={14} />
              <span className="header-pill-label">{project.name}</span>
            </span>
          )}
          <RepoPill thread={thread} cwd={cwd} />
        </div>
      </div>
      <span className="spacer" />
      <div className="header-actions">
        {!railFolded && (
          <>
            <Button
              ref={rail.toggleRef}
              variant="ghost"
              icon={<ListCard />}
              label={railLabel}
              tipSide="bottom"
              active={rail.onScreen}
              aria-pressed={rail.onScreen}
              aria-expanded={rail.raises ? rail.onScreen : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => rail.toggle(event.detail === 0)}
            />
            <span className="header-rule" role="separator" aria-orientation="vertical" />
          </>
        )}
        {toggles
          .filter((t) => !folded.has(t.pane))
          .map((t) => (
            <Button
              key={t.pane}
              variant="ghost"
              icon={t.icon}
              label={t.label}
              kbd={t.kbd}
              tipSide="bottom"
              active={isOpen(t.pane)}
              aria-pressed={isOpen(t.pane)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => togglePane(t.pane, key)}
            />
          ))}
        {(railFolded || menuItems.length > 0) && (
          <Popover
            open={views}
            onClose={() => setViews(false)}
            placement="bottom-end"
            anchor={<Button variant="ghost" icon={<EllipsisVertical size={18} />} label="视图选项" tipSide="bottom" onClick={() => setViews(!views)} />}
          >
            {railFolded && (
              <MenuItem
                icon={<ListCard />}
                label={railLabel}
                onClick={() => {
                  setViews(false);
                  rail.toggle(false);
                }}
              />
            )}
            {menuItems.map((t) => (
              <MenuItem
                key={t.pane}
                icon={t.icon}
                label={t.label}
                value={t.pane === "background" && thread.background.length > 0 ? String(thread.background.length) : undefined}
                kbd={t.kbd}
                toggle
                checked={isOpen(t.pane)}
                onClick={() => {
                  setViews(false);
                  togglePane(t.pane, key);
                }}
              />
            ))}
          </Popover>
        )}
      </div>
    </header>
  );
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const rail = useRail(thread.meta.id);
  useTerminalShortcut(thread.meta.id);
  // ponytail: the chat column centres in the room left of a docked rail; the bundle keeps it
  // centred on the whole tile while it clears the rail (shared-18 --session-rail-column-start).
  return (
    <div ref={rail.col} className="main-col">
      <ChatHeader thread={thread} rail={rail} />
      <div className="session-row">
        <div className="session-chat">
          <Transcript thread={thread} />
          <div className="dock">
            <Approvals threadId={thread.meta.id} cwd={cwd} />
            <Composer threadId={thread.meta.id} form="reply" autoFocus />
          </div>
        </div>
        {rail.docked && <SessionRail thread={thread} />}
        {rail.overlay && <SessionRail thread={thread} overlay={rail.overlay} toggleRef={rail.toggleRef} onDismiss={rail.dismiss} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-session (draft) page, the greeting face (cc43287c9 with the session-presets flag off): the
// greeting (jU) stays put under the titlebar, the action center (PU) scrolls under it and the
// composer docks at the bottom like in a session. Pull requests (LU) need PR status Codex lacks.

/** Dismissed sessions: id → the recency (Unix seconds) they were dismissed at (cd54a5401 ackedAt). */
const ACKED_KEY = "codex-ui:acked";
/** Last section sizes (cc43287c9 Kh / kU): the greeting and the skeleton before the list loads. */
const COUNTS_KEY = "codex-ui:action-center";

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

/** What the action center reads from a session: blocked = waiting on the user or a system error. */
function sessionFacts(thread: ThreadState, waiting: Set<string | null>): SessionFacts {
  const { meta } = thread;
  const { status } = meta;
  const blocked = (status.type === "active" && status.activeFlags.length > 0) || waiting.has(meta.id) || status.type === "systemError";
  return {
    id: meta.id,
    at: meta.recencyAt ?? meta.updatedAt,
    blocked,
    working: !blocked && (status.type === "active" || !!activeTurn(thread)),
    unread: isUnread(thread),
    projectId: meta.projectId,
  };
}

/** Untitled sessions read "未命名会话" here (cc43287c9 RU), not the sidebar's "新会话". */
const sessionTitle = (thread: ThreadState | undefined) => thread?.meta.name?.trim() || thread?.meta.preview?.trim().split("\n")[0] || "未命名会话";

function subscribeHeight(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const heightLimit = () => rowLimit(window.innerHeight);

type PillKind = "blocked" | "unread" | "working" | "idle";
const PILL_LABELS: Record<Exclude<PillKind, "idle">, string> = { blocked: "需要输入", unread: "未读", working: "进行中" };

/** Status pill (cc43287c9 uU / dU): a 5px dot in a 16px cell, then the label and an optional count. */
function Pill({ kind, label = true, count }: { kind: PillKind; label?: boolean; count?: number }) {
  return (
    <span className="ac-pill" data-kind={kind}>
      <span className="ac-dot" />
      {label && kind !== "idle" && (
        <span className="ac-pill-text">
          <span className="ac-pill-label">{PILL_LABELS[kind]}</span>
          {count !== undefined && <span className="ac-pill-count">{count}</span>}
        </span>
      )}
    </span>
  );
}

function When({ at, now }: { at: number | undefined; now: number }) {
  return (
    <span className="ac-time">
      {at !== undefined && (
        <time dateTime={new Date(at * 1000).toISOString()} data-tip={new Date(at * 1000).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" })}>
          {relativeTime(at, now)}
        </time>
      )}
    </span>
  );
}

/** A row's main button (cc43287c9 pU): pill, title, then repo, time and the caret on the right. */
function RowButton({ pill, title, meta, at, now, onClick }: { pill: ReactNode; title: string; meta?: string | null; at?: number; now: number; onClick(): void }) {
  return (
    <button type="button" className="ac-main" aria-label={`打开会话 ${title}`} onClick={onClick}>
      <span className="ac-lead">
        {pill}
        <span className="ac-text">
          <span className="ac-name">{title}</span>
        </span>
      </span>
      <span className="ac-end">
        {meta && <span className="ac-meta">{meta}</span>}
        <When at={at} now={now} />
        <ChevronRight size={20} className="ac-caret" aria-hidden="true" />
      </span>
    </button>
  );
}

/** Section header (cc43287c9 FU / IU): the h2 takes focus after a dismissal; 再显示 / 收起 toggles the rest. */
function SectionHead({ title, extra, hidden, all, onToggle }: { title: string; extra?: ReactNode; hidden: number; all: boolean; onToggle(): void }) {
  return (
    <header className="ac-head">
      <h2 className="ac-title" tabIndex={-1}>
        {title}
      </h2>
      <span className="spacer" />
      {extra}
      {(hidden > 0 || all) && (
        <Button variant="ghost" size="sm" muted aria-expanded={all} onClick={onToggle}>
          {all ? "收起" : `再显示 ${hidden} 个`}
        </Button>
      )}
    </header>
  );
}

function SessionsSection({
  rows,
  limit,
  now,
  onDismiss,
  onMarkAllRead,
}: {
  rows: { id: string; kind: "blocked" | "unread" }[];
  limit: number;
  now: number;
  onDismiss(id: string): void;
  onMarkAllRead(): void;
}) {
  const [all, setAll] = useState(false);
  const threads = useStore((s) => s.threads);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <section className="ac-section">
      <SectionHead
        title="会话"
        hidden={rows.length - shown.length}
        all={all}
        onToggle={() => setAll(!all)}
        extra={
          rows.some((row) => row.kind === "unread") && (
            <Button variant="ghost" size="sm" muted onClick={onMarkAllRead}>
              全部标为已读
            </Button>
          )
        }
      />
      <ul role="list" className="ac-list">
        {shown.map(({ id, kind }) => {
          const thread = threads[id];
          return (
            <li
              key={id}
              className="ac-row"
              // cc43287c9 RU: a right click opens the sidebar's session menu at the pointer.
              onContextMenu={(event) => {
                event.preventDefault();
                openSessionMenu(id, event);
              }}
            >
              <RowButton
                pill={<Pill kind={kind} />}
                title={sessionTitle(thread)}
                meta={repoSlug(thread?.meta.gitInfo?.originUrl)}
                at={thread ? (thread.meta.recencyAt ?? thread.meta.updatedAt) : undefined}
                now={now}
                onClick={() => void openThread(id)}
              />
              <Button variant="ghost" muted className="ac-dismiss" icon={<X size={16} />} label="关闭会话" tip="关闭" onClick={() => onDismiss(id)} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Sessions a project row opens to (cc43287c9 VU: blocked and working, three at first). */
const PROJECT_SESSIONS = 3;

function ProjectItem({ project, unread, at, facts, now }: { project: Project; unread: boolean; at?: number; facts: SessionFacts[]; now: number }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const threads = useStore((s) => s.threads);
  const { rows, counts } = useMemo(() => projectSessions(facts, project.id, all ? Infinity : PROJECT_SESSIONS), [facts, project.id, all]);
  const hidden = counts.blocked + counts.working - rows.length;
  return (
    <li className="ac-project">
      <div className="ac-project-row">
        {/* Codex has no project page: the name does not navigate, the whole row toggles. */}
        <button type="button" className="ac-project-toggle" aria-expanded={open} aria-label={`切换 ${project.name} 的详情`} onClick={() => setOpen(!open)} />
        <span className="ac-lead">
          <Pill kind={unread ? "unread" : "idle"} label={false} />
          <span className="ac-text">
            <span className="ac-name">{project.name}</span>
            {(counts.blocked > 0 || counts.working > 0) && (
              <span className="ac-badges">{(["blocked", "working"] as const).map((kind) => counts[kind] > 0 && <Pill key={kind} kind={kind} count={counts[kind]} />)}</span>
            )}
          </span>
        </span>
        <span className="ac-end">
          <When at={at} now={now} />
          <ChevronRight size={20} className="ac-caret" data-open={open || undefined} aria-hidden="true" />
        </span>
      </div>
      {open && rows.length > 0 && (
        <ul role="list" className="ac-sublist">
          {rows.map(({ id, kind, at: moved }) => (
            <li key={id} className="ac-subrow">
              <RowButton pill={<Pill kind={kind} />} title={sessionTitle(threads[id])} at={moved} now={now} onClick={() => void openThread(id)} />
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <Button variant="ghost" size="sm" muted onClick={() => setAll(true)}>
                再显示 {hidden} 个
              </Button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function ProjectsSection({ rows, facts, limit, now }: { rows: ProjectRow<Project>[]; facts: SessionFacts[]; limit: number; now: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <section className="ac-section">
      <SectionHead title="项目" hidden={rows.length - shown.length} all={all} onToggle={() => setAll(!all)} />
      <ul role="list" className="ac-list">
        {shown.map((row) => (
          <ProjectItem key={row.project.id} project={row.project} unread={row.unread} at={row.at} facts={facts} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** Skeleton rows widths (cc43287c9 mU). */
const SKELETON_WIDTHS = ["40%", "33%", "50%", "60%"];

/** A section while the list loads (cc43287c9 gU / hU): the cached size, capped at the row limit. */
function SkeletonSection({ title, count, limit, dismissSlot }: { title: string; count: number; limit: number; dismissSlot?: boolean }) {
  if (count === 0) return null;
  return (
    <section className="ac-section">
      <header className="ac-head">
        <h2 className="ac-title">{title}</h2>
        {count > limit && (
          <Button variant="ghost" size="sm" className="ac-invisible" tabIndex={-1} aria-hidden="true">
            再显示 {count - limit} 个
          </Button>
        )}
      </header>
      <ul role="list" aria-hidden="true" className="ac-list">
        {Array.from({ length: Math.min(count, limit) }, (_, index) => (
          <li key={index} className="ac-row" data-skeleton>
            <Pill kind="working" label={false} />
            <span className="ac-text">
              <span className="ac-skeleton-line" style={{ width: SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] }} />
            </span>
            <ChevronRight size={20} className="ac-caret ac-invisible" aria-hidden="true" />
            {dismissSlot && <span className="ac-dismiss-slot" />}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Landing header (cc43287c9 jU): the 22px mark pulses on a repeat 新建, then the greeting. */
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
  const ready = useStore((s) => s.conn.status === "ready");
  const landing = useStore((s) => s.landing);
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const requests = useStore((s) => s.requests);
  const projects = useStore((s) => s.projects);
  const [acked, setAcked] = useState(() => readJson<Record<string, number>>(ACKED_KEY, {}));
  const [cached] = useState(() => {
    const saved = readJson<{ sessions?: unknown; projects?: unknown }>(COUNTS_KEY, {});
    return { sessions: Number(saved.sessions) || 0, projects: Number(saved.projects) || 0 };
  });
  // Sessions and Projects show at most five rows before 再显示 (cc43287c9 j10).
  const limit = Math.min(useSyncExternalStore(subscribeHeight, heightLimit), 5);
  const root = useRef<HTMLDivElement>(null);
  useTerminalShortcut("draft");

  useEffect(() => {
    if (ready) void refreshLanding();
  }, [ready]);

  // The page's own list plus whatever the sidebar has seen since (new sessions start there).
  const facts = useMemo(() => {
    const waiting = new Set(requests.map(requestThreadId));
    const ids = new Set([...(landing ?? []), ...list.ids.filter((id) => !isArchivedThread(id))]);
    return [...ids].flatMap((id) => (threads[id] ? [sessionFacts(threads[id], waiting)] : []));
  }, [landing, list, threads, requests]);
  const now = Date.now();
  const sessions = useMemo(() => attentionRows(facts, acked), [facts, acked]);
  const inFlight = useMemo(() => projectRows(projects, facts, Date.now() / 1000), [projects, facts]);
  const loading = landing === null;
  const counts = loading ? cached : { sessions: sessions.length, projects: inFlight.length };

  useEffect(() => {
    if (!loading) writePref(COUNTS_KEY, JSON.stringify({ sessions: counts.sessions, projects: counts.projects }));
  }, [loading, counts.sessions, counts.projects]);

  // After a dismissal focus goes to the first section's heading, or to the composer (cc43287c9 PU).
  const refocus = () =>
    requestAnimationFrame(() => (root.current?.querySelector<HTMLElement>("section h2") ?? document.querySelector<HTMLElement>(".composer-input"))?.focus());
  const dismiss = (id: string) => {
    const meta = threads[id]?.meta;
    const next = Object.fromEntries([...Object.entries(acked).filter(([key]) => key !== id), [id, meta ? (meta.recencyAt ?? meta.updatedAt) : 0]].slice(-200));
    setAcked(next);
    writePref(ACKED_KEY, JSON.stringify(next));
    void markRead(id);
    refocus();
  };
  const markAllRead = () => {
    for (const row of sessions) if (row.kind === "unread") void markRead(row.id);
    refocus();
  };

  return (
    <div className="main-col">
      <header className="chat-header" data-collapsed={!sidebarOpen || undefined}>
        <span className="spacer" />
        <div className="header-actions">
          <TerminalToggle termKey="draft" />
        </div>
      </header>
      <LandingHead clear={counts.sessions === 0 && counts.projects === 0} />
      <div className="landing scroll-fade-y">
        <div className="landing-col">
          {loading ? (
            <div className="ac" aria-busy="true">
              <span className="sr-only" role="status">
                正在加载…
              </span>
              <SkeletonSection title="会话" count={cached.sessions} limit={limit} dismissSlot />
              <SkeletonSection title="项目" count={cached.projects} limit={limit} />
            </div>
          ) : (
            (sessions.length > 0 || inFlight.length > 0) && (
              <div className="ac" ref={root}>
                {sessions.length > 0 && <SessionsSection rows={sessions} limit={limit} now={now} onDismiss={dismiss} onMarkAllRead={markAllRead} />}
                {inFlight.length > 0 && <ProjectsSection rows={inFlight} facts={facts} limit={limit} now={now} />}
              </div>
            )
          )}
        </div>
      </div>
      <div className="dock">
        <Approvals threadId={null} cwd={cwd} />
        <Composer threadId={null} form="home" autoFocus />
      </div>
    </div>
  );
}
