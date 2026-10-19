// The dframe sidebar, Code tab only (Claude Desktop 2.42304.0.0 ion-dist shared-18 / 19 / 20 /
// 21 / 22, ce4f4374c and shared-styles): title row, search, nav rows, then Pinned and the list
// grouped by folder, date, custom group or not at all, rows in their families, and the user
// menu. With claudeai_cc_epitaxy_session_presets_main off (shared-11 rc(), the baseline) the
// Code list takes the classic path: no data-code-list, the Filter menu (shared-21 iU classic),
// rows led by their status glyph (shared-21 Dq / bq "leading"). Modes: docked, peek (collapsed
// or a narrow window: the switch or a hover floats it out, shared-52 rh()) and the phone sheet
// (browser, < 40rem).

import type { ServerRequest } from "@protocol/ServerRequest";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  activeTurn,
  archiveThread,
  deleteThread,
  ensureThreads,
  errorMessage,
  forkThread,
  isArchivedThread,
  logout,
  markRead,
  markUnread,
  moveToSection,
  newChat,
  openThread,
  refreshThreads,
  renameThread,
  requestThreadId,
  setListFilter,
  setThreadProject,
  unarchiveThread,
  updateSection,
} from "../lib/codex";
import { threadTitle } from "../lib/format";
import { dateBuckets, familyOrder, folderBuckets, rangeIds, type SessionSort } from "../lib/session";
import { getState, isUnread, readPref, setState, toast, useStore, writePref, type AppState, type StatusFilter, type ThreadState } from "../lib/store";
import { openPalette, shortcutLabel } from "./Palette";
import { openSettings } from "./Settings";
import { Button, Dialog, Icon, MenuItem, MenuSection, MenuSep, Popover, StatusDot, Submenu } from "./ui";

const DRAG_TYPE = "application/x-codex-thread";
const WIDTH_KEY = "codex-ui:sidebar-width";
const OPEN_KEY = "codex-ui:sidebar";
// shared-52 Yu / $u: at least 200 (the title row's own floor), at most 420 and 330 short of the window.
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 288;
const DESKTOP = typeof window !== "undefined" && !!window.codexDesktop;
const HELP_URL = "https://developers.openai.com/codex";
const CHANGELOG_URL = "https://github.com/openai/codex/releases";
const BODY_ID = "sidebar-body";
const PINNED = "pinned";
const RECENTS = "recents";
/** Rows a list or a group shows, and how many more each "再显示" adds (shared-22 Cj Sr2 / qk: 20). */
const TRUNCATE = 20;
/** shared-16 Lm: the peek closes 180ms after the pointer leaves, retrying while a menu or field holds it. */
const PEEK_CLOSE_MS = 180;

/** Section colors are Cove slots, stored by name so other clients can map them too. */
export const SECTION_COLORS = ["blue", "orange", "green", "yellow", "pink", "forest", "purple", "red"];

export function sectionColor(color: string | null | undefined): string | undefined {
  const index = SECTION_COLORS.indexOf(color ?? "");
  if (index >= 0) return `var(--cds-chart-${index + 1})`;
  return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}

export function SectionSwatch({ color }: { color: string | null | undefined }) {
  return <span className="section-swatch" style={{ background: sectionColor(color) }} aria-hidden="true" />;
}

const fail = (title: string) => (error: unknown) => toast("danger", title, errorMessage(error));

// ---------------------------------------------------------------------------
// Local state: pins, grouping, folds, selection and the peek

/** Filter ▸ Group by, classic (shared-21 oU xe2): State waits on claudeai_session_state (off). */
type GroupBy = "date" | "project" | "custom" | "none";

interface Local {
  /** Pinned session ids, top to bottom; kept locally like the package's starred-local-code-sessions. */
  pins: string[];
  /** Folded lists and groups. */
  collapsed: string[];
  groupBy: GroupBy;
  /** Filter ▸ Show empty groups (shared-16 sp(): off by default). */
  showEmpty: boolean;
  /** Rows revealed past the first twenty, by list or group. */
  more: Record<string, number>;
  selected: string[];
  anchor: string | null;
  peek: boolean;
  /** Groups created here, listed while empty until the next start (shared-22 Za()). */
  kept: string[];
  /** A session menu opened from outside the sidebar (openSessionMenu). */
  menu: { threadId: string; at: { x: number; y: number } } | null;
}

const PERSIST: Partial<Record<keyof Local, string>> = {
  pins: "codex-ui:pinned",
  collapsed: "codex-ui:collapsed-sections",
  groupBy: "codex-ui:group-by",
  showEmpty: "codex-ui:show-empty-groups",
};

function readJson(key: string | undefined): unknown {
  try {
    return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
  } catch {
    return null;
  }
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

// shared-52 _h(): the desktop app groups the Code list by folder, a browser does not group it.
const DEFAULT_GROUP_BY: GroupBy = DESKTOP ? "project" : "none";
const savedGroupBy = readJson(PERSIST.groupBy);

let local: Local = {
  pins: strings(readJson(PERSIST.pins)),
  collapsed: strings(readJson(PERSIST.collapsed)),
  groupBy: savedGroupBy === "date" || savedGroupBy === "project" || savedGroupBy === "custom" || savedGroupBy === "none" ? savedGroupBy : DEFAULT_GROUP_BY,
  showEmpty: readJson(PERSIST.showEmpty) === true,
  more: {},
  selected: [],
  anchor: null,
  peek: false,
  kept: [],
  menu: null,
};
const localListeners = new Set<() => void>();

function setLocal(patch: Partial<Local>) {
  local = { ...local, ...patch };
  for (const key of Object.keys(patch) as (keyof Local)[]) {
    const storageKey = PERSIST[key];
    if (storageKey) writePref(storageKey, JSON.stringify(local[key]));
  }
  for (const listener of localListeners) listener();
}

function subscribeLocal(listener: () => void) {
  localListeners.add(listener);
  return () => localListeners.delete(listener);
}

/** Select a slice of the local state; return stable references. */
function useLocal<T>(select: (state: Local) => T): T {
  return useSyncExternalStore(subscribeLocal, () => select(local));
}

function toggleCollapsed(key: string) {
  setLocal({ collapsed: local.collapsed.includes(key) ? local.collapsed.filter((x) => x !== key) : [...local.collapsed, key] });
}

function setPinned(ids: string[], on: boolean) {
  const rest = local.pins.filter((id) => !ids.includes(id));
  setLocal({ pins: on ? [...rest, ...ids] : rest });
}

function movePin(id: string, by: -1 | 1) {
  const pins = [...local.pins];
  const at = pins.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= pins.length) return;
  [pins[at], pins[to]] = [pins[to], pins[at]];
  setLocal({ pins });
}

function clearSelection() {
  if (local.selected.length) setLocal({ selected: [] });
}

/** Archived in the list on screen: the Archived filter, or All with a session from the archive. */
function archivedNow(id: string, status: StatusFilter = getState().list.status): boolean {
  return status === "archived" || (status === "all" && isArchivedThread(id));
}

// ---------------------------------------------------------------------------
// Mode: narrow viewports force the sidebar closed (shared-52 Zu(): max(700, width + 329)px) and
// the switch floats it out as the peek, as hovering does while it is collapsed.

const narrowQuery = (width: number) => `(max-width: ${Math.max(700, Math.ceil(width) + 329)}px)`;

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    if (value) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
  } catch {
    // Private mode: start at the default width.
  }
  return DEFAULT_WIDTH;
}

// The store starts from the same key (store.ts); narrow screens override it below.
const openPref = () => readPref(OPEN_KEY, ["open", "collapsed"], "open") === "open";

// A narrow window starts collapsed rather than folding away after the first paint.
let narrowNow = typeof window !== "undefined" && matchMedia(narrowQuery(readWidth())).matches;
if (narrowNow) setState({ sidebarOpen: false });
let phoneNow = false;
let peekTimer = 0;
// shared-52 keeps hovering and peeked apart: a peek the switch opened stays when the pointer leaves.
let peekPinned = false;

function setPeek(open: boolean, pinned = false) {
  clearTimeout(peekTimer);
  peekPinned = open && pinned;
  if (local.peek !== open) setLocal({ peek: open });
}

function closePeekSoon() {
  clearTimeout(peekTimer);
  if (peekPinned) return;
  peekTimer = window.setTimeout(function attempt() {
    const focused = document.activeElement;
    const held = document.querySelector(".popover") !== null || (!!focused?.closest(".sidebar") && focused.matches("input, textarea"));
    if (held) peekTimer = window.setTimeout(attempt, PEEK_CLOSE_MS);
    else setPeek(false);
  }, PEEK_CLOSE_MS);
}

/** A mouse coming in opens the peek at once; leaving closes it after a short grace (the peek bridge). */
const peekHover = {
  onPointerEnter(event: PointerEvent) {
    clearTimeout(peekTimer);
    if (event.pointerType !== "mouse" || phoneNow || getState().sidebarOpen || local.peek) return;
    setPeek(true);
  },
  onPointerLeave(event: PointerEvent) {
    if (event.pointerType === "mouse" && local.peek) closePeekSoon();
  },
};

