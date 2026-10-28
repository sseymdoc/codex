// Right-hand panes beside the chat (lib/panes.ts; Claude Desktop 2.42304.0.0 tiles; the session
// rail inside the chat tile is Rail.tsx): the column of open panes with
// draggable edges, the pane chrome (c4db265df Bt: a 2rem head with ⋮「{pane}设置」, 展开 /
// 收起 and 关闭), and the 更改 (cccc2cf0a qO diff branch), 计划 (cccc2cf0a Iv) and 后台任务
// (cccc2cf0a kD) panes. The 文件 and 终端 panes live in FilePreview.tsx and Terminal.tsx.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { clearGoal, errorMessage, fail, loadAgent, loadTurns, modelLabel, optional, refreshBackground, requestThreadId, setGoalStatus, stopBackgroundTask } from "../lib/codex";
import { AGENT_TASK_STATUS, agentActivity, agentRunStatus, type BackgroundTask, type ShellTask, type TaskFamily } from "../lib/background";
import { backgroundDismissalKey, backgroundOutputPosition, popAgent, showAgent, toggleBackgroundTask, updateBackgroundView, useBackgroundTasks, useBackgroundView, useStopping } from "../lib/background-view";
import { changedIn, filesStats, splitUnifiedDiff, turnFiles, type FileDiff } from "../lib/diff";
import { basename, formatDuration, formatTokens, parentDir, threadTitle } from "../lib/format";
import { highlight } from "../lib/markdown";
import {
  NO_PANES,
  PANE_NAMES,
  activePane,
  closeActivePane,
  closePane,
  columnFlex,
  fileRows,
  moveEdge,
  notePane,
  rowFlex,
  saveFlex,
  splitRows,
  takePendingDiff,
  takePendingScope,
  toggleActiveExpanded,
  toggleExpanded,
  togglePane,
  type SplitCell,
} from "../lib/panes";
import { waitingPlan } from "../lib/questions";
import { getState, readJson, record, useStore, writeJson, type Notice, type PaneId, type ThreadState } from "../lib/store";
import { setComposerDraft } from "./Composer";
import { TodoList, useAgentName, UserBubble } from "./items";
import { TurnView } from "./Transcript";
import { DiffView, FileDiffCard, FileDiffHead } from "./content";
import { FilesPane } from "./FilePreview";
import { PlanDoc } from "./PlanComments";
import { BrowserPane } from "./Browser";
import { MAC, TerminalPane } from "./Terminal";
import { Button, Icon, MenuItem, MenuSep, Popover, ShimmerText, Spinner, Submenu, useNow } from "./ui";
import type { GitDiffToRemoteResponse } from "@protocol/GitDiffToRemoteResponse";
import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import type { ThreadItem } from "@protocol/v2/ThreadItem";

type ItemOf<T extends ThreadItem["type"]> = Extract<ThreadItem, { type: T }>;

/** Narrowest a pane or the chat gets from dragging an edge (shared-18 Tb minTileWidthPx). */
const MIN_TILE = 280;

// ---------------------------------------------------------------------------
// The column

/** The open panes of the view on screen (on the new-session page only the terminal opens). */
export function Panes({ thread }: { thread?: ThreadState }) {
  const view = thread?.meta.id ?? "draft";
  const layout = useStore((s) => s.panes[view]) ?? NO_PANES;
  const draftCwd = useStore((s) => s.prefs.cwd);
  const column = useRef<HTMLDivElement>(null);
  const start = useRef<{ sizes: [number, number]; flexes: [number, number] } | null>(null);
  const [, bump] = useState(0);
  usePaneShortcuts(view, !!thread);
  const { open } = layout;
  if (!open.length) return null;
  const expanded = layout.expanded && open.includes(layout.expanded) ? layout.expanded : null;
  const shown = expanded ? [expanded] : open;
  const cwd = thread ? (thread.settings?.cwd ?? thread.meta.cwd) : draftCwd;
  const width = columnFlex(open[0]);
  const names = (panes: PaneId[]) => panes.map((pane) => PANE_NAMES[pane]).join("、");

  const slots = () => [...(column.current?.children ?? [])].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains("pane-slot"));
  const commit = () => {
    start.current = null;
    bump((n) => n + 1);
  };

  return (
    <>
      {!expanded && (
        <Edge
          orientation="vertical"
          label={thread ? `调整 ${threadTitle(thread.meta)} 和 ${names(open)} 的大小` : "调整 1 和 2 的大小"}
          value={Math.round(200 / (2 + width))}
          onStart={() => {
            const chat = column.current?.previousElementSibling?.previousElementSibling;
            start.current = { sizes: [chat?.getBoundingClientRect().width ?? 0, column.current?.getBoundingClientRect().width ?? 0], flexes: [2, width] };
          }}
          onMove={(delta, done) => {
            const from = start.current;
            if (!from || !column.current) return;
            const [chat, pane] = moveEdge(from.flexes, from.sizes, delta, MIN_TILE);
            const next = (2 * pane) / chat;
            column.current.style.flexGrow = String(next / 2);
            if (done) {
              saveFlex("w", { [open[0]]: next });
              commit();
            }
          }}
          onReset={() => {
            saveFlex("w", { [open[0]]: undefined });
            if (column.current) column.current.style.flexGrow = String(columnFlex(open[0]) / 2);
            commit();
          }}
        />
      )}
      <div ref={column} className="pane-column" data-expanded={expanded || undefined} style={{ flexGrow: expanded ? 1 : width / 2 }}>
        {shown.map((pane, index) => (
          <Fragment key={pane}>
            {index > 0 && (
              <Edge
                orientation="horizontal"
                label={`调整 ${PANE_NAMES[shown[index - 1]]} 和 ${PANE_NAMES[pane]} 的大小`}
                value={Math.round((100 * rowFlex(shown[index - 1])) / (rowFlex(shown[index - 1]) + rowFlex(pane)))}
                onStart={() => {
                  const els = slots();
                  start.current = {
                    sizes: [els[index - 1]?.getBoundingClientRect().height ?? 0, els[index]?.getBoundingClientRect().height ?? 0],
                    flexes: [rowFlex(shown[index - 1]), rowFlex(pane)],
                  };
                }}
                onMove={(delta, done) => {
                  const from = start.current;
                  const els = slots();
                  if (!from || !els[index]) return;
                  const [upper, lower] = moveEdge(from.flexes, from.sizes, delta, 96);
                  els[index - 1].style.flexGrow = String(upper);
                  els[index].style.flexGrow = String(lower);
                  if (done) {
                    saveFlex("h", { [shown[index - 1]]: upper, [pane]: lower });
                    commit();
                  }
                }}
                onReset={() => {
                  saveFlex("h", { [shown[index - 1]]: undefined, [pane]: undefined });
                  for (const el of slots()) el.style.flexGrow = "";
                  commit();
                }}
              />
            )}
            <div className="pane-slot" data-pane={pane} data-view={view} style={{ flexGrow: expanded ? 1 : rowFlex(pane) }}>
              {pane === "terminal" ? (
                <TerminalPane view={view} cwd={cwd} />
              ) : !thread ? null : pane === "diff" ? (
                <DiffPane thread={thread} />
              ) : pane === "browser" ? (
                <BrowserPane view={view} cwd={cwd} />
              ) : pane === "files" ? (
                <FilesPane thread={thread} />
              ) : pane === "plan" ? (
                <PlanPane thread={thread} />
              ) : (
                <BackgroundPane key={view} thread={thread} />
              )}
            </div>
          </Fragment>
        ))}
      </div>
    </>
  );
}

