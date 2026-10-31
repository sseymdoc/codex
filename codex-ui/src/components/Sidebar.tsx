// The dframe sidebar, Code tab only (Claude Desktop 2.42304.0.0 ion-dist shared-18 / 19 / 20 /
// 21 / 22, ce4f4374c and shared-styles): title row, search, nav rows, then Pinned and the list
// grouped by folder, date, custom group or not at all, rows in their families, and the user
// menu. The rest of the sidebar keeps claudeai_cc_epitaxy_session_presets_main off (shared-11
// rc(), the baseline: the Filter menu is shared-21 iU classic), but the session list is the one
// the flag draws (data-code-list, asked for by the user from their own Claude): iconless rows with
// their status at the end (shared-21 Eq), families under an elbow that fold behind an "N nested
// sessions" row, folded groups that keep the open session. Modes: docked, peek (collapsed or a
// narrow window: the switch or a hover floats it out, shared-52 rh()) and the phone sheet
// (browser, < 40rem).

import type { ThreadSection } from "@protocol/v2/ThreadSection";
import {
  Fragment,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
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
  fail,
  forkThread,
  isArchivedThread,
  logout,
  markRead,
  markUnread,
  moveToSection,
  newChat,
  openCloudTask,
  openCustomize,
  openDots,
  openScheduled,
  openImages,
  openLibrary,
  openSplit,
  openThread,
  refreshAccountProfile,
  refreshThreads,
  renameThread,
  requestSessionId,
  setListFilter,
  setThreadProject,
  unarchiveThread,
  updateSection,
} from "../lib/codex";
import { backendMismatch, mismatchText } from "../lib/backend-version";
import { selectChat, useChat } from "../lib/chat";
import { refreshCloudTasks, resetCloud, runningStatus, useCloud, type CloudTask } from "../lib/cloud";
import { resetProfiles } from "../lib/dot-profile";
import { resetDotWork } from "../lib/dot-work";
import { loadDot, refreshDotsAvailable, resetDots, selectDot, useDots, type Dot } from "../lib/dots";
import { MAGNET, STATIC_HINT, advance, edgeLook, magnet, released, resting, settle, snapTiming, staticZone, wheeled } from "../lib/edgeMagnet";
import { threadTitle } from "../lib/format";
import { useImagesEntry } from "../lib/images";
import { libraryPrefs, useLibraryEntry } from "../lib/library";
import { askingThreads } from "../lib/questions";
import { automationsState, inTaskFolder, markRunsRead, useAutomations } from "../lib/automations";
import { inScratch } from "../lib/scratch";
import { heartbeatOn, nextRunOf } from "../lib/rail";
import { dayTime, navMark, type Mark } from "../lib/scheduled-view";
import { blockedBoxThreads } from "../lib/wrap-up";
import { dateBuckets, familyOrder, folderBuckets, outliving, rangeIds, spawnRoot, type SessionSort } from "../lib/session";
import { getState, isShown, isUnread, pluginsOff, readJson, readPref, setState, toast, useStore, writeJson, writePref, type AppState, type ScheduledDialog, type StatusFilter, type ThreadState } from "../lib/store";
import { useWco } from "./Frame";
import { openPalette, shortcutLabel } from "./Palette";
import { DotAvatar, DotMark, useDotEvents } from "./Dots";
import { ScheduledForm } from "./ScheduledForm";
import { dotsNotify } from "./DotProfile";
import { LibraryNewMenu } from "./LibraryDialogs";
import { Confirm, openSettings, useBackendState } from "./Settings";
import { Button, Dialog, Icon, Kbd, MenuItem, MenuSection, MenuSep, Popover, Spinner, StatusDot, Submenu, syncPhase, syncShimmer, useReducedMotion } from "./ui";

const DRAG_TYPE = "application/x-codex-thread";
/** The one session a row drags onto the main area, for split view (App.tsx). */
export const SESSION_DRAG = "application/x-codex-session";
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

// ---------------------------------------------------------------------------
// Local state: pins, grouping, folds, selection and the peek

/** Filter ▸ Group by, classic (shared-21 oU xe2): State waits on claudeai_session_state (off). */
type GroupBy = "date" | "project" | "custom" | "none";

interface Local {
  /** Pinned session ids, top to bottom; kept locally like the package's starred-local-code-sessions. */
  pins: string[];
  /** Folded lists and groups. */
  collapsed: string[];
  /** Family roots whose nested sessions are hidden (shared-20 collapsedFamilies). */
  families: string[];
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
  /**
   * Archive or delete asked of a family root (shared-20 mA): the nested sessions that could stay
   * on their own, and how many sub-agents go with it regardless.
   */
  confirm: { threadId: string; action: "archive" | "delete"; nested: string[]; spawned: number } | null;
  /** 添加定时任务… / 编辑定时任务… from a session's menu: the form, over the session (scheduleSession). */
  scheduleForm: Extract<ScheduledDialog, { type: "form" }> | null;
  /** Sessions to archive that an active heartbeat watches, asked about first (the ChatGPT app's archiveConfirmHeartbeat). */
  unschedule: string[] | null;
}

const PERSIST = {
  pins: "codex-ui:pinned",
  collapsed: "codex-ui:collapsed-sections",
  families: "codex-ui:collapsed-families",
  groupBy: "codex-ui:group-by",
  showEmpty: "codex-ui:show-empty-groups",
} satisfies Partial<Record<keyof Local, string>>;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

// shared-52 _h(): the desktop app groups the Code list by folder, a browser does not group it.
const DEFAULT_GROUP_BY: GroupBy = DESKTOP ? "project" : "none";
const savedGroupBy = readJson(PERSIST.groupBy);

let local: Local = {
  pins: strings(readJson(PERSIST.pins)),
  collapsed: strings(readJson(PERSIST.collapsed)),
  families: strings(readJson(PERSIST.families)),
  groupBy: savedGroupBy === "date" || savedGroupBy === "project" || savedGroupBy === "custom" || savedGroupBy === "none" ? savedGroupBy : DEFAULT_GROUP_BY,
  showEmpty: readJson(PERSIST.showEmpty) === true,
  more: {},
  selected: [],
  anchor: null,
  peek: false,
  kept: [],
  confirm: null,
  scheduleForm: null,
  unschedule: null,
};
const localListeners = new Set<() => void>();