export function toggleSidebar() {
  // Narrow (shared-52 toggleCollapsed): only the peek changes; the remembered choice stays. A
  // peek the hover opened is kept by the press, a kept one closes.
  if (narrowNow || phoneNow) {
    setPeek(!(local.peek && peekPinned), true);
    return;
  }
  const open = !getState().sidebarOpen;
  setPeek(false);
  setState({ sidebarOpen: open });
  writePref(OPEN_KEY, open ? "open" : "collapsed");
}

/** After choosing a session: close the peek or the phone sheet. */
export function closeSidebarOnMobile() {
  setPeek(false);
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

// ---------------------------------------------------------------------------
// Layout: Pinned, then the list in family order (shared-21 rz() / az()), grouped by Filter ▸
// Group by: folders (shared-22 nT), date (vw), custom groups and Ungrouped (uw) or not at all (WC).

type Kind = "fork" | "spawn";

interface Row {
  thread: ThreadState;
  place: "flat" | "head" | "nested";
  parentTitle: string | null;
  kind: Kind | null;
  /** The family root this row hangs under (itself for a flat row or a head). */
  head: string;
}

interface Group {
  key: string;
  label: string;
  rows: Row[];
  /** A folder group: where a new session there starts. */
  folder?: string;
  /** A custom group: its section, or null for Ungrouped. */
  section?: ThreadSection | null;
}

interface ListShape {
  pinned: Row[];
  /** null: no grouping, one 最近 list. */
  groups: Group[] | null;
  rows: Row[];
}

/** A sub-agent hangs under the thread that spawned it, a fork under its source. */
function parentOf(thread: ThreadState): string | null {
  return thread.meta.parentThreadId ?? thread.meta.forkedFromId ?? null;
}

const recencyOf = (thread: ThreadState) => thread.meta.recencyAt ?? thread.meta.updatedAt;

function orderRows(group: ThreadState[], threads: Record<string, ThreadState>, sort: SessionSort): Row[] {
  let head = "";
  return familyOrder(
    group.map((thread) => ({
      id: thread.meta.id,
      title: threadTitle(thread.meta),
      recency: recencyOf(thread),
      created: thread.meta.createdAt,
      parent: parentOf(thread),
      thread,
    })),
    sort,
  ).map(({ row, place }) => {
    if (place !== "nested") head = row.id;
    const parent = place === "nested" ? parentOf(row.thread) : null;
    return {
      thread: row.thread,
      place,
      parentTitle: parent && threads[parent] ? threadTitle(threads[parent].meta) : null,
      kind: place === "nested" ? (row.thread.meta.parentThreadId ? "spawn" : "fork") : null,
      head,
    };
  });
}

/** Rows grouped by family: a flat row or a head, then its nested members. */
function slotsOf(rows: Row[]): Row[][] {
  const slots: Row[][] = [];
  for (const row of rows) {
    if (row.place === "nested" && slots.length) slots[slots.length - 1].push(row);
    else slots.push([row]);
  }
  return slots;
}

/** Pinned sessions read with thread/read because the list has not paged them in. */
const pinLoaded = new Set<string>();

function layout({ list, threads, sections }: Pick<AppState, "list" | "threads" | "sections">, state: Local): ListShape {
  const listed = new Set(list.ids);
  const pins = state.pins.filter((id) => threads[id] && (listed.has(id) || (list.status !== "archived" && pinLoaded.has(id))));
  const pinSet = new Set(pins);
  const pinned: Row[] = pins.map((id) => ({ thread: threads[id], place: "flat", parentTitle: null, kind: null, head: id }));
  const loose = list.ids.flatMap((id) => (threads[id] && !pinSet.has(id) ? [threads[id]] : []));
  const rows = orderRows(loose, threads, list.sort);
  if (state.groupBy === "none") return { pinned, groups: null, rows };
  if (state.groupBy === "custom") {
    // A family member without a group of its own stays with its root's group.
    const known = new Set(sections.map((section) => section.id));
    const sectionOf = (thread: ThreadState | undefined): string | null => {
      for (let depth = 0; thread && depth < 32; depth++) {
        const id = thread.meta.section?.id;
        if (id && known.has(id)) return id;
        const parent = parentOf(thread);
        thread = parent ? threads[parent] : undefined;
      }
      return null;
    };
    const by = new Map<string | null, ThreadState[]>();
    for (const thread of loose) {
      const id = sectionOf(thread);
      by.set(id, [...(by.get(id) ?? []), thread]);
    }
    const groups: Group[] = sections.flatMap((section) => {
      const members = orderRows(by.get(section.id) ?? [], threads, list.sort);
      return members.length || state.showEmpty || state.kept.includes(section.id) ? [{ key: `group:${section.id}`, label: section.name, rows: members, section }] : [];
    });
    const ungrouped = orderRows(by.get(null) ?? [], threads, list.sort);
    if (ungrouped.length || state.showEmpty) groups.push({ key: "group:ungrouped", label: "未分组", rows: ungrouped, section: null });
    return { pinned, groups, rows };
  }
  const families = slotsOf(rows).map((slot) => ({
    rows: slot,
    time: Math.max(...slot.map((row) => recencyOf(row.thread))),
    folder: slot[0].thread.meta.cwd,
  }));
  const groups: Group[] = state.groupBy === "date" ? dateBuckets(families, new Date()) : folderBuckets(families);
  return { pinned, groups, rows };
}

interface Shape {
  slots: Row[][];
  visible: Row[][];
  hidden: number;
  revealed: number;
}

function shapeOf(key: string, rows: Row[], state: Local): Shape {
  const slots = slotsOf(rows);
  const revealed = state.more[key] ?? 0;
  const limit = TRUNCATE + revealed;
  return { slots, visible: slots.slice(0, limit), hidden: Math.max(0, slots.length - limit), revealed };
}

/** The rows on screen, top to bottom: folded lists and rows past "再显示" left out. */
function visibleRows(shape: ListShape, state: Local): Row[] {
  const lists: [string, Row[]][] = [[PINNED, shape.pinned], ...(shape.groups ? shape.groups.map((group): [string, Row[]] => [group.key, group.rows]) : [[RECENTS, shape.rows] as [string, Row[]]])];
  return lists.flatMap(([key, rows]) => (state.collapsed.includes(key) ? [] : shapeOf(key, rows, state).visible.flat()));
}

/** Session ids top to bottom as the sidebar shows them (next / previous / jump shortcuts). */
export function sidebarOrder(): string[] {
  return visibleRows(layout(getState(), local), local).map((row) => row.thread.meta.id);
}

// ---------------------------------------------------------------------------
// Row status (shared-18 nO / XD / ED): the leading glyph says idle, working, waiting, unread,
// error or archived; working, waiting, unread and error are live.

type Status = "blocked" | "error" | "running" | "unread";

function statusOf(thread: ThreadState, request: ServerRequest | null): Status | null {
  const { status } = thread.meta;
  const flags = status.type === "active" ? status.activeFlags : [];
  if (request || flags.length) return "blocked";
  if (status.type === "systemError") return "error";
  if (activeTurn(thread) || status.type === "active") return "running";
  return isUnread(thread) ? "unread" : null;
}

/** nO: a waiting row reads "Awaiting input" whatever it waits on (only XD tells a question apart). */
function RowGlyph({ status, archived }: { status: Status | null; archived: boolean }) {
  if (archived)
    return (
      <span className="row-glyph" role="img" aria-label="已归档">
        <Icon name="Archive" size="sm" className="glyph-archived" />
      </span>
    );
  if (!status)
    return (
      <span className="row-glyph" role="img" aria-label="空闲">
        <span className="glyph-idle" aria-hidden="true" />
      </span>
    );
  const label = status === "blocked" ? "等待输入" : status === "error" ? "出错" : status === "running" ? "运行中" : "未读回复";
  return (
    <span className="row-glyph" role="status" aria-label={label}>
      {status === "error" ? <Icon name="Warning" size="sm" className="glyph-error" /> : <StatusDot kind={status} />}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Menus

/** Single-letter keys while a menu is open (ce4f4374c ze()); 1-9 pick in Move to group. */
function useMenuKeys(keys: Record<string, (() => void) | undefined>) {
  const current = useRef(keys);
  current.current = keys;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.repeat || event.key.length !== 1) return;
      // Typing in a field elsewhere stays typing (shared-20 ZC: VC() skips editable targets).
      const target = event.target as Element | null;
      if (target?.closest?.("input, textarea, [contenteditable]:not([contenteditable='false'])") && !target.closest(".popover")) return;
      const key = event.key.toLowerCase();
      if (/[1-9]/.test(key) && !document.querySelector(".submenu.move-menu")) return;
      const run = current.current[key];
      if (!run) return;
      event.preventDefault();
      event.stopPropagation();
      run();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);
}

/** Move to group (shared-20 Cx / wx): radio items with 1-9, Ungrouped, then New group…. */
function moveItems(sections: ThreadSection[], current: string | null | undefined, move: (sectionId: string | null) => void, create: () => void) {
  const digit = (index: number) => (index < 9 ? String(index + 1) : undefined);
  const keys: Record<string, () => void> = {};
  sections.forEach((section, index) => {
    if (index < 9) keys[String(index + 1)] = () => move(section.id);
  });
  if (sections.length < 9) keys[String(sections.length + 1)] = () => move(null);
  if (sections.length + 1 < 9) keys[String(sections.length + 2)] = create;
  const items = (
    <>
      <div className="menu-scroll">
        {sections.map((section, index) => (
          <MenuItem key={section.id} label={section.name} kbd={digit(index)} checked={current !== undefined ? current === section.id : undefined} onClick={() => move(section.id)} />
        ))}
      </div>
      {sections.length > 0 && <MenuSep />}
      <MenuItem label="未分组" kbd={digit(sections.length)} checked={current !== undefined ? current === null : undefined} onClick={() => move(null)} />
      <MenuSep />
      <MenuItem label="新建分组…" kbd={digit(sections.length + 1)} onClick={create} />
    </>
  );
  return { items, keys };
}

let awaitingGroup: Set<string> | null = null;

/** The new-group dialog (shared-20 bx); a group made here stays listed while empty. */
function createGroup(threadId?: string) {
  awaitingGroup = new Set(getState().sections.map((section) => section.id));
  setState({ dialog: { type: "section", sectionId: null, threadId } });
}

function archiveOrRestore(ids: string[], archived: boolean) {
  setPinned(ids, false);
  void Promise.allSettled(ids.map((id) => (archived ? unarchiveThread(id) : archiveThread(id)))).then((results) => {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) fail(archived ? "取消归档失败" : "归档失败")(failed.reason);
    // Status All keeps them, now on the other side of the archive.
    if (getState().list.status === "all") void refreshThreads();
  });
}