/**
 * Pane keys (shared-19 W7): Ctrl+\ closes the pane used last (its own tab first), Ctrl+Shift+\
 * expands or collapses it, Ctrl+Shift+F shows or hides the files pane. On Windows and Linux a
 * focused terminal keeps Ctrl+\ (its close button shows no shortcut there, c4db265df).
 */
function usePaneShortcuts(view: string, files: boolean) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const { palette, settings, dialog } = getState();
      if (palette || settings || dialog) return;
      if (event.code === "Backslash") {
        if (!event.shiftKey && !MAC && (event.target as Element | null)?.closest?.(".xterm")) return;
        if (!activePane(view)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) toggleActiveExpanded(view);
        else closeActivePane(view);
      } else if (files && event.shiftKey && event.code === "KeyF") {
        event.preventDefault();
        event.stopPropagation();
        togglePane("files", view);
      }
    };
    // Capture: a focused terminal would take the keys as input.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [view, files]);
}

/**
 * A draggable edge (c9543da06 ed): ← → or ↑ ↓ move it 24px (120 with Shift), Home / End to
 * the limits, Enter, Space or a double click back to the default. `onMove` gets the distance
 * since `onStart`.
 */
function Edge({
  orientation,
  label,
  value,
  onStart,
  onMove,
  onReset,
}: {
  orientation: "vertical" | "horizontal";
  label: string;
  value?: number;
  onStart(): void;
  onMove(delta: number, done: boolean): void;
  onReset(): void;
}) {
  const from = useRef<number | null>(null);
  const [active, setActive] = useState(false);
  const vertical = orientation === "vertical";
  const at = (event: { clientX: number; clientY: number }) => (vertical ? event.clientX : event.clientY);
  const end = (event: { clientX: number; clientY: number }) => {
    if (from.current === null) return;
    onMove(at(event) - from.current, true);
    from.current = null;
    setActive(false);
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      className="pane-edge"
      data-active={active || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        onStart();
        from.current = at(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
      }}
      onPointerMove={(event) => from.current !== null && onMove(at(event) - from.current, false)}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat) onReset();
          return;
        }
        const step = event.shiftKey ? 120 : 24;
        const keys: Record<string, number> = vertical ? { ArrowLeft: -step, ArrowRight: step } : { ArrowUp: -step, ArrowDown: step };
        const delta = event.key === "Home" ? -Infinity : event.key === "End" ? Infinity : keys[event.key];
        if (delta === undefined) return;
        event.preventDefault();
        onStart();
        onMove(delta, true);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Pane chrome

/**
 * A pane (c4db265df Bt): the head is 2rem, the title in body text and secondary ink, then the
 * pane's own keys, ⋮「{pane}设置」(only with a menu), 展开 / 收起 and 关闭.
 */
export function PaneFrame({
  view,
  pane,
  title,
  trailing,
  menu,
  closeKbd = true,
  onKeyDown,
  children,
}: {
  view: string;
  pane: PaneId;
  title?: ReactNode;
  trailing?: ReactNode;
  /** The settings menu's items; `close` closes the menu. */
  menu?: (close: () => void) => ReactNode;
  /** The terminal shows no Ctrl+\ off macOS (the terminal takes the key there). */
  closeKbd?: boolean;
  onKeyDown?(event: KeyboardEvent<HTMLElement>): void;
  children: ReactNode;
}) {
  const expanded = useStore((s) => s.panes[view]?.expanded === pane);
  const [menuOpen, setMenuOpen] = useState(false);
  const name = PANE_NAMES[pane];
  return (
    <section className="pane" aria-label={name} data-pane={pane} onPointerDownCapture={() => notePane(pane)} onFocusCapture={() => notePane(pane)} onKeyDown={onKeyDown}>
      <div className="pane-head">
        <div className="pane-title" data-tip-group={pane === "diff" ? "" : undefined}>{title ?? <span className="pane-name">{name}</span>}</div>
        <div className="pane-actions" data-tip-group="">
          {trailing}
          {menu && (
            <Popover
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              placement="bottom-end"
              anchor={<Button variant="ghost" icon={<Icon name="DotsVertical" size={18} />} label={`${name} 设置`} tipSide="bottom" onClick={() => setMenuOpen(!menuOpen)} />}
            >
              {menu(() => setMenuOpen(false))}
            </Popover>
          )}
          <Button
            variant="ghost"
            icon={<Icon name={expanded ? "Collapse" : "Expand"} size={18} />}
            label={expanded ? "折叠" : "展开"}
            kbd={"Ctrl + Shift + \\"}
            tipSide="bottom"
            onClick={() => toggleExpanded(pane, view)}
          />
          <Button
            variant="ghost"
            icon={<Icon name="X" size={18} />}
            label="关闭"
            kbd={closeKbd ? "Ctrl + \\" : undefined}
            tipSide="bottom"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => closePane(pane, view)}
          />
        </div>
      </div>
      <div className="pane-body">{children}</div>
    </section>
  );
}

/** A pane's empty state (cc0a875c8): a 28px glyph, a title in body text, a muted footnote. */
export function PaneEmpty({ icon, title, body, children }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="pane-empty">
      {icon && <span className="pane-empty-icon">{icon}</span>}
      <div className="pane-empty-text">
        <p className="pane-empty-title">{title}</p>
        {body && <p className="pane-empty-body">{body}</p>}
      </div>
      {children && <div className="pane-empty-actions">{children}</div>}
    </div>
  );
}

export interface GotoItem {
  path: string;
  added?: number;
  removed?: number;
}

/** Every character of `query`, in order (case-insensitive). */
const fuzzy = (text: string, query: string) => {
  let at = 0;
  const lower = text.toLowerCase();
  for (const char of query.toLowerCase()) {
    at = lower.indexOf(char, at) + 1;
    if (!at) return false;
  }
  return true;
};

const GOTO_LIMIT = 100;

/**
 * 转到文件 (cccc2cf0a Fb): a search box over the files, at most 100 shown, Enter opens the first.
 * `items` are filtered here; `search` asks the server as the query changes. The pane opens it
 * with Ctrl+P through [data-goto].
 */
