// Main column of the Code session view (compact density, decisions §1): the session
// titlebar over the transcript and the composer dock, and the new-session (draft) page. The
// panes beside it are Panes.tsx's. Structure and copy follow Claude Desktop 2.42304.0.0's Code
// chunks (ion-dist cc43287c9 / c73f45bc3 / shared-6), noted per part.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { errorMessage, forkThread, loadTurns, refreshLanding, renameThread, supports } from "../lib/codex";
import { threadMarkdown, threadTitle } from "../lib/format";
import { useBackgroundTasks } from "../lib/background-view";
import { togglePane } from "../lib/panes";
import { VIEWS, type TranscriptView } from "../lib/session";
import { getState, pullRequests, setKeepAwake, setSessionView, setState, toast, useStore, writePref, type PaneId, type ThreadState } from "../lib/store";
import { Approvals } from "./Approvals";
import { Composer, MenuSwitch } from "./Composer";
import { KeptIn } from "./items";
import { SessionRail, useRail, type RailState } from "./Rail";
import { archiveSession, deleteSession } from "./Sidebar";
import { TERMINAL_KBD, TerminalToggle, useTerminalShortcut } from "./Terminal";
import { Transcript } from "./Transcript";
import { PendingMessage } from "./PendingMessage";
import { StartCard, StartColumn } from "./StartCard";
import { Button, Icon, MenuItem, MenuSep, Popover, Submenu, type IconName } from "./ui";

const fail = (title: string) => (error: unknown) => toast("warning", title, errorMessage(error));

export const VIEW_LABELS: Record<TranscriptView, string> = { normal: "普通", thinking: "思考", verbose: "详细" };

export const setThreadView = setSessionView;

// Lifted titlebar (shared-16 ss -> shared-20 Wm / Gm): under the Windows / Linux chrome bar
// ([data-wco]) the titlebar moves into the bar's title slot (App.tsx ChromeBar; shared-22 LN
// dframe-chrome-title-slot). Claude drops it back above the transcript only in split view, with
// other sessions side by side (shared-16 Uo: extraPanesByMode), which codex-ui has none of; the
// panes beside the chat (终端, 更改, 文件, 浏览器) leave it lifted, so its controls stay put. Not a
// flag. It keeps the Code view's compact density, as a portal keeps Claude's density context.

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