/**
 * One session's menu (ce4f4374c): edit, organize, remove, a separator between groups, no icons,
 * letter keys. `rename` edits the title in place; without it the rename dialog opens.
 */
function SessionMenu({ row, pinIndex, archived, close, rename }: { row: Row; pinIndex: number; archived: boolean; close(): void; rename?: () => void }) {
  const sections = useStore((s) => s.sections);
  const projects = useStore((s) => s.projects);
  const pins = useLocal((s) => s.pins);
  const { thread } = row;
  const { meta } = thread;
  const id = meta.id;
  const pinned = pins.includes(id);
  const running = !!activeTurn(thread) || meta.status.type === "active";
  const unread = isUnread(thread);
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const pin = archived ? undefined : act(() => setPinned([id], !pinned));
  // shared-20 5688: not for agents' sessions, nor while a turn runs.
  const read = running || meta.parentThreadId ? undefined : act(() => void (unread ? markRead(id) : markUnread(id)).catch(fail("更新未读状态失败")));
  const doRename = archived ? undefined : act(() => (rename ? rename() : setState({ dialog: { type: "rename", threadId: id } })));
  const fork = archived ? undefined : act(() => void forkThread(id).catch(fail("派生会话失败")));
  const lifecycle = act(() => archiveOrRestore([id], archived));
  const remove = act(() => setState({ dialog: { type: "delete", threadId: id } }));
  const move = moveItems(
    sections,
    meta.section?.id ?? null,
    (sectionId) => {
      close();
      if ((meta.section?.id ?? null) !== sectionId) moveToSection(id, sectionId).catch(fail("移动失败"));
    },
    act(() => createGroup(id)),
  );
  useMenuKeys({ p: pin, u: read, r: doRename, f: fork, a: lifecycle, d: remove, ...(archived ? {} : move.keys) });
  const edit = [
    pin && <MenuItem key="pin" label={pinned ? "取消置顶" : "置顶"} kbd="P" onClick={pin} />,
    read && <MenuItem key="read" label={unread ? "标为已读" : "标为未读"} kbd="U" onClick={read} />,
    doRename && <MenuItem key="rename" label="重命名" kbd="R" onClick={doRename} />,
    fork && <MenuItem key="fork" label="派生" kbd="F" onClick={fork} />,
  ].filter(Boolean);
  const organize = [
    pinned && pinIndex > 0 && <MenuItem key="up" label="上移" onClick={act(() => movePin(id, -1))} />,
    pinned && pinIndex >= 0 && pinIndex < pins.length - 1 && <MenuItem key="down" label="下移" onClick={act(() => movePin(id, 1))} />,
    !archived && (
      <Submenu key="move" label="移到分组" className="move-menu">
        {move.items}
      </Submenu>
    ),
    // Codex projects (thread/metadata/update.projectId); clearing one is Codex's own.
    !archived && projects.length > 0 && (
      <Submenu key="project" label="移到项目">
        <div className="menu-scroll">
          {projects.map((project) => (
            <MenuItem
              key={project.id}
              label={project.name}
              checked={meta.projectId === project.id}
              onClick={act(() => void setThreadProject(id, project.id).catch(fail("移动失败")))}
            />
          ))}
        </div>
        {meta.projectId && (
          <>
            <MenuSep />
            <MenuItem label="移出项目" onClick={act(() => void setThreadProject(id, null).catch(fail("移动失败")))} />
          </>
        )}
      </Submenu>
    ),
  ].filter(Boolean);
  const groups = [
    edit,
    organize,
    [
      <MenuItem key="archive" label={archived ? "取消归档" : "归档"} kbd="A" onClick={lifecycle} />,
      <MenuItem key="delete" label="删除" kbd="D" danger onClick={remove} />,
    ],
  ].filter((group) => group.length > 0);
  return groups.flatMap((group, index) => (index ? [<MenuSep key={`sep${index}`} />, ...group] : group));
}

/** The menu for a selection of several sessions (ce4f4374c Be). */
function BulkMenu({ ids, close, onDelete }: { ids: string[]; close(): void; onDelete(ids: string[]): void }) {
  const sections = useStore((s) => s.sections);
  const status = useStore((s) => s.list.status);
  const pins = useLocal((s) => s.pins);
  const count = ids.length;
  const archived = ids.every((id) => archivedNow(id, status));
  const unpinned = ids.filter((id) => !pins.includes(id));
  const pinnedIds = ids.filter((id) => pins.includes(id));
  const done = (fn: () => void) => () => {
    close();
    clearSelection();
    fn();
  };
  const pin = unpinned.length && !archived ? done(() => setPinned(unpinned, true)) : undefined;
  const unpin = pinnedIds.length ? done(() => setPinned(pinnedIds, false)) : undefined;
  const unread = done(() => ids.forEach((id) => void markUnread(id).catch(fail("更新未读状态失败"))));
  const lifecycle = done(() => archiveOrRestore(ids, archived));
  const remove = done(() => onDelete(ids));
  const move = moveItems(
    sections,
    undefined,
    (sectionId) => {
      close();
      clearSelection();
      for (const id of ids) void moveToSection(id, sectionId).catch(fail("移动失败"));
    },
    done(() => createGroup()),
  );
  useMenuKeys({ p: pin ?? unpin, u: unread, a: lifecycle, d: remove, ...(archived ? {} : move.keys) });
  return (
    <>
      {pin && <MenuItem label={`置顶 ${unpinned.length} 个`} kbd="P" onClick={pin} />}
      {unpin && <MenuItem label={`取消置顶 ${pinnedIds.length} 个`} kbd={pin ? undefined : "P"} onClick={unpin} />}
      <MenuItem label={`将 ${count} 个标为未读`} kbd="U" onClick={unread} />
      {!archived && (
        <>
          <MenuSep />
          <Submenu label={`将 ${count} 个移到分组`} className="move-menu">
            {move.items}
          </Submenu>
        </>
      )}
      <MenuSep />
      <MenuItem label={archived ? `取消归档 ${count} 个` : `归档 ${count} 个`} kbd="A" onClick={lifecycle} />
      <MenuItem label={`删除 ${count} 个`} kbd="D" danger onClick={remove} />
    </>
  );
}

/** A menu at the pointer (shared-20 ZC: a virtual anchor 2px off the pointer, bottom start). */
export function PointerMenu({ at, onClose, children }: { at: { x: number; y: number }; onClose(): void; children: ReactNode }) {
  // The menu takes the keys once it opens, as a Base UI menu does.
  useEffect(() => document.querySelector<HTMLElement>(".popover.pointer-menu")?.focus({ preventScroll: true }), []);
  return (
    <Popover open onClose={onClose} placement="bottom-start" className="pointer-menu" anchor={<span className="pointer-anchor" style={{ left: at.x + 2, top: at.y - 2 }} />}>
      {children}
    </Popover>
  );
}

/** Where a context menu opens: the pointer, or under the element for the keyboard's menu key. */
export function menuPoint(event: MouseEvent<HTMLElement>): { x: number; y: number } {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + 8, y: rect.bottom };
}

