// Main column of the Code session view (compact density, decisions §1): the session
// titlebar over the transcript and the composer dock, and the new-session (draft) page. The
// panes beside it are Panes.tsx's. Structure and copy follow Claude Desktop 2.42304.0.0's Code
// chunks (ion-dist cc43287c9 / c73f45bc3 / shared-6), noted per part.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  errorMessage,
  folderStatus,
  forkThread,
  isArchivedThread,
  loadTurns,
  openThread,
  refreshLanding,
  renameThread,
  requestThreadId,
  supports,
  type FolderStatus,
} from "../lib/codex";
import { basename, samePath, threadMarkdown, threadTitle } from "../lib/format";
import { continues, dismiss, seat, type Dismissals } from "../lib/landing";
import { togglePane } from "../lib/panes";
import { waitingQuestions } from "../lib/questions";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, pullRequests, setSessionView, setState, toast, useStore, writePref, type PaneId, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer, FolderMenu, chooseFolder, setComposerDraft, useRecentFolders } from "./Composer";
import { KeptIn } from "./items";
import { SessionRail, useRail, type RailState } from "./Rail";
import { archiveSession, deleteSession } from "./Sidebar";
import { TERMINAL_KBD, TerminalToggle, useTerminalShortcut } from "./Terminal";
import { Transcript } from "./Transcript";
import { PendingMessage } from "./PendingMessage";
import { Button, Icon, MenuItem, MenuSep, Popover, Submenu, type IconName } from "./ui";
import type { ServerRequest } from "@protocol/ServerRequest";

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

export const VIEW_LABELS: Record<TranscriptView, string> = { normal: "普通", thinking: "思考", verbose: "详细" };

export const setThreadView = setSessionView;

// Lifted titlebar (shared-16 ss -> shared-20 Wm / Gm): under the Windows / Linux chrome bar
// ([data-wco]) the titlebar moves into the bar's title slot (App.tsx ChromeBar; shared-22 LN
// dframe-chrome-title-slot) while no pane is open beside the chat (ko), and drops back above the
// transcript when one opens. Not a flag. It keeps the Code view's compact density, as a portal
// keeps Claude's density context.

let titleSlot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();

/** ChromeBar's ref on its title slot. */
export function registerTitleSlot(el: HTMLElement | null) {
  titleSlot = el;
  for (const listener of slotListeners) listener();
}