/** The title slot while the titlebar is lifted into it. */
const useLiftSlot = () => useSyncExternalStore(subscribeSlot, slotNow);

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
 * (Ctrl+`), 更改 (Ctrl+Shift+D), 浏览器 (Ctrl+Shift+B) and 文件 (Ctrl+Shift+F) in that order
 * (c73f45bc3 mv / 3.6556 x_: terminal, diff, preview, …, file), then 查看选项. When the title would
 * be cut short the pane toggles fold into 查看选项, inactive ones first (jh). The rail toggle, which
 * Claude folds first (cd54a5401 en), always stays, as the user asked. In the desktop app 查看选项
 * is always there: it holds the session's 保持计算机唤醒 (c73f45bc3 K_ shows for keepAwake).
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
  const slot = useLiftSlot();
  const isOpen = (pane: PaneId) => !!open?.includes(pane);

  const toggles: PaneToggle[] = [
    ...(supports("process/spawn") ? [{ pane: "terminal" as const, icon: "CommandLinePrompt" as const, label: "终端", kbd: TERMINAL_KBD }] : []),
    { pane: "diff", icon: "ChangesPlusMinus", label: "更改", kbd: "Ctrl + Shift + D" },
    ...(window.codexDesktop ? [{ pane: "browser" as const, icon: "Globe" as const, label: "浏览器", kbd: "Ctrl + Shift + B" }] : []),
    { pane: "files", icon: "Folder", label: "文件", kbd: "Ctrl + Shift + F" },
  ];
  const desktop = !!window.codexDesktop;
  const awake = useStore((s) => s.keepAwake.has(thread.meta.id));
  const folded = new Set([...toggles.filter((t) => !isOpen(t.pane)), ...toggles.filter((t) => isOpen(t.pane))].slice(0, hidden).map((t) => t.pane));
  const planned = !!thread.goal || thread.turns.some((turn) => turn.plan || turn.items.some((item) => item.type === "plan"));
  const { tasks } = useBackgroundTasks(thread);
  const taskCount = tasks.filter((task) => task.status === "running").length;
  const extra: PaneToggle[] = [
    ...(tasks.length > 0 || isOpen("background") ? [{ pane: "background" as const, icon: "AgentsSimple" as const, label: "后台任务" }] : []),
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
    <header ref={header} className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
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
      <div className="header-actions" data-tip-group="">
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
        {(menuItems.length > 0 || desktop) && (
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
                value={t.pane === "background" && taskCount > 0 ? String(taskCount) : undefined}
                kbd={t.kbd}
                toggle
                checked={isOpen(t.pane)}
                onClick={() => {
                  setViews(false);
                  togglePane(t.pane, key);
                }}
              />
            ))}
            {/* cf74bc599 DA: after a rule, a checkbox with its switch that keeps the menu open. */}
            {desktop && (
              <>
                {menuItems.length > 0 && <MenuSep />}
                <MenuItem label="保持计算机唤醒" hint="仅限本次会话" toggle checked={awake} value={<MenuSwitch on={awake} />} onClick={() => setKeepAwake(meta.id, !awake)} />
              </>
            )}
          </Popover>
        )}
      </div>
    </header>
  );
  return slot ? createPortal(bar, slot) : bar;
}

/**
 * The desktop app's native menu in the main column only where it can act (cc43287c9 _re, shared-19
 * yX): fields, editable text, links, media, menus, or over a selection in the column. A right-click
 * anywhere else opens nothing; a child's own menu (defaultPrevented) is left alone.
 */
const NATIVE_MENU = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), a[href], img, video, audio, [role="menu"]';
function quietMenu(event: MouseEvent<HTMLElement>) {
  if (!window.codexDesktop || event.defaultPrevented) return;
  const col = event.currentTarget;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !col.contains(target)) return;
  const live = target.closest(NATIVE_MENU);
  if (live && col.contains(live)) return;
  const selection = col.ownerDocument.getSelection();
  if (selection && selection.rangeCount > 0 && selection.toString().trim() && selection.getRangeAt(0).intersectsNode(col)) return;
  event.preventDefault();
}

export function ThreadView({ thread }: { thread: ThreadState }) {
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const rail = useRail(thread.meta.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  useTerminalShortcut(thread.meta.id);
  // ponytail: the chat column centres in the room left of a docked rail; the bundle keeps it
  // centred on the whole tile while it clears the rail (shared-18 --session-rail-column-start).
  return (
    <div ref={rail.col} className="main-col" onContextMenu={quietMenu}>
      <ChatHeader thread={thread} rail={rail} />
      <div className="session-row">
        <div className="session-chat">
          <KeptIn value={thread.meta.id}>
            <Transcript thread={thread} dock={dock} scrollRef={scrollRef} />
          </KeptIn>
          <div ref={dock} className="dock">
            <Approvals threadId={thread.meta.id} cwd={cwd} />
            <Composer threadId={thread.meta.id} form="reply" autoFocus />
          </div>
        </div>
        {rail.docked && <SessionRail thread={thread} scrollRef={scrollRef} />}
        {rail.overlay && <SessionRail thread={thread} scrollRef={scrollRef} overlay={rail.overlay} toggleRef={rail.toggleRef} onDismiss={rail.dismiss} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-session (draft) page: the titlebar reads 新建会话 (cc43287c9 yre); the start card
// (StartCard.tsx) sits in the scroll area above the docked composer.

export function Welcome() {
  const pending = useStore((s) => s.pendingMessages[""]);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const cwd = useStore((s) => s.prefs.cwd);
  const ready = useStore((s) => s.conn.status === "ready");
  const epoch = useStore((s) => s.draftEpoch);
  const slot = useLiftSlot();
  useTerminalShortcut("draft");

  useEffect(() => {
    if (ready) void refreshLanding();
  }, [ready]);

  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title">新建会话</h1>
      <span className="spacer" />
      <div className="header-actions" data-tip-group="">
        <TerminalToggle termKey="draft" />
      </div>
    </header>
  );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="landing scroll-fade-y">
        {pending && <div className="transcript-list"><PendingMessage threadId={null} /></div>}
        <StartColumn hidden={!!pending}>
          <StartCard key={epoch} />
        </StartColumn>
      </div>
      <div className="dock">
        <Approvals threadId={null} cwd={cwd} />
        <Composer threadId={null} form="home" autoFocus />
      </div>
    </div>
  );
}