const looseRow = (thread: ThreadState): Row => ({ thread, place: "flat", parentTitle: null, kind: null, head: thread.meta.id });

/**
 * The sidebar's session menu at the pointer, for session rows elsewhere (the new-session page's
 * rows): call it from onContextMenu with the event (after preventDefault), or with a point.
 * The sidebar hosts the menu; Rename opens the rename dialog there.
 */
export function openSessionMenu(threadId: string, at: MouseEvent<HTMLElement> | { x: number; y: number }) {
  setLocal({ menu: { threadId, at: "currentTarget" in at ? menuPoint(at) : at } });
}

/** The same menu's items inside a caller's own Popover (a … button); `close` closes that Popover. */
export function SessionMenuItems({ threadId, close }: { threadId: string; close(): void }) {
  const thread = useStore((s) => s.threads[threadId]);
  return thread ? <SessionMenu row={looseRow(thread)} pinIndex={-1} archived={isArchivedThread(threadId)} close={close} /> : null;
}

/** "Filter" / "Filter (active)" (shared-21 iU classic, rU()): Status first, then Group by and Sort by. */
function FilterMenu() {
  const [open, setOpen] = useState(false);
  const status = useStore((s) => s.list.status);
  const sort = useStore((s) => s.list.sort);
  const groupBy = useLocal((s) => s.groupBy);
  const showEmpty = useLocal((s) => s.showEmpty);
  // nU(): Show empty groups belongs to custom groups and folders; a Codex folder group only exists
  // while it has sessions, so here it is the custom groups' alone.
  const emptyApplies = groupBy === "custom";
  const active = status !== "active" || (emptyApplies && showEmpty);
  const statuses: [StatusFilter, string][] = [
    ["active", "活跃"],
    ["archived", "已归档"],
    ["all", "全部"],
  ];
  const groupings: [GroupBy, string][] = [
    ["date", "日期"],
    ["project", "文件夹"],
    ["custom", "自定义分组"],
    ["none", "无"],
  ];
  const sorts: [SessionSort, string][] = [
    ["alpha", "名称"],
    ["created", "创建日期"],
    ["recency", "最近活动"],
  ];
  const label = active ? "筛选（已启用）" : "筛选";
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      className="filter-menu"
      anchor={<Button variant="ghost" className="chrome-btn" icon={<Icon name="Filter" size={16} />} label={label} aria-expanded={open} onClick={() => setOpen(!open)} />}
    >
      {/* Radio items close the menu (uU); the check items keep it open. */}
      <Submenu label="状态" value={<span className={status === "active" ? undefined : "filter-on"}>{statuses.find(([value]) => value === status)?.[1]}</span>}>
        {statuses.map(([value, text]) => (
          <MenuItem
            key={value}
            label={text}
            checked={status === value}
            onClick={() => {
              setOpen(false);
              if (status !== value) setListFilter({ status: value });
            }}
          />
        ))}
      </Submenu>
      <MenuSep />
      <Submenu label="分组方式" value={groupings.find(([value]) => value === groupBy)?.[1]}>
        {groupings.map(([value, text]) => (
          <MenuItem
            key={value}
            label={text}
            checked={groupBy === value}
            onClick={() => {
              setOpen(false);
              setLocal({ groupBy: value });
            }}
          />
        ))}
      </Submenu>
      <Submenu label="排序方式" value={sorts.find(([value]) => value === sort)?.[1]}>
        {sorts.map(([value, text]) => (
          <MenuItem
            key={value}
            label={text}
            checked={sort === value}
            onClick={() => {
              setOpen(false);
              if (sort === value) return;
              writePref("codex-ui:sort", value);
              setListFilter({ sort: value });
            }}
          />
        ))}
      </Submenu>
      {/* Show PR status: Codex has no pull request states to show. */}
      {emptyApplies && (
        <>
          <MenuSep />
          <MenuItem label="显示空分组" toggle checked={showEmpty} onClick={() => setLocal({ showEmpty: !showEmpty })} />
        </>
      )}
      {active && (
        <>
          <MenuSep />
          <MenuItem
            label="清除筛选"
            onClick={() => {
              setOpen(false);
              setLocal({ showEmpty: false });
              if (status !== "active") setListFilter({ status: "active" });
            }}
          />
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Rows

/** Edits a title in place (shared-18 PE / FE): Enter or leaving saves, Esc restores. */
function RenameField({ value, label, onDone }: { value: string; label: string; onDone(next: string | null, keyboard: boolean): void }) {
  const [draft, setDraft] = useState(value);
  const finished = useRef(false);
  const finish = (next: string | null, keyboard: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next, keyboard);
  };
  return (
    <input
      className="rename-field"
      dir="auto"
      aria-label={label}
      value={draft}
      maxLength={200}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(draft, false)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // The field keeps its keys from the list's roving focus and menus (shared-18 FE).
        event.stopPropagation();
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          finish(draft, true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null, true);
        }
      }}
    />
  );
}

/** Marks a label that runs out of room so it fades over its last 24px, and offers the whole text as its tip. */
function useFade(ref: RefObject<HTMLElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const over = el.scrollWidth > el.clientWidth + 1;
      el.toggleAttribute("data-overflowing", over);
      if (over) el.dataset.tip = text;
      else delete el.dataset.tip;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);
}

function open(id: string) {
  setLocal({ anchor: id, selected: [] });
  void openThread(id);
  closeSidebarOnMobile();
}

/** shared-21 r0: Shift extends from the anchor, Ctrl / Cmd toggles; a plain click opens the session. */
function clickRow(event: MouseEvent, id: string) {
  const activeId = getState().activeId;
  if (event.shiftKey && !(event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    const range = rangeIds(sidebarOrder(), local.anchor ?? activeId, id);
    setLocal({ selected: [...new Set([...local.selected, ...range])] });
    return;
  }
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    // The open session joins a selection that starts with a Ctrl-click elsewhere.
    const base = local.selected.length || !activeId || activeId === id ? local.selected : [activeId];
    setLocal({ selected: base.includes(id) ? base.filter((x) => x !== id) : [...base, id], anchor: id });
    return;
  }
  open(id);
}

interface RowProps {
  row: Row;
  active: boolean;
  request: ServerRequest | null;
  archived: boolean;
  pinIndex: number;
  checked: boolean;
  /** Ids of the selection this row belongs to (two or more): its menus act on all of them. */
  selection: string[] | null;
  onDragStart(event: DragEvent, row: Row): void;
  onBulkDelete(ids: string[]): void;
}

/** A classic session row (shared-18 LE "session", led by its status glyph). */
const CodeRow = memo(function CodeRow({ row, active, request, archived, pinIndex, checked, selection, onDragStart, onBulkDelete }: RowProps) {
  const [menu, setMenu] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const refocus = useRef(false);
  const { thread, kind, parentTitle } = row;
  const { meta } = thread;
  const title = threadTitle(meta);
  const status = statusOf(thread, request);
  // The title span comes back new after an edit: measure it again.
  useFade(titleRef, editing ? "" : title);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [editing]);
  const glyph = <RowGlyph status={status} archived={archived} />;
  const closeAt = () => {
    setAt(null);
    if (document.activeElement === document.body) button.current?.focus({ preventScroll: true });
  };
  const body = (close: () => void) =>
    selection ? (
      <BulkMenu ids={selection} close={close} onDelete={onBulkDelete} />
    ) : (
      <SessionMenu row={row} pinIndex={pinIndex} archived={archived} close={close} rename={archived ? undefined : () => setEditing(true)} />
    );
  return (
    <div
      className="code-row-wrap"
      data-row=""
      data-selected={active || undefined}
      data-checked={checked || undefined}
      data-menu-open={menu || at ? "" : undefined}
      draggable={!archived && !editing}
      onDragStart={(event) => onDragStart(event, row)}
      onContextMenu={(event) => {
        if (editing) return;
        event.preventDefault();
        setMenu(false);
        setAt(menuPoint(event));
      }}
    >
      {editing ? (
        <div className="code-row" data-editing="">
          {glyph}
          <RenameField
            value={title}
            label="重命名"
            onDone={(next, keyboard) => {
              refocus.current = keyboard;
              setEditing(false);
              const value = next?.trim();
              if (value && value !== title) renameThread(meta.id, value).catch(fail("重命名失败"));
            }}
          />
        </div>
      ) : (
        <button
          ref={button}
          type="button"
          className="code-row"
          data-roving-item=""
          data-selected={active || undefined}
          aria-current={active ? "page" : undefined}
          onClick={(event) => clickRow(event, meta.id)}
          onDoubleClick={(event) => {
            if (archived || event.shiftKey || event.ctrlKey || event.metaKey) return;
            setEditing(true);
          }}
        >
          {glyph}
          <span className="code-title" ref={titleRef}>
            {title}
            {kind && parentTitle && <span className="sr-only">{kind === "spawn" ? `，由 Codex 从“${parentTitle}”启动` : `，派生自“${parentTitle}”`}</span>}
          </span>
        </button>
      )}
      {/* sD: DotsVertical while El() is null (no session-list context), as on the classic list. */}
      {!editing && (
        <div className="code-row-act">
          <Popover
            open={menu}
            onClose={() => setMenu(false)}
            placement="bottom-end"
            anchor={
              <Button variant="ghost" size="xs" icon={<Icon name="DotsVertical" size={16} />} label={`“${title}”的更多选项`} tip="" aria-expanded={menu} onClick={() => setMenu(!menu)} />
            }
          >
            {body(() => setMenu(false))}
          </Popover>
        </div>
      )}
      {at && (
        <PointerMenu at={at} onClose={closeAt}>
          {body(closeAt)}
        </PointerMenu>
      )}
    </div>
  );
});