function subscribeSlot(onChange: () => void) {
  slotListeners.add(onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-wco"] });
  return () => {
    slotListeners.delete(onChange);
    observer.disconnect();
  };
}

const slotNow = () => (document.documentElement.hasAttribute("data-wco") ? titleSlot : null);

/** The title slot while the titlebar of a view (thread id or "draft") is lifted into it. */
function useLiftSlot(paneKey: string): HTMLElement | null {
  const slot = useSyncExternalStore(subscribeSlot, slotNow);
  const beside = useStore((s) => !!s.panes[paneKey]?.open.length);
  return beside ? null : slot;
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

/**
 * Inline rename (c9543da06 Od: the title button starts editing; Enter commits, Esc cancels). The
 * field (cc43287c9 vW) sizes to the name, `size` standing in where field-sizing is unsupported.
 */
function TitleInput({ threadId, initial, onDone }: { threadId: string; initial: string; onDone(): void }) {
  const [value, setValue] = useState(initial);
  const settled = useRef(false);
  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = value.trim();
    if (commit && name && name !== initial) renameThread(threadId, name).catch(fail("重命名失败。您可以重试。"));
    onDone();
  };
  return (
    <input
      className="title-input"
      autoFocus
      value={value}
      maxLength={200}
      size={Math.min(Math.max(value.length, 1), 30)}
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

interface PaneToggle {
  pane: PaneId;
  icon: IconName;
  label: string;
  kbd?: string;
}

/**
 * Session titlebar (cc43287c9 wW): lead = title split (title, caret menu); the user asked for
 * Claude's project badge after it to go. With the session rail (railMode) Claude drops the origin
 * box and the environment pill (c73f45bc3 w_); the rail's 环境 card has the folder, branch and
 * Remote Control instead. Cluster = the session-rail toggle (EH) and a rule, the pane toggles 终端
 * (Ctrl+`), 更改 (Ctrl+Shift+D) and 文件 (Ctrl+Shift+F) (c73f45bc3 Rh), then 视图选项. When the
 * title would be cut short the pane toggles fold into 视图选项, inactive ones first (jh). The rail
 * toggle, which Claude folds first (cd54a5401 en), always stays, as the user asked.
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
  const { meta } = thread;
  const key = meta.id;
  const view = thread.view ?? defaultView;
  const title = threadTitle(meta);
  const named = !!(meta.name?.trim() || meta.preview?.trim());
  const prs = pullRequests(thread);
  const slot = useLiftSlot(key);
  const isOpen = (pane: PaneId) => !!open?.includes(pane);

  const toggles: PaneToggle[] = [
    ...(supports("process/spawn") ? [{ pane: "terminal" as const, icon: "CommandLinePrompt" as const, label: "终端", kbd: TERMINAL_KBD }] : []),
    { pane: "diff", icon: "ChangesPlusMinus", label: "更改", kbd: "Ctrl + Shift + D" },
    { pane: "files", icon: "Folder", label: "文件", kbd: "Ctrl + Shift + F" },
  ];
  const folded = new Set([...toggles.filter((t) => !isOpen(t.pane)), ...toggles.filter((t) => isOpen(t.pane))].slice(0, hidden).map((t) => t.pane));
  const planned = !!thread.goal || thread.turns.some((turn) => turn.plan || turn.items.some((item) => item.type === "plan"));
  const extra: PaneToggle[] = [
    ...(thread.background.length > 0 || isOpen("background") ? [{ pane: "background" as const, icon: "AgentsSimple" as const, label: "后台任务" }] : []),
    ...(planned || isOpen("plan") ? [{ pane: "plan" as const, icon: "Checklist" as const, label: "计划" }] : []),
  ];
  const menuItems = [...toggles.filter((t) => folded.has(t.pane)), ...extra];

  // Fold one more toggle while the title is cut short with no room left; unfold while there is.
  // Lifting or dropping the titlebar mounts a new header, so `slot` re-arms the observer.
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const measure = () => {
      const label = el.querySelector<HTMLElement>(".title-btn .btn-label");
      const cut = !!label && label.scrollWidth > label.clientWidth + 1;
      const free = el.querySelector<HTMLElement>(":scope > .spacer")?.offsetWidth ?? 0;
      setHidden((n) => (cut && free < 1 && n < toggles.length ? n + 1 : !cut && n > 0 && free >= 38 ? n - 1 : n));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hidden, toggles.length, editing, title, slot]);

  const act = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };
  const rename = () => setEditing(true);
  const fork = () => forkThread(meta.id).catch(fail("无法分叉此会话。"));
  const exportIt = () => exportThread(meta.id).catch(fail("导出会话失败。您可以重试。"));
  const archive = () => archiveSession(meta.id);
  const remove = () => deleteSession(meta.id);
  const openPr = () => window.open(prs[0].url, "_blank", "noopener");
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

  const bar = (
    <header ref={header} className="chat-header" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <div className="header-lead">
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
                icon={<Icon name="CaretDown" size="sm" className="caret" />}
                label={named ? `${title} 的更多选项` : "更多选项"}
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
            <MenuItem label="分叉" kbd="F" onClick={act(fork)} />
            <MenuSep />
            <MenuItem label="导出" kbd="E" onClick={act(exportIt)} />
            <MenuSep />
            <Submenu label="对话记录视图">
              {VIEWS.map((v) => (
                <MenuItem key={v} label={VIEW_LABELS[v]} checked={v === view} onClick={act(() => setThreadView(meta.id, v))} />
              ))}
              {view !== defaultView && (
                <>
                  <MenuSep />
                  <MenuItem
                    label={`将 ${VIEW_LABELS[view]} 设为默认`}
                    onClick={act(() => {
                      writePref("codex-ui:view", view);
                      setState({ defaultView: view });
                      toast("neutral", `${VIEW_LABELS[view]} 现在是默认视图。`);
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
      </div>
      <span className="spacer" />
      <div className="header-actions">
        <Button
          ref={rail.toggleRef}
          variant="ghost"
          icon={<Icon name="ListCard" size={18} />}
          label={rail.onScreen ? "隐藏会话栏" : "显示会话栏"}
          tipSide="bottom"
          active={rail.onScreen}
          aria-pressed={rail.onScreen}
          aria-expanded={rail.raises ? rail.onScreen : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => rail.toggle(event.detail === 0)}
        />
        <span className="header-rule" role="separator" aria-orientation="vertical" />
        {toggles
          .filter((t) => !folded.has(t.pane))
          .map((t) => (
            <Button
              key={t.pane}
              variant="ghost"
              icon={<Icon name={t.icon} size={18} />}
              label={t.label}
              kbd={t.kbd}
              tipSide="bottom"
              active={isOpen(t.pane)}
              aria-pressed={isOpen(t.pane)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => togglePane(t.pane, key)}
            />
          ))}
        {menuItems.length > 0 && (
          <Popover
            open={views}
            onClose={() => setViews(false)}
            placement="bottom-end"
            anchor={<Button variant="ghost" icon={<Icon name="DotsVertical" size={18} />} label="查看选项" tipSide="bottom" onClick={() => setViews(!views)} />}
          >
            {menuItems.map((t) => (
              <MenuItem
                key={t.pane}
                icon={<Icon name={t.icon} size="sm" />}
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
  return slot ? createPortal(bar, slot) : bar;
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const rail = useRail(thread.meta.id);
  const dock = useRef<HTMLDivElement>(null);
  useTerminalShortcut(thread.meta.id);
  // ponytail: the chat column centres in the room left of a docked rail; the bundle keeps it
  // centred on the whole tile while it clears the rail (shared-18 --session-rail-column-start).
  return (
    <div ref={rail.col} className="main-col">
      <ChatHeader thread={thread} rail={rail} />
      <div className="session-row">
        <div className="session-chat">
          <KeptIn value={thread.meta.id}>
            <Transcript thread={thread} dock={dock} />
          </KeptIn>
          <div ref={dock} className="dock">
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
// New-session (draft) page, the start-card face (cc43287c9 with the session-presets flag on, as
// the user's Claude runs it): the titlebar reads 新建会话 (yre) and the start card (p6) sits in the
// scroll area above the docked composer, centred on the room down to the prompt (hG / fG): the
// recent environments with 选择环境 under them, then the next steps (a6). Codex runs here only, so
// an environment is a folder; with no worktrees, pull requests or suggested tasks the next steps
// are the sessions waiting on the user and 继续未提交的工作.

/** Dismissed next steps (cc43287c9 r3 startCardDismissals). */
const DISMISSED_KEY = "codex-ui:start-card";

type Ask = "question" | "permission" | "error";
const ASKS: Record<Ask, string> = { question: "已提出问题", permission: "需要权限", error: "遇到错误" };

type SessionStep = { kind: "session"; id: string; title: string; ask: Ask; at: number };
type Step = SessionStep | { kind: "continue"; folder: string; branch: string; files: number };

const stepKey = (step: Step) => (step.kind === "session" ? `session:${step.id}` : `continue:${step.folder}\u0000${step.branch}`);
const stepStamp = (step: Step) => String(step.kind === "session" ? step.at : step.files);

function readDismissed(): Dismissals {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "null");
    return value && typeof value === "object" ? (value as Dismissals) : {};
  } catch {
    return {};
  }
}

const focusComposer = () => requestAnimationFrame(() => document.querySelector<HTMLElement>(".composer-input")?.focus());

/**
 * Sessions waiting on the user, newest first (cc43287c9 P3: an approval needs permission, the rest
 * asked a question, mid-turn ones too), then the newest one in this folder that stopped on an error
 * (N3). Untitled sessions stay out.
 */
function blockedSessions(ids: Iterable<string>, threads: Record<string, ThreadState>, requests: ServerRequest[], settled: ReadonlySet<string>, cwd: string): SessionStep[] {
  const asks = new Map<string, Ask>();
  for (const request of requests) {
    const id = requestThreadId(request);
    const ask = request.method === "item/tool/requestUserInput" || request.method === "mcpServer/elicitation/request" ? "question" : "permission";
    if (id && asks.get(id) !== "permission") asks.set(id, ask);
  }
  const waiting: SessionStep[] = [];
  let failed: SessionStep | null = null;
  for (const id of ids) {
    const meta = threads[id]?.meta;
    const title = meta?.name?.trim() || meta?.preview?.trim().split("\n")[0] || "";
    if (!meta || !title) continue;
    const { status } = meta;
    const at = meta.recencyAt ?? meta.updatedAt;
    const flagged = status.type === "active" && status.activeFlags.length > 0 ? (status.activeFlags.includes("waitingOnApproval") ? "permission" : "question") : null;
    const ask = asks.get(id) ?? flagged ?? (waitingQuestions(threads[id], settled).length ? "question" : null);
    if (ask) waiting.push({ kind: "session", id, title, ask, at });
    else if (status.type === "systemError" && samePath(meta.cwd, cwd) && (!failed || at > failed.at)) failed = { kind: "session", id, title, ask: "error", at };
  }
  waiting.sort((a, b) => b.at - a.at);
  return failed ? [...waiting, failed] : waiting;
}

/**
 * A start-card row (cc43287c9 t3): 32 tall, the title then a muted detail that drops onto a hidden
 * second line when there is no room, a caret on a menu row, and on hover an X for a row that can
 * be dismissed, the text making room for it.
 */
function StartRow({
  icon,
  title,
  detail,
  tip,
  tipDetail,
  menu,
  onPress,
  dismiss,
}: {
  icon?: IconName;
  title: ReactNode;
  detail?: string;
  tip?: string;
  tipDetail?: string;
  menu?: boolean;
  onPress(): void;
  dismiss?: { label: string; onPress(): void };
}) {
  return (
    <div className="start-row">
      <button type="button" className="start-btn" data-tip={tip} data-tip-detail={tipDetail} aria-expanded={menu} onClick={onPress}>
        {icon && <Icon name={icon} size="sm" className="start-icon" />}
        <span className="start-text">
          <span className="start-line">
            <span className="start-title">{title}</span>
            {detail && <span className="start-detail">{detail}</span>}
          </span>
          {menu !== undefined && <Icon name="CaretDown" size="xs" className="start-caret" />}
        </span>
        {dismiss && <span aria-hidden="true" className="start-room" />}
      </button>
      {dismiss && (
        <span className="start-dismiss">
          <Button variant="ghost" icon={<Icon name="X" />} label={dismiss.label} tip="关闭" onClick={dismiss.onPress} />
        </span>
      )}
    </div>
  );
}

function StartCard() {
  const threads = useStore((s) => s.threads);
  const requests = useStore((s) => s.requests);
  const settledQuestions = useStore((s) => s.settledQuestions);
  const landing = useStore((s) => s.landing);
  const listed = useStore((s) => s.list.ids);
  const ready = useStore((s) => s.conn.status === "ready");
  const recent = useRecentFolders();
  const { cwd } = recent;
  const [status, setStatus] = useState<FolderStatus | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  // Steps taken on this visit stay gone until the next 新建 (cc43287c9 markUsed, per opening).
  const [used, setUsed] = useState<string[]>([]);
  const [menu, setMenu] = useState<"env" | "rest" | null>(null);

  useEffect(() => {
    let live = true;
    setStatus(null);
    const refresh = () => { if (cwd && ready) void folderStatus(cwd, true).then((next) => live && setStatus(next)); };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
    };
  }, [cwd, ready]);

  if (landing === null) return null;

  // Three environments, newest first; the working folder takes the last place when older (p6).
  const top = recent.recent.slice(0, 3);
  const envs = !cwd || top.some((path) => samePath(path, cwd)) ? top : [...top.slice(0, -1), cwd];

  const sessions = blockedSessions(new Set([...landing, ...listed.filter((id) => !isArchivedThread(id))]), threads, requests, settledQuestions, cwd);
  const families: Step[][] = [sessions, status && continues(status) ? [{ kind: "continue", folder: cwd, branch: status.branch, files: status.files }] : []];
  const seats = seat(families.map((steps) => steps.filter((step) => !used.includes(stepKey(step)) && dismissed[stepKey(step)] !== stepStamp(step))));

  const forget = (steps: Step[]) => {
    const next = steps.reduce((map, step) => dismiss(map, stepKey(step), stepStamp(step)), dismissed);
    setDismissed(next);
    writePref(DISMISSED_KEY, JSON.stringify(next));
    setMenu(null);
    focusComposer();
  };

  const stepRow = (step: Step, inList = false) =>
    step.kind === "session" ? (
      <StartRow
        title={
          inList ? (
            step.title
          ) : (
            <>
              <span className="start-blocked">已阻塞</span> {step.title}
            </>
          )
        }
        detail={ASKS[step.ask]}
        tip={step.title}
        tipDetail={ASKS[step.ask]}
        onPress={() => {
          setMenu(null);
          void openThread(step.id);
        }}
        dismiss={{ label: `关闭“${step.title}”`, onPress: () => forget([step]) }}
      />
    ) : (
      <StartRow
        title="继续未提交的工作"
        detail={`${step.files} 个文件`}
        tip={`${step.branch} 上的 ${step.files} 个未提交文件`}
        onPress={() => {
          setUsed((keys) => [...keys, stepKey(step)]);
          setComposerDraft(`继续 ${step.branch} 上正在进行的工作：查看未提交的更改，告诉我它们处于什么状态，并完成已开始的部分。`);
        }}
        dismiss={{ label: "忽略未提交的工作", onPress: () => forget([step]) }}
      />
    );

  return (
    <div className="start-card">
      {envs.length > 0 && (
        <ul role="list" aria-label="最近使用的环境" className="start-list start-envs">
          {envs.map((path) => (
            <li key={path} aria-current={samePath(path, cwd) || undefined}>
              {samePath(path, cwd) ? (
                <div className="start-btn" data-tip={path}>
                  <Icon name="Laptop" size="sm" className="start-icon" />
                  <span className="start-title start-fill">{basename(path)}</span>
                  <Icon name="Check" size="sm" className="start-check" />
                </div>
              ) : (
                <StartRow
                  icon="Laptop"
                  title={basename(path)}
                  tip={path}
                  onPress={() => {
                    chooseFolder(path);
                    focusComposer();
                  }}
                />
              )}
            </li>
          ))}
          <li className="start-choose">
            <div aria-hidden="true" className="start-rule" />
            <Popover
              open={menu === "env"}
              onClose={() => setMenu(null)}
              className="menu-wide"
              anchor={<StartRow title="选择环境" menu={menu === "env"} onPress={() => setMenu(menu === "env" ? null : "env")} />}
            >
              <FolderMenu onClose={() => setMenu(null)} />
            </Popover>
          </li>
        </ul>
      )}
      {seats.length > 0 && (
        <ul role="list" aria-label="后续步骤" className="start-list start-steps">
          {seats.map((entry) =>
            "row" in entry ? (
              <li key={stepKey(entry.row)}>{stepRow(entry.row)}</li>
            ) : (
              <li key="rest">
                <Popover
                  open={menu === "rest"}
                  onClose={() => setMenu(null)}
                  className="start-pop"
                  anchor={
                    <StartRow
                      title={entry.whole ? `Codex 在 ${entry.rest.length} 个会话中受阻` : `Codex 在另外 ${entry.rest.length} 个会话中已受阻`}
                      menu={menu === "rest"}
                      onPress={() => setMenu(menu === "rest" ? null : "rest")}
                      dismiss={{ label: `忽略 ${entry.rest.length} 个受阻会话`, onPress: () => forget(entry.rest) }}
                    />
                  }
                >
                  <ul role="list" className="start-pop-list">
                    {entry.rest.map((step) => (
                      <li key={stepKey(step)}>{stepRow(step, true)}</li>
                    ))}
                  </ul>
                </Popover>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * cc43287c9 fG / dG: the card's top padding centres it on the room from the scroll area's top down
 * to 2.75rem above the prompt's bottom, kept 24 clear of the area's bottom; when the next steps do
 * not fit even then, they drop out until there is room again.
 */
function useCentred() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = ref.current;
    const scroller = shell?.parentElement;
    const slot = shell?.firstElementChild;
    if (!shell || !scroller || !slot) return;
    let setup = 0;
    const measure = () => {
      const steps = slot.querySelector<HTMLElement>(".start-steps");
      const shown = !!steps && steps.offsetHeight > 0;
      const above = steps?.previousElementSibling;
      if (!steps) setup = 0;
      else if (shown) setup = steps.getBoundingClientRect().bottom - (above ? above.getBoundingClientRect().bottom : steps.getBoundingClientRect().top);
      const room = scroller.clientHeight;
      const prompt = shell.closest(".main-col")?.querySelector(".composer");
      const lift = 2.75 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      const rest = prompt ? prompt.getBoundingClientRect().bottom - lift - scroller.getBoundingClientRect().top : room;
      const envs = slot.getBoundingClientRect().height - (shown ? setup : 0);
      const top = Math.max(0, (rest - envs - setup) / 2);
      const fits = top + envs + setup + 24 + Number(shell.hasAttribute("data-steps-hidden")) <= room;
      shell.style.paddingTop = `${Math.max(0, Math.min(top, room - 24 - (fits ? envs + setup : envs)))}px`;
      shell.toggleAttribute("data-steps-hidden", !fits);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(slot);
    measure();
    return () => observer.disconnect();
  }, []);
  return ref;
}

export function Welcome() {
  const pending = useStore((s) => s.pendingMessages[""]);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const cwd = useStore((s) => s.prefs.cwd);
  const ready = useStore((s) => s.conn.status === "ready");
  const epoch = useStore((s) => s.draftEpoch);
  const slot = useLiftSlot("draft");
  const shell = useCentred();
  useTerminalShortcut("draft");

  useEffect(() => {
    if (ready) void refreshLanding();
  }, [ready]);

  const bar = (
    <header className="chat-header" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title">新建会话</h1>
      <span className="spacer" />
      <div className="header-actions">
        <TerminalToggle termKey="draft" />
      </div>
    </header>
  );

  return (
    <div className="main-col">
      {slot ? createPortal(bar, slot) : bar}
      <div className="landing scroll-fade-y">
        {pending && <div className="transcript-list"><PendingMessage threadId={null} /></div>}
        <div ref={shell} className="start-shell" hidden={!!pending}>
          <div className="start-slot">
            <StartCard key={epoch} />
          </div>
        </div>
      </div>
      <div className="dock">
        <Approvals threadId={null} cwd={cwd} />
        <Composer threadId={null} form="home" autoFocus />
      </div>
    </div>
  );
}