export function GoToFile({
  label,
  placeholder,
  items,
  search,
  onPick,
}: {
  label: string;
  placeholder: string;
  items?: GotoItem[];
  search?(query: string): Promise<GotoItem[]>;
  onPick(path: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<GotoItem[] | null>(null);
  useEffect(() => {
    if (!open || !search) return;
    if (!query.trim()) return setFound([]);
    let live = true;
    const timer = setTimeout(() => {
      search(query.trim()).then(
        (list) => live && setFound(list),
        () => live && setFound([]),
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query, search]);
  const list = items ? items.filter((item) => fuzzy(item.path, query.trim())) : (found ?? []);
  const shown = list.slice(0, GOTO_LIMIT);
  const settled = items ? true : !!query.trim() && found !== null;
  const close = () => {
    setOpen(false);
    setQuery("");
    setFound(null);
  };
  const pick = (path: string) => {
    close();
    onPick(path);
  };
  return (
    <Popover
      open={open}
      onClose={close}
      placement="bottom-end"
      className="goto-menu"
      anchor={<Button variant="ghost" icon={<Icon name="Search" size="sm" />} label={label} kbd="Ctrl + P" tipSide="bottom" data-goto="" onClick={() => (open ? close() : setOpen(true))} />}
    >
      <input
        className="goto-input"
        autoFocus
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || !shown[0]) return;
          event.preventDefault();
          pick(shown[0].path);
        }}
      />
      {shown.length > 0 && (
        <div className="menu-scroll goto-list">
          {shown.map((item) => (
            <button key={item.path} type="button" role="menuitem" className="menu-item goto-item" onClick={() => pick(item.path)}>
              <span className="goto-name">{basename(item.path)}</span>
              <span className="goto-dir">{parentDir(item.path) === item.path ? "" : parentDir(item.path)}</span>
              {item.added !== undefined && (
                <span className="diff-stat">
                  <span className="plus">+{item.added}</span>
                  <span className="minus">−{item.removed ?? 0}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {!items && !query.trim() ? (
        <div className="menu-note">暂无可显示的文件。输入以搜索。</div>
      ) : settled && list.length === 0 ? (
        <div className="menu-note">没有匹配的文件</div>
      ) : list.length > GOTO_LIMIT ? (
        <div className="menu-note">还有 {list.length - GOTO_LIMIT} 个文件。继续输入以缩小范围。</div>
      ) : null}
    </Popover>
  );
}

/** Ctrl+P inside a pane opens its 转到文件 (the goToDiffFile key, scoped to the pane). */
export function gotoKey(event: KeyboardEvent<HTMLElement>) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "p") return;
  const button = event.currentTarget.querySelector<HTMLButtonElement>("[data-goto]");
  if (!button) return;
  event.preventDefault();
  button.click();
}

// ---------------------------------------------------------------------------
// 更改 (Changes)

type Scope = { kind: "all" } | { kind: "turn"; id: string | null };

interface DiffPrefs {
  /** 显示文件 (diffShowTree): off until turned on. */
  files: boolean;
  /** 并排显示 (diff style split; unified by default, c227f4d5e nC). */
  split: boolean;
  /** 自动换行 (on by default, c227f4d5e JS). */
  wrap: boolean;
  /** 隐藏空白更改 (off by default, XS). */
  ws: boolean;
  /** The file list's width. */
  list: number;
}

const DIFF_KEY = "codex-ui:diff-view";
let diffPrefs = { files: false, split: false, wrap: true, ws: false, list: 220, ...record(readJson(DIFF_KEY)) } as DiffPrefs;

/** Narrower than this, 并排显示 falls back to one column (c44d00c7f Dl). */
const SPLIT_MIN = 640;
/** More files than this start collapsed. */
const OPEN_FILES = 4;

type Remote = { status: "error"; message?: string } | { status: "ready"; sha: string; files: FileDiff[] };

/**
 * 所有更改 by folder (gitDiffToRemote), shared with the rail's 更改 card so the two agree; the
 * last answer stays up while the next read is under way.
 */
const remotes = new Map<string, Remote>();
const reading = new Set<string>();
const remoteListeners = new Set<() => void>();
let remoteVersion = 0;

function remoteChanged() {
  remoteVersion += 1;
  for (const listener of remoteListeners) listener();
}

function subscribeRemote(listener: () => void) {
  remoteListeners.add(listener);
  return () => remoteListeners.delete(listener);
}

export function loadRemoteDiff(cwd: string): void {
  if (reading.has(cwd)) return;
  reading.add(cwd);
  remoteChanged();
  optional<GitDiffToRemoteResponse>("gitDiffToRemote", { cwd })
    .then(
      (response): Remote => (response ? { status: "ready", sha: response.sha, files: splitUnifiedDiff(response.diff) } : { status: "error" }),
      (error): Remote => ({ status: "error", message: errorMessage(error) }),
    )
    .then((remote) => {
      reading.delete(cwd);
      remotes.set(cwd, remote);
      remoteChanged();
    });
}

/** The last read of a folder's changes, outside React (the next-step box's app actions). */
export const remoteDiffOf = (cwd: string): Remote | null => remotes.get(cwd) ?? null;

export function useRemoteDiff(cwd: string): Remote | null {
  useSyncExternalStore(subscribeRemote, () => remoteVersion);
  return remotes.get(cwd) ?? null;
}

const displayedDiffs = new Map<string, FileDiff[]>();
export function diffTargets(thread: ThreadState) {
  const files = displayedDiffs.get(thread.meta.id) ?? thread.turns.map(turn => turnFiles(turn, thread.settings?.cwd ?? thread.meta.cwd)).findLast(files => files.length) ?? [];
  return files.map(file => ({ id: file.movePath ?? file.path, label: file.movePath ?? file.path }));
}

function DiffPane({ thread }: { thread: ThreadState }) {
  const view = thread.meta.id;
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const git = !!thread.meta.gitInfo;
  const [prefs, setPrefsState] = useState(diffPrefs);
  const [scope, setScope] = useState<Scope>({ kind: "turn", id: null });
  const remote = useRemoteDiff(cwd);
  const [fold, setFold] = useState<{ open: boolean | null; epoch: number }>({ open: null, epoch: 0 });
  const [focus, setFocus] = useState<{ path: string; nonce: number } | null>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLElement>(null);
  const listStart = useRef(0);

  const setPrefs = (patch: Partial<DiffPrefs>) => {
    diffPrefs = { ...diffPrefs, ...patch };
    writeJson(DIFF_KEY, diffPrefs);
    setPrefsState(diffPrefs);
  };

  const turns = useMemo(() => thread.turns.map((turn) => ({ turn, files: turnFiles(turn, cwd) })).filter((entry) => entry.files.length > 0), [thread.turns, cwd]);
  const picked = scope.kind === "turn" ? (turns.find((entry) => entry.turn.id === scope.id) ?? turns.at(-1)) : undefined;
  // 隐藏空白更改 folds each card's hunks (fileRows), not the counts.
  const files = scope.kind === "all" ? (remote?.status === "ready" ? remote.files : []) : (picked?.files ?? []);
  const stats = filesStats(files);
  useLayoutEffect(() => {
    displayedDiffs.set(view, files);
    return () => { displayedDiffs.delete(view); };
  }, [view, files]);

  // Read again whenever the pane turns to 所有更改.
  useEffect(() => {
    if (scope.kind === "all" && git) loadRemoteDiff(cwd);
  }, [scope.kind, git, cwd]);

  // Ctrl+Shift+Y shows or hides the file list while the pane is open (toggleDiffFileList).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.code !== "KeyY") return;
      event.preventDefault();
      setPrefs({ files: !diffPrefs.files });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < SPLIT_MIN));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focus) body.current?.querySelector(`[data-diff-path="${CSS.escape(focus.path)}"]`)?.scrollIntoView({ block: "start" });
  }, [focus]);

  const reveal = (path: string) => setFocus((last) => ({ path, nonce: (last?.nonce ?? 0) + 1 }));

  // nextDiffChange / prevDiffChange (shared-19: F7 / Shift+F7, and Alt+F5 / Shift+Alt+F5 off
  // Linux): scroll to the next or previous run of added / removed rows.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const f7 = event.key === "F7" && !event.altKey;
      const f5 = event.key === "F5" && event.altKey && !/linux/i.test(navigator.userAgent);
      const root = body.current;
      if ((!f7 && !f5) || !root) return;
      const changed = (el: Element | null) => !!el && (el.classList.contains("diff-add") || el.classList.contains("diff-del"));
      const starts = [...root.querySelectorAll<HTMLElement>(".diff-row.diff-add, .diff-row.diff-del")].filter((row) => !changed(row.previousElementSibling));
      if (!starts.length) return;
      event.preventDefault();
      const edge = root.getBoundingClientRect().top;
      const target = event.shiftKey
        ? starts.findLast((row) => row.getBoundingClientRect().top < edge - 1)
        : starts.find((row) => row.getBoundingClientRect().top > edge + 1);
      target?.scrollIntoView({ block: "start" });
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  // openDiff (an edit row's file name): the newest turn that changed the file, scrolled to it.
  // openChanges (the rail's 更改 row): the scope its numbers came from.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  useEffect(() => {
    const apply = () => {
      const wantedScope = takePendingScope(view);
      if (wantedScope) {
        setScope(wantedScope === "all" ? { kind: "all" } : { kind: "turn", id: null });
        setFocus(null);
      }
      const wanted = takePendingDiff(view);
      if (!wanted) return;
      if (wanted.preserveScope) { reveal(wanted.path); return; }
      const hit = changedIn(turnsRef.current, wanted.path, cwd);
      if (!hit) return;
      setScope({ kind: "turn", id: hit.turn.turn.id });
      reveal(hit.file.movePath ?? hit.file.path);
    };
    apply();
    window.addEventListener("codex:open-diff", apply);
    return () => window.removeEventListener("codex:open-diff", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest turns through the ref
  }, [cwd, view]);
  const sha = remote?.status === "ready" ? remote.sha.slice(0, 7) : null;
  const latest = picked === turns.at(-1);
  const scopeLabel =
    scope.kind === "all" ? (sha ? `${sha} → 工作树` : "所有更改") : !picked || latest ? "本轮更改" : `第 ${thread.turns.indexOf(picked.turn) + 1} 轮`;
  const choose = (next: Scope) => {
    setScopeOpen(false);
    setScope(next);
    setFocus(null);
  };

  const title = (
    <>
      <Button
        variant="ghost"
        icon={<Icon name="ListBullet" size={18} />}
        label={prefs.files ? "隐藏文件" : "显示文件"}
        kbd="Ctrl + Shift + Y"
        tipSide="bottom"
        active={prefs.files}
        aria-pressed={prefs.files}
        onClick={() => setPrefs({ files: !prefs.files })}
      />
      <Popover
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
        anchor={
          <Button variant="ghost" className="diff-scope" aria-label={`差异范围：${scopeLabel}`} onClick={() => setScopeOpen(!scopeOpen)}>
            {scope.kind === "all" && sha ? (
              <span className="diff-scope-range">
                <span>{sha}</span>
                <Icon name="ArrowRight" size="xs" />
                <span>工作树</span>
              </span>
            ) : (
              <span className="btn-label">{scopeLabel}</span>
            )}
          </Button>
        }
      >
        <MenuItem label="所有更改" value={sha ? `对比 ${sha}` : undefined} checked={scope.kind === "all"} onClick={() => choose({ kind: "all" })} />
        <MenuItem label="本轮更改" checked={scope.kind === "turn" && latest} disabled={turns.length === 0} onClick={() => choose({ kind: "turn", id: null })} />
        {/* Codex keeps every turn's diff (turn/diff/updated): older turns, like the commits submenu. */}
        {turns.length > 1 && (
          <>
            <MenuSep />
            <Submenu label="轮次" value={String(turns.length)}>
              <div className="menu-scroll">
                {turns.toReversed().map(({ turn }) => (
                  <MenuItem
                    key={turn.id}
                    label={`第 ${thread.turns.indexOf(turn) + 1} 轮`}
                    checked={scope.kind === "turn" && picked?.turn === turn}
                    onClick={() => choose({ kind: "turn", id: turn.id })}
                  />
                ))}
              </div>
            </Submenu>
          </>
        )}
      </Popover>
    </>
  );

  const menu = (close: () => void) => (
    <>
      <MenuItem label="显示文件" toggle checked={prefs.files} kbd="Ctrl + Shift + Y" onClick={() => setPrefs({ files: !prefs.files })} />
      <MenuSep />
      <MenuItem
        label="折叠所有文件"
        onClick={() => {
          close();
          setFold((last) => ({ open: false, epoch: last.epoch + 1 }));
        }}
      />
      <MenuItem
        label="展开所有文件"
        onClick={() => {
          close();
          setFold((last) => ({ open: true, epoch: last.epoch + 1 }));
        }}
      />
      <MenuSep />
      <MenuItem label="并排" hint={prefs.split && narrow ? "需要更宽的窗格" : undefined} toggle checked={prefs.split} onClick={() => setPrefs({ split: !prefs.split })} />
      <MenuItem label="自动换行" toggle checked={prefs.wrap} onClick={() => setPrefs({ wrap: !prefs.wrap })} />
      <MenuItem label="隐藏空白字符更改" toggle checked={prefs.ws} onClick={() => setPrefs({ ws: !prefs.ws })} />
      {scope.kind === "all" && git && (
        <>
          <MenuSep />
          <MenuItem
            label="刷新"
            onClick={() => {
              close();
              loadRemoteDiff(cwd);
            }}
          />
        </>
      )}
    </>
  );

  const trailing = files.length > 0 && (
    <GoToFile
      label="转到文件"
      placeholder="搜索已更改的文件"
      items={files.map((file) => ({ path: file.movePath ?? file.path, ...filesStats([file]) }))}
      onPick={reveal}
    />
  );

  const split = prefs.split && !narrow;
  const collapsed = fold.open ?? files.length <= OPEN_FILES;
  let content: ReactNode;
  if (scope.kind === "all" && !git) content = <PaneEmpty title="更改功能需要 Git 仓库" />;
  else if (scope.kind === "all" && remote === null) content = <PaneEmpty icon={<Spinner size={20} />} title="正在加载更改" />;
  else if (scope.kind === "all" && remote?.status === "error") content = <PaneEmpty title="无法加载更改" body={remote.message} />;
  else if (files.length === 0) content = <PaneEmpty title="没有可显示的更改" />;
  else
    content = (
      <div className="diff-pane-main">
        {prefs.files && (
          <>
            <nav ref={list} className="diff-files scroll-fade-y" data-tip-group="700" aria-label="已更改的文件" style={{ width: prefs.list }}>
              {files.map((file) => {
                const path = file.movePath ?? file.path;
                const counts = filesStats([file]);
                return (
                  <button key={path} type="button" className="diff-file" data-tip={path} aria-current={focus?.path === path || undefined} onClick={() => reveal(path)}>
                    <span className="diff-file-name">{basename(path)}</span>
                    <span className="diff-stat">
                      <span className="plus">+{counts.added}</span>
                      <span className="minus">−{counts.removed}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
            <Edge
              orientation="vertical"
              label="调整文件列表大小"
              onStart={() => (listStart.current = list.current?.offsetWidth ?? prefs.list)}
              onMove={(delta, done) => {
                const width = Math.round(Math.min(Math.max(listStart.current + delta, 140), 480));
                if (list.current) list.current.style.width = `${width}px`;
                if (done) setPrefs({ list: width });
              }}
              onReset={() => setPrefs({ list: 220 })}
            />
          </>
        )}
        <div className="diff-pane-files scroll-fade-y">
          <div className="diff-pane-head">
            <span>{files.length} 个文件</span>
            <span className="diff-stat">
              <span className="plus">+{stats.added}</span>
              <span className="minus">−{stats.removed}</span>
            </span>
          </div>
          {fold.open === null && files.length > OPEN_FILES && <p className="diff-pane-note">差异较大时，文件会折叠显示。请选择文件将其展开。</p>}
          {files.map((file) => {
            const path = file.movePath ?? file.path;
            const shownOpen = focus?.path === path ? true : collapsed;
            const key = `${path}:${fold.epoch}:${focus?.path === path ? focus.nonce : 0}:${split}`;
            return (
              <div key={path} data-diff-path={path}>
                {split ? (
                  <SplitFileDiff key={key} file={file} ws={prefs.ws} defaultOpen={shownOpen} />
                ) : (
                  <FileDiffCard key={key} file={file} ws={prefs.ws} defaultOpen={shownOpen} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );

  return (
    <PaneFrame view={view} pane="diff" title={title} trailing={trailing} menu={menu} onKeyDown={gotoKey}>
      <div ref={body} className="diff-pane" data-wrap={prefs.wrap || undefined}>
        {content}
      </div>
    </PaneFrame>
  );
}

const MAX_SPLIT_ROWS = 3000;

function SplitSide({ cell, language }: { cell: SplitCell | null; language: string | undefined }) {
  if (!cell) return <span className="diff-cell" data-empty="" />;
  return (
    <span className="diff-cell" data-kind={cell.kind}>
      <span className="diff-no">{cell.no ?? ""}</span>
      <span className="diff-code">
        <span className="diff-sign">{cell.kind === "add" ? "+" : cell.kind === "del" ? "-" : " "}</span>
        <span dangerouslySetInnerHTML={{ __html: highlight(cell.text, language) || " " }} />
      </span>
    </span>
  );
}

/** One file side by side: the FileDiffCard head over removed | added columns. */
function SplitFileDiff({ file, ws, defaultOpen }: { file: FileDiff; ws: boolean; defaultOpen: boolean }) {
  const { diff, rows: unified, stats, whitespaceOnly } = useMemo(() => fileRows(file, ws), [file, ws]);
  const rows = useMemo(() => splitRows(unified), [unified]);
  // As FileDiffCard: a head with no lines under it opens nothing.
  const lines = rows.length > 0;
  const [picked, setPicked] = useState(defaultOpen);
  const open = lines && picked;
  const path = file.movePath ?? file.path;
  const language = basename(path).toLowerCase().split(".").pop();
  return (
    <div className={`file-diff ${open ? "open" : ""}`}>
      <FileDiffHead file={file} stats={stats} whitespaceOnly={whitespaceOnly} lines={lines} open={open} onToggle={() => setPicked(!open)} />
      {open &&
        (rows.length > MAX_SPLIT_ROWS ? (
          // Too big for rows: the shared view shows the removed and the added text apart.
          <DiffView diff={diff} path={path} kind={file.kind} whole={file.whole} />
        ) : (
          <div className="diff diff-sbs" role="table">
            {rows.map((row, index) =>
              "gap" in row ? (
                <div key={index} className="diff-gap" aria-hidden="true" />
              ) : (
                <div key={index} className="diff-row">
                  <SplitSide cell={row.left} language={language} />
                  <SplitSide cell={row.right} language={language} />
                </div>
              ),
            )}
          </div>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 计划 (Plan): the plan Codex proposes (plan items, item/plan/delta) and its task list
// (turn/plan/updated), as cccc2cf0a Iv lays them out.

export const GOAL_LABELS: Record<ThreadGoalStatus, string> = {
  active: "进行中",
  paused: "已暂停",
  blocked: "受阻",
  usageLimited: "已达到使用限额",
  budgetLimited: "预算已用尽",
  complete: "已完成",
};

function latestPlanText(thread: ThreadState): string | null {
  for (let t = thread.turns.length - 1; t >= 0; t -= 1) {
    const item = thread.turns[t].items.findLast((entry): entry is Extract<ThreadItem, { type: "plan" }> => entry.type === "plan" && !!entry.text.trim());
    if (item) return item.text;
  }
  return null;
}

/**
 * Codex's goal (thread/goal/*), Codex-only: the session rail's 目标 card shows it (Rail.tsx); it
 * also heads the Plan pane, for when the rail is hidden. 编辑 puts `/goal …` in the composer.
 */
function GoalSection({ threadId, goal }: { threadId: string; goal: ThreadGoal }) {
  const [more, setMore] = useState(false);
  const [clamped, setClamped] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (el && !more) setClamped(el.scrollHeight > el.clientHeight + 1);
  }, [goal.objective, more]);
  const meta = [
    GOAL_LABELS[goal.status],
    `${formatTokens(goal.tokensUsed)}${goal.tokenBudget ? ` / ${formatTokens(goal.tokenBudget)}` : ""} tokens`,
    goal.timeUsedSeconds ? formatDuration(goal.timeUsedSeconds * 1000) : null,
  ].filter(Boolean);
  return (
    <section className="plan-goal">
      <div className="plan-goal-head">
        <h2 className="plan-h2">目标</h2>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon={<Icon name="Edit" size={16} />} label="编辑目标" tipSide="bottom" onClick={() => setComposerDraft(`/goal ${goal.objective}`)} />
        {goal.status === "active" ? (
          <Button variant="ghost" size="sm" icon={<Icon name="Pause" size={16} />} label="暂停" tipSide="bottom" onClick={() => setGoalStatus(threadId, "paused").catch(fail("暂停失败"))} />
        ) : (
          goal.status !== "complete" && (
            <Button variant="ghost" size="sm" icon={<Icon name="Play" size={16} />} label="继续" tipSide="bottom" onClick={() => setGoalStatus(threadId, "active").catch(fail("继续失败"))} />
          )
        )}
        <Button variant="ghost" size="sm" icon={<Icon name="X" size={16} />} label="清除" tipSide="bottom" onClick={() => clearGoal(threadId).catch(fail("清除失败"))} />
      </div>
      <p ref={text} className="plan-goal-text" data-clamped={!more || undefined}>
        {goal.objective}
      </p>
      {(clamped || more) && (
        <button type="button" className="link-btn plan-goal-more" onClick={() => setMore(!more)}>
          {more ? "收起" : "显示更多"}
        </button>
      )}
      <p className="plan-goal-meta">{meta.join(" · ")}</p>
    </section>
  );
}

function CopyPlan({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      icon={<Icon name={copied ? "Check" : "Copy"} size={18} />}
      label={copied ? "已复制" : "复制计划"}
      tipSide="bottom"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    />
  );
}

function PlanPane({ thread }: { thread: ThreadState }) {
  const threadId = thread.meta.id;
  // The latest update_plan among the loaded turns (store.ts recordTodo).
  const todos = useStore((s) => s.todoUpdates[threadId]);
  const steps = todos?.findLast((update) => thread.turns.some((turn) => turn.id === update.turnId))?.steps ?? [];
  const proposal = latestPlanText(thread);
  const { goal } = thread;
  // cccc2cf0a Gb: comments while the plan waits on the card or the session is in plan mode.
  const commenting = useStore((s) => thread.planMode || waitingPlan(s.threads[threadId], s.settledQuestions) !== null);
  const page = useRef<HTMLDivElement>(null);
  // cccc2cf0a Hb: no plan in what has loaded, so earlier turns are read for one.
  const reading = !proposal && steps.length === 0 && !!thread.olderCursor;
  useEffect(() => {
    if (reading && !thread.loading && !thread.olderError) void loadTurns(threadId, true).catch(() => {});
  }, [reading, thread.loading, thread.olderError, threadId]);
  const empty = () =>
    reading && thread.olderError ? (
      <PaneEmpty icon={<Icon name="Warning" size="lg" />} title="无法加载更早的消息" body="如果 Codex 之前在此会话中编写过计划，该计划无法在此处显示。">
        <Button variant="secondary" onClick={() => void loadTurns(threadId, true).catch(() => {})}>
          重试
        </Button>
      </PaneEmpty>
    ) : reading ? (
      <PaneEmpty icon={<Spinner size={20} />} title="正在加载…" />
    ) : (
      <PaneEmpty icon={<Icon name="Checklist" size="lg" />} title="暂无计划" body="Codex 会在探索过程中将计划写在此处。继续对话。" />
    );
  return (
    <PaneFrame view={threadId} pane="plan" trailing={proposal ? <CopyPlan text={proposal} /> : undefined}>
      {!proposal && steps.length === 0 && !goal ? (
        empty()
      ) : (
        <div ref={page} className="plan-page scroll-fade-y">
          <div className="plan-col">
            {goal && <GoalSection threadId={threadId} goal={goal} />}
            {proposal && <PlanDoc threadId={threadId} text={proposal} enabled={commenting} boundary={page} />}
            {steps.length > 0 && (
              <section className="plan-tasks">
                <h2 className="plan-h2">任务</h2>
                <TodoList steps={steps} />
              </section>
            )}
          </div>
        </div>
      )}
    </PaneFrame>
  );
}

// ---------------------------------------------------------------------------
// 后台任务: Claude's session-presets path (cccc2cf0a cE / SE / hD line).
export function BackgroundTitle({ title, rail = false }: { title: string; rail?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => setClipped(node.scrollWidth > node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [title]);
  return <span ref={element} className={rail ? "rail-label bg-title" : "bg-task-title bg-title"} data-tip={clipped ? title : undefined} data-tip-multiline={clipped ? "" : undefined} data-tip-lines={rail ? "4" : undefined}>{title}</span>;
}

function BackgroundPane({ thread }: { thread: ThreadState }) {
  const agent = useBackgroundView(thread.meta.id).agents.at(-1);
  return agent ? <AgentRecord key={agent} sessionId={thread.meta.id} agentId={agent} /> : <BackgroundList thread={thread} />;
}

const NO_NOTICES: Notice[] = [];
const NO_SHELLS: ShellTask[] = [];
const NO_IDS = new Set<string>();

/**
 * The task a session gave a sub-agent: its spawn call's prompt (a MultiAgentV2 agent's thread has no user message).
 * ponytail: a MultiAgentV2 spawn is a bare subAgentActivity and its task only a rollout agent_message (encrypted_content),
 * so its record opens with no task; show it once app-server puts the NEW_TASK message on an item.
 */
function spawnPrompt(threads: Record<string, ThreadState>, agentId: string): string {
  const parent = threads[agentId]?.meta.parentThreadId;
  for (const turn of (parent && threads[parent]?.turns) || []) {
    for (const item of turn.items) if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent" && item.receiverThreadIds.includes(agentId)) return item.prompt?.trim() ?? "";
  }
  return "";
}

/**
 * A sub-agent's record over the task list (cccc2cf0a pF → wP / PP): 返回 and its name in the head;
 * read-only and live; the task it was given as your message, 模型 {model} under it, its turns, then
 * thinking while it runs, or once it ends its tally and, with no reply, 无结果——任务….
 */
function AgentRecord({ sessionId, agentId }: { sessionId: string; agentId: string }) {
  const thread = useStore((s) => s.threads[agentId]);
  const given = useStore((s) => spawnPrompt(s.threads, agentId));
  const waiting = useStore((s) => s.requests.flatMap((request) => {
    const itemId = (request.params as { itemId?: string }).itemId;
    return requestThreadId(request) === agentId && itemId ? [itemId] : [];
  }).join("\n"));
  const name = useAgentName(agentId);
  const page = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => { void loadAgent(agentId); }, [agentId]);
  const pendingItems = useMemo(() => (waiting ? new Set(waiting.split("\n")) : NO_IDS), [waiting]);
  const turns = thread?.turns ?? [];
  // The first user message is the task (MultiAgentV1); it opens the record, the model under it.
  const first = turns[0];
  const asked = first?.items.find((item): item is ItemOf<"userMessage"> => item.type === "userMessage");
  const opening = useMemo(() => (first && asked ? { ...first, items: first.items.filter((item) => item !== asked) } : first), [first, asked]);
  const task: ItemOf<"userMessage"> | undefined = asked ?? (given ? { type: "userMessage", id: `${agentId}:task`, clientId: null, content: [{ type: "text", text: given, text_elements: [] }] } : undefined);
  const status = thread ? agentRunStatus(thread) : "unknown";
  const live = status === "running";
  const activity = agentActivity(thread);
  const tokens = thread?.tokenUsage?.total.totalTokens;
  const spent = turns.reduce((sum, turn) => sum + (turn.durationMs ?? 0), 0);
  const replied = turns.at(-1)?.items.some((item) => item.type === "agentMessage" && item.text.trim()) ?? false;
  // dAbHM3tAVv: {n} 次工具调用 · {tokens} 个 token · {duration}, each part only once known.
  const tally = [activity && `${activity.toolCalls} 次工具调用`, tokens ? `${formatTokens(tokens)} 个 token` : null, spent ? formatDuration(spent) : null].filter(Boolean).join(" · ");
  const model = thread?.meta.model ?? "";
  useLayoutEffect(() => {
    const node = page.current;
    if (node && following.current) node.scrollTop = node.scrollHeight;
  });
  const back = (
    <span className="agent-record-title">
      <Button variant="ghost" icon={<Icon name="ArrowLeft" size={18} />} label="返回" tipSide="bottom" onClick={() => popAgent(sessionId)} />
      <span className="pane-name">{name}</span>
    </span>
  );
  const shown = !!task || turns.some((turn) => turn.items.length > 0);
  return (
    <PaneFrame view={sessionId} pane="background" title={back}>
      {!shown ? (
        thread?.loadError ? <PaneEmpty title="暂无活动" body={thread.loadError} /> : <PaneEmpty icon={thread?.loaded ? undefined : <Spinner size={20} />} title="暂无活动" />
      ) : (
        <div
          ref={page}
          className="agent-record scroll-fade-y"
          onScroll={(event) => {
            const node = event.currentTarget;
            following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          }}
        >
          <div className="transcript-list agent-record-list">
            {task && <div className="turn-prompt"><UserBubble item={task} /></div>}
            {model && <p className="agent-record-model">模型 <span>{modelLabel(model)}</span></p>}
            {turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn === first && opening ? opening : turn}
                threadId={agentId}
                cwd={thread?.meta.cwd ?? ""}
                timing={thread?.timing ?? {}}
                pendingItems={pendingItems}
                idle={false}
                model={model}
                fresh={NO_IDS}
                notices={NO_NOTICES}
                progress={thread?.progress ?? {}}
                forkBase={undefined}
                catching={false}
                answered=""
                shells={NO_SHELLS}
                readOnly
              />
            ))}
            {live ? (
              <ShimmerText className="agent-record-live">思考中</ShimmerText>
            ) : (
              <>
                {!replied && <p className="agent-record-end">无结果——任务{status === "failed" ? "失败" : status === "stopped" ? "已停止" : "已结束"}</p>}
                {tally && <p className="agent-record-end">{tally}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </PaneFrame>
  );
}

function BackgroundList({ thread }: { thread: ThreadState }) {
  const id = thread.meta.id;
  const { tasks, groups, view } = useBackgroundTasks(thread);
  const page = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(10);
  const now = useNow(tasks.some((task) => task.status === "running"));
  useEffect(() => { void refreshBackground(id); }, [id]);
  useLayoutEffect(() => {
    if (!view.focus) return;
    const row = page.current?.querySelector<HTMLElement>(`[data-background-key="${CSS.escape(view.focus)}"]`);
    if (row) {
      row.scrollIntoView({ block: "start" });
      updateBackgroundView(id, { focus: null });
    }
  }, [id, view.focus, view.finished, view.open, tasks]);
  const clear = () => updateBackgroundView(id, {
    dismissed: [...view.dismissed, ...groups.finished.flatMap((family) => [family.task, ...family.children].map(backgroundDismissalKey))],
  });
  const family = (item: TaskFamily) => <BackgroundFamily key={item.task.key} family={item} threadId={id} open={view.open} now={now} />;
  const failures = new Set(groups.finished.filter((item) => [item.task, ...item.children].some((task) => task.status === "failed")).slice(0, 100));
  const finished = groups.finished.filter((item, index) => index < limit || failures.has(item) || [item.task, ...item.children].some((task) => view.open.includes(task.key)));
  return (
    <PaneFrame view={id} pane="background" trailing={<Button variant="ghost" icon={<Icon name="Trash" size={18} />} label="清除已完成任务" disabled={groups.finished.length === 0} onClick={clear} />}>
      {tasks.length === 0 ? <PaneEmpty icon={<Icon name="AgentsSimple" size="lg" />} title="后台任务显示在此处" /> : (
        <div ref={page} className="bg-page scroll-fade-y">
          {groups.running.length > 0 && <section className="bg-section"><h3 className="bg-heading">运行中</h3><div className="bg-list">{groups.running.map(family)}</div></section>}
          {groups.unknown.length > 0 && <section className="bg-section"><h3 className="bg-heading">状态未知</h3><div className="bg-list">{groups.unknown.map(family)}</div></section>}
          {groups.finished.length > 0 && <section className="bg-section">
            <button type="button" className="bg-heading bg-finished" aria-expanded={view.finished} onClick={() => updateBackgroundView(id, { finished: !view.finished })}>已完成 {groups.finished.length}<Icon name="CaretRight" size="xs" /></button>
            {view.finished && <div className="bg-list">{finished.map(family)}
              {finished.length < groups.finished.length && <button type="button" className="rail-more" onClick={() => setLimit((value) => value + 100)}>显示更多</button>}
            </div>}
          </section>}
        </div>
      )}
    </PaneFrame>
  );
}

function BackgroundFamily({ family, threadId, open, now }: { family: TaskFamily; threadId: string; open: string[]; now: number }) {
  const { task, children } = family;
  const expanded = open.includes(task.key);
  const ended = children.filter((child) => child.status === "completed" || child.status === "stopped").reverse().sort((a, b) => (b.completedAt ?? -Infinity) - (a.completedAt ?? -Infinity));
  const important = children.filter((child) => !ended.includes(child));
  const visible = family.live ? important : [...important, ...ended];
  const failed = [task, ...children].filter((child) => child.status === "failed").length;
  const finishedKey = `${task.key}/finished`;
  const row = (child: BackgroundTask) => <BackgroundTaskRow key={child.key} task={child} threadId={threadId} open={open.includes(child.key)} now={now} nested />;
  return <div className="bg-family">
    <BackgroundTaskRow task={task} threadId={threadId} open={expanded} now={now} childCount={children.length} />
    {children.length > 0 && <>
      <button type="button" className="bg-family-toggle" aria-expanded={expanded} onClick={() => toggleBackgroundTask(threadId, task.key)}>
        {children.length} 项任务{children.some((child) => child.status === "running") && ` · ${children.filter((child) => child.status === "running").length} 项运行中`}{failed > 0 && ` · ${failed} 项失败`}<Icon name="CaretRight" size="xs" />
      </button>
      {expanded && <div className="bg-children">{visible.map(row)}
        {family.live && ended.length > 0 && <><button type="button" className="bg-heading bg-finished" aria-expanded={open.includes(finishedKey)} onClick={() => toggleBackgroundTask(threadId, finishedKey)}>已完成 {ended.length}<Icon name="CaretRight" size="xs" /></button>{open.includes(finishedKey) && ended.map(row)}</>}
      </div>}
    </>}
  </div>;
}

function BackgroundTaskRow({ task, threadId, open, now, nested = false, childCount = 0 }: { task: BackgroundTask; threadId: string; open: boolean; now: number; nested?: boolean; childCount?: number }) {
  const busy = useStopping().has(task.key);
  const running = task.status === "running";
  const duration = running && task.startedAt !== undefined ? now - task.startedAt : task.kind === "shell" ? task.durationMs : task.completedAt !== undefined && task.startedAt !== undefined ? task.completedAt - task.startedAt : undefined;
  const stopped = task.status === "failed" || task.status === "stopped" || task.status === "unknown";
  const toggle = () => toggleBackgroundTask(threadId, task.key);
  const stop = () => void stopBackgroundTask(task);
  return <div className="bg-task" data-background-key={task.key} data-nested={nested || undefined}>
    <div className="bg-task-main">
      <div className="bg-task-row">
        {/* QM: an agent's line opens its record (查看记录, tS1eQb8Kqr / Mf532BYrge). */}
        <button
          type="button"
          className="bg-task-toggle"
          aria-expanded={task.kind === "shell" && childCount === 0 ? open : undefined}
          aria-label={task.kind === "agent" ? `查看 ${task.title} 的记录` : `后台任务：${task.title}`}
          data-tip={task.kind === "agent" ? "查看记录" : undefined}
          onClick={task.kind === "agent" ? () => showAgent(threadId, task.threadId) : childCount === 0 ? toggle : undefined}
        >
          <BackgroundTitle title={task.title} />
          {task.kind === "agent" && <Icon name="ArrowUpRight" size="xs" className="bg-task-caret" />}
        </button>
        {busy ? <span className="bg-task-state">正在停止…</span> : stopped ? <span className="bg-task-state" data-tone={task.status === "failed" ? "danger" : undefined}>{AGENT_TASK_STATUS[task.status]}</span> : duration !== undefined && <span className="bg-task-duration tabular">{formatDuration(duration)}</span>}
        {running ? <Button variant="ghost" size="xs" icon={busy ? <Spinner size={12} /> : <Icon name="Stop" size={14} />} label={busy ? "正在停止…" : "停止此任务"} disabled={busy} onClick={stop} /> : task.kind === "shell" && childCount === 0 && <button type="button" className="bg-detail-toggle" aria-label={open ? "收起任务详情" : "展开任务详情"} aria-expanded={open} onClick={toggle}><Icon name="CaretRight" size="xs" /></button>}
      </div>
      {task.kind === "agent" && <AgentTaskMeta threadId={task.threadId} model={task.model} running={running} />}
    </div>
    {open && task.kind === "shell" && <TaskOutput taskKey={task.key} command={task.command} output={task.output} />}
  </div>;
}

/** QM's meta for an agent: its model, tokens and tool uses, and while it runs its latest tool (UM). */
function AgentTaskMeta({ threadId, model, running }: { threadId: string; model: string | null; running: boolean }) {
  const child = useStore((s) => s.threads[threadId]);
  const activity = agentActivity(child);
  const tokens = child?.tokenUsage?.total.totalTokens;
  const parts = [
    model && modelLabel(model),
    tokens ? `${formatTokens(tokens)} 个 token` : null,
    activity?.toolCalls ? `${activity.toolCalls} 次工具使用` : null,
    running ? activity?.lastTool : null,
  ].filter(Boolean);
  return parts.length ? <span className="bg-task-model">{parts.join(" · ")}</span> : null;
}

/** Full commands wrap; output keeps a bounded tail and follows only while the reader is at its end. */
function TaskOutput({ taskKey, command, output }: { taskKey: string; command: string; output: string }) {
  const pre = useRef<HTMLPreElement>(null);
  const position = useMemo(() => backgroundOutputPosition(taskKey), [taskKey]);
  const tail = output.slice(-8000);
  useLayoutEffect(() => {
    const node = pre.current;
    if (node && !position.following) node.scrollTop = position.top;
    return () => { if (node) position.top = node.scrollTop; };
  }, [position]);
  useLayoutEffect(() => {
    const node = pre.current;
    if (!node) return;
    const follow = () => {
      const selection = document.getSelection();
      const selecting = selection && !selection.isCollapsed && (node.contains(selection.anchorNode) || node.contains(selection.focusNode));
      if (position.following && !selecting) node.scrollTop = node.scrollHeight;
      else if (!position.following) node.scrollTop = position.top;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(node);
    // Lazy-loaded mono fonts can change scroll height after the first output has rendered.
    document.fonts.addEventListener("loadingdone", follow);
    return () => { observer.disconnect(); document.fonts.removeEventListener("loadingdone", follow); };
  }, [output, position]);
  return <div className="bg-task-detail">
    <pre className="bg-task-code" role="region" tabIndex={0} aria-label={`${command} 的命令`}>{command}</pre>
    {output.length > tail.length && <span className="bg-task-note">更早的输出未显示</span>}
    {output ? <pre ref={pre} className="bg-task-code bg-task-output" role="region" tabIndex={0} aria-label="任务输出" onScroll={(event) => { const node = event.currentTarget; position.following = node.scrollHeight - node.scrollTop - node.clientHeight < 16; position.top = node.scrollTop; }}>{tail}</pre> : <span className="bg-task-note">暂无输出</span>}
  </div>;
}