/**
 * Show more (shared-21 TW, classic): twenty more rows a press ("Show {count} more"), the next
 * page from the server at the end of the last list, then Show less.
 */
function MoreRow({ listKey, label, shape, fetch, announce }: { listKey: string; label: string; shape: Shape; fetch: boolean; announce(text: string): void }) {
  const loading = useStore((s) => s.list.loading);
  const cursor = useStore((s) => s.list.cursor !== null);
  const canFetch = fetch && cursor;
  if (!shape.hidden && !canFetch && !shape.revealed) return null;
  const reveal = Math.min(TRUNCATE, shape.hidden);
  const fetching = !shape.hidden && canFetch && loading;
  const less = !shape.hidden && !canFetch;
  const text = less ? "收起" : fetching ? "正在加载…" : reveal ? `再显示 ${reveal} 个` : "显示更多";
  const aria = less ? `在“${label}”中收起` : reveal ? `在“${label}”中再显示 ${reveal} 个` : "显示更多会话";
  return (
    <button
      type="button"
      className="list-more-row"
      data-row=""
      data-roving-item=""
      aria-label={aria}
      aria-disabled={fetching || undefined}
      onClick={() => {
        if (fetching) return;
        if (less) {
          setLocal({ more: { ...local.more, [listKey]: 0 } });
          announce(`在“${label}”中收起了`);
        } else if (reveal) {
          setLocal({ more: { ...local.more, [listKey]: shape.revealed + TRUNCATE } });
          announce(`在“${label}”中又显示了 ${reveal} 个`);
        } else {
          const before = getState().list.ids.length;
          setLocal({ more: { ...local.more, [listKey]: shape.revealed + TRUNCATE } });
          void refreshThreads(true).then(() => announce(`又加载了 ${Math.max(0, getState().list.ids.length - before)} 个会话`));
        }
      }}
    >
      <span className="nav-lead" aria-hidden="true" />
      <span>{text}</span>
    </button>
  );
}

/** "Load more sessions" (TW loadSessionsFace): after folder and custom groups, the next page. */
function LoadMoreRow({ announce }: { announce(text: string): void }) {
  const loading = useStore((s) => s.list.loading);
  const cursor = useStore((s) => s.list.cursor !== null);
  if (!cursor) return null;
  return (
    <button
      type="button"
      className="list-more-row list-load-row"
      data-row=""
      data-roving-item=""
      aria-label="加载更多会话"
      aria-disabled={loading || undefined}
      onClick={() => {
        if (loading) return;
        const before = getState().list.ids.length;
        void refreshThreads(true).then(() => announce(`又加载了 ${Math.max(0, getState().list.ids.length - before)} 个会话`));
      }}
    >
      {loading ? "正在加载…" : "加载更多会话"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Group labels (shared-18 fD, classic): 12px above the label line, the caret shows while the
// list is hovered or the list is folded.

function GroupLabel({
  name,
  lead,
  closed,
  onToggle,
  actions,
  onContextMenu,
  renaming,
}: {
  name: string;
  lead?: ReactNode;
  closed: boolean;
  onToggle(): void;
  actions?: ReactNode;
  onContextMenu?(event: MouseEvent<HTMLElement>): void;
  renaming?: ReactNode;
}) {
  return (
    <div className="group-label" data-sidebar-group-label="" onContextMenu={onContextMenu}>
      {renaming ?? (
        <button type="button" className="group-toggle" data-group-toggle="" aria-expanded={!closed} onClick={onToggle}>
          {lead}
          <span className="group-name">{name}</span>
          <Icon name="CaretRight" size="xs" className="group-caret" />
        </button>
      )}
      {actions && <span className="group-actions">{actions}</span>}
    </div>
  );
}

/** A group's + (shared-18 cD via shared-21 y$): a new session that starts in that group or folder. */
function GroupAdd({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="group-add" data-row-action="" tabIndex={-1} aria-label={label} onClick={onClick}>
      <Icon name="Add" size={16} />
    </button>
  );
}

let pendingSection: { sectionId: string; epoch: number; since: number } | null = null;

/** A new session; once it has started, it moves into `sectionId` (thread/start, then thread/section/move). */
function startIn(target: { sectionId?: string; folder?: string }) {
  // A folder's +: the new session starts there, in whatever project holds that folder.
  if (target.folder) setState((s) => ({ prefs: { ...s.prefs, cwd: target.folder!, projectId: null } }));
  newChat();
  closeSidebarOnMobile();
  pendingSection = target.sectionId ? { sectionId: target.sectionId, epoch: getState().draftEpoch, since: Date.now() / 1000 - 5 } : null;
}

// ---------------------------------------------------------------------------
// Footer

function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}

/** The user button (avatar · name · plan) spans the row and opens the account menu (cd75f6c8c). */
function UserMenu() {
  const account = useStore((s) => s.account?.account ?? null);
  // null until account/read answers: show an empty button rather than “未登录”.
  const needsAuth = useStore((s) => (s.account ? s.account.requiresOpenaiAuth : null));
  const [open, setOpen] = useState(false);
  const name =
    account?.type === "chatgpt"
      ? (account.email?.split("@")[0] ?? "ChatGPT")
      : account?.type === "apiKey"
        ? "API Key"
        : account?.type === "amazonBedrock"
          ? "Amazon Bedrock"
          : needsAuth === null
            ? ""
            : needsAuth
              ? "未登录"
              : "本地模型";
  const plan = account?.type === "chatgpt" ? account.planType : null;
  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="top-start"
      className="user-menu"
      anchor={
        <Button variant="ghost" className="user-btn" aria-expanded={open} aria-label="账户菜单" onClick={() => setOpen(!open)}>
          <span className="avatar-slot">
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
          </span>
          <span className="user-name">{name}</span>
          {plan && <span className="user-plan">· {plan}</span>}
          <Icon name="CaretDown" size="xs" className="caret" />
        </Button>
      }
    >
      {account?.type === "chatgpt" && account.email && <MenuSection title={account.email} />}
      <MenuItem icon={<Icon name="Settings" size={16} />} label="设置" kbd={shortcutLabel("settings")} onClick={go(() => openSettings("general"))} />
      <MenuItem icon={<Icon name="UsageGaugeMiddle" size={16} />} label="用量" onClick={go(() => openSettings("account", "setting-account-limits"))} />
      <MenuItem icon={<Icon name="Help" size={16} />} label="获取帮助" onClick={go(() => openExternal(HELP_URL))} />
      <MenuSep />
      {DESKTOP && <MenuItem icon={<Icon name="Scroll" size={16} />} label="查看更新日志" onClick={go(() => openExternal(CHANGELOG_URL))} />}
      <Submenu icon={<Icon name="Info" size={16} />} label="了解更多">
        <MenuItem label="键盘快捷键" kbd={shortcutLabel("shortcuts")} onClick={go(() => openPalette("shortcuts"))} />
      </Submenu>
      {account && (
        <>
          <MenuSep />
          <MenuItem icon={<Icon name="Logout" size={16} />} label="退出登录" onClick={go(() => void logout().catch(fail("退出失败")))} />
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Roving focus (shared-18 xD / bD): each [data-tab-section] is one Tab stop and the rest of the
// sidebar one more, ↑ ↓ Home End walk the rows (wrapping), ← → step between a row and its actions.

const ROVING = "[data-roving-item], [data-group-toggle]";
const ROW = "[data-row], [data-sidebar-group-label]";

function rovingItems(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROVING)].filter((el) => el.offsetParent !== null && !el.matches(":disabled") && !el.closest("[inert]"));
}

/** The roving item for whatever has focus: itself, or the main item of its row. */
function rovingOwner(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>(ROVING) ?? el?.closest(ROW)?.querySelector<HTMLElement>(ROVING) ?? null;
}

function rowParts(el: Element): HTMLElement[] {
  const row = el.closest(ROW);
  return row ? [...row.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.offsetParent !== null && !b.disabled) : [];
}

function syncTabStops(root: HTMLElement, stops: WeakSet<HTMLElement>) {
  const focused = rovingOwner(root.ownerDocument.activeElement);
  const groups = new Map<Element | null, HTMLElement[]>();
  for (const item of rovingItems(root)) {
    const key = item.closest("[data-tab-section]");
    groups.set(key, [...(groups.get(key) ?? []), item]);
    for (const part of rowParts(item)) if (part !== item) part.tabIndex = -1;
  }
  for (const items of groups.values()) {
    const stop = items.find((item) => item === focused) ?? items.find((item) => stops.has(item)) ?? items[0];
    for (const item of items) {
      item.tabIndex = item === stop ? 0 : -1;
      if (item === stop) stops.add(item);
      else stops.delete(item);
    }
  }
}

function useRovingFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const stops = new WeakSet<HTMLElement>();
    const onTab = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab") syncTabStops(el, stops);
    };
    const onFocus = () => {
      if (el.contains(document.activeElement)) syncTabStops(el, stops);
    };
    document.addEventListener("keydown", onTab, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onTab, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [root]);
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !event.currentTarget.contains(active)) return;
    if (event.key === "Escape" && local.selected.length) {
      clearSelection();
      return;
    }
    let target: HTMLElement | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const parts = rowParts(active);
      const at = parts.indexOf(active);
      if (parts.length < 2 || at < 0) return;
      target = parts[Math.max(0, Math.min(parts.length - 1, at + (event.key === "ArrowRight" ? 1 : -1)))];
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      const owner = rovingOwner(active);
      const items = rovingItems(event.currentTarget);
      if (!owner || !items.length) return;
      const at = items.indexOf(owner);
      const down = event.key === "ArrowDown";
      const next =
        event.key === "Home" ? 0
        : event.key === "End" ? items.length - 1
        : at === -1 ? (down ? 0 : items.length - 1)
        : (at + (down ? 1 : -1) + items.length) % items.length;
      target = items[next];
    }
    if (!target || target === active) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  };
}

