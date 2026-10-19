// Right-hand panes beside the chat (lib/panes.ts; Claude Desktop 2.42304.0.0 tiles; the session
// rail inside the chat tile is Rail.tsx): the column of open panes with
// draggable edges, the pane chrome (c4db265df Bt: a 2rem head with ⋮「{pane}设置」, 展开 /
// 收起 and 关闭), and the 更改 (cccc2cf0a qO diff branch), 计划 (cccc2cf0a Iv) and 后台任务
// (cccc2cf0a kD) panes. The 文件 and 终端 panes live in FilePreview.tsx and Terminal.tsx.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { cleanBackground, clearGoal, errorMessage, optional, refreshBackground, setGoalStatus, terminateBackground } from "../lib/codex";
import { filesStats, parseDiff, splitUnifiedDiff, turnFiles, type FileDiff } from "../lib/diff";
import { basename, formatDuration, formatTokens, parentDir, relativePath, threadTitle } from "../lib/format";
import { highlight } from "../lib/markdown";
import {
  NO_PANES,
  PANE_NAMES,
  activePane,
  closeActivePane,
  closePane,
  columnFlex,
  ignoreWhitespace,
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
import { getState, toast, useStore, writePref, type PaneId, type ThreadState } from "../lib/store";
import { setComposerDraft } from "./Composer";
import { DiffView, FileDiffCard, FileLink, Markdown } from "./content";
import { FilesPane } from "./FilePreview";
import { MAC, TerminalPane } from "./Terminal";
import { Button, Icon, MenuItem, MenuSep, Popover, Spinner, Submenu, fileGlyph } from "./ui";
import type { GitDiffToRemoteResponse } from "@protocol/GitDiffToRemoteResponse";
import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { TurnPlanStep } from "@protocol/v2/TurnPlanStep";

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

/** Narrowest a pane or the chat gets from dragging an edge (shared-18 Tb minTileWidthPx). */
const MIN_TILE = 280;

export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function readJson<T extends object>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return value && typeof value === "object" ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}

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
            <div className="pane-slot" style={{ flexGrow: expanded ? 1 : rowFlex(pane) }}>
              {pane === "terminal" ? (
                <TerminalPane view={view} cwd={cwd} />
              ) : !thread ? null : pane === "diff" ? (
                <DiffPane thread={thread} />
              ) : pane === "files" ? (
                <FilesPane thread={thread} />
              ) : pane === "plan" ? (
                <PlanPane thread={thread} />
              ) : (
                <BackgroundPane thread={thread} />
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
        <div className="pane-title">{title ?? <span className="pane-name">{name}</span>}</div>
        <div className="pane-actions">
          {trailing}
          {menu && (
            <Popover
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              placement="bottom-end"
              anchor={<Button variant="ghost" icon={<Icon name="DotsVertical" size={18} />} label={`${name}设置`} tipSide="bottom" onClick={() => setMenuOpen(!menuOpen)} />}
            >
              {menu(() => setMenuOpen(false))}
            </Popover>
          )}
          <Button
            variant="ghost"
            icon={<Icon name={expanded ? "Collapse" : "Expand"} size={18} />}
            label={expanded ? "收起" : "展开"}
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
        <div className="menu-note">还没有可显示的文件。输入以搜索。</div>
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
let diffPrefs: DiffPrefs = readJson<DiffPrefs>(DIFF_KEY, { files: false, split: false, wrap: true, ws: false, list: 220 });

/** Narrower than this, 并排显示 falls back to one column (c44d00c7f Dl). */
const SPLIT_MIN = 640;
/** More files than this start collapsed. */
const OPEN_FILES = 4;

type Remote = { status: "error" } | { status: "ready"; sha: string; files: FileDiff[] };

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
      (): Remote => ({ status: "error" }),
    )
    .then((remote) => {
      reading.delete(cwd);
      remotes.set(cwd, remote);
      remoteChanged();
    });
}