function setLocal(patch: Partial<Local>) {
  local = { ...local, ...patch };
  for (const key of Object.keys(patch) as (keyof Local)[]) {
    const storageKey = (PERSIST as Partial<Record<keyof Local, string>>)[key];
    if (storageKey) writeJson(storageKey, local[key]);
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

/** Hide or show nested sessions under these family roots (shared-20 Ix). */
export function foldFamilies(ids: string[], fold: boolean) {
  const rest = local.families.filter((id) => !ids.includes(id));
  setLocal({ families: fold ? [...rest, ...ids] : rest });
}

/** The family roots listed now and which of them are folded (the palette's nested-session commands). */
export function familyRoots(): { roots: string[]; folded: string[] } {
  const roots = layout(getState(), local).rows.flatMap((row) => (row.place === "head" ? [row.thread.meta.id] : []));
  return { roots, folded: local.families.filter((id) => roots.includes(id)) };
}

/** Hide every listed family's nested sessions, or show them all again (shared-20 Lx). */
export function foldAllFamilies(fold: boolean) {
  setLocal({ families: fold ? [...new Set([...local.families, ...familyRoots().roots])] : [] });
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

export const narrowQuery = (width: number) => `(max-width: ${Math.max(700, Math.ceil(width) + 329)}px)`;

export function readWidth(): number {
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

/** A menu, or a field in the sidebar, keeps the peek out. */
function peekHeld(): boolean {
  const focused = document.activeElement;
  return document.querySelector(".popover") !== null || (!!focused?.closest(".dframe-sidebar") && focused.matches("input, textarea"));
}

function closePeekSoon() {
  clearTimeout(peekTimer);
  if (peekPinned) return;
  peekTimer = window.setTimeout(function attempt() {
    if (peekHeld()) peekTimer = window.setTimeout(attempt, PEEK_CLOSE_MS);
    else setPeek(false);
  }, PEEK_CLOSE_MS);
}

/** shared-16 kg: the edge opens the peek, or keeps one out (a pending close is called off). */
function holdPeek() {
  if (phoneNow || document.querySelector(".dframe-root[data-resizing]")) return;
  clearTimeout(peekTimer);
  if (!local.peek) setPeek(true);
}

/** shared-16 jg: the edge closes the peek at once, unless it is held. */
function dropPeek() {
  if (local.peek && !peekPinned && !peekHeld()) setPeek(false);
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
  setDocked(!getState().sidebarOpen);
}

/** Wide: dock the sidebar or fold it, and remember the choice (shared-52 setCollapsedPref). */
function setDocked(open: boolean) {
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

interface Row {
  thread: ThreadState;
  place: "flat" | "head" | "nested";
  parentTitle: string | null;
  /** A nested row is a fork or a session another one started (sub-agents are never listed). */
  kind: "fork" | "linked" | null;
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

/** A fork hangs under its source, a session another one started under that one (sub-agents are never listed). */
function parentOf(thread: ThreadState): string | null {
  return thread.meta.forkedFromId ?? getState().links[thread.meta.id]?.parentId ?? null;
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
      kind: place === "nested" ? (row.thread.meta.forkedFromId ? "fork" : "linked") : null,
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

function layout({ list, threads, sections, server }: Pick<AppState, "list" | "threads" | "sections" | "server">, state: Local): ListShape {
  const listed = new Set(list.ids);
  // A sub-agent pinned before sub-agents left the list stays out of it too.
  const pins = state.pins.filter((id) => threads[id] && !threads[id].meta.parentThreadId && (listed.has(id) || (list.status !== "archived" && pinLoaded.has(id))));
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
    // A projectless scheduled run works in its task's folder, a folderless session in a scratch workspace: no folder of the user's.
    folder: inTaskFolder(slot[0].thread.meta.cwd, server.info?.codexHome) || inScratch(slot[0].thread.meta.cwd, server.info?.codexHome) ? null : slot[0].thread.meta.cwd,
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

/** A family as listed: its root, the nested sessions on show, and those folded behind its stub. */
interface Family {
  head: Row;
  shown: Row[];
  hidden: Row[];
}

let keptFolds: string[] | null = null;
const keptOpen = new Set<string>();

/** Sessions waiting on the user: a request, a rename to approve, or a mid-turn question or proposed plan not settled yet. */
function waitingOn({ requests, threads, settledQuestions, titleConsents, planConsents, terminalConsents, settingConsents, offers }: Pick<AppState, "requests" | "threads" | "settledQuestions" | "titleConsents" | "planConsents" | "terminalConsents" | "settingConsents" | "offers">): Set<string | null> {
  // A sub-agent waits in the session it runs in (the list has no sub-agents).
  return new Set([...requests.map((request) => requestSessionId(request, threads)), ...Object.keys(titleConsents), ...Object.keys(planConsents), ...Object.keys(terminalConsents), ...Object.keys(settingConsents), ...Object.keys(offers), ...askingThreads(threads, settledQuestions), ...blockedBoxThreads(threads)]);
}

/**
 * The nested sessions a folded family still lists (shared-21 p$ / pz, shared-20 Xx): one waiting
 * on input, and every session opened since the folds last changed.
 */
function keeper(state: Local, activeId: string | null, waiting: Set<string | null>): (row: Row) => boolean {
  if (keptFolds !== state.families) {
    keptFolds = state.families;
    keptOpen.clear();
  }
  if (activeId) keptOpen.add(activeId);
  return ({ thread: { meta } }) => keptOpen.has(meta.id) || waiting.has(meta.id) || (meta.status.type === "active" && meta.status.activeFlags.length > 0);
}

function familyOf([head, ...nested]: Row[], state: Local, keep: (row: Row) => boolean): Family {
  if (!state.families.includes(head.thread.meta.id)) return { head, shown: nested, hidden: [] };
  return { head, shown: nested.filter(keep), hidden: nested.filter((row) => !keep(row)) };
}

/** What a folded list still shows (shared-22 bC): a group keeps the open session; Pinned and 最近 keep nothing. */
function keptIn(key: string, rows: Row[], activeId: string | null): Row[] {
  return key === PINNED || key === RECENTS ? [] : rows.filter((row) => row.thread.meta.id === activeId);
}

/** The rows on screen, top to bottom: folded lists, folded families and rows past 显示更多 left out. */
function visibleRows(shape: ListShape, state: Local): Row[] {
  const app = getState();
  const keep = keeper(state, app.activeId, waitingOn(app));
  const lists: [string, Row[]][] = [[PINNED, shape.pinned], ...(shape.groups ? shape.groups.map((group): [string, Row[]] => [group.key, group.rows]) : [[RECENTS, shape.rows] as [string, Row[]]])];
  return lists.flatMap(([key, rows]) =>
    state.collapsed.includes(key)
      ? keptIn(key, rows, app.activeId)
      : shapeOf(key, rows, state).visible.flatMap((slot) => {
          const family = familyOf(slot, state, keep);
          return [family.head, ...family.shown];
        }),
  );
}

/** Session ids top to bottom as the sidebar shows them (next / previous / jump shortcuts). */
export function sidebarOrder(): string[] {
  return visibleRows(layout(getState(), local), local).map((row) => row.thread.meta.id);
}

// ---------------------------------------------------------------------------
// Row status (shared-20 rD / aD, shared-18 FD): at rest nothing; otherwise a mark at the row's
// end (a 6px dot: waiting warning, unread accent, running muted and blinking; an error's warning)
// that the row's ⋯ replaces under the pointer, and the words for it inside the title.

type Status = "blocked" | "error" | "running" | "unread";

/** What a folded group's label shows first (shared-21 IG). */
const URGENCY: Status[] = ["blocked", "error", "unread", "running"];

const STATUS_LABEL: Record<Status, string> = { blocked: "等待输入", error: "出现错误", running: "运行中", unread: "未读回复" };

function statusOf(thread: ThreadState, waiting: boolean, agents = false): Status | null {
  const { status } = thread.meta;
  const flags = status.type === "active" ? status.activeFlags : [];
  if (waiting || flags.length) return "blocked";
  if (status.type === "systemError") return "error";
  if (activeTurn(thread) || status.type === "active" || agents) return "running";
  return isUnread(thread) ? "unread" : null;
}

/** Sessions with a sub-agent still at work: shared-26 Uj reads hasBackgroundWork as running, after the turn too. */
function agentsWorking(threads: Record<string, ThreadState>): Set<string> {
  const working = new Set<string>();
  for (const { meta } of Object.values(threads)) if (meta.parentThreadId && meta.status.type === "active") working.add(spawnRoot(meta.id, (at) => threads[at]?.meta.parentThreadId));
  return working;
}

// ---------------------------------------------------------------------------
// Claude's sidebar markup: the class strings of its row parts, verbatim (shared-18 vD hD xD wD
// bD KD qD ID HD WD UD, shared-21 YY ZY sX); their rules come from styles/claude.generated.css.

const FOCUS_RING = "hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-[inset_0_0_0_1px_var(--cds-fill-accent),0_0_6px_0_color-mix(in_srgb,var(--cds-fill-accent)_20%,transparent)]";
const HIT_ROW = "hit-row [--cds-hit-gap-y:7px]";
/** A row's fills: hover, focus, selected ("focused"), menu open (xD). */
const ROW_FILL = `${HIT_ROW} rounded-[var(--df-radius-pill)] hover:bg-[var(--df-hover)] focus-visible:bg-[var(--df-hover)] has-[:focus-visible]:bg-[var(--df-hover)] data-[selected=focused]:bg-[var(--df-selected)] data-[selected=focused]:text-primary data-[selected=open]:bg-[var(--df-selected)] data-[menu-open=true]:bg-[var(--df-hover)] data-[context-menu-open=true]:bg-[var(--df-hover)]`;
const ROW_BASE = "w-full shrink-0 border-none text-start text-[length:var(--df-row-font)] text-secondary";
/** wD variant nav. */
const NAV_ROW = `${ROW_BASE} flex items-center gap-[var(--df-row-gap)] h-[var(--df-row-h)] px-[var(--df-row-px)] [&_.df-leading-slot]:text-secondary data-[selected=focused]:[&_.df-leading-slot]:text-primary`;
/** wD variant session, one line. */
const SESSION_ROW = `${ROW_BASE} flex ps-[calc(var(--df-row-px)+var(--df-row-indent,0px))] pe-[var(--df-row-px)] items-center gap-[var(--df-row-gap)] h-[var(--df-row-h)]`;
/** bD: an iconless title starts where an icon's glyph would. */
const ICONLESS = "ps-[var(--df-iconless-pad,calc((var(--df-leading-slot)-var(--df-icon-size))/2))]";
/** KD + qD: the decoration cell at the row's end, over the ⋯. */
const DECORATION = "absolute end-[var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))] -translate-y-1/2 pointer-events-none flex h-[var(--df-row-ctl)] items-center justify-center top-1/2 w-[var(--df-row-ctl)] touch:group-data-[touch-menu]:end-[calc(var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))+var(--df-row-ctl)+4px)]";
const ACTIONS_AT_REST = "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto touch:group-data-[touch-menu]:opacity-100 touch:group-data-[touch-menu]:pointer-events-auto";
/** YY: Show more / Load more rows (shared-21 cX). */
const MORE_BASE = `${FOCUS_RING} ${HIT_ROW} hit-row-main flex h-[var(--df-row-h)] w-full shrink-0 items-center gap-[var(--df-row-gap)] rounded-[var(--df-radius-pill)] text-start text-[length:var(--df-row-font)] text-muted hover:bg-[var(--df-hover)] hover:text-secondary aria-disabled:pointer-events-none aria-disabled:opacity-70`;
const MORE_HELD = " aria-disabled:data-[held]:pointer-events-auto data-[held]:hover:bg-transparent data-[held]:hover:text-muted";
/** QY: in the iconless list the text sits on the titles' inset (its span takes bD). */
const MORE_ROW = `${MORE_BASE} ps-[calc(var(--df-row-px)+var(--df-row-indent,0px))] pe-[var(--df-row-px)]${MORE_HELD}`;
/** eX: Load more sessions, a group's top room above it. */
const LOAD_ROW = `${MORE_BASE} pe-[var(--df-row-px)] ps-[calc(var(--df-row-px)+var(--df-iconless-pad,calc((var(--df-leading-slot)-var(--df-icon-size))/2)))] mt-[var(--df-group-pt)]${MORE_HELD}`;
const FADE_LABEL = "dframe-fade-label block w-full min-w-0 whitespace-nowrap overflow-hidden [text-align:-webkit-match-parent] [text-align:match-parent] [&:where([data-overflowing])]:[mask-image:linear-gradient(var(--df-label-fade-angle,90deg),black_calc(100%_-_24px),transparent_100%)] [&:dir(rtl)]:[--df-label-fade-angle:270deg] [:root:not([dir=rtl])_&:where([data-overflowing]):dir(rtl)]:[--df-label-start-fade:transparent_0,black_24px] [:root[dir=rtl]_&:where([data-overflowing]):dir(ltr)]:[--df-label-start-fade:transparent_0,black_24px]";
/** HD + WD (with UD): an uncleared label also fades under the row's controls on hover. */
const FADE_UNDER_CONTROLS = "[:root:not([dir=rtl])_&:dir(rtl)]:ps-[calc(24px_+_var(--df-fade-clear,20px))] [:root[dir=rtl]_&:dir(ltr)]:ps-[calc(24px_+_var(--df-fade-clear,20px))] touch:[:root:not([dir=rtl])_&:dir(rtl)]:ps-0 touch:[:root[dir=rtl]_&:dir(ltr)]:ps-0 [--df-hover-mask:linear-gradient(var(--df-fade-to,to_right),var(--df-label-start-fade,black_calc(100%_-_24px_-_var(--df-fade-clear,20px))),black_calc(100%_-_24px_-_var(--df-fade-clear,20px)),transparent_calc(100%_-_var(--df-fade-clear,20px)))] group-hover:[mask-image:var(--df-hover-mask)] group-focus-visible:[mask-image:var(--df-hover-mask)] group-has-[:focus-visible]:[mask-image:var(--df-hover-mask)] group-data-[menu-open=true]:[mask-image:var(--df-hover-mask)]";

/**
 * shared-21 sN: a list section marks the pointer or focus inside it (data-hover-within /
 * data-focus-within), one section at a time, so its label's controls show.
 */
function withinMarker(name: string) {
  const inside = (el: Element, node: EventTarget | null) => node instanceof Node && el.contains(node);
  return {
    enter(el: Element, target: EventTarget | null) {
      if (!inside(el, target) || el.hasAttribute(name)) return false;
      for (const other of el.ownerDocument.querySelectorAll(`.group\\/section[${name}]`)) if (!inside(other, target)) other.removeAttribute(name);
      el.setAttribute(name, "");
      return true;
    },
    leave(el: Element, related: EventTarget | null) {
      if (el.hasAttribute(name) && !inside(el, related)) el.removeAttribute(name);
    },
  };
}
const hoverMark = withinMarker("data-hover-within");
const focusMark = withinMarker("data-focus-within");
const hoverWithin = {
  onMouseOver(event: MouseEvent<HTMLElement>) {
    if (!hoverMark.enter(event.currentTarget, event.target)) return;
    // A section that lost focus keeps no stale mark.
    const doc = event.currentTarget.ownerDocument;
    for (const el of doc.querySelectorAll(".group\\/section[data-focus-within]")) if (!doc.activeElement || !el.contains(doc.activeElement)) el.removeAttribute("data-focus-within");
  },
  onMouseOut: (event: MouseEvent<HTMLElement>) => hoverMark.leave(event.currentTarget, event.relatedTarget),
  onFocus: (event: FocusEvent<HTMLElement>) => void focusMark.enter(event.currentTarget, event.target),
  onBlur: (event: FocusEvent<HTMLElement>) => focusMark.leave(event.currentTarget, event.relatedTarget),
};

/**
 * shared-18 OD as a nav row with its own content (no icon prop): the row button, its shortcut a
 * text key that shows on hover (_D). `inRow`: the main button of a row that holds more (a control
 * at its end), which then carries [data-row] and the fills, as a session row's does.
 */
function NavRow({ className = "", selected = false, kbd, inRow = false, children, ...rest }: { selected?: boolean; kbd?: string; inRow?: boolean } & ButtonHTMLAttributes<HTMLButtonElement> & { [data: `data-${string}`]: string }) {
  return (
    <button
      type="button"
      data-row={inRow ? undefined : ""}
      data-roving-item=""
      data-row-main-button=""
      className={`${NAV_ROW} ${inRow ? "rounded-[var(--df-radius-pill)] data-[selected=focused]:text-primary" : ROW_FILL} hit-row-main ${FOCUS_RING} group ${className}`}
      data-row-nav=""
      data-selected={selected ? "focused" : undefined}
      aria-current={selected ? "page" : undefined}
      {...rest}
    >
      {children}
      {kbd && (
        <kbd aria-hidden="true" className="kbd ms-1 me-[var(--df-radius-pill)] leading-none text-muted-as-secondary opacity-0 group-hover:opacity-100">
          {kbd}
        </kbd>
      )}
    </button>
  );
}

/**
 * A row's label (shared-18 ZD): one line that fades over its last 24px once it runs out of room
 * (data-overflowing) and offers the whole text as its tip. `cleared`: nothing at the row's end
 * covers it, so it does not fade further under the controls on hover.
 */
function FadeLabel({ cleared = false, tip, children }: { cleared?: boolean; tip: string; children: ReactNode }) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = outer.current;
    const text = inner.current;
    if (!el || !text) return;
    const sync = () => {
      const over = el.offsetWidth > 0 && text.scrollWidth > el.offsetWidth;
      el.toggleAttribute("data-overflowing", over);
      if (over) {
        el.dataset.tip = tip;
        el.dataset.tipSide = "right";
      } else delete el.dataset.tip;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    observer.observe(text);
    return () => observer.disconnect();
  }, [tip]);
  return (
    <span ref={outer} dir="auto" className={cleared ? FADE_LABEL : `${FADE_LABEL} ${FADE_UNDER_CONTROLS}`}>
      <span ref={inner} className="inline-block whitespace-nowrap align-top">
        {children}
      </span>
    </span>
  );
}

const DOT_COLOR: Record<Exclude<Status, "error">, string> = { blocked: "var(--cds-fill-warning)", unread: "var(--cds-fill-accent)", running: "var(--cds-text-muted)" };

/**
 * A row's status (shared-18 JO / SO / jO, the session list's Pulse dot; zO / LO the error's
 * warning glyph in text-warning).
 */
function RowMark({ status, label }: { status: Status | null; label?: string }) {
  if (!status) return null;
  return (
    <span role="img" aria-label={label ?? STATUS_LABEL[status]} className="flex min-h-3.5 min-w-3.5 shrink-0 items-center justify-center ">
      {status === "error" ? (
        <Icon name="Warning" size="sm" className="text-warning" />
      ) : (
        <span className="contents [--cds-page-bg:transparent]" onAnimationStart={syncPhase}>
          <span
            data-cds="Pulse"
            className={`block size-[calc(0.375rem*var(--cds-rem-scale,1))] rounded-full${status === "running" ? " df-tab-dot-running" : ""}`}
            style={{ background: DOT_COLOR[status], boxShadow: "0 0 0 0.5px var(--cds-page-bg)" }}
          />
        </span>
      )}
    </span>
  );
}

/** The 定时任务 row's marks in Claude's words (shared-21 YY, shared-16 navMark*). */
const SCHEDULED_MARK: Record<Mark, string> = { unread: "定时任务有更新", running: "有定时任务正在运行", blocked: "有一项定时任务正在等待您处理", error: "某个定时任务运行失败" };

/**
 * The 定时任务 row (shared-21 mH: Clock; the ChatGPT app's sidebarElectron.inboxRouteNavLink) with
 * its mark at the end (oX inline, ZY's order) and the ChatGPT app's one context-menu item.
 */
function ScheduledRow({ selected }: { selected: boolean }) {
  const items = useAutomations((s) => s.items);
  const runs = useAutomations((s) => s.runs);
  const unread = useAutomations((s) => s.unread.total);
  const threads = useStore((s) => s.threads);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const mark = useMemo(() => navMark(items ?? [], runs, threads), [items, runs, threads]);
  return (
    <>
      <NavRow
        data-nav-item="scheduled"
        selected={selected}
        onClick={() => {
          openScheduled();
          closeSidebarOnMobile();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(menuPoint(event));
        }}
      >
        <span className="df-leading-slot">
          <Icon name="Clock" />
        </span>
        <span className="flex min-w-0 flex-1 items-center">
          <span className="min-w-0 truncate">定时任务</span>
        </span>
        {mark && (
          <span className="ms-auto me-[calc(var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))-var(--df-row-px))] flex size-[var(--df-row-ctl)] shrink-0 items-center justify-center">
            <RowMark status={mark} label={SCHEDULED_MARK[mark]} />
          </span>
        )}
      </NavRow>
      {menu && (
        <PointerMenu at={menu} onClose={() => setMenu(null)}>
          <MenuItem
            label="全部标记为已读"
            disabled={!unread}
            onClick={() => {
              setMenu(null);
              void markRunsRead().catch(fail("更新未读状态失败"));
            }}
          />
        </PointerMenu>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Menus

/** Single-letter keys while a menu is open (ce4f4374c ze()); 1-9 pick in Move to group. */
export function useMenuKeys(keys: Record<string, (() => void) | undefined>) {
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

/** A menu item that, dimmed, says why as its tip (CDS Menu.Item disabledReason). */
function ReasonTip({ reason, children }: { reason: string | undefined; children: ReactNode }) {
  return (
    <span className="reason-tip" data-tip-reason="" data-tip={reason}>
      {children}
    </span>
  );
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

/** Claude's notice after a bulk action (c39a247c4 xt, shared-46 Archive all) while its undo flag is off; toast() floors it to 6s as CDS does. */
const BULK_MS = 3000;

/**
 * Archive or restore. `bulk` (several picked, or a group's Archive all) says how many went and how
 * many failed, as Claude does with its undo flag off; "partial" when unloaded sessions stay.
 */
function archiveOrRestore(ids: string[], archived: boolean, bulk?: "bulk" | "partial") {
  if (!archived) {
    const next = neighbourOf(ids);
    if (next) void openThread(next);
  }
  setPinned(ids, false);
  void Promise.allSettled(ids.map((id) => (archived ? unarchiveThread(id) : archiveThread(id)))).then((results) => {
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    // Status All keeps them, now on the other side of the archive.
    if (getState().list.status === "all") void refreshThreads();
    if (!bulk) {
      if (failed.length) fail(archived ? "无法取消归档。请重试。" : "无法归档。请重试。")(failed[0].reason);
      return;
    }
    const done = ids.length - failed.length;
    if (done) toast("neutral", archived ? `已取消归档 ${done} 个会话` : `已归档 ${done} 个会话${bulk === "partial" ? "。未加载的会话未归档。" : ""}`, undefined, BULK_MS);
    if (failed.length) toast("warning", archived ? `${failed.length} 个会话取消归档失败。请重试。` : `${failed.length} 个会话归档失败。请重试。`);
  });
}

/**
 * shared-16 ng / tg: archiving the open session moves to the row after it in the sidebar, else the
 * nearest one above, passing over the rows archived with it (and the sub-agents they spawned, which
 * Codex archives along); with none left, the new session page. (Claude's __gb__1299930367, off in
 * the user's Claude, would keep a menu archive in place.)
 */
function neighbourOf(ids: string[]): string | null {
  const { activeId, threads } = getState();
  const order = sidebarOrder();
  const at = activeId && ids.includes(activeId) ? order.indexOf(activeId) : -1;
  if (at === -1) return null;
  const spawner = (id: string) => threads[id]?.meta.parentThreadId;
  const goes = (id: string) => ids.includes(id) || ids.some((root) => outliving(root, [id], spawner).length === 0);
  return [...order.slice(at + 1), ...order.slice(0, at).reverse()].find((id) => !goes(id)) ?? null;
}

/** A family root's nested sessions: the ones that can stay without it, and how many go with it. */
function nestedUnder(id: string): { free: string[]; spawned: number } {
  const state = getState();
  const ids = layout(state, local).rows.flatMap((row) => (row.place === "nested" && row.head === id ? [row.thread.meta.id] : []));
  const free = outliving(id, ids, (child) => state.threads[child]?.meta.parentThreadId);
  return { free, spawned: ids.length - free.length };
}

/** The active heartbeats watching these sessions, which archiving pauses (the bridge's /thread archived). */
const watchedBy = (ids: string[]) => (automationsState().items ?? []).filter((task) => task.kind === "heartbeat" && task.status === "ACTIVE" && ids.includes(task.targetThreadId ?? ""));

/**
 * Archive a session from any menu or command; one an active heartbeat watches asks first (the
 * ChatGPT app's archiveConfirmHeartbeat), then a root with forks under it (shared-20 mA).
 */
export function archiveSession(id: string, unscheduled = false) {
  if (!unscheduled && watchedBy([id]).length) return setLocal({ unschedule: [id] });
  const { free, spawned } = nestedUnder(id);
  if (free.length) setLocal({ confirm: { threadId: id, action: "archive", nested: free, spawned } });
  else archiveOrRestore([id], false);
}

/**
 * 添加定时任务… / 编辑定时任务… (the ChatGPT app's thread menu: sidebarElectron.addAutomation /
 * editAutomation): the form over the session, on the heartbeat watching it, else a new one on it
 * named as the session.
 */
export function scheduleSession(id: string) {
  const heartbeat = heartbeatOn(automationsState().items, id);
  const meta = getState().threads[id]?.meta;
  // As the sidebar names it; an untitled one leaves the name to the instructions.
  const name = meta && (meta.name?.trim() || meta.preview?.trim()) ? threadTitle(meta) : "";
  setLocal({
    scheduleForm: heartbeat
      ? { type: "form", source: "local", id: heartbeat.id, seed: null }
      : { type: "form", source: "local", id: null, seed: { kind: "heartbeat", targetThreadId: id, name } },
  });
}

/** Delete a session from any menu or command; a root with forks under it asks which go (shared-20 mA). */
export function deleteSession(id: string) {
  const { free, spawned } = nestedUnder(id);
  if (free.length) setLocal({ confirm: { threadId: id, action: "delete", nested: free, spawned } });
  else setState({ dialog: { type: "delete", threadId: id } });
}

/**
 * One session's menu (ce4f4374c): edit, organize, remove, a separator between groups, no icons,
 * letter keys. `rename` edits the title in place; without it the rename dialog opens.
 */
function SessionMenu({ row, pinIndex, archived, close, rename }: { row: Row; pinIndex: number; archived: boolean; close(): void; rename?: () => void }) {
  const sections = useStore((s) => s.sections);
  const projects = useStore((s) => s.projects);
  const pins = useLocal((s) => s.pins);
  const folded = useLocal((s) => s.families).includes(row.thread.meta.id);
  const { thread } = row;
  const { meta } = thread;
  const id = meta.id;
  const pinned = pins.includes(id);
  const running = !!activeTurn(thread) || meta.status.type === "active";
  const unread = isUnread(thread);
  const waiting = useStore((s) => waitingOn(s).has(id));
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const pin = archived ? undefined : act(() => setPinned([id], !pinned));
  // shared-20 LS: not for agents' sessions; while one works or waits on you it stays, dimmed, with
  // its reason (ce4f4374c qe). Its U then belongs to Mark as completed, which Codex has no use for.
  const busy = running || waiting;
  const read = meta.parentThreadId ? undefined : act(() => void (unread ? markRead(id) : markUnread(id)).catch(fail("更新未读状态失败")));
  const doRename = archived ? undefined : act(() => (rename ? rename() : setState({ dialog: { type: "rename", threadId: id } })));
  const fork = archived ? undefined : act(() => void forkThread(id).catch(fail("无法分叉此会话。")));
  // The ChatGPT app's continuation group: a heartbeat on the session, not on an agent's (wJn).
  const scheduled = useAutomations((s) => (s.items ? !!heartbeatOn(s.items, id) : null));
  const schedule = archived || meta.parentThreadId ? undefined : act(() => scheduleSession(id));
  // ce4f4374c: a family root shows or hides its nested sessions, after Fork and with no key.
  const nesting = row.place === "head" ? act(() => foldFamilies([id], !folded)) : undefined;
  const lifecycle = act(() => (archived ? archiveOrRestore([id], true) : archiveSession(id)));
  const remove = act(() => deleteSession(id));
  const move = moveItems(
    sections,
    meta.section?.id ?? null,
    (sectionId) => {
      close();
      if ((meta.section?.id ?? null) !== sectionId) moveToSection(id, sectionId).catch(fail("无法移动。请重试。"));
    },
    act(() => createGroup(id)),
  );
  useMenuKeys({ p: pin, u: busy ? undefined : read, r: doRename, f: fork, a: lifecycle, d: remove, ...(archived ? {} : move.keys) });
  const edit = [
    pin && <MenuItem key="pin" label={pinned ? "取消置顶" : "置顶"} kbd="P" onClick={pin} />,
    read && (
      <ReasonTip key="read" reason={busy ? "此会话仍在运行中，或正在等待您的输入。" : undefined}>
        <MenuItem label={unread ? "标记为已读" : "标记为未读"} kbd="U" disabled={busy} onClick={read} />
      </ReasonTip>
    ),
    doRename && <MenuItem key="rename" label="重命名" kbd="R" onClick={doRename} />,
    fork && <MenuItem key="fork" label="分叉" kbd="F" onClick={fork} />,
    // Until the tasks are read it cannot tell adding from editing.
    schedule && <MenuItem key="schedule" label={scheduled ? "编辑定时任务…" : "添加定时任务…"} disabled={scheduled === null} onClick={schedule} />,
    nesting && <MenuItem key="nesting" label={folded ? "显示嵌套会话" : "隐藏嵌套会话"} onClick={nesting} />,
  ].filter(Boolean);
  const organize = [
    pinned && pinIndex > 0 && <MenuItem key="up" label="上移" onClick={act(() => movePin(id, -1))} />,
    pinned && pinIndex >= 0 && pinIndex < pins.length - 1 && <MenuItem key="down" label="下移" onClick={act(() => movePin(id, 1))} />,
    !archived && (
      <Submenu key="move" label="移至分组" className="move-menu">
        {move.items}
      </Submenu>
    ),
    // Codex projects (thread/metadata/update.projectId); clearing one is Codex's own.
    !archived && projects.length > 0 && (
      <Submenu key="project" label="移至项目">
        <div className="menu-scroll">
          {projects.map((project) => (
            <MenuItem
              key={project.id}
              label={project.name}
              checked={meta.projectId === project.id}
              onClick={act(() => void setThreadProject(id, project.id).catch(fail("无法移动。请重试。")))}
            />
          ))}
        </div>
        {meta.projectId && (
          <>
            <MenuSep />
            <MenuItem label="从项目中移除" onClick={act(() => void setThreadProject(id, null).catch(fail("无法从项目中移除。请重试。")))} />
          </>
        )}
      </Submenu>
    ),
  ].filter(Boolean);
  // Split view: beside the open session, when it is neither of the two on screen.
  const splittable = useStore((s) => !!s.activeId && !isShown(s, id) && !meta.parentThreadId);
  const groups = [
    splittable ? [<MenuItem key="split" label="在分屏中打开" onClick={act(() => void openSplit(id))} />] : [],
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
  const threads = useStore((s) => s.threads);
  const pins = useLocal((s) => s.pins);
  const count = ids.length;
  const archived = ids.every((id) => archivedNow(id, status));
  const unpinned = ids.filter((id) => !pins.includes(id));
  const pinnedIds = ids.filter((id) => pins.includes(id));
  // c39a247c4 Q: agents' sessions and working ones aside, the unread can be marked read, the rest unread.
  const idle = ids.filter((id) => threads[id] && !threads[id].meta.parentThreadId && !activeTurn(threads[id]) && threads[id].meta.status.type !== "active");
  const unreadIds = idle.filter((id) => isUnread(threads[id]));
  const readIds = idle.filter((id) => !isUnread(threads[id]));
  const done = (fn: () => void) => () => {
    close();
    clearSelection();
    fn();
  };
  const pin = unpinned.length && !archived ? done(() => setPinned(unpinned, true)) : undefined;
  const unpin = pinnedIds.length ? done(() => setPinned(pinnedIds, false)) : undefined;
  const read = unreadIds.length ? done(() => unreadIds.forEach((id) => void markRead(id).catch(fail("无法标记为已读。请重试。")))) : undefined;
  const unread = readIds.length ? done(() => readIds.forEach((id) => void markUnread(id).catch(fail("无法标记为未读。请重试。")))) : undefined;
  const lifecycle = done(() => (archived || !watchedBy(ids).length ? archiveOrRestore(ids, archived, "bulk") : setLocal({ unschedule: ids })));
  const remove = done(() => onDelete(ids));
  const move = moveItems(
    sections,
    undefined,
    (sectionId) => {
      close();
      clearSelection();
      for (const id of ids) void moveToSection(id, sectionId).catch(fail("无法移动。请重试。"));
    },
    done(() => createGroup()),
  );
  useMenuKeys({ p: pin ?? unpin, u: read ?? unread, a: lifecycle, d: remove, ...(archived ? {} : move.keys) });
  const first = !!(pin || unpin || read || unread);
  return (
    <>
      {pin && <MenuItem label={`置顶 ${unpinned.length}`} kbd="P" onClick={pin} />}
      {unpin && <MenuItem label={`取消置顶 ${pinnedIds.length}`} kbd={pin ? undefined : "P"} onClick={unpin} />}
      {read && <MenuItem label={`将 ${unreadIds.length} 个会话标记为已读`} kbd="U" onClick={read} />}
      {unread && <MenuItem label={`将 ${readIds.length} 项标记为未读`} kbd={read ? undefined : "U"} onClick={unread} />}
      {!archived && (
        <>
          {first && <MenuSep />}
          <Submenu label={`将 ${count} 项移至分组`} className="move-menu">
            {move.items}
          </Submenu>
        </>
      )}
      {(first || !archived) && <MenuSep />}
      <MenuItem label={archived ? `取消归档 ${count}` : `归档 ${count} 项`} kbd="A" onClick={lifecycle} />
      <MenuItem label={`删除 ${count}`} kbd="D" danger onClick={remove} />
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
    ["recency", "最近活动时间"],
  ];
  const label = active ? "筛选（已启用）" : "筛选";
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      className="filter-menu"
      // shared-21 kJ: the trigger is a row action in the label's trailing group.
      anchor={<Button variant="ghost" className="df-chrome-btn relative -my-1 data-[held]:touch-none" data-row-action="" icon={<Icon name="Filter" size={16} />} label={label} aria-expanded={open} onClick={() => setOpen(!open)} />}
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
      <Submenu label="分组依据" value={groupings.find(([value]) => value === groupBy)?.[1]}>
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
            label="清除筛选条件"
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
  // shared-18 ED: no box of its own, the row's text in primary.
  return (
    <input
      type="text"
      className="hide-focus-ring bg-transparent text-primary border-none [text-align:-webkit-match-parent] [text-align:match-parent] flex-1 min-w-0 w-full text-[length:var(--df-row-font)]"
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
  /** A request or a mid-turn question waits on the user (waitingOn). */
  waiting: boolean;
  /** A sub-agent of this session is still at work (agentsWorking). */
  agents: boolean;
  archived: boolean;
  pinIndex: number;
  checked: boolean;
  /** Ids of the selection this row belongs to (two or more): its menus act on all of them. */
  selection: string[] | null;
  onDragStart(event: DragEvent, row: Row): void;
  onBulkDelete(ids: string[]): void;
}

/**
 * A row that leaves the list with focus in it or in its menu (archived, deleted, pinned, moved to
 * a group) hands focus on once the list settles: to the same session where it shows up again,
 * else the next row still listed, else the nearest one above, the order Claude's yield shortcut
 * moves in (shared-16 Sh). Claude's own menus leave focus on <body> here.
 */
function handFocusOn(wrap: HTMLElement | null) {
  const active = document.activeElement;
  if (!wrap || !(wrap.contains(active) || (wrap.querySelector("[data-menu-open]") && active?.closest(".popover")))) return;
  const keys = [...document.querySelectorAll<HTMLElement>('.dframe-sidebar [data-row-key^="code:"]')].map((row) => row.dataset.rowKey ?? "");
  const at = keys.indexOf(wrap.dataset.rowKey ?? "");
  if (at < 0) return;
  const order = [keys[at], ...keys.slice(at + 1), ...keys.slice(0, at).reverse()];
  queueMicrotask(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    for (const key of order) {
      const next = document.querySelector<HTMLElement>(`.dframe-sidebar [data-row-key="${CSS.escape(key)}"] [data-row-main-button]`);
      if (next) return next.focus();
    }
  });
}

const CLOUD = "cloud";

/**
 * Codex Cloud tasks while signed in with ChatGPT: read on start and as the account changes, then
 * as often as the extension polls (15 s while one runs, else 2 min).
 */
function useCloudTasks(): CloudTask[] | null {
  const ready = useStore((s) => s.conn.status === "ready");
  const account = useStore((s) => (s.account?.account?.type === "chatgpt" ? (s.account.account.email ?? "") : null));
  const tasks = useCloud((s) => s.tasks);
  const running = !!tasks?.some((task) => runningStatus(task.status));
  useEffect(() => {
    resetCloud();
  }, [account]);
  useEffect(() => {
    if (!ready || account === null) return;
    void refreshCloudTasks();
    const timer = setInterval(() => void refreshCloudTasks(), running ? 15_000 : 120_000);
    return () => clearInterval(timer);
  }, [ready, account, running]);
  return account === null ? null : tasks;
}

/**
 * The ChatGPT Dots entries: only for a ChatGPT login whose account has Dots (the Codex desktop app
 * hides them otherwise), asked on start and as the account changes. One row (你的 Dot until it is
 * named) while the account has one dot or none; a row for each when it has more. With desktop
 * notifications on, the dot's events are followed here, wherever the user is.
 */
function useDotsEntry(): { dots: Dot[]; label: string } | null {
  const ready = useStore((s) => s.conn.status === "ready");
  const account = useStore((s) => (s.account?.account?.type === "chatgpt" ? (s.account.account.email ?? "") : null));
  const available = useDots((s) => s.available);
  const dots = useDots((s) => s.dots);
  const name = useDots((s) => s.dot?.name ?? null);
  useEffect(() => {
    resetDots();
    resetProfiles();
    resetDotWork();
  }, [account]);
  useEffect(() => {
    if (ready && account !== null) void refreshDotsAvailable();
  }, [ready, account]);
  useEffect(() => {
    if (available) void loadDot();
  }, [available]);
  useDotEvents(!!available && !!window.codexDesktop && dotsNotify());
  return account !== null && available ? { dots, label: name ?? "你的 Dot" } : null;
}

/** A cloud task's row: as a session row, its title and status mark; it opens the task view. */
function CloudRow({ task, active }: { task: CloudTask; active: boolean }) {
  const status: Status | null = runningStatus(task.status) ? "running" : task.status === "failed" ? "error" : task.unread ? "unread" : null;
  const selected = active ? "focused" : undefined;
  return (
    <div data-row-key={`cloud:${task.id}`} className="relative">
      <div data-row="" className={`group ${ROW_FILL}`} data-selected={selected}>
        <button
          type="button"
          data-roving-item=""
          data-row-main-button=""
          className={`${SESSION_ROW} ${FOCUS_RING} hit-row-main rounded-[var(--df-radius-pill)] data-[selected=focused]:text-primary`}
          data-selected={selected}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            openCloudTask(task.id);
            closeSidebarOnMobile();
          }}
        >
          <span data-row-label="iconless" className={`flex-1 min-w-0 ${ICONLESS}`}>
            <FadeLabel cleared={!status} tip={task.title}>
              <span className="relative">
                {task.title}
                {status && <span role="status" className="sr-only">{`，${STATUS_LABEL[status]}`}</span>}
              </span>
            </FadeLabel>
          </span>
        </button>
        {status && (
          <span data-size="xs" data-row-decoration="" className={DECORATION}>
            <span aria-hidden="true" className="flex items-center">
              <RowMark status={status} />
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

/** 云端: the account's current Codex Cloud tasks, newest first, under their own band. */
function CloudGroup({ tasks, collapsed }: { tasks: CloudTask[]; collapsed: boolean }) {
  const open = useStore((s) => (s.activeId ? null : s.cloudTaskId));
  const sorted = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  const badge = (sorted.some((task) => runningStatus(task.status)) && "running") || (sorted.some((task) => task.unread) && "unread") || null;
  return (
    <div data-cloud-list="" data-tab-section="" className="group/section flex flex-col gap-px" {...hoverWithin}>
      <div>
        <GroupLabel name="云端" closed={collapsed} onToggle={() => toggleCollapsed(CLOUD)} badge={collapsed ? badge : undefined} rowless={collapsed} />
      </div>
      {!collapsed && sorted.map((task) => <CloudRow key={task.id} task={task} active={task.id === open} />)}
    </div>
  );
}

/**
 * A session row (shared-21 Eq via shared-18 LE "session"): the title on its own, after the Code
 * mark when pinned; the status mark at the end, under the ⋯ that replaces it on hover.
 */
const CodeRow = memo(function CodeRow({ row, active, waiting, agents, archived, pinIndex, checked, selection, onDragStart, onBulkDelete }: RowProps) {
  const [menu, setMenu] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const { thread, kind, parentTitle } = row;
  const { meta } = thread;
  const title = threadTitle(meta);
  // An archived row says so in words, and dims (shared-21 S1).
  const status = archived ? null : statusOf(thread, waiting, agents);
  // The ChatGPT app's clock on a scheduled run's session or one a heartbeat watches (localTaskRow
  // automation / attachedHeartbeatAutomation), in the status's cell while there is none; the
  // heartbeat's next run is the row's tip (sidebarTaskRow.heartbeatAutomation.nextRun).
  const heartbeat = useAutomations((s) => heartbeatOn(s.items, meta.id));
  // A run's record names its session after a reload too, where thread/list leaves threadSource out.
  // ponytail: past the newest runs the bridge lists per task, a reload drops the clock until the session is opened;
  // a bridge lookup by thread id if older run sessions must keep it.
  const run = useAutomations((s) => s.runs.some((r) => r.threadId === meta.id));
  const clock = archived || status ? null : heartbeat ? "已附加定时任务" : run || meta.threadSource === "automation" ? "定时任务运行" : null;
  const next = heartbeat?.status === "ACTIVE" ? nextRunOf(heartbeat) : null;
  useLayoutEffect(() => () => handFocusOn(wrap.current), []);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      button.current?.focus({ preventScroll: true });
    }
  }, [editing]);
  // Pinned rows lead with the Code glyph (shared-21 P1 icon, shared-18 OO); the rest are iconless.
  const lead = pinIndex >= 0 && (
    <span className="df-leading-slot text-secondary">
      <span className="relative inline-flex">
        <Icon name="Code" />
      </span>
    </span>
  );
  const body = (close: () => void) =>
    selection ? (
      <BulkMenu ids={selection} close={close} onDelete={onBulkDelete} />
    ) : (
      <SessionMenu row={row} pinIndex={pinIndex} archived={archived} close={close} rename={archived ? undefined : () => setEditing(true)} />
    );
  // A picked row shows as the open one does (shared-21 L9 selected: picked || focused).
  const selected = active || checked ? "focused" : undefined;
  // shared-22 $S (row key, jump hint), Z9's pointer wrapper, then shared-18 OD as a session row with a
  // menu: the main button, the status in the decoration cell, the ⋯ in the action cell.
  return (
    <div ref={wrap} data-row-key={`code:${meta.id}`} data-jump-hint-row="" className="relative df-drag-shiftable">
      <div>
        {editing ? (
          <div data-row="" data-editing="" className={`${SESSION_ROW} ${ROW_FILL}${archived ? " text-muted opacity-50" : ""}`} data-selected={selected}>
            {lead}
            {lead ? renameField() : <span className={`flex-1 min-w-0 ${ICONLESS}`}>{renameField()}</span>}
          </div>
        ) : (
          <div
            data-row=""
            className={`group ${ROW_FILL}${archived ? " text-muted opacity-50" : ""}`}
            data-selected={selected}
            data-menu-open={menu || undefined}
            data-context-menu-open={at ? true : undefined}
            data-touch-menu={active || undefined}
            draggable={!archived}
            onDragStart={(event) => onDragStart(event, row)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(false);
              setAt(menuPoint(event));
            }}
          >
            <button
              ref={button}
              type="button"
              data-roving-item=""
              data-row-main-button=""
              className={`${SESSION_ROW} ${FOCUS_RING} hit-row-main rounded-[var(--df-radius-pill)] data-[selected=focused]:text-primary touch:group-data-[touch-menu]:pe-[calc(var(--df-row-px)+var(--df-row-ctl)+4px)]`}
              data-selected={selected}
              aria-current={active ? "page" : undefined}
              data-tip={next != null ? `下次运行：${dayTime(next, Date.now(), true)}` : undefined}
              data-tip-side={next != null ? "right" : undefined}
              // Said again as the pointer comes: 明天 turns into 今天 overnight.
              onPointerEnter={next != null ? (event) => void (event.currentTarget.dataset.tip = `下次运行：${dayTime(next, Date.now(), true)}`) : undefined}
              onClick={(event) => clickRow(event, meta.id)}
              onDoubleClick={(event) => {
                if (archived || event.shiftKey || event.ctrlKey || event.metaKey) return;
                setEditing(true);
              }}
            >
              {lead}
              <span data-row-label={lead ? "" : "iconless"} className={lead ? "flex-1 min-w-0" : `flex-1 min-w-0 ${ICONLESS}`}>
                <FadeLabel cleared={!!(status || clock)} tip={title}>
                  <span className="relative">
                    {kind && parentTitle ? (
                      <span className="relative">
                        {title}
                        <span className="sr-only">{kind === "fork" ? `，从 ${parentTitle} 分叉` : `，由 ${parentTitle} 启动`}</span>
                      </span>
                    ) : (
                      title
                    )}
                    {archived && <span className="sr-only">，已归档</span>}
                    {status && (
                      <span role="status" className="sr-only [[role=tooltip]_&]:hidden" data-find-omitted="">
                        {`，${STATUS_LABEL[status]}`}
                      </span>
                    )}
                    {clock && <span className="sr-only [[role=tooltip]_&]:hidden" data-find-omitted="">{`，${clock}`}</span>}
                  </span>
                </FadeLabel>
              </span>
              {/* With a status, an empty tail keeps the decoration cell's room (OD tailBesideControls). */}
              {(status || clock) && <span className="shrink-0 flex items-center gap-1.5 text-xs text-muted-as-secondary me-[calc(var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))+var(--df-row-ctl)+var(--df-deco-extra,0px)-var(--df-row-pad-end,var(--df-row-px)))]" />}
              {checked && selection && <span className="sr-only">，已选择</span>}
            </button>
            {(status || clock) && (
              <span data-size="xs" data-row-decoration="" aria-hidden={menu || undefined} className={`${DECORATION} ${menu ? "opacity-0" : "group-hover:opacity-0 group-has-[:focus-visible]:opacity-0"}`}>
                <span aria-hidden="true" className="flex items-center">
                  {status ? <RowMark status={status} /> : <Icon name="Clock" size="sm" className="text-muted" />}
                </span>
              </span>
            )}
            <div className={`absolute end-[var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))] -translate-y-1/2 flex items-center gap-0.5 top-1/2 ${menu ? "opacity-100" : ACTIONS_AT_REST}`}>
              {/* shared-18 tO: DotsHorizontal inside the session list (GE set). */}
              <Popover
                open={menu}
                onClose={() => setMenu(false)}
                placement="bottom-end"
                anchor={
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<Icon name="DotsHorizontal" size={16} />}
                    label={`${title} 的更多选项`}
                    tip=""
                    className="size-[var(--df-row-ctl)] text-secondary hover:text-primary aria-expanded:text-primary"
                    data-row-action=""
                    tabIndex={-1}
                    aria-expanded={menu}
                    onClick={() => setMenu(!menu)}
                  />
                }
              >
                {body(() => setMenu(false))}
              </Popover>
            </div>
            {at && (
              <PointerMenu at={at} onClose={() => setAt(null)}>
                {body(() => setAt(null))}
              </PointerMenu>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function renameField() {
    return (
      <RenameField
        value={title}
        label="重命名"
        onDone={(next, keyboard) => {
          refocus.current = keyboard;
          setEditing(false);
          const value = next?.trim();
          if (value && value !== title) renameThread(meta.id, value).catch(fail("重命名失败。您可以重试。"));
        }}
      />
    );
  }
});

/**
 * Show more (shared-21 TW in the session list: no count on its face, the text on the titles'
 * inset): twenty more rows a press, the next page from the server at the end of the last list,
 * then Show less.
 */
function MoreRow({ listKey, label, shape, fetch, announce }: { listKey: string; label: string; shape: Shape; fetch: boolean; announce(text: string): void }) {
  const loading = useStore((s) => s.list.loading);
  const cursor = useStore((s) => s.list.cursor !== null);
  const canFetch = fetch && cursor;
  if (!shape.hidden && !canFetch && !shape.revealed) return null;
  const reveal = Math.min(TRUNCATE, shape.hidden);
  const fetching = !shape.hidden && canFetch && loading;
  const less = !shape.hidden && !canFetch;
  const text = less ? "收起" : fetching ? "正在加载…" : "显示更多";
  const aria = less ? `在 ${label} 中显示更少` : reveal ? `在 ${label} 中再显示 ${reveal} 项` : "显示更多会话";
  return (
    <div data-row-key={`label:showmore:${listKey}`} className="df-drag-shiftable [overflow-anchor:none]">
    <button
      type="button"
      className={MORE_ROW}
      data-row=""
      data-roving-item=""
      aria-label={aria}
      aria-disabled={fetching || undefined}
      onClick={() => {
        if (fetching) return;
        if (less) {
          setLocal({ more: { ...local.more, [listKey]: 0 } });
          announce(`在${label}中显示较少内容`);
        } else if (reveal) {
          setLocal({ more: { ...local.more, [listKey]: shape.revealed + TRUNCATE } });
          announce(`在${label}中另外显示 ${reveal} 项`);
        } else {
          const before = getState().list.ids.length;
          setLocal({ more: { ...local.more, [listKey]: shape.revealed + TRUNCATE } });
          void refreshThreads(true).then(() => announce(`已额外加载 ${Math.max(0, getState().list.ids.length - before)} 个会话`));
        }
      }}
    >
      <span className={ICONLESS}>{text}</span>
    </button>
    </div>
  );
}

/**
 * A folded family's hidden members (shared-21 g$): how many, which of them failed, have news or
 * still work, and a press that shows them again and moves focus to the first.
 */
function FamilyStub({ headId, hidden, someListed, statusFor }: { headId: string; hidden: Row[]; someListed: boolean; statusFor(row: Row): Status | null }) {
  const count = (status: Status) => hidden.filter((row) => statusFor(row) === status).length;
  const failed = count("error");
  const unread = count("unread");
  const working = count("running");
  const sessions = `${someListed ? "还有 " : ""}${hidden.length} 个嵌套会话`;
  const news = [failed && `${failed} 个失败`, unread && `${unread} 个未读`, working && `${working} 个正在运行`].filter(Boolean);
  // shared-21 u7: each count after a muted middle dot.
  const chip = (children: ReactNode) => (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="px-1.5 text-muted">
        ·
      </span>
      {children}
    </span>
  );
  return (
    <div data-row-key={`family-stub:${headId}`} className="df-drag-shiftable relative">
      <button
        type="button"
        data-row=""
        data-roving-item=""
        className={`df-family-stub ${HIT_ROW} hit-row-main flex h-[var(--df-row-h)] w-full min-w-0 items-center rounded-[var(--df-radius-pill)] pe-[var(--df-row-px)] ps-[calc(var(--df-row-px)+var(--df-row-indent,0px)+var(--df-iconless-pad,calc((var(--df-leading-slot)-var(--df-icon-size))/2)))] text-start text-[length:var(--df-group-font)] text-secondary hover:text-primary ${FOCUS_RING}`}
        aria-label={`显示 ${sessions}${news.length ? `、${news.join("、")}` : ""}`}
        onClick={(event) => {
          if (event.detail > 1) return;
          foldFamilies([headId], false);
          // The stub goes away with the fold, so focus moves on to the first row it hid.
          requestAnimationFrame(() => document.querySelector<HTMLElement>(`.dframe-sidebar [data-row-key="code:${CSS.escape(hidden[0].thread.meta.id)}"] [data-row-main-button]`)?.focus());
        }}
      >
        <span className="df-fade-truncate flex items-center whitespace-nowrap">
          <span data-row-label="" className="min-w-0">
            <FadeLabel cleared tip={sessions}>
              {sessions}
            </FadeLabel>
          </span>
          {failed > 0 && chip(`${failed} 个失败`)}
          {unread > 0 &&
            chip(
              <span className="flex items-center gap-1.5 text-accent">
                <StatusDot kind="ready" />
                {unread} 个未读
              </span>,
            )}
          {working > 0 && chip(`${working} 个正在运行`)}
        </span>
        {failed > 0 && (
          <span aria-hidden="true" data-row-decoration="" className="me-[calc(var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))-var(--df-row-px))] ms-auto flex size-[var(--df-row-ctl)] shrink-0 items-center justify-center">
            <span role="img" aria-label={STATUS_LABEL.error} className="flex items-center justify-center">
              <Icon name="Warning" size="sm" className="text-warning" />
            </span>
          </span>
        )}
      </button>
    </div>
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
      className={LOAD_ROW}
      data-row=""
      data-roving-item=""
      aria-label="加载更多会话"
      aria-disabled={loading || undefined}
      onClick={() => {
        if (loading) return;
        const before = getState().list.ids.length;
        void refreshThreads(true).then(() => announce(`已额外加载 ${Math.max(0, getState().list.ids.length - before)} 个会话`));
      }}
    >
      {loading ? "正在加载…" : "加载更多会话"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Group labels (shared-18 fD in the session list): a row-tall band, the caret shows while the
// list is hovered or the list is folded; folded, the most urgent status it hides follows the caret.

function GroupLabel({
  name,
  lead,
  closed,
  onToggle,
  actions,
  onContextMenu,
  renaming,
  badge,
  rowless,
}: {
  name: string;
  lead?: ReactNode;
  closed: boolean;
  onToggle(): void;
  actions?: ReactNode;
  onContextMenu?(event: MouseEvent<HTMLElement>): void;
  renaming?: ReactNode;
  badge?: Status | null;
  /** Folded with nothing kept on show: the label takes the rows' gap under it. */
  rowless?: boolean;
}) {
  // shared-18 sO: the band, its toggle (name, caret, the folded group's badge), then the trailing buttons.
  return (
    <div
      data-sidebar-group-label=""
      data-kind="group"
      data-rowless={rowless || undefined}
      className="group/labelrow df-label-inset flex w-full items-center gap-[var(--df-row-gap)] pt-[var(--df-group-pt)] pe-[calc((var(--df-row-h)-24px)/2)] pb-1 text-[length:var(--df-group-font)] leading-4 font-normal font-header text-muted min-h-[calc(var(--df-group-pt)+(var(--df-row-h)-8px)+4px)]"
      onContextMenu={onContextMenu}
    >
      {lead}
      {renaming ?? (
        <button
          type="button"
          data-group-toggle=""
          aria-expanded={!closed}
          className={`${FOCUS_RING} ${HIT_ROW} hit-row-main group/label -my-1 -ms-1 flex min-w-0 flex-1 items-center rounded-[var(--df-radius-pill)] py-1 ps-1 text-start hover:text-secondary gap-1`}
          onClick={onToggle}
        >
          <span data-group-name="" className="min-w-0 truncate">
            {name}
          </span>
          <Icon
            name="CaretRight"
            size="xs"
            data-group-caret=""
            style={{ rotate: closed ? undefined : "90deg" }}
            className={`shrink-0 transition-transform duration-fast motion-reduce:transition-none group-data-[hover-within]/section:opacity-100 group-focus-visible/label:opacity-100 ${closed ? "opacity-100" : "opacity-0"}`}
          />
          {badge && (
            <span data-group-badge="" className="-my-1 ms-auto flex size-6 shrink-0 items-center justify-center">
              <RowMark status={badge} />
            </span>
          )}
        </button>
      )}
      {actions && <div className="flex items-center">{actions}</div>}
    </div>
  );
}

/** A group's + (shared-21 p7 / hJ): a new session that starts in that group or folder. */
function GroupAdd({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <span className="-my-1">
      <Button variant="ghost" icon={<Icon name="Add" size={16} />} label={label} tip="" className="df-chrome-btn" data-row-action="" tabIndex={-1} onClick={onClick} />
    </span>
  );
}

/**
 * The 资料库 row (shared-21 mH: Collection) with its + (cZ: Add at the row's end, its tip "New in
 * Library"), built as a session row is: [data-row], the fills and the touch menu on the row, so
 * the + keeps the row lit and → reaches it. Its menu is the page's 新建 for where the page is (its
 * root on the last tab when it is not open, which 笔记, 文件夹 and 上传文件 open first), beside
 * the + (aZ: inline-end). ponytail: the page's search and filters are its own state, so here
 * only the trash keeps them closed (and a batch under way).
 */
function LibraryRow({ selected, onOpen }: { selected: boolean; onOpen(): void }) {
  const [open, setOpen] = useState(false);
  const route = useStore((s) => s.libraryRoute) ?? { tab: libraryPrefs().lastTab };
  const query = { tab: route.tab, directoryId: route.directoryId ?? null, deleted: !!route.deleted, search: "", categories: [], sources: [] };
  return (
    <div data-row="" className={`relative group ${ROW_FILL}`} data-selected={selected ? "focused" : undefined} data-menu-open={open || undefined} data-touch-menu={selected || undefined}>
      <NavRow inRow data-nav-item="library" selected={selected} onClick={onOpen}>
        <span className="df-leading-slot">
          <Icon name="Collection" />
        </span>
        <span className="flex min-w-0 flex-1 items-center">
          <span className="min-w-0 truncate">资料库</span>
        </span>
      </NavRow>
      <div className={`absolute end-[var(--df-row-ctl-inset,calc((var(--df-row-h)-var(--df-row-ctl))/2))] -translate-y-1/2 flex items-center gap-0.5 top-1/2 ${open ? "opacity-100" : ACTIONS_AT_REST}`}>
        <LibraryNewMenu
          query={query}
          placement="inline-end"
          onOpenChange={setOpen}
          onAct={() => {
            if (!getState().libraryRoute) openLibrary();
          }}
          anchor={(shown, toggle) => (
            <Button
              variant="ghost"
              size="xs"
              icon={<Icon name="Add" size={16} />}
              label="在资料库中新建"
              // Its tip, kept shut while the menu is open (iZ).
              tip={shown ? "" : undefined}
              className="size-[var(--df-row-ctl)] text-secondary hover:text-primary aria-expanded:text-primary"
              data-row-action=""
              tabIndex={-1}
              aria-expanded={shown}
              onClick={toggle}
            />
          )}
        />
      </div>
    </div>
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

/**
 * 实验型后端版本不匹配 (lib/backend-version) as Claude's notice card in the banner slot over the
 * footer (ccc47c03f D, its EpitaxyInstallUpsells cards): a tile, the line, the fix the backend's
 * channel has — 重启应用 once another backend waits, 检查更新 for Release / Preview, 选择后端包 for a
 * custom one — and ✕, which hides it until the next start. 设置 → 实验性功能 names what is missing.
 * The tile stays size-18: the line always takes two lines here, where D measures it.
 */
function BackendCard() {
  const server = useStore((s) => s.server);
  const mismatch = useMemo(() => backendMismatch(server.experimental, server.info), [server.experimental, server.info]);
  const backend = useBackendState();
  const [hidden, setHidden] = useState(false);
  // A 检查更新 from here reports its outcome, unless the card turns into 重启应用.
  const asked = useRef(false);
  const busy = backend?.phase === "download" || backend?.phase === "build" || backend?.phase === "install";
  useEffect(() => {
    if (!backend || busy || !asked.current) return;
    asked.current = false;
    if (!backend.restartNeeded && backend.message) toast(backend.phase === "error" ? "warning" : "neutral", backend.message);
  }, [backend, busy]);
  if (!mismatch || hidden) return null;
  const desktop = window.codexDesktop;
  const update = async () => {
    asked.current = true;
    const error = await desktop!.updateBackend();
    if (error) { asked.current = false; toast("warning", "无法检查更新", error); }
  };
  const choose = async () => {
    const result = await desktop!.setDesktopSettings({ backendChannel: "custom" });
    if (!result.ok) toast("warning", "无法安装后端包", result.error);
  };
  const action = !desktop || !backend ? null
    : backend.restartNeeded ? { label: "重启应用", run: () => desktop.relaunch() }
    : backend.channel === "release" || backend.channel === "preview" ? { label: busy ? (backend.phase === "build" ? "正在编译…" : "正在检查…") : "检查更新", run: update }
    : backend.channel === "custom" ? { label: busy ? "正在安装…" : "选择后端包", run: choose }
    : null;
  return (
    <div data-cds="Card" data-size="xs" className="group/card relative isolate flex flex-col rounded-card after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-card-ring after:content-['']">
      <span aria-hidden="true" className="cds-card-fill pointer-events-none absolute inset-0 -z-[1] m-0 rounded-[inherit]" />
      <div data-cds-card-body="" className="cds-card-body flex min-h-0 flex-1 flex-col self-stretch [gap:inherit] [align-items:inherit] [justify-content:inherit] rounded-[inherit] p-lg">
        <div className="@container relative flex items-start gap-sm" role="status">
          <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded bg-alpha-2 text-primary @max-[12rem]:size-10 size-18">
            <Icon name="Warning" size={28} className="text-warning" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col items-start justify-between gap-xs self-stretch">
            <span className="flex min-h-control max-w-full items-center text-body text-primary">
              <span className="line-clamp-3 break-words">{mismatchText(mismatch)}</span>
            </span>
            {action && (
              <Button variant="secondary" disabled={busy} onClick={() => void action.run()}>
                {busy && <Spinner size={14} inherit />}
                {action.label}
              </Button>
            )}
          </div>
          <Button variant="ghost" icon={<Icon name="X" />} label="关闭" onClick={() => setHidden(true)} />
        </div>
      </div>
    </div>
  );
}

/** The user button (avatar · name · plan) spans the row and opens the account menu (cd75f6c8c). */
function UserMenu() {
  const account = useStore((s) => s.account?.account ?? null);
  const profile = useStore((s) => s.accountProfile);
  const avatarUrl = account?.type === "chatgpt" ? profile?.avatarUrl : null;
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);
  useEffect(() => setFailedAvatar(null), [profile]);
  // null until account/read answers: show an empty button rather than “未登录”.
  const needsAuth = useStore((s) => (s.account ? s.account.requiresOpenaiAuth : null));
  const [open, setOpen] = useState(false);
  const name =
    account?.type === "chatgpt"
      ? (profile?.displayName || account.email?.split("@")[0] || "ChatGPT")
      : account?.type === "apiKey"
        ? "API Key"
        : account?.type === "amazonBedrock"
          ? "Amazon Bedrock"
          : needsAuth === null
            ? ""
            : needsAuth
              ? "未登录"
              : "本地模型";
  // Codex reports the plan in lower case ("plus"); Claude's footer names it capitalized.
  const plan = account?.type === "chatgpt" && account.planType ? account.planType.charAt(0).toUpperCase() + account.planType.slice(1) : null;
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
      // shared-19 rP: the avatar on the rail, the name, "· plan", the caret.
      anchor={
        <button
          type="button"
          data-testid="user-menu-button"
          className="df-user-menu-btn cds-reset flex h-[max(28px,var(--df-footer-btn-size))] max-w-full items-center gap-[var(--df-row-gap)] rounded-[var(--df-radius-pill)] ps-[var(--df-row-px)] pe-2 text-start outline-none hover:bg-[var(--df-hover)] focus-visible:shadow-focus"
          aria-expanded={open}
          aria-label="账户菜单"
          onClick={() => {
            if (!open) void refreshAccountProfile();
            setOpen(!open);
          }}
        >
          <span className="df-on-rail relative flex w-[var(--df-leading-slot)] shrink-0 items-center justify-center">
            {avatarUrl && avatarUrl !== failedAvatar
              ? <img key={avatarUrl} className="avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatarUrl)} />
              : <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>}
          </span>
          <span className="df-user-menu-trailing flex min-w-0 gap-1 overflow-hidden text-[length:var(--df-row-font)] df-footer-suffix items-baseline">
            <span className="df-footer-name whitespace-nowrap text-secondary max-w-full shrink-0" title={name}>
              {name}
            </span>
            {plan && (
              <>
                <span aria-hidden="true" className="df-footer-suffix-text text-muted-as-secondary">
                  ·
                </span>
                <span className="df-footer-suffix-text min-w-0 whitespace-nowrap text-muted-as-secondary">{plan}</span>
              </>
            )}
          </span>
          <Icon name="CaretDown" size="xs" className="df-user-menu-trailing shrink-0 text-muted-as-secondary" />
        </button>
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
          <MenuItem icon={<Icon name="Logout" size={16} />} label="退出登录" onClick={go(() => void logout().catch(fail("退出登录失败")))} />
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
  const [dragging, setDragging] = useState(false);
  const save = (next: number) => {
    setWidth(next);
    writePref(WIDTH_KEY, String(Math.round(next)));
  };
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const root = aside.current?.closest<HTMLElement>(".dframe-root");
    const from = event.clientX;
    let moved = false;
    let next = width;
    let below = false;
    const move = (e: globalThis.PointerEvent) => {
      // A press only counts as a drag once it has moved more than 3px.
      if (!moved && Math.abs(e.clientX - from) <= 3) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        root?.setAttribute("data-resizing", "");
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
      setDragging(false);
      root?.removeAttribute("data-resizing");
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
  // shared-21 tz: CDS ResizeHandle (shared-9 im) at the sidebar's inline end, its tip Hide sidebar
  // with Drag to resize under it.
  return (
    <div
      data-cds="ResizeHandle"
      role="separator"
      aria-orientation="vertical"
      tabIndex={0}
      data-dragging={dragging ? "" : undefined}
      className="cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize absolute inset-y-0 end-[calc(-6px_-_(var(--cds-ring-outer,0px)_-_var(--cds-ring-inner,0px))_/_2)] dframe-resize-handle"
      aria-label="调整侧边栏宽度"
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      data-tip="隐藏侧边栏"
      data-tip-kbd={shortcutLabel("sidebar")}
      data-tip-detail="拖动以调整大小"
      data-tip-side="right"
      data-tip-track="y"
      onPointerDown={start}
      onKeyDown={onKeyDown}
    >
      <div aria-hidden="true" className="absolute rounded-full transition-shadow duration-fast group-focus-visible/resize:shadow-focus inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize" />
      <div
        aria-hidden="true"
        data-cds-part="resize-pill"
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current transition-[opacity,color,background-color] h-full max-h-12 w-[3px] group-focus-visible/resize:max-h-none ${dragging ? "text-secondary opacity-100 duration-snap" : "text-muted opacity-[var(--cds-resize-pill-force,0)] delay-200 duration-base group-hover/resize:opacity-100"} group-focus-visible/resize:bg-fill-accent group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0`}
      />
    </div>
  );
}

/**
 * The sidebar switch. place="chrome" is the Windows chrome bar's (always shown, Ctrl+B, a hover
 * peeks when collapsed); "title" sits in the sidebar's own title row; "trigger" is the browser's
 * collapsed-state button at the top left.
 */
export function SidebarToggle({ place = "chrome" }: { place?: "chrome" | "title" | "trigger" }) {
  const open = useStore((s) => s.sidebarOpen);
  const peek = useLocal((s) => s.peek);
  const toggle = (className: string, size?: "sm" | "lg", style?: CSSProperties) => (
    <Button
      variant="ghost"
      size={size}
      className={className}
      style={style}
      icon={<Icon name="Sidebar" size="sm" className={place === "trigger" ? "text-secondary" : undefined} />}
      // A narrow window's switch closes the peek it opened; a wide one's docks the sidebar.
      label={place === "title" || open || (peek && (narrowNow || phoneNow)) ? "隐藏侧边栏" : "显示侧边栏"}
      kbd={shortcutLabel("sidebar")}
      tipSide={place === "chrome" ? "bottom" : undefined}
      data-testid={place === "trigger" ? "sidebar-compact-trigger" : undefined}
      aria-controls={BODY_ID}
      // Collapsed, the switch also owns the peek (shared-22 ML: aria-expanded while peekable).
      aria-expanded={place !== "title" && !open ? peek : undefined}
      onClick={toggleSidebar}
    />
  );
  // ML: in the chrome bar, its own hover owner for the peek.
  if (place === "chrome")
    return (
      <div className="flex items-center" data-peek-owner="" {...peekHover}>
        {toggle("draggable-none", "sm")}
      </div>
    );
  // shared-21 YF: collapsed in a browser, the compact trigger (lg in the compact density).
  // Claude's Icon keeps its own size in any button (an inline font-size), so the glyph stays 16.
  if (place === "trigger") return toggle("df-compact-trigger draggable-none", "lg", { "--btn-icon": "16px", "--btn-icon-wght": "533.3" } as CSSProperties);
  // shared-21 cz: in the sidebar's title row.
  return toggle("df-chrome-btn");
}

/**
 * Placeholder rows while the first page of sessions loads (shared-21 TK / OK, iconless session
 * rows): a CDS Skeleton bar 68 / 54 / 44% of the title's room in each, standing alone (no
 * SkeletonGroup), so each shimmers and says 加载中 (shared-frame Ad), all sweeping in step.
 */
function SkeletonRows() {
  const widths = ["68%", "54%", "44%"];
  return (
    <div className="df-placeholder-rows flex flex-col gap-px" data-testid="sidebar-bucket-rows-skeleton">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} data-row="" className="flex h-[var(--df-row-h)] items-center gap-[var(--df-row-gap)] pe-[var(--df-row-px)] ps-[calc(var(--df-row-px)+var(--df-row-indent,0px))]">
          <span className={`flex min-w-0 flex-1 items-center ${ICONLESS}`}>
            <div
              ref={syncShimmer}
              data-cds="Skeleton"
              role="status"
              className="relative h-[1em] max-w-full overflow-hidden rounded bg-[var(--cds-skeleton-base)] after:absolute after:inset-0 after:animate-[cds-shimmer_2s_linear_infinite] after:bg-[linear-gradient(90deg,transparent,var(--cds-skeleton-sheen),transparent)] motion-reduce:after:hidden"
              style={{ width: widths[index % widths.length], height: "var(--df-row-font, 13px)" }}
            >
              <span className="sr-only">加载中</span>
            </div>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The collapsed browser sidebar's chrome (shared-21 nI): the compact trigger. Where the trigger
 * really ends is reported to the frame (--df-trigger-right, and --df-nav-extent past the trigger)
 * whenever it is not the CSS-derived place, so the page header clears it.
 */
function CollapsedChrome() {
  const chrome = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = chrome.current;
    const root = el?.closest<HTMLElement>(".dframe-root");
    if (!el || !root) return;
    const rtl = document.documentElement.dir === "rtl";
    const end = (box: DOMRect) => (rtl ? root.clientWidth - box.left : box.right);
    let shown = "";
    const clear = () => {
      root.style.removeProperty("--df-trigger-right");
      root.style.removeProperty("--df-nav-extent");
    };
    const measure = () => {
      const box = el.getBoundingClientRect();
      if (box.width === 0) return;
      const at = end(box);
      const right = Math.round(at);
      const trigger = el.querySelector(".df-compact-trigger");
      const triggerEnd = trigger ? Math.round(end(trigger.getBoundingClientRect()) + (parseFloat(getComputedStyle(trigger)[rtl ? "marginLeft" : "marginRight"]) || 0)) : null;
      const extent = triggerEnd === null ? 0 : Math.max(0, right - triggerEnd);
      const derived = parseFloat(getComputedStyle(root).getPropertyValue("--df-trigger-right-derived"));
      const next = Math.abs(derived - at) < 1 && extent === 0 ? "" : `${right}px ${extent}px`;
      if (next === shown) return;
      shown = next;
      if (!next) clear();
      else {
        root.style.setProperty("--df-trigger-right", `${right}px`);
        root.style.setProperty("--df-nav-extent", `${extent}px`);
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(root);
    return () => {
      observer.disconnect();
      if (shown) clear();
    };
  }, []);
  return (
    <div ref={chrome} className="df-collapsed-chrome flex items-center">
      <SidebarToggle place="trigger" />
    </div>
  );
}

/** Where the pointer is, from the window's start edge (shared-16 ig). */
const fromEdge = (x: number) => (document.documentElement.dir === "rtl" ? window.innerWidth - x : x);

/** What the pointer is over when it is over the sidebar or what owns its peek. */
const PEEK_OWNERS = ".dframe-sidebar, [data-peek-owner]";

/**
 * shared-21 MM: with motion reduced, the hint strip shows while a mouse is within 48px of the edge
 * (below the chrome bar) and the peek opens after 100ms within 16px; leaving that closes it soon.
 */
function useStaticHint(on: boolean, handle: RefObject<HTMLDivElement | null>, hint: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const strip = hint.current;
    if (!on || !strip) return;
    let zone: "open" | "hint" | "far" = "far";
    let over = false;
    let timer = 0;
    const clear = () => {
      clearTimeout(timer);
      timer = 0;
    };
    const to = (next: typeof zone) => {
      if (next === "open" && local.peek) holdPeek();
      if (next === zone) return;
      const was = zone;
      zone = next;
      strip.toggleAttribute("data-shown", next !== "far");
      clear();
      if (next === "open") {
        if (!local.peek) timer = window.setTimeout(holdPeek, STATIC_HINT.dwellMs);
      } else if (was === "open" && !over) closePeekSoon();
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target;
      over = target instanceof Element && target.closest(PEEK_OWNERS) !== null;
      if (event.buttons !== 0) {
        clear();
        if (zone === "open" && !over) closePeekSoon();
        zone = "far";
        strip.removeAttribute("data-shown");
        return;
      }
      const edge = handle.current;
      const inFrame = !!edge && target instanceof Node && !!edge.closest(".dframe-root")?.contains(target) && event.clientY >= edge.getBoundingClientRect().top;
      to(inFrame ? staticZone(fromEdge(event.clientX)) : "far");
    };
    const leave = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "mouse") to("far");
    };
    window.addEventListener("pointermove", move, { capture: true, passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move, { capture: true });
      document.documentElement.removeEventListener("pointerleave", leave);
      clear();
      strip.removeAttribute("data-shown");
    };
  }, [on, handle, hint]);
}

/** cec084e62: the blocks whose start marks where the content begins, and what is not content. */
const CONTENT = "p,li,h1,h2,h3,h4,h5,h6,pre,td,th,blockquote,button,a,input,textarea,select,img,[role='button'],[contenteditable='true']";
const NOT_CONTENT = ".dframe-sidebar,.dframe-sidebar-edge,.dframe-sidebar-edge-hint,[data-peek-owner]";
/** How often the room is measured, and how long the loop runs on after the last event. */
const ROOM_EVERY_MS = 250;
const LINGER_MS = 600;

/** cec084e62 ae: how far in from the edge the content starts at height `y` (probed every 12px up to 200). */
function contentRoom(root: HTMLElement, y: number): number {
  const rtl = document.documentElement.dir === "rtl";
  for (let x = 10; x <= 200; x += 12) {
    const el = document.elementFromPoint(rtl ? window.innerWidth - x : x, y);
    if (!el || !root.contains(el) || el.closest(NOT_CONTENT)) continue;
    const box = el.closest(CONTENT)?.getBoundingClientRect();
    const at = box && fromEdge(rtl ? box.right : box.left);
    if (at !== undefined && at > 0) return at;
  }
  return Infinity;
}

/**
 * cec084e62 EdgeMagnetPeek: while a mouse is within 200px of the edge (or of a peeked sidebar), a
 * frame loop steps lib/edgeMagnet.ts and paints the hint strip's lean, hairline and shade; an open
 * calls the peek out. Leaving the tip closes a peek it kept; leaving the window right after an
 * open closes it at once. The loop stops once all is at rest for 600ms.
 */
function useEdgeMagnet(on: boolean, handle: RefObject<HTMLDivElement | null>, hint: RefObject<HTMLDivElement | null>, width: RefObject<number>) {
  useEffect(() => {
    const strip = hint.current;
    if (!on || !strip) return;
    const state = magnet();
    let x = 1e4;
    let y = 0;
    let buttons = 0;
    let inFrame = false;
    let over = false;
    let atTip = false;
    let room = Infinity;
    let roomAt = -1e9;
    let raf = 0;
    let last = 0;
    let kicked = 0;
    let idleSince = performance.now();
    let wheelAt: number | null = null;
    let upAt: number | null = null;
    let slide: Animation | null = null;
    let openedAt = -1e9;
    let shownLean = "";
    let shownLook = "";
    const reach = MAGNET.farPx * 2;
    const sidebarWidth = () => Math.max(width.current, MIN_WIDTH);
    const near = () => x < (local.peek ? Math.max(reach, sidebarWidth() + 40) : reach);
    const paint = (lean: string, look: string, line: number, shade: number) => {
      if (lean !== shownLean) {
        shownLean = lean;
        strip.style.setProperty("--df-edge-lean", lean);
      }
      if (look === shownLook) return;
      shownLook = look;
      strip.style.setProperty("--df-edge-line", line.toFixed(2));
      strip.style.setProperty("--df-edge-shade", shade.toFixed(3));
    };
    const stopSlide = () => {
      slide?.cancel();
      slide = null;
    };
    const kick = () => {
      kicked = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    };
    function frame(now: number) {
      raf = 0;
      if (last === 0) {
        settle(state, x, y, buttons, now - idleSince);
        if (wheelAt !== null) wheeled(state, now - wheelAt);
        if (upAt !== null) released(state, now - upAt);
      }
      wheelAt = upAt = null;
      const dt = last === 0 ? 16 : now - last;
      last = now;
      const open = local.peek;
      const root = handle.current?.closest<HTMLElement>(".dframe-root") ?? null;
      if (root && inFrame && !open && x < reach && state.t - roomAt > ROOM_EVERY_MS) {
        room = contentRoom(root, y);
        roomAt = state.t;
      }
      const step = advance(state, { x, y, buttons, inFrame, peekOpen: open, sidebarWidth: sidebarWidth(), roomPx: room }, dt);
      const look = edgeLook(MAGNET, step.lean, sidebarWidth());
      paint(`${step.lean.toFixed(2)}px`, `${look.line.toFixed(2)} ${look.shade.toFixed(3)}`, look.line, look.shade);
      if (step.open && !phoneNow && !root?.hasAttribute("data-resizing")) {
        holdPeek();
        openedAt = now;
        // The web build slides the peeked sidebar in at the snap's pace.
        const body = root?.matches("[data-web]") ? root.querySelector<HTMLElement>(".dframe-sidebar-body") : null;
        if (body && local.peek) {
          const { durationMs, easing } = snapTiming();
          slide = body.animate({ transform: [document.documentElement.dir === "rtl" ? "translateX(100%)" : "translateX(-100%)", "none"] }, { duration: durationMs, easing });
        }
      }
      if (buttons !== 0) {
        if (atTip && open && !over) closePeekSoon();
        atTip = false;
      } else {
        const tip = inFrame && x <= state.tipPx;
        if (tip && open) holdPeek();
        if (atTip && !tip && !over) closePeekSoon();
        atTip = tip;
      }
      if (!resting(state) || now - kicked < LINGER_MS) raf = requestAnimationFrame(frame);
      else {
        last = 0;
        idleSince = now;
        paint("0.00px", "0.00 0.000", 0, 0);
      }
    }
    const sample = (event: globalThis.PointerEvent) => {
      x = fromEdge(event.clientX);
      y = event.clientY;
      buttons = event.buttons;
      over = event.target instanceof Element && event.target.closest(PEEK_OWNERS) !== null;
      if (!near()) {
        inFrame = true;
        return;
      }
      const edge = handle.current;
      inFrame = !!edge && event.target instanceof Node && edge.closest(".dframe-root")?.contains(event.target) === true && y >= edge.getBoundingClientRect().top;
    };
    const mouse = (handler: (event: globalThis.PointerEvent) => void) => (event: globalThis.PointerEvent) => {
      if (event.pointerType === "mouse") handler(event);
    };
    const onMove = mouse((event) => {
      sample(event);
      if (near() || atTip || !resting(state)) kick();
    });
    const onDown = mouse((event) => {
      sample(event);
      if (near()) kick();
    });
    const onUp = mouse((event) => {
      sample(event);
      if (last === 0) upAt = performance.now();
      else released(state);
      if (near()) kick();
    });
    const onLeave = mouse(() => {
      inFrame = false;
      if (performance.now() - openedAt < snapTiming().durationMs + 80 && !over) {
        stopSlide();
        dropPeek();
      }
      kick();
    });
    const onWheel = () => {
      if (last === 0) wheelAt = performance.now();
      else wheeled(state);
      if (near()) kick();
    };
    let peeked = local.peek;
    const unsubscribe = subscribeLocal(() => {
      if (peeked && !local.peek) stopSlide();
      peeked = local.peek;
    });
    strip.setAttribute("data-magnet", "");
    strip.removeAttribute("data-shown");
    const passive = { capture: true, passive: true };
    window.addEventListener("pointermove", onMove, passive);
    window.addEventListener("pointerdown", onDown, passive);
    window.addEventListener("pointerup", onUp, passive);
    window.addEventListener("wheel", onWheel, passive);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("pointerup", onUp, { capture: true });
      window.removeEventListener("wheel", onWheel, { capture: true });
      document.documentElement.removeEventListener("pointerleave", onLeave);
      unsubscribe();
      cancelAnimationFrame(raf);
      stopSlide();
      // Back to the plain strip without animating the way there.
      strip.style.transition = "none";
      strip.removeAttribute("data-magnet");
      strip.getBoundingClientRect();
      strip.style.transition = "";
      for (const name of ["--df-edge-lean", "--df-edge-line", "--df-edge-shade"]) strip.style.removeProperty(name);
    };
  }, [on, handle, hint, width]);
}

/**
 * Collapsed on a wide window, the frame's start edge (shared-21 RM): a CDS ResizeHandle strip,
 * 显示侧边栏 · Ctrl+B with 拖动以调整大小 at the pointer's height. A press opens the sidebar;
 * dragging out docks it once past half the narrowest width and sizes it with the pointer (LM);
 * → and Enter open it too. With __gb__741807810 on (设置 → 通用 → 外观 → 侧边栏边缘提示; iv(),
 * off in the user's Claude) the handle lets the pointer through to the edge, which owns the peek:
 * the magnet, or with motion reduced the static hint; the tip is gone while the peek is out.
 */
function SidebarEdge({ width, setWidth }: { width: number; setWidth(next: number): void }) {
  const peekOn = useStore((s) => s.claudeFlags.sidebarEdgePeek);
  const peek = useLocal((s) => s.peek);
  const reduced = useReducedMotion();
  const handle = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const widthNow = useRef(width);
  widthNow.current = width;
  useStaticHint(peekOn && reduced, handle, hint);
  useEdgeMagnet(peekOn && !reduced, handle, hint, widthNow);
  const tip = !(peekOn && peek);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const root = event.currentTarget.closest<HTMLElement>(".dframe-root");
    const from = event.clientX;
    const dir = document.documentElement.dir === "rtl" ? -1 : 1;
    let moved = false;
    let docked = false;
    let next = MIN_WIDTH;
    root?.setAttribute("data-resizing", "");
    // On the document: once docked the edge is gone, and the drag goes on sizing the sidebar.
    const move = (e: globalThis.PointerEvent) => {
      if (!(e.buttons & 1)) return end();
      const pulled = (e.clientX - from) * dir;
      if (Math.abs(pulled) > 3) moved = true;
      const out = pulled >= MIN_WIDTH / 2;
      if (out) next = Math.max(MIN_WIDTH, Math.min(maxWidth(), pulled));
      if (out !== docked) {
        docked = out;
        setDocked(out);
      }
      if (out) setWidth(next);
    };
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
      root?.removeAttribute("data-resizing");
      if (!moved) setDocked(true);
      else if (docked) writePref(WIDTH_KEY, String(Math.round(next)));
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const out = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    if (event.key !== out && event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setDocked(true);
  };
  return (
    <>
      {peekOn && <div ref={hint} aria-hidden="true" className="dframe-sidebar-edge-hint" />}
      <div
        ref={handle}
        data-cds="ResizeHandle"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        className={`cds-reset group/resize outline-none focus-visible:outline-hidden w-3 cursor-col-resize relative h-full dframe-sidebar-edge draggable-none${peekOn ? " pointer-events-none" : ""}`}
        aria-label="调整侧边栏宽度"
        aria-valuenow={0}
        aria-valuemin={0}
        aria-valuemax={MAX_WIDTH}
        data-peek-owner={peekOn ? "" : undefined}
        data-tip={tip ? "显示侧边栏" : undefined}
        data-tip-kbd={tip ? shortcutLabel("sidebar") : undefined}
        data-tip-detail={tip ? "拖动以调整大小" : undefined}
        data-tip-side="right"
        data-tip-track="y"
        onPointerDown={start}
        onKeyDown={onKeyDown}
      >
        <div aria-hidden="true" className="absolute rounded-full transition-shadow duration-fast group-focus-visible/resize:shadow-focus inset-y-0 left-1/2 w-3 -translate-x-1/2 cursor-col-resize" />
        <div
          aria-hidden="true"
          data-cds-part="resize-pill"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current transition-[opacity,color,background-color] h-full max-h-12 w-[3px] group-focus-visible/resize:max-h-none text-muted opacity-[var(--cds-resize-pill-force,0)] delay-200 duration-base group-hover/resize:opacity-100 group-focus-visible/resize:bg-fill-accent group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0"
        />
      </div>
    </>
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
  const server = useStore((s) => s.server);
  const activeId = useStore((s) => s.activeId);
  const requests = useStore((s) => s.requests);
  const settledQuestions = useStore((s) => s.settledQuestions);
  const titleConsents = useStore((s) => s.titleConsents);
  const planConsents = useStore((s) => s.planConsents);
  const terminalConsents = useStore((s) => s.terminalConsents);
  const settingConsents = useStore((s) => s.settingConsents);
  const offers = useStore((s) => s.offers);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const ready = useStore((s) => s.conn.status === "ready");
  const state = useLocal((s) => s);
  const cloudTasks = useCloudTasks();
  const dotsEntry = useDotsEntry();
  const currentDot = useDots((s) => s.dot?.id ?? null);
  const dotsOpen = useStore((s) => s.dotsOpen);
  const scheduledOpen = useStore((s) => !s.activeId && s.scheduledRoute !== null);
  const imagesEntry = useImagesEntry();
  const imagesOpen = useStore((s) => !s.activeId && s.imagesOpen);
  const chatOpen = useStore((s) => !s.activeId && s.chatOpen);
  const siwc = useChat((s) => s);
  const customizeOpen = useStore((s) => s.customizeRoute !== null);
  const libraryEntry = useLibraryEntry();
  const libraryOpen = useStore((s) => s.libraryRoute !== null);
  // The Codex app's row says 技能 with the plugins feature off; here it says Claude's 自定义 then.
  const noPlugins = useStore(pluginsOff);
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
  const wco = useWco();
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

  // The frame root carries the sidebar's state (shared-22 RL / FL): its width, collapsed (peek or
  // phone sheet), the sheet, the peek out (hovering) and once out since the last fold (peeked, so
  // the float animates only then), a session dragged. The trigger's clearance is CSS-derived.
  const peeked = useRef({ mode, out: false });
  useLayoutEffect(() => {
    const root = aside.current?.closest<HTMLElement>(".dframe-root");
    if (!root) return;
    if (peeked.current.mode !== mode) peeked.current = { mode, out: false };
    if (state.peek) peeked.current.out = true;
    root.style.setProperty("--df-sidebar-width", `${width}px`);
    root.toggleAttribute("data-collapsed", mode !== "docked");
    if (phone) root.setAttribute("data-phone-sheet", "left");
    else root.removeAttribute("data-phone-sheet");
    root.toggleAttribute("data-hovering", mode !== "docked" && state.peek);
    root.toggleAttribute("data-peeked", mode !== "docked" && peeked.current.out);
    root.toggleAttribute("data-session-dragging", !!dragging);
  });

  // shared-21 (phone sheet): the open sheet is a modal dialog.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || !phone) return;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("tabindex", "-1");
    return () => ["role", "aria-modal", "tabindex"].forEach((name) => el.removeAttribute(name));
  }, [phone]);

  // shared-18 gO: the list runs to the sidebar's edge; the header gives back what a scrollbar takes.
  useLayoutEffect(() => {
    const el = scroll.current;
    const nav = el?.parentElement;
    if (!el || !nav) return;
    const sync = () => nav.style.setProperty("--df-nav-scrollbar-lane", `${el.offsetWidth - el.clientWidth}px`);
    // The list's rows sit in display: contents boxes, so their coming and going is watched instead.
    const resized = new ResizeObserver(sync);
    const changed = new MutationObserver(sync);
    resized.observe(el);
    changed.observe(el, { childList: true, subtree: true });
    sync();
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, []);

  // Esc closes the peek and hands focus back to the switch; a press outside closes it too (shared-16 Lm).
  useEffect(() => {
    if (!state.peek) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".popover, .dialog-backdrop")) return;
      setPeek(false);
      document.querySelector<HTMLElement>("[data-peek-owner] button, .df-compact-trigger")?.focus();
    };
    const onPress = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".dframe-sidebar, [data-peek-owner], .popover, .dialog-backdrop, .tooltip")) setPeek(false);
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
    if (getState().draftEpoch === pending.epoch && thread && thread.meta.createdAt >= pending.since) moveToSection(activeId, pending.sectionId).catch(fail("无法移动。请重试。"));
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

  const waiting = waitingOn({ requests, threads, settledQuestions, titleConsents, planConsents, terminalConsents, settingConsents, offers });
  const shape = layout({ list, threads, sections, server }, state);
  const keep = keeper(state, activeId, waiting);
  const agents = agentsWorking(threads);
  const statusFor = (row: Row) => statusOf(row.thread, waiting.has(row.thread.meta.id), agents.has(row.thread.meta.id));
  /** What a folded list's label shows (shared-21 HG): the most urgent status among the rows it hides. */
  const badgeOf = (rows: Row[], kept: Row[]) => (rows.length ? URGENCY.find((status) => rows.some((row) => !kept.includes(row) && statusFor(row) === status)) : undefined);
  const selection = new Set(state.selected);
  const selectionIds = state.selected.length > 1 ? state.selected : null;
  const announce = (text: string) => setAnnouncement(text);
  const customMode = state.groupBy === "custom";

  const onDragStart = (event: DragEvent, row: Row) => {
    const id = row.thread.meta.id;
    // A nested session goes with its family root; a selected row takes the whole selection.
    const ids = selection.has(id) && state.selected.length > 1 ? state.selected : [row.head];
    event.dataTransfer.setData(DRAG_TYPE, ids.join("\n"));
    if (!row.thread.meta.parentThreadId) event.dataTransfer.setData(SESSION_DRAG, id);
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
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      event.stopPropagation();
      setDropTarget(target);
      const moves = section !== undefined && dragging && (section?.id ?? null) !== dragging.section;
      const hint = target === PINNED ? "" : moves ? (section ? `移至 ${label}` : "移出分组") : dragging?.fromPinned ? "松开以取消置顶" : "";
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
      for (const id of ids) if ((threads[id]?.meta.section?.id ?? null) !== (section?.id ?? null)) moveToSection(id, section?.id ?? null).catch(fail("无法移动。请重试。"));
    },
  });

  const rowFor = (entry: Row, pinnedList: boolean) => {
    const id = entry.thread.meta.id;
    return (
      <CodeRow
        key={id}
        row={entry}
        active={id === activeId}
        waiting={waiting.has(id)}
        agents={agents.has(id)}
        archived={archivedNow(id, list.status)}
        pinIndex={pinnedList ? state.pins.indexOf(id) : -1}
        checked={selection.has(id)}
        selection={selectionIds && selection.has(id) ? selectionIds : null}
        onDragStart={onDragStart}
        onBulkDelete={setBulkDelete}
      />
    );
  };

  /**
   * The rows of one list (shared-22 uC): each root, then its family one level in on an elbow
   * (pC: df-accordion-guide df-family), a folded one's hidden members behind its stub; Show more.
   */
  const listRows = (key: string, label: string, rows: Row[], fetch: boolean, pinnedList = false) => {
    const listShape = shapeOf(key, rows, state);
    return (
      <>
        {listShape.visible.map((slot) => {
          const family = familyOf(slot, state, keep);
          const id = family.head.thread.meta.id;
          return (
            <Fragment key={id}>
              {rowFor(family.head, pinnedList)}
              {slot.length > 1 && (
                <div className="df-accordion-guide flex flex-col [--df-row-indent:calc(var(--df-icon-size)+var(--df-row-gap))] df-family">
                  {family.shown.map((entry) => rowFor(entry, pinnedList))}
                  {family.hidden.length > 0 && <FamilyStub headId={id} hidden={family.hidden} someListed={family.shown.length > 0} statusFor={statusFor} />}
                </div>
              )}
            </Fragment>
          );
        })}
        <MoreRow listKey={key} label={label} shape={listShape} fetch={fetch} announce={announce} />
      </>
    );
  };

  const firstLoad = list.loading && list.ids.length === 0;
  const anyRows = shape.pinned.length > 0 || shape.rows.length > 0;
  const filter = <FilterMenu />;

  /**
   * One group (shared-22 wC): the label in its drag-shift wrapper, then the rows in a contents box;
   * folded, only the rows it keeps. A custom group carries its id and a drop highlight.
   */
  const renderGroup = (group: Group, index: number, groups: Group[]) => {
    const closed = state.collapsed.includes(group.key);
    const kept = closed ? keptIn(group.key, group.rows, activeId) : [];
    const section = group.section;
    const last = index === groups.length - 1;
    const add = section ? (
      <GroupAdd label={`在 ${section.name} 中新建会话`} onClick={() => startIn({ sectionId: section.id })} />
    ) : group.folder !== undefined ? (
      <GroupAdd label={`在 ${group.label} 中新建会话`} onClick={() => startIn({ folder: group.folder })} />
    ) : null;
    // wC fe: the list's trailing (Filter, on the first group) comes first, then the group's +.
    const actions = (add || index === 0) && (
      <>
        {index === 0 && filter}
        {add}
      </>
    );
    const menu = section !== undefined && section !== null ? true : group.folder !== undefined;
    const drop = customMode ? dropZone(group.key, section ?? null, group.label) : undefined;
    return (
      <div
        key={group.key}
        className="group/section relative isolate flex flex-col gap-px rounded-lg"
        data-nested-group=""
        data-group-list={customMode ? (section?.id ?? "") : undefined}
        data-group-label={customMode ? group.label : undefined}
        data-group-section={group.key}
        {...hoverWithin}
        {...drop}
      >
        <div data-row-key={`label:${group.key}`} className="df-drag-shiftable">
          <GroupLabel
            name={group.label}
            lead={section ? <SectionSwatch color={section.appearance?.color} /> : undefined}
            closed={closed}
            onToggle={() => toggleCollapsed(group.key)}
            badge={closed ? badgeOf(group.rows, kept) : undefined}
            rowless={closed ? !kept.length : !group.rows.length}
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
        </div>
        {/* Folded, a group still lists the open session (shared-22 xC openKeys). */}
        {closed ? (
          kept.map((entry) => rowFor(entry, false))
        ) : (
          <div className="contents">
            {listRows(group.key, group.label, group.rows, state.groupBy === "date" && last)}
            {/* wC: an empty custom group says where its sessions come from. */}
            {section && !group.rows.length && (
              <div data-row-key={`label:hint:${group.key}`} className="df-drag-shiftable">
                <p data-empty-group-hint="" className="df-label-inset flex min-h-[var(--df-row-h)] select-none items-center py-1 pe-[var(--df-row-px)] text-caption text-muted-as-secondary">
                  将会话拖动或移动到此处
                </p>
              </div>
            )}
          </div>
        )}
        {drop && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-x-0 rounded-lg transition-[background-color,box-shadow] ${dropTarget === group.key ? "bg-accent-muted ring-2 ring-inset ring-fill-accent" : ""}`}
            style={{ top: "calc(max(0px, var(--df-group-band-mt, var(--df-group-pt)) - 6px) - 0px)", bottom: 0 }}
          />
        )}
      </div>
    );
  };

  const collapsed = mode !== "docked";
  // SI: the title row in a docked browser sidebar (wordmark, then the switch); collapsed it is the
  // compact trigger (shared-21 nI); in the Windows chrome bar's frame there is none.
  const titlebar = wco ? null : collapsed ? (
    <CollapsedChrome />
  ) : (
    <div className="df-titlebar draggable h-11 shrink-0 flex items-center px-2">
      {!DESKTOP && (
        <div className="draggable-none ms-2 flex min-w-0 items-center gap-1.5">
          <a
            href="/"
            className="flex items-center"
            aria-label="主页"
            onClick={(event) => {
              event.preventDefault();
              newChat();
            }}
          >
            <span className="wordmark">Codex</span>
          </a>
        </div>
      )}
      <div className={`draggable-none static-composer-boot-fade ${DESKTOP ? "flex ms-0.5" : "ms-auto"}`}>
        <SidebarToggle place="title" />
      </div>
    </div>
  );

  return (
    <>
      <aside
        className="dframe-sidebar font-normal font-control"
        ref={aside}
        data-variant="web"
        data-density="compact"
        data-code-list=""
        aria-label="侧边栏"
        onContextMenu={(event) => {
          // The sidebar has no browser menu (shared-22 TI); fields keep theirs.
          if (!(event.target as Element).closest("input, textarea")) event.preventDefault();
        }}
        {...(mode === "peek" ? peekHover : {})}
      >
        {collapsed && <div className="dframe-peek-bridge" aria-hidden="true" {...peekHover} />}
        {titlebar}
        <div
          id={BODY_ID}
          ref={body}
          data-testid="sidebar"
          className={`dframe-sidebar-body flex flex-col flex-1 min-h-0 gap-2 px-2 pt-3 pb-1.5 [overflow:clip]${collapsed ? " bg-[hsl(var(--df-surface-primary))] border-0.5" : ""}`}
          data-tip-group=""
          aria-hidden={shown ? undefined : true}
          inert={!shown || undefined}
          onKeyDown={onRovingKey}
        >
          {phone && (
            // shared-21 YR: close and the wordmark over a full-width Search.
            <div className="df-phone-sheet-header flex shrink-0 flex-col gap-2">
              <div className="flex h-11 items-center gap-2">
                <Button variant="ghost" icon={<Icon name="X" size={16} />} label="关闭侧边栏" onClick={() => setPeek(false)} />
                <span className="wordmark">Codex</span>
              </div>
              <Button variant="secondary" size="lg" icon={<Icon name="Search" size={16} />} className="w-full justify-start" onClick={() => openPalette("command")}>
                搜索
              </Button>
            </div>
          )}
          {/* FrameSidebarNav (shared-22 fP → shared-18 gO): the header over the scrolling list. */}
          <div className="static-composer-boot-fade flex flex-col flex-1 min-h-0">
            <div className="shrink-0 pe-[max(0px,calc(var(--df-nav-scrollbar-lane,0px)-8px))]">
              {!phone && (
                // shared-21 gz.
                <div className="mb-2" data-tab-section="">
                  <button
                    type="button"
                    data-row=""
                    data-roving-item=""
                    aria-keyshortcuts="Control+K"
                    className={`df-search-field hit-row hit-row-main [--cds-hit-gap-y:10px] mx-[calc(var(--df-rail-shift,0px)/2)] mt-1 flex h-[var(--df-row-h)] w-[calc(100%-var(--df-rail-shift,0px))] shrink-0 items-center gap-[var(--df-row-gap)] rounded-[var(--df-radius-pill)] border-none bg-fill-field px-[var(--df-row-px)] text-start text-[length:var(--df-row-font)] text-muted forced-colors:border forced-colors:border-solid ${FOCUS_RING}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openPalette("command")}
                  >
                    <span data-leading-slot="" className="ms-[calc(var(--df-rail-shift,0px)/2)] flex size-[var(--df-leading-slot)] shrink-0 items-center justify-center">
                      <Icon name="Search" size="sm" />
                    </span>
                    <span data-row-label="" className="min-w-0 flex-1 truncate">
                      搜索
                    </span>
                    <span aria-hidden="true" className="df-search-field-keys flex shrink-0 items-center pe-[calc((var(--df-row-h)-1em-6px)/2-var(--df-row-px))] text-caption">
                      {shortcutLabel("command") && <Kbd>{shortcutLabel("command")!}</Kbd>}
                    </span>
                  </button>
                </div>
              )}
              {/* shared-21 F8: New, a nav row with the new circle and its shortcut. */}
              <div className="contents">
                <NavRow
                  className="mt-1"
                  selected={activeId === null && !dotsOpen && !customizeOpen && !scheduledOpen && !imagesOpen && !chatOpen && !libraryOpen}
                  kbd={shortcutLabel("new")}
                  onClick={() => {
                    newChat();
                    closeSidebarOnMobile();
                  }}
                >
                  <span className="df-leading-slot">
                    <span className="df-new-circle flex shrink-0 items-center justify-center rounded-full">
                      <Icon name="Add" size="sm" className="text-secondary group-hover:text-primary group-data-[selected=focused]:text-primary" />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 items-center">
                    <span className="min-w-0 truncate">新建</span>
                  </span>
                </NavRow>
              </div>
              <div aria-hidden="true" className="h-1 shrink-0" />
            </div>
            <div
              ref={scroll}
              onScroll={(event) => event.currentTarget.toggleAttribute("data-scrolled", event.currentTarget.scrollTop > 2)}
              className="dframe-nav-scroll relative flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden ps-1 pt-1 pb-2 -ms-1 -mt-1 -me-2 pe-[max(0px,calc(8px-var(--df-nav-scrollbar-lane,0px)))] [scrollbar-gutter:stable]"
            >
              {/* shared-21 I8: the nav rows, then their 12px spacer (0 over the code list). */}
              <div className="-mt-1" data-testid="nav-pin-rows">
                {siwc.available && <>
                  <NavRow data-nav-item="siwc-chat" selected={chatOpen && !siwc.selectedId} onClick={() => { selectChat(null); closeSidebarOnMobile(); }}>
                    <span className="df-leading-slot"><Icon name="Add" size="sm" /></span><span className="min-w-0 truncate">聊天</span>
                  </NavRow>
                  {chatOpen && siwc.chats.map((chat) => <NavRow key={chat.id} inRow className="ps-6" selected={siwc.selectedId === chat.id} onClick={() => { selectChat(chat.id); closeSidebarOnMobile(); }}>
                    <span className="min-w-0 truncate">{chat.title}</span>
                  </NavRow>)}
                </>}
                {/* The Codex desktop app's dot entry (app-primary IAn), right under New there; a row per
                    dot once the account has more than one (the desktop app's 你的 Dot list). */}
                {dotsEntry && dotsEntry.dots.length <= 1 && (
                  <NavRow
                    data-nav-item="dots"
                    selected={dotsOpen}
                    onClick={() => {
                      openDots();
                      closeSidebarOnMobile();
                    }}
                  >
                    <span className="df-leading-slot">
                      {dotsEntry.dots[0] ? <DotAvatar url={dotsEntry.dots[0].avatar.url} color={dotsEntry.dots[0].color} size={16} /> : <DotMark />}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center">
                      <span className="min-w-0 truncate">{dotsEntry.label}</span>
                    </span>
                  </NavRow>
                )}
                {dotsEntry && dotsEntry.dots.length > 1 && dotsEntry.dots.map((dot) => (
                  <NavRow
                    key={dot.id}
                    data-nav-item="dots"
                    data-dot-id={dot.id}
                    selected={dotsOpen && currentDot === dot.id}
                    onClick={() => {
                      selectDot(dot.id);
                      openDots();
                      closeSidebarOnMobile();
                    }}
                  >
                    <span className="df-leading-slot">
                      <DotAvatar url={dot.avatar.url} color={dot.color} size={16} />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="min-w-0 truncate">{dot.name ?? "你的 Dot"}</span>
                      {dot.paused && <span className="dots-paused">已暂停</span>}
                    </span>
                  </NavRow>
                ))}
                {/* The Codex desktop app's 图像 (sidebarElectron.imagesRouteNavLink, route /images). */}
                {imagesEntry && (
                  <NavRow
                    data-nav-item="images"
                    selected={imagesOpen}
                    onClick={() => {
                      openImages();
                      closeSidebarOnMobile();
                    }}
                  >
                    <span className="df-leading-slot">
                      <Icon name="Image" />
                    </span>
                    <span className="flex min-w-0 flex-1 items-center">
                      <span className="min-w-0 truncate">图像</span>
                    </span>
                  </NavRow>
                )}
                <ScheduledRow selected={scheduledOpen} />
                {/* The ChatGPT app's 资料库 (sidebarElectron.libraryRouteNavLink) with Claude's Library row
                    (shared-21 mH: Collection, above connect and customize); whatever plugins are. */}
                {libraryEntry && (
                  <LibraryRow
                    selected={libraryOpen}
                    onOpen={() => {
                      openLibrary();
                      closeSidebarOnMobile();
                    }}
                  />
                )}
                {/* One row for the 自定义 page: the Codex app's 插件 (sidebarElectron.skillsAppsRouteNavLink,
                    destination builtin:customize), Claude's 自定义 (Tool) while plugins are off. */}
                <NavRow
                  data-nav-item="plugins"
                  selected={customizeOpen}
                  onClick={() => {
                    openCustomize(noPlugins ? "skills" : "plugins");
                    closeSidebarOnMobile();
                  }}
                >
                  <span className="df-leading-slot">
                    <Icon name={noPlugins ? "Tool" : "Plugin"} />
                  </span>
                  <span className="flex min-w-0 flex-1 items-center">
                    <span className="min-w-0 truncate">{noPlugins ? "自定义" : "插件"}</span>
                  </span>
                </NavRow>
                <div className="h-3 shrink-0" aria-hidden="true" />
              </div>

              {/* shared-22 bP / Ox: the Code column, a contents box of df-session-list. */}
              <div className="dframe-recents-by-mode contents" data-mode="code" data-tab-section="" aria-label="会话">
                <div data-kind="code" className="df-session-list contents">
                  {(shape.pinned.length > 0 || dragging) && (
                    // shared-22 Fj.
                    <div data-testid="sidebar-pinned" data-pinned-list="" data-tab-section="" className="group/section flex flex-col gap-px" {...hoverWithin} {...dropZone(PINNED, undefined, "已置顶")}>
                      <div>
                        <GroupLabel
                          name="已置顶"
                          closed={state.collapsed.includes(PINNED)}
                          onToggle={() => toggleCollapsed(PINNED)}
                          badge={state.collapsed.includes(PINNED) ? badgeOf(shape.pinned, []) : undefined}
                          rowless={state.collapsed.includes(PINNED)}
                        />
                      </div>
                      {!state.collapsed.includes(PINNED) && listRows(PINNED, "已置顶", shape.pinned, false, true)}
                      {/* shared-22 Pj: while dragging, an empty Pinned offers itself. */}
                      {!state.collapsed.includes(PINNED) && !shape.pinned.length && (
                        <div className={`flex h-[var(--df-row-h)] items-center gap-[var(--df-row-gap)] rounded-[var(--df-radius-pill)] px-[var(--df-row-px)] text-[length:var(--df-row-font)] transition-colors ${dropTarget === PINNED ? "bg-neutral-30 text-secondary" : "text-muted-as-secondary opacity-80"}`}>
                          <span className="df-leading-slot">
                            <Icon name="Pin" className={`transition-transform ${dropTarget === PINNED ? "rotate-6 scale-105" : ""}`} />
                          </span>
                          <span>{dropTarget === PINNED ? "松开" : "拖放到此处"}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {cloudTasks && cloudTasks.length > 0 && <CloudGroup tasks={cloudTasks} collapsed={state.collapsed.includes(CLOUD)} />}
                  <div className="contents" {...(!customMode ? dropZone("", undefined, "最近使用") : {})}>
                    {shape.groups && shape.groups.length > 0 ? (
                      <>
                        {shape.groups.map(renderGroup)}
                        {state.groupBy !== "date" && <LoadMoreRow announce={announce} />}
                      </>
                    ) : (
                      // With no groups the 最近 band stays, so Filter stays within reach (shared-22 jN).
                      <div className="group/section flex flex-col gap-px" {...hoverWithin}>
                        <div data-row-key="label:recents" className="df-drag-shiftable">
                          <GroupLabel
                            name="最近使用"
                            closed={state.collapsed.includes(RECENTS)}
                            onToggle={() => toggleCollapsed(RECENTS)}
                            badge={state.collapsed.includes(RECENTS) ? badgeOf(shape.rows, []) : undefined}
                            rowless={state.collapsed.includes(RECENTS)}
                            actions={filter}
                          />
                        </div>
                        {!state.collapsed.includes(RECENTS) && (firstLoad ? <SkeletonRows /> : listRows(RECENTS, "最近使用", shape.rows, true))}
                      </div>
                    )}
                    {list.error && !list.loading && list.ids.length === 0 && (
                      // shared-21 SK.
                      <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                        <p role="alert" className="text-footnote text-muted-as-secondary">
                          无法加载您的会话
                        </p>
                        <Button variant="secondary" size="sm" data-roving-item="" onClick={() => void refreshThreads()}>
                          重试
                        </Button>
                      </div>
                    )}
                    {!list.loading &&
                      !list.error &&
                      !anyRows &&
                      (list.status !== "active" ? (
                        // shared-21 xK filtered.
                        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
                          <p className="text-footnote text-muted-as-secondary">没有符合当前筛选条件的会话</p>
                          <button
                            type="button"
                            data-roving-item=""
                            className="text-footnote text-secondary underline-offset-2 hover:text-primary hover:underline hide-focus-ring focus-visible:shadow-focus"
                            onClick={() => setListFilter({ status: "all" })}
                          >
                            显示所有会话
                          </button>
                        </div>
                      ) : (
                        // shared-21 xK; Claude's illustration under it is not drawn.
                        <div className="flex min-h-[200px] select-none flex-col last:flex-1 items-center justify-center gap-4 px-4 pb-10 text-center">
                          <p className="text-footnote text-muted-as-secondary">您启动的会话将显示在这里</p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-0" />
            </div>
          </div>
          <div className="static-composer-boot-fade df-banner-slot -mt-2 flex shrink-0 flex-col gap-2 empty:hidden">
            <BackendCard />
          </div>
          {/* AF: the bottom tray's footer row, the user button and the (empty) aux buttons. */}
          <div className="static-composer-boot-fade df-bottom-tray shrink-0">
            <div className="df-footer-row shrink-0 flex items-center gap-[var(--df-footer-gap)]">
              <div className="min-w-0 flex-1">
                <UserMenu />
              </div>
              <div className="df-footer-aux ms-auto flex shrink-0 items-center" />
            </div>
          </div>
        </div>
        {mode === "docked" && <ResizeHandle width={width} setWidth={setWidth} aside={aside} />}
      </aside>
      {mode === "peek" && !narrow && <SidebarEdge width={width} setWidth={setWidth} />}
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
      {state.confirm && <NestedConfirm {...state.confirm} onClose={() => setLocal({ confirm: null })} />}
      {state.unschedule && <UnscheduleConfirm ids={state.unschedule} onClose={() => setLocal({ unschedule: null })} />}
      {state.scheduleForm && <ScheduledForm dialog={state.scheduleForm} onClose={() => setLocal({ scheduleForm: null })} />}
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
  const activeId = useStore((s) => s.activeId);
  const section = group.section ?? null;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const anyOpen = groupKeys.some((key) => !collapsed.includes(key));
  const anyClosed = groupKeys.some((key) => collapsed.includes(key));
  const ids = group.rows.map((row) => row.thread.meta.id);
  const archivable = archivableIn(group, activeId);
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
      <ReasonTip reason={ids.length < 2 ? "此处至少需要有 2 个可选择的会话。" : undefined}>
        <MenuItem label="全选" disabled={ids.length < 2} onClick={act(() => setLocal({ selected: [...new Set([...local.selected, ...ids])] }))} />
      </ReasonTip>
      <MenuSep />
      {/* shared-46 rk: both stay, the one with nothing to do dimmed with its reason. */}
      <ReasonTip reason={anyOpen ? undefined : "所有显示的内容均已折叠。"}>
        <MenuItem label="全部折叠" disabled={!anyOpen} onClick={act(() => setLocal({ collapsed: [...new Set([...local.collapsed, ...groupKeys])] }))} />
      </ReasonTip>
      <ReasonTip reason={anyClosed ? undefined : "所有内容均已展开。"}>
        <MenuItem label="全部展开" disabled={!anyClosed} onClick={act(() => setLocal({ collapsed: local.collapsed.filter((key) => !groupKeys.includes(key)) }))} />
      </ReasonTip>
      <MenuSep />
      {/* shared-46 JO: with nothing to take it stays, dimmed, and says why. */}
      {archivable.length > 0 ? (
        <MenuItem label={`全部归档（${archivable.length}）`} onClick={() => onArchiveAll(group)} />
      ) : (
        <ReasonTip reason={ids.length ? "此处的每一项均已置顶、已在窗格或窗口中打开、已归档，或无法从此处归档。" : "当前没有可归档的内容。"}>
          <MenuItem label="全部归档" disabled onClick={() => undefined} />
        </ReasonTip>
      )}
      {section && <MenuItem label="删除分组" danger onClick={act(() => setState({ dialog: { type: "deleteSection", sectionId: section.id } }))} />}
    </PointerMenu>
  );
}

/** What Archive all takes (shared-46 AO): not archived already, nor open; pinned ones list apart. */
function archivableIn(group: Group, activeId: string | null): string[] {
  return group.rows.map((row) => row.thread.meta.id).filter((id) => !isArchivedThread(id) && id !== activeId);
}

/**
 * Archive all sessions in a group (shared-46 qD bulk-archive, VD): how many go, whether some
 * still work and stop, and that sessions the list has not loaded stay (shared-22 hasMore). Claude's
 * "{section}: {heading}" title needs its sidebar sections, which Codex has none of.
 */
function ArchiveAllDialog({ group, onClose }: { group: Group; onClose(): void }) {
  const ids = archivableIn(group, getState().activeId);
  const threads = getState().threads;
  const working = ids.filter((id) => threads[id] && (activeTurn(threads[id]) || threads[id].meta.status.type === "active")).length;
  const unloaded = getState().list.cursor !== null;
  // Archiving pauses the heartbeats watching them (the bridge's /thread archived), as UnscheduleConfirm says.
  const scheduled = watchedBy(ids).length > 0;
  const description = [
    `将归档 ${ids.length} 个会话。`,
    scheduled && "其中一个或多个会话有已开启的定时任务，归档也会移除其定时任务，并停止日后的运行。",
    working > 0 && (ids.length === 1 ? "该会话仍在运行，归档会使其停止。" : working === 1 ? "其中一个仍在运行，归档会将其停止。" : `其中 ${working} 个仍在运行，归档会将其停止。`),
    unloaded && "尚未加载的会话不会被归档。",
  ];
  return (
    <Confirm
      focusConfirm
      title={scheduled ? "要归档会话并移除定时任务吗？" : `要归档“${group.label}”中的所有会话吗？`}
      description={description.filter(Boolean).join(" ")}
      confirm="全部归档"
      onClose={onClose}
      onConfirm={async () => void archiveOrRestore(ids, false, unloaded ? "partial" : "bulk")}
    />
  );
}

/**
 * Archive or delete a family root with forks under it (shared-20 yA, ca674e66a
 * NestedSessionsConfirmBody): the whole family, or this one alone while the forks move to the top
 * level. Its sub-agents go with it either way.
 */
function NestedConfirm({ threadId, action, nested, spawned, onClose }: NonNullable<Local["confirm"]> & { onClose(): void }) {
  const threads = useStore((s) => s.threads);
  const remove = action === "delete";
  const verb = remove ? "删除" : "归档";
  const title = threads[threadId] ? threadTitle(threads[threadId].meta) : "";
  const total = 1 + nested.length + spawned;
  const working = nested.filter((id) => threads[id] && (activeTurn(threads[id]) || threads[id].meta.status.type === "active")).length;
  const stays = spawned ? `它启动的 ${spawned} 个子代理将一并${verb}，其余 ${nested.length} 个将移至顶层` : `${remove ? "" : "其"}嵌套会话将移至顶层`;
  const after = remove ? "此操作无法撤销。" : working ? `${working} 个嵌套会话仍在运行，如果将其一并归档，这些会话将停止。` : "";
  const run = (ids: string[]) => {
    onClose();
    if (!remove) return archiveOrRestore(ids, false);
    setPinned(ids, false);
    void Promise.allSettled(ids.map((id) => deleteThread(id))).then((results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) toast("warning", "删除失败", `${failed} 个会话无法删除。请重试。`);
    });
  };
  // What a fork spawned goes with the fork, so only the outermost ones need a call of their own.
  const tops = nested.filter((id) => !nested.includes(threads[id]?.meta.parentThreadId ?? ""));
  return (
    <Dialog
      alert
      title={`${verb}会话？`}
      description={`“${title}”${remove ? "包含" : "有"} ${total - 1} 个嵌套会话。${remove ? "如果" : "若"}仅${verb}此会话，${stays}。${after}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="nested-cancel" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => run([threadId, ...tops])}>
            {total === 2 ? `${verb} 2 个会话` : `${verb}全部 ${total} 个会话`}
          </Button>
          <Button variant={remove ? "danger" : "primary"} data-autofocus onClick={() => run([threadId])}>
            {verb}此会话
          </Button>
        </>
      }
    />
  );
}

/**
 * Archiving sessions an active heartbeat watches, which pauses it (the ChatGPT app's
 * threadHeader.archiveConfirmHeartbeat* for one, archiveSelectedThreads.confirmScheduled* for a
 * selection). One then goes on as any archive does: its forks may ask next.
 */
function UnscheduleConfirm({ ids, onClose }: { ids: string[]; onClose(): void }) {
  const one = ids.length === 1 ? ids[0] : null;
  const running = useStore((s) => {
    const thread = one ? s.threads[one] : undefined;
    return !!thread && (!!activeTurn(thread) || thread.meta.status.type === "active");
  });
  const names = watchedBy(ids).map((task) => `“${task.name}”`).join("、");
  return (
    <Confirm
      focusConfirm
      title={!one ? "要归档会话并移除定时任务吗？" : running ? "停止并归档此会话？" : "归档会话并移除定时任务？"}
      description={
        !one
          ? "一个或多个所选会话有已开启的定时任务。归档这些会话也会移除其定时任务，并停止日后的运行。"
          : running
            ? `归档会停止正在进行的工作，并移除定时任务${names}，使其今后不再运行。`
            : `此会话有一项已开启的定时任务${names}。归档此会话也会将其移除并停止后续运行。`
      }
      confirm={running ? "停止并归档" : "归档并移除"}
      onClose={onClose}
      onConfirm={async () => void (one ? archiveSession(one, true) : archiveOrRestore(ids, false, "bulk"))}
    />
  );
}

function BulkDeleteDialog({ ids, onClose }: { ids: string[]; onClose(): void }) {
  return (
    <Confirm
      danger
      title={`删除 ${ids.length} 个会话？`}
      description={`这 ${ids.length} 个会话将被永久删除。此操作无法撤销。`}
      confirm="删除"
      onClose={onClose}
      onConfirm={async () => {
        setPinned(ids, false);
        void Promise.allSettled(ids.map((id) => deleteThread(id))).then((results) => {
          // c39a247c4 xt.delete, as archiving several.
          const failed = results.filter((result) => result.status === "rejected").length;
          if (failed < ids.length) toast("neutral", `已删除 ${ids.length - failed} 个会话`, undefined, BULK_MS);
          if (failed) toast("warning", `${failed} 个会话无法删除。请重试。`);
        });
      }}
    />
  );
}