// ---------------------------------------------------------------------------
// Resize handle (shared-21 DF, shared-15 ResizeHandle)

const maxWidth = () => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, window.innerWidth - 330));

function ResizeHandle({ width, setWidth, aside }: { width: number; setWidth(next: number): void; aside: RefObject<HTMLElement | null> }) {
  const save = (next: number) => {
    setWidth(next);
    writePref(WIDTH_KEY, String(Math.round(next)));
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const app = aside.current?.closest<HTMLElement>(".app");
    const from = event.clientX;
    let moved = false;
    let next = width;
    let below = false;
    const move = (e: globalThis.PointerEvent) => {
      // A press only counts as a drag once it has moved more than 3px.
      if (!moved && Math.abs(e.clientX - from) <= 3) return;
      if (!moved) {
        moved = true;
        handle.dataset.dragging = "";
        if (app) app.dataset.resizing = "";
      }
      const raw = width + e.clientX - from;
      below = raw < MIN_WIDTH;
      next = Math.min(maxWidth(), Math.max(MIN_WIDTH, raw));
      setWidth(next);
    };
    const end = (cancel: boolean) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", esc, true);
      delete handle.dataset.dragging;
      if (app) delete app.dataset.resizing;
      if (cancel) {
        setWidth(width);
        return;
      }
      // A click hides the sidebar; so does letting go below the narrowest width.
      if (!moved || below) {
        setWidth(width);
        toggleSidebar();
        return;
      }
      save(next);
    };
    const up = () => end(false);
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      end(true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    document.addEventListener("keydown", esc, true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8;
    const next =
      event.key === "ArrowLeft" ? width - step
      : event.key === "ArrowRight" ? width + step
      : event.key === "Home" ? MIN_WIDTH
      : event.key === "End" ? maxWidth()
      : null;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSidebar();
    } else if (next !== null) {
      event.preventDefault();
      save(Math.min(maxWidth(), Math.max(MIN_WIDTH, next)));
    }
  };
  return (
    <div
      className="sidebar-resize"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="调整侧边栏大小"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      data-tip="隐藏侧边栏"
      data-tip-kbd={shortcutLabel("sidebar")}
      onPointerDown={start}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}

/**
 * The sidebar switch. place="chrome" is the Windows chrome bar's (always shown, Ctrl+B, a hover
 * peeks when collapsed); "title" sits in the sidebar's own title row; "trigger" is the browser's
 * collapsed-state button at the top left.
 */
export function SidebarToggle({ place = "chrome", size = "sm" }: { place?: "chrome" | "title" | "trigger"; size?: "xs" | "sm" }) {
  const open = useStore((s) => s.sidebarOpen);
  const peek = useLocal((s) => s.peek);
  return (
    <span className="sidebar-toggle" {...(place === "title" ? {} : peekHover)}>
      <Button
        variant="ghost"
        size={place === "title" ? "xs" : size}
        className={place === "title" ? "chrome-btn" : undefined}
        icon={<Icon name="Sidebar" size="sm" />}
        // A narrow window's switch closes the peek it opened; a wide one's docks the sidebar.
        label={place === "title" || open || (peek && (narrowNow || phoneNow)) ? "隐藏侧边栏" : "显示侧边栏"}
        kbd={shortcutLabel("sidebar")}
        aria-controls={BODY_ID}
        // Collapsed, the switch also owns the peek (shared-22 LN(): aria-expanded while peekable).
        aria-expanded={place !== "title" && !open ? peek : undefined}
        onClick={toggleSidebar}
      />
    </span>
  );
}

/** Placeholder rows while the first page of sessions loads (shared-21 kV() / MV(), session rows). */
function SkeletonRows() {
  const widths = [0.68, 0.54, 0.44, 0.68, 0.54];
  return (
    <div className="df-placeholder-rows" aria-hidden="true">
      {widths.map((width, index) => (
        <div key={index} className="placeholder-row">
          <i className="placeholder-dot" />
          <i className="placeholder-bar" style={{ width: `${Math.round(width * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dragging rows to Pinned and between custom groups (shared-22 By / bC, shared-19 XQ)

const dragHint = { text: "", x: 0, y: 0 };
const dragListeners = new Set<() => void>();
let dragSnapshot = "";

function setDragHint(text: string, x = 0, y = 0) {
  Object.assign(dragHint, { text, x, y });
  dragSnapshot = `${text}|${x}|${y}`;
  for (const listener of dragListeners) listener();
}

/** The intent label next to the pointer while a session is dragged (Move to …, Ungroup, Release to unpin). */
function DragLabel() {
  useSyncExternalStore(
    (listener) => {
      dragListeners.add(listener);
      return () => dragListeners.delete(listener);
    },
    () => dragSnapshot,
  );
  if (!dragHint.text) return null;
  return (
    <div className="drag-hint" style={{ left: dragHint.x + 14, top: dragHint.y + 10 }}>
      {dragHint.text}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sidebar

export function Sidebar() {
  const list = useStore((s) => s.list);
  const threads = useStore((s) => s.threads);
  const sections = useStore((s) => s.sections);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const ready = useStore((s) => s.conn.status === "ready");
  const state = useLocal((s) => s);
  const aside = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const onRovingKey = useRovingFocus(body);
  const [width, setWidth] = useState(readWidth);
  // Drop target under a dragged session: "pinned", a group key, or "" for the rest of the list.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ ids: string[]; fromPinned: boolean; section: string | null } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ group: Group; at: { x: number; y: number } } | null>(null);
  const [bulkDelete, setBulkDelete] = useState<string[] | null>(null);
  const [archiveAll, setArchiveAll] = useState<Group | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const narrow = useMedia(narrowQuery(width));
  const phone = useMedia("(width < 40rem)") && !DESKTOP;
  const wco = document.documentElement.hasAttribute("data-wco");
  const mode = phone ? "sheet" : sidebarOpen ? "docked" : "peek";
  const shown = mode === "docked" || state.peek;

  // Narrow screens collapse the sidebar; leaving them brings back the remembered choice.
  useEffect(() => {
    narrowNow = narrow;
    setPeek(false);
    setState({ sidebarOpen: narrow ? false : openPref() });
  }, [narrow]);

  useEffect(() => {
    phoneNow = phone;
  }, [phone]);

  // The chrome bar's peek band and the header's clearance read these (dframe-root inline style).
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--df-sidebar-width", `${width}px`);
    root.setProperty("--df-trigger-right", mode !== "docked" && !wco ? "36px" : "0px");
  }, [width, mode, wco]);

  // The list runs to the sidebar's edge; rows give back 8px only when no scrollbar takes it.
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const sync = () => el.style.setProperty("--df-sb", `${el.offsetWidth - el.clientWidth}px`);
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    sync();
    return () => observer.disconnect();
  }, []);

  // Esc closes the peek and hands focus back to the switch; a press outside closes it too (shared-16 Lm).
  useEffect(() => {
    if (!state.peek) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".popover, .dialog-backdrop")) return;
      setPeek(false);
      document.querySelector<HTMLElement>(".sidebar-toggle button")?.focus();
    };
    const onPress = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".sidebar, .sidebar-toggle, .popover, .dialog-backdrop, .tooltip")) setPeek(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress, true);
    };
  }, [state.peek]);

  // A plain press outside the rows, menus and dialogs drops the selection (shared-21 SB).
  const selecting = state.selected.length > 0;
  useEffect(() => {
    if (!selecting) return;
    const onPress = (event: globalThis.PointerEvent) => {
      if (event.shiftKey || event.metaKey || event.ctrlKey || event.button !== 0) return;
      if (!(event.target as Element | null)?.closest("[data-row], .popover, .dialog-backdrop")) clearSelection();
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [selecting]);

  // A session started from a group's +: once thread/start has made it, file it there.
  useEffect(() => {
    const pending = pendingSection;
    if (!pending || !activeId) return;
    pendingSection = null;
    const thread = getState().threads[activeId];
    if (getState().draftEpoch === pending.epoch && thread && thread.meta.createdAt >= pending.since) moveToSection(activeId, pending.sectionId).catch(fail("移动失败"));
  }, [activeId]);

  // A group made from here stays listed while it is still empty.
  useEffect(() => {
    const before = awaitingGroup;
    if (!before) return;
    const fresh = sections.filter((section) => !before.has(section.id)).map((section) => section.id);
    if (!fresh.length) return;
    awaitingGroup = null;
    setLocal({ kept: [...local.kept, ...fresh] });
  }, [sections]);

  // Pinned sessions the first page did not bring are read one by one.
  useEffect(() => {
    if (!ready) return;
    const missing = state.pins.filter((id) => !getState().threads[id]);
    if (!missing.length) return;
    void ensureThreads(missing).then(() => {
      for (const id of missing) if (getState().threads[id]) pinLoaded.add(id);
      setLocal({});
    });
  }, [ready, state.pins]);

  const blockedBy = new Map<string, ServerRequest>();
  for (const request of requests) {
    const id = requestThreadId(request);
    if (id && !blockedBy.has(id)) blockedBy.set(id, request);
  }
  const shape = layout({ list, threads, sections }, state);
  const selection = new Set(state.selected);
  const selectionIds = state.selected.length > 1 ? state.selected : null;
  const announce = (text: string) => setAnnouncement(text);
  const customMode = state.groupBy === "custom";

  const onDragStart = (event: DragEvent, row: Row) => {
    const id = row.thread.meta.id;
    // A nested session goes with its family root; a selected row takes the whole selection.
    const ids = selection.has(id) && state.selected.length > 1 ? state.selected : [row.head];
    event.dataTransfer.setData(DRAG_TYPE, ids.join("\n"));
    event.dataTransfer.effectAllowed = "move";
    setDragging({ ids, fromPinned: state.pins.includes(id), section: threads[row.head]?.meta.section?.id ?? null });
  };

  const endDrag = () => {
    setDropTarget(null);
    setDragging(null);
    setDragHint("");
  };

  useEffect(() => {
    if (!dragging) return;
    document.addEventListener("dragend", endDrag);
    return () => document.removeEventListener("dragend", endDrag);
  });

  /** A drop target: Pinned pins; a custom group or Ungrouped files the sessions; the rest only unpins. */
  const dropZone = (target: string, section: ThreadSection | null | undefined, label: string) => ({
    "data-drop": dropTarget === target || undefined,
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      event.stopPropagation();
      setDropTarget(target);
      const moves = section !== undefined && dragging && (section?.id ?? null) !== dragging.section;
      const hint = target === PINNED ? "" : moves ? (section ? `移到“${label}”` : "取消分组") : dragging?.fromPinned ? "松开以取消置顶" : "";
      setDragHint(hint, event.clientX, event.clientY);
    },
    onDragLeave: (event: DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setDropTarget(null);
      setDragHint("");
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const ids = event.dataTransfer.getData(DRAG_TYPE).split("\n").filter(Boolean);
      endDrag();
      clearSelection();
      if (target === PINNED) {
        setPinned(ids, true);
        return;
      }
      setPinned(ids, false);
      if (section === undefined) return;
      for (const id of ids) if ((threads[id]?.meta.section?.id ?? null) !== (section?.id ?? null)) moveToSection(id, section?.id ?? null).catch(fail("移动失败"));
    },
  });

  const rowFor = (entry: Row, pinnedList: boolean) => {
    const id = entry.thread.meta.id;
    return (
      <CodeRow
        key={id}
        row={entry}
        active={id === activeId}
        request={blockedBy.get(id) ?? null}
        archived={archivedNow(id, list.status)}
        pinIndex={pinnedList ? state.pins.indexOf(id) : -1}
        checked={selection.has(id)}
        selection={selectionIds && selection.has(id) ? selectionIds : null}
        onDragStart={onDragStart}
        onBulkDelete={setBulkDelete}
      />
    );
  };

  /** The rows of one list: families one level in under their root (shared-22 sC / uC), then Show more. */
  const listRows = (key: string, label: string, rows: Row[], fetch: boolean, pinnedList = false) => {
    const listShape = shapeOf(key, rows, state);
    return (
      <>
        {listShape.visible.map((slot) => (
          <div key={slot[0].thread.meta.id} className="family-slot">
            {rowFor(slot[0], pinnedList)}
            {slot.length > 1 && <div className="family">{slot.slice(1).map((entry) => rowFor(entry, pinnedList))}</div>}
          </div>
        ))}
        <MoreRow listKey={key} label={label} shape={listShape} fetch={fetch} announce={announce} />
      </>
    );
  };

  const firstLoad = list.loading && list.ids.length === 0;
  const anyRows = shape.pinned.length > 0 || shape.rows.length > 0;
  const filter = <FilterMenu />;

  const renderGroup = (group: Group, index: number, groups: Group[]) => {
    const closed = state.collapsed.includes(group.key);
    const section = group.section;
    const last = index === groups.length - 1;
    const add = section ? (
      <GroupAdd label={`在“${section.name}”中新建会话`} onClick={() => startIn({ sectionId: section.id })} />
    ) : group.folder !== undefined ? (
      <GroupAdd label={`在“${group.label}”中新建会话`} onClick={() => startIn({ folder: group.folder })} />
    ) : null;
    // shared-22 bC classic: the + comes first, then the list's Filter on the first group.
    const actions = (add || index === 0) && (
      <>
        {add}
        {index === 0 && filter}
      </>
    );
    const menu = section !== undefined && section !== null ? true : group.folder !== undefined;
    return (
      <section
        key={group.key}
        className="list-group"
        {...(customMode ? dropZone(group.key, section ?? null, group.label) : {})}
      >
        <GroupLabel
          name={group.label}
          lead={section ? <SectionSwatch color={section.appearance?.color} /> : undefined}
          closed={closed}
          onToggle={() => toggleCollapsed(group.key)}
          actions={actions}
          onContextMenu={
            menu
              ? (event) => {
                  event.preventDefault();
                  setGroupMenu({ group, at: menuPoint(event) });
                }
              : undefined
          }
          renaming={
            section && renamingGroup === section.id ? (
              <RenameField
                value={section.name}
                label="重命名分组"
                onDone={(next) => {
                  setRenamingGroup(null);
                  const value = next?.trim();
                  if (value && value !== section.name) updateSection(section.id, value, section.appearance?.color ?? null).catch(fail("重命名分组失败"));
                }}
              />
            ) : undefined
          }
        />
        {!closed && (
          <div className="code-list">
            {listRows(group.key, group.label, group.rows, state.groupBy === "date" && last)}
            {/* shared-22 bC: an empty custom group says where its sessions come from. */}
            {section && !group.rows.length && <p className="group-hint">将会话拖到或移到这里</p>}
          </div>
        )}
      </section>
    );
  };

  return (
    <>
      {mode !== "docked" && !wco && !(mode === "sheet" && state.peek) && (
        <div className="sidebar-trigger" data-phone={phone || undefined}>
          <SidebarToggle place="trigger" />
        </div>
      )}
      <aside
        className="sidebar"
        ref={aside}
        data-density="compact"
        data-mode={mode}
        data-open={shown || undefined}
        style={{ "--sidebar-w": `${width}px` } as CSSProperties}
        aria-label="侧边栏"
        aria-hidden={shown ? undefined : true}
        onContextMenu={(event) => {
          // The sidebar has no browser menu (shared-22 TN); fields keep theirs.
          if (!(event.target as Element).closest("input, textarea")) event.preventDefault();
        }}
        {...(mode === "peek" ? peekHover : {})}
      >
        <div className="sidebar-titlebar">
          {phone ? (
            <Button variant="ghost" size="xs" className="chrome-btn" icon={<Icon name="X" size={16} />} label="关闭侧边栏" onClick={() => setPeek(false)} />
          ) : (
            <span className="reveal">
              <SidebarToggle place="title" />
            </span>
          )}
          <span className="wordmark">Codex</span>
        </div>
        {phone && (
          <div className="sheet-search">
            <Button variant="secondary" size="lg" icon={<Icon name="Search" size={16} />} onClick={() => openPalette("command")}>
              搜索
            </Button>
          </div>
        )}

        <div className="sidebar-body" id={BODY_ID} ref={body} onKeyDown={onRovingKey}>
          <button
            type="button"
            className="sidebar-search hit-row"
            data-row=""
            data-roving-item=""
            data-tab-section=""
            aria-keyshortcuts="Control+K"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => openPalette("command")}
          >
            <span className="nav-lead">
              <Icon name="Search" size="sm" />
            </span>
            <span className="nav-label">搜索</span>
            <kbd className="kbd">{shortcutLabel("command")}</kbd>
          </button>

          <div
            className="sidebar-scroll"
            ref={scroll}
            onScroll={(event) => event.currentTarget.toggleAttribute("data-scrolled", event.currentTarget.scrollTop > 2)}
          >
            <div>
              <nav className="nav-rows" aria-label="导航">
                <button
                  type="button"
                  className="nav-row hit-row"
                  data-row=""
                  data-roving-item=""
                  data-selected={activeId === null || undefined}
                  onClick={() => {
                    newChat();
                    closeSidebarOnMobile();
                  }}
                >
                  <span className="nav-lead">
                    <span className="new-circle">
                      <Icon name="Add" size="sm" />
                    </span>
                  </span>
                  <span className="nav-label">新建</span>
                  <kbd className="kbd">{shortcutLabel("new")}</kbd>
                </button>
                <button type="button" className="nav-row hit-row" data-row="" data-roving-item="" onClick={() => openSettings("skills")}>
                  <span className="nav-lead">
                    <Icon name="Tool" />
                  </span>
                  <span className="nav-label">自定义</span>
                </button>
              </nav>

              <div className="session-list" data-tab-section="" aria-label="会话">
                {(shape.pinned.length > 0 || dragging) && (
                  <section className="list-group" data-kind="pinned" {...dropZone(PINNED, undefined, "置顶")}>
                    <GroupLabel name="置顶" closed={state.collapsed.includes(PINNED)} onToggle={() => toggleCollapsed(PINNED)} />
                    {!state.collapsed.includes(PINNED) && (
                      <div className="code-list">
                        {listRows(PINNED, "置顶", shape.pinned, false, true)}
                        {/* shared-22 Kk: while dragging, an empty Pinned offers itself. */}
                        {!shape.pinned.length && (
                          <div className="pin-drop" data-hot={dropTarget === PINNED || undefined}>
                            <span className="nav-lead">
                              <Icon name="Pin" />
                            </span>
                            <span>{dropTarget === PINNED ? "松开" : "拖放到这里"}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}
                <div className="recents-anchor" {...(!customMode ? dropZone("", undefined, "最近") : {})}>
                  {shape.groups && shape.groups.length > 0 ? (
                    <>
                      {shape.groups.map(renderGroup)}
                      {state.groupBy !== "date" && <LoadMoreRow announce={announce} />}
                    </>
                  ) : (
                    // With no groups the 最近 band stays, so Filter stays within reach (shared-22 Cj Yi2).
                    <section className="list-group">
                      <GroupLabel name="最近" closed={state.collapsed.includes(RECENTS)} onToggle={() => toggleCollapsed(RECENTS)} actions={filter} />
                      {!state.collapsed.includes(RECENTS) && (
                        <div className="code-list">{firstLoad ? <SkeletonRows /> : listRows(RECENTS, "最近", shape.rows, true)}</div>
                      )}
                    </section>
                  )}
                  {list.error && !list.loading && list.ids.length === 0 && (
                    <div className="list-error" role="alert">
                      <p>无法加载您的会话</p>
                      <Button variant="secondary" size="sm" data-roving-item="" onClick={() => void refreshThreads()}>
                        重试
                      </Button>
                    </div>
                  )}
                  {!list.loading && !list.error && !anyRows &&
                    (list.status !== "active" ? (
                      <div className="list-empty list-filtered">
                        <p>没有符合当前筛选条件的会话</p>
                        <button type="button" className="text-btn" data-roving-item="" onClick={() => setListFilter({ status: "all" })}>
                          显示所有会话
                        </button>
                      </div>
                    ) : (
                      <div className="list-empty list-none">您开始的会话会显示在这里</div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-foot">
          <UserMenu />
        </div>
        {mode === "docked" && <ResizeHandle width={width} setWidth={setWidth} aside={aside} />}
      </aside>
      {groupMenu && (
        <GroupMenu
          group={groupMenu.group}
          groupKeys={shape.groups?.map((group) => group.key) ?? []}
          at={groupMenu.at}
          onClose={() => setGroupMenu(null)}
          onRename={(section) => {
            setGroupMenu(null);
            setRenamingGroup(section.id);
          }}
          onArchiveAll={(group) => {
            setGroupMenu(null);
            setArchiveAll(group);
          }}
        />
      )}
      {bulkDelete && <BulkDeleteDialog ids={bulkDelete} onClose={() => setBulkDelete(null)} />}
      {archiveAll && <ArchiveAllDialog group={archiveAll} onClose={() => setArchiveAll(null)} />}
      {state.menu && threads[state.menu.threadId] && (
        <PointerMenu key={`${state.menu.threadId}:${state.menu.at.x}:${state.menu.at.y}`} at={state.menu.at} onClose={() => setLocal({ menu: null })}>
          <SessionMenu row={looseRow(threads[state.menu.threadId])} pinIndex={-1} archived={isArchivedThread(state.menu.threadId)} close={() => setLocal({ menu: null })} />
        </PointerMenu>
      )}
      <DragLabel />
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

/**
 * A folder's or custom group's own menu, on its label's right click (shared-19 g$, shared-20
 * yx): New session (New group…), Rename group, Select all, Collapse all / Expand all,
 * Archive all, Delete group.
 */
function GroupMenu({
  group,
  groupKeys,
  at,
  onClose,
  onRename,
  onArchiveAll,
}: {
  group: Group;
  /** Every group in the list, for Collapse all / Expand all. */
  groupKeys: string[];
  at: { x: number; y: number };
  onClose(): void;
  onRename(section: ThreadSection): void;
  onArchiveAll(group: Group): void;
}) {
  const collapsed = useLocal((s) => s.collapsed);
  const section = group.section ?? null;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const anyOpen = groupKeys.some((key) => !collapsed.includes(key));
  const anyClosed = groupKeys.some((key) => collapsed.includes(key));
  const ids = group.rows.map((row) => row.thread.meta.id);
  const archivable = ids.filter((id) => !isArchivedThread(id));
  return (
    <PointerMenu at={at} onClose={onClose}>
      <MenuItem label="新建会话" onClick={act(() => startIn(section ? { sectionId: section.id } : { folder: group.folder }))} />
      {section && <MenuItem label="新建分组…" onClick={act(() => createGroup())} />}
      {section && (
        <>
          <MenuSep />
          <MenuItem label="重命名分组" onClick={() => onRename(section)} />
          {/* The group's color is Codex's (threadSection appearance, synced across clients). */}
          <MenuItem label="更改颜色…" onClick={act(() => setState({ dialog: { type: "section", sectionId: section.id } }))} />
        </>
      )}
      <MenuSep />
      <span className="reason-tip" data-tip={ids.length < 2 ? "全选至少需要此分组中有两个可见会话。" : undefined}>
        <MenuItem label="全选" disabled={ids.length < 2} onClick={act(() => setLocal({ selected: [...new Set([...local.selected, ...ids])] }))} />
      </span>
      <MenuSep />
      {anyOpen && <MenuItem label="全部折叠" onClick={act(() => setLocal({ collapsed: [...new Set([...local.collapsed, ...groupKeys])] }))} />}
      {anyClosed && <MenuItem label="全部展开" onClick={act(() => setLocal({ collapsed: local.collapsed.filter((key) => !groupKeys.includes(key)) }))} />}
      {(archivable.length > 0 || section) && <MenuSep />}
      {archivable.length > 0 && <MenuItem label={`全部归档（${archivable.length}）`} onClick={() => onArchiveAll(group)} />}
      {section && <MenuItem label="删除分组" danger onClick={act(() => setState({ dialog: { type: "deleteSection", sectionId: section.id } }))} />}
    </PointerMenu>
  );
}

/** Archive all sessions in a group (shared-19 bulk-archive confirm). */
function ArchiveAllDialog({ group, onClose }: { group: Group; onClose(): void }) {
  const ids = group.rows.map((row) => row.thread.meta.id).filter((id) => !isArchivedThread(id));
  return (
    <Dialog
      alert
      size="sm"
      title={`将“${group.label}”中的所有会话归档？`}
      description={`${ids.length} 个会话将被归档。`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              onClose();
              archiveOrRestore(ids, false);
            }}
          >
            全部归档
          </Button>
        </>
      }
    />
  );
}

function BulkDeleteDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      alert
      size="sm"
      title="删除所选项？"
      description={`${ids.length} 项将被永久删除，此操作无法撤销。`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onClose}>
            取消
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setPinned(ids, false);
              void Promise.allSettled(ids.map((id) => deleteThread(id))).then((results) => {
                const failed = results.filter((result) => result.status === "rejected").length;
                if (failed) toast("danger", "删除失败", `${failed} 项没有删除。`);
                onClose();
              });
            }}
          >
            删除
          </Button>
        </>
      }
    />
  );
}