export function useRemoteDiff(cwd: string): Remote | null {
  useSyncExternalStore(subscribeRemote, () => remoteVersion);
  return remotes.get(cwd) ?? null;
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
    writePref(DIFF_KEY, JSON.stringify(diffPrefs));
    setPrefsState(diffPrefs);
  };

  const turns = useMemo(() => thread.turns.map((turn) => ({ turn, files: turnFiles(turn, cwd) })).filter((entry) => entry.files.length > 0), [thread.turns, cwd]);
  const picked = scope.kind === "turn" ? (turns.find((entry) => entry.turn.id === scope.id) ?? turns.at(-1)) : undefined;
  const raw = scope.kind === "all" ? (remote?.status === "ready" ? remote.files : []) : (picked?.files ?? []);
  const files = useMemo(() => (prefs.ws ? raw.map((file) => (file.whole ? file : { ...file, diff: ignoreWhitespace(file.diff) })) : raw), [raw, prefs.ws]);
  const stats = filesStats(files);

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
      const wantedScope = takePendingScope();
      if (wantedScope) {
        setScope(wantedScope === "all" ? { kind: "all" } : { kind: "turn", id: null });
        setFocus(null);
      }
      const wanted = takePendingDiff();
      if (!wanted) return;
      const target = relativePath(wanted, cwd).replace(/\\/g, "/");
      const same = (path: string) => {
        const p = path.replace(/\\/g, "/");
        return p === target || target.endsWith(`/${p}`) || p.endsWith(`/${target}`);
      };
      // A moved file's card goes by where it went, as an edit row names it; a tool summary names
      // where it came from.
      const final = (file: FileDiff) => file.movePath ?? file.path;
      const match = (file: FileDiff) => same(final(file)) || same(file.path);
      const hit = turnsRef.current.findLast((entry) => entry.files.some(match));
      if (!hit) return;
      setScope({ kind: "turn", id: hit.turn.id });
      reveal(final(hit.files.find((file) => same(final(file))) ?? hit.files.find(match)!));
    };
    apply();
    window.addEventListener("codex:open-diff", apply);
    return () => window.removeEventListener("codex:open-diff", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the latest turns through the ref
  }, [cwd]);
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
          <Button variant="ghost" className="diff-scope" aria-label={`更改范围：${scopeLabel}`} onClick={() => setScopeOpen(!scopeOpen)}>
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
      <MenuItem label="并排显示" hint={prefs.split && narrow ? "需要更宽的窗格" : undefined} toggle checked={prefs.split} onClick={() => setPrefs({ split: !prefs.split })} />
      <MenuItem label="自动换行" toggle checked={prefs.wrap} onClick={() => setPrefs({ wrap: !prefs.wrap })} />
      <MenuItem label="隐藏空白更改" toggle checked={prefs.ws} onClick={() => setPrefs({ ws: !prefs.ws })} />
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
  if (scope.kind === "all" && !git) content = <PaneEmpty title="更改需要 Git 仓库" />;
  else if (scope.kind === "all" && remote === null) content = <PaneEmpty icon={<Spinner size={20} />} title="正在加载更改" />;
  else if (scope.kind === "all" && remote?.status === "error") content = <PaneEmpty title="无法加载更改" />;
  else if (files.length === 0) content = <PaneEmpty title="没有可显示的更改" />;
  else
    content = (
      <div className="diff-pane-main">
        {prefs.files && (
          <>
            <nav ref={list} className="diff-files scroll-fade-y" aria-label="已更改的文件" style={{ width: prefs.list }}>
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
              label="调整文件列表的大小"
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
          {fold.open === null && files.length > OPEN_FILES && <p className="diff-pane-note">大型差异中的文件已折叠。选择一个文件即可展开。</p>}
          {files.map((file) => {
            const path = file.movePath ?? file.path;
            const shownOpen = focus?.path === path ? true : collapsed;
            const key = `${path}:${fold.epoch}:${focus?.path === path ? focus.nonce : 0}:${split}`;
            return (
              <div key={path} data-diff-path={path}>
                {split ? <SplitFileDiff key={key} file={file} defaultOpen={shownOpen} /> : <FileDiffCard key={key} file={file} defaultOpen={shownOpen} />}
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
function SplitFileDiff({ file, defaultOpen }: { file: FileDiff; defaultOpen: boolean }) {
  const rows = useMemo(() => splitRows(parseDiff(file.diff, file.kind, file.whole)), [file.diff, file.kind, file.whole]);
  // As FileDiffCard: a head with no lines under it opens nothing.
  const lines = rows.length > 0;
  const [picked, setPicked] = useState(defaultOpen);
  const open = lines && picked;
  const stats = filesStats([file]);
  const path = file.movePath ?? file.path;
  const language = basename(path).toLowerCase().split(".").pop();
  return (
    <div className={`file-diff ${open ? "open" : ""}`}>
      <div className="file-diff-head" onClick={lines ? () => setPicked(!open) : undefined}>
        <button
          type="button"
          className="file-diff-toggle"
          aria-expanded={lines ? open : undefined}
          aria-disabled={!lines || undefined}
          aria-label={open ? "收起差异" : "展开差异"}
        >
          <Icon name="CaretRight" size="sm" className="tool-caret" />
          <Icon name={fileGlyph(path)} size="xs" className={`file-kind file-kind-${file.kind}`} />
        </button>
        <FileLink path={path} className="file-path">
          {file.movePath ? `${file.path} → ${file.movePath}` : file.path}
        </FileLink>
        {file.binary && <span className="file-diff-label">二进制文件</span>}
        <span className="diff-stat">
          <span className="plus">+{stats.added}</span>
          <span className="minus">−{stats.removed}</span>
        </span>
      </div>
      {open &&
        (rows.length > MAX_SPLIT_ROWS ? (
          // Too big for rows: the shared view shows the removed and the added text apart.
          <DiffView diff={file.diff} path={path} kind={file.kind} whole={file.whole} />
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
  usageLimited: "额度受限",
  budgetLimited: "预算用尽",
  complete: "已完成",
};

function latestPlanText(thread: ThreadState): string | null {
  for (let t = thread.turns.length - 1; t >= 0; t -= 1) {
    const item = thread.turns[t].items.findLast((entry): entry is Extract<ThreadItem, { type: "plan" }> => entry.type === "plan" && !!entry.text.trim());
    if (item) return item.text;
  }
  return null;
}

/** Task rows (cb6930dae Lu / ua): a 16px status cell, then the step; done steps struck through. */
function TodoList({ steps }: { steps: TurnPlanStep[] }) {
  return (
    <ul className="plan-todos">
      {steps.map((step, index) => (
        <li key={index} className="plan-todo" data-status={step.status}>
          <span className="plan-todo-icon">
            {step.status === "completed" ? <Icon name="Check" size="sm" /> : step.status === "inProgress" ? <Spinner size={12} inherit /> : <Icon name="Placeholder" size="sm" />}
            <span className="sr-only">{step.status === "completed" ? "已完成" : step.status === "inProgress" ? "进行中" : "未完成"}</span>
          </span>
          <span className="plan-todo-text">{step.step}</span>
        </li>
      ))}
    </ul>
  );
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
          {more ? "显示更少" : "显示更多"}
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
  const steps = thread.turns.findLast((turn) => turn.plan)?.plan?.steps ?? [];
  const proposal = latestPlanText(thread);
  const { goal } = thread;
  return (
    <PaneFrame view={thread.meta.id} pane="plan" trailing={proposal ? <CopyPlan text={proposal} /> : undefined}>
      {!proposal && steps.length === 0 && !goal ? (
        <PaneEmpty icon={<Icon name="Checklist" size="lg" />} title="还没有计划" body="Codex 在探索时会把计划写在这里。请继续对话。" />
      ) : (
        <div className="plan-page scroll-fade-y">
          <div className="plan-col">
            {goal && <GoalSection threadId={thread.meta.id} goal={goal} />}
            {proposal && <Markdown text={proposal} className="plan-doc" />}
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
// 后台任务 (Background tasks): the agent's background terminals (thread/backgroundTerminals/*),
// as cccc2cf0a hD's card rows; the output is the command item's (item/commandExecution/outputDelta).

function commandItem(thread: ThreadState, itemId: string): Extract<ThreadItem, { type: "commandExecution" }> | undefined {
  for (let t = thread.turns.length - 1; t >= 0; t -= 1) {
    const item = thread.turns[t].items.find((entry) => entry.id === itemId);
    if (item?.type === "commandExecution") return item;
  }
  return undefined;
}

function BackgroundPane({ thread }: { thread: ThreadState }) {
  const id = thread.meta.id;
  const tasks = thread.background;
  const [stopping, setStopping] = useState<string[]>([]);
  const [opened, setOpened] = useState<string[]>([]);
  const [said, setSaid] = useState("");
  const now = useNow(tasks.length > 0);
  useEffect(() => {
    void refreshBackground(id);
  }, [id]);
  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(""), 5000);
    return () => clearTimeout(timer);
  }, [said]);
  const stop = (processId: string) => {
    setStopping((list) => [...list, processId]);
    terminateBackground(id, processId)
      .then(() => setSaid("任务已停止"), fail("停止失败"))
      .finally(() => setStopping((list) => list.filter((other) => other !== processId)));
  };
  return (
    <PaneFrame
      view={id}
      pane="background"
      trailing={
        // Codex-only: thread/backgroundTerminals/clean stops them all (the CLI's /stop).
        tasks.length > 1 && <Button variant="ghost" icon={<Icon name="StopCircle" size={18} />} label="停止所有后台任务" tipSide="bottom" onClick={() => cleanBackground(id).catch(fail("停止失败"))} />
      }
    >
      <span role="status" className="sr-only">
        {said}
      </span>
      {tasks.length === 0 ? (
        <PaneEmpty icon={<Icon name="AgentsSimple" size="lg" />} title="后台任务会显示在这里" />
      ) : (
        <div className="bg-page scroll-fade-y">
          <section className="bg-section">
            <h3 className="bg-heading">运行中</h3>
            <div className="bg-list">
              {tasks.map((task) => {
                const item = commandItem(thread, task.itemId);
                const started = thread.timing[task.itemId]?.[0];
                const open = opened.includes(task.processId);
                const busy = stopping.includes(task.processId);
                return (
                  <div key={task.processId} className="bg-task" data-task-id={task.processId}>
                    <div className="bg-task-main">
                      <div className="bg-task-row">
                        <button
                          type="button"
                          className="bg-task-toggle"
                          aria-expanded={open}
                          aria-label={`后台任务：${task.command}`}
                          onClick={() => setOpened((list) => (open ? list.filter((other) => other !== task.processId) : [...list, task.processId]))}
                        >
                          <span className="bg-task-title">{task.command}</span>
                          <Icon name="CaretRight" size="xs" className="bg-task-caret" />
                        </button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={busy ? <Spinner size={12} /> : <Icon name="Stop" size={14} />}
                          label={busy ? "正在停止…" : "停止此任务"}
                          tipSide="bottom"
                          disabled={busy}
                          onClick={() => stop(task.processId)}
                        />
                      </div>
                      <span className="bg-task-meta">
                        <span className="bg-task-kind">Shell</span>
                        {busy && <span>正在停止…</span>}
                        {started ? (
                          <span className="tabular">{formatDuration(now - started)}</span>
                        ) : (
                          // No start time (opened later): the CPU share stands in for the running time.
                          task.cpuPercent !== null && <span className="tabular">CPU {Math.round(task.cpuPercent)}%</span>
                        )}
                      </span>
                    </div>
                    {open && <TaskOutput command={task.command} output={item?.aggregatedOutput ?? ""} />}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </PaneFrame>
  );
}

/** The command and its output (cccc2cf0a qE / KE): 200px tall at most, kept at the bottom. */
function TaskOutput({ command, output }: { command: string; output: string }) {
  const pre = useRef<HTMLPreElement>(null);
  useLayoutEffect(() => {
    if (pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [output]);
  return (
    <div className="bg-task-detail">
      <pre className="bg-task-code" role="region" tabIndex={0} aria-label={`${command} 的命令`}>
        {command}
      </pre>
      {output ? (
        <pre ref={pre} className="bg-task-code bg-task-output" role="region" tabIndex={0} aria-label={`${command} 的输出`}>
          {output}
        </pre>
      ) : (
        <span className="bg-task-note">还没有输出</span>
      )}
    </div>
  );
}
