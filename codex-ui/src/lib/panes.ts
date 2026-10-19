// Right-hand panes beside the chat (Claude Desktop 2.42304.0.0 tiles with the move / Fill / Tile
// menus off: c03935b01 Ti / Ci, cf53e1812 B, ca5db7aaf expand, c9543da06 boundary keys). Each
// view (a thread id, or "draft" for the new-session page) keeps its own open panes. The first
// opens beside the chat at chat:pane = 2:3 for the big panes (changes, files) and 2:1 for the
// rest; later ones stack under the last. Dragged ratios are remembered in codex-ui:pane-flex:
// the column's width per top pane (against the chat's 2, c03935b01 wi) and each pane's share of
// the column's height.

import { filesStats, parseDiff, type DiffRow, type FileDiff } from "./diff.ts";
import { getState, setState, writePref, type PaneId, type PaneLayout } from "./store.ts";

export const PANE_NAMES: Record<PaneId, string> = { diff: "更改", files: "文件", terminal: "终端", plan: "计划", background: "后台任务" };

/** c03935b01 Ci: these open at 3 against the chat's 2, the others at 1. */
const BIG = new Set<PaneId>(["diff", "files"]);

export const NO_PANES: PaneLayout = { open: [], expanded: null };

/** The view on screen: the open thread, or the new-session page. */
export const viewKey = () => getState().activeId ?? "draft";

export const layoutOf = (key: string): PaneLayout => getState().panes[key] ?? NO_PANES;

/** A pane opens below the others (cf53e1812 B); an expanded pane gives way to it. */
export function withPane(layout: PaneLayout, pane: PaneId): PaneLayout {
  return layout.open.includes(pane) ? layout : { open: [...layout.open, pane], expanded: null };
}

export function withoutPane(layout: PaneLayout, pane: PaneId): PaneLayout {
  return { open: layout.open.filter((open) => open !== pane), expanded: layout.expanded === pane ? null : layout.expanded };
}

function update(key: string, next: (layout: PaneLayout) => PaneLayout) {
  setState((s) => ({ panes: { ...s.panes, [key]: next(s.panes[key] ?? NO_PANES) } }));
}

/** The new-session page has only the terminal: the other panes need a session. */
const allowed = (pane: PaneId, key: string) => key !== "draft" || pane === "terminal";

export function openPane(pane: PaneId, key = viewKey()): void {
  if (allowed(pane, key)) update(key, (layout) => withPane(layout, pane));
}

export function closePane(pane: PaneId, key = viewKey()): void {
  update(key, (layout) => withoutPane(layout, pane));
}

export function togglePane(pane: PaneId, key = viewKey()): void {
  if (allowed(pane, key)) update(key, (layout) => (layout.open.includes(pane) ? withoutPane(layout, pane) : withPane(layout, pane)));
}

let pendingDiff: string | null = null;

/** c856385e2 preferDiff: an edit row's file name opens that file's diff in the changes pane. */
export function openDiff(path: string): void {
  pendingDiff = path;
  openPane("diff");
  window.dispatchEvent(new Event("codex:open-diff"));
}

/** The path openDiff asked for, once (the changes pane reads it on mount and on the event). */
export function takePendingDiff(): string | null {
  const path = pendingDiff;
  pendingDiff = null;
  return path;
}

let pendingScope: "all" | "turn" | null = null;

/** The rail's 更改 row: the changes pane at the scope its numbers came from (所有更改 or 本轮更改). */
export function openChanges(scope: "all" | "turn"): void {
  pendingScope = scope;
  openPane("diff");
  window.dispatchEvent(new Event("codex:open-diff"));
}

export function takePendingScope(): "all" | "turn" | null {
  const scope = pendingScope;
  pendingScope = null;
  return scope;
}

/** 展开 / 收起 (toggleExpandPane): the pane fills the space beside the sidebar, the chat hidden. */
export function toggleExpanded(pane: PaneId, key = viewKey()): void {
  update(key, (layout) => (layout.open.includes(pane) ? { ...layout, expanded: layout.expanded === pane ? null : pane } : layout));
}

let lastPane: PaneId | null = null;

/** The pane the user last pointed at or focused. */
export function notePane(pane: PaneId): void {
  lastPane = pane;
}

/** Where Ctrl+\ and Ctrl+Shift+\ act: the expanded pane, else the last one used, else the bottom one. */
export function activePane(key = viewKey()): PaneId | undefined {
  const { open, expanded } = layoutOf(key);
  return expanded ?? (lastPane && open.includes(lastPane) ? lastPane : open.at(-1));
}

/** Ctrl+\ first closes a pane's own tab where it has one (cccc2cf0a Rg): true when it did. */
export const innerClose = new Map<PaneId, () => boolean>();

/** closePane (Ctrl+\): the active pane's own tab first, else the pane. */
export function closeActivePane(key = viewKey()): void {
  const pane = activePane(key);
  if (pane && !innerClose.get(pane)?.()) closePane(pane, key);
}

/** toggleExpandPane (Ctrl+Shift+\) on the active pane. */
export function toggleActiveExpanded(key = viewKey()): void {
  const pane = activePane(key);
  if (pane) toggleExpanded(pane, key);
}

// ---------------------------------------------------------------------------
// Sizes

type Flexes = Partial<Record<PaneId, number>>;

const FLEX_KEY = "codex-ui:pane-flex";

function readFlex(): { w: Flexes; h: Flexes } {
  const clean = (value: unknown): Flexes =>
    Object.fromEntries(Object.entries(value && typeof value === "object" ? value : {}).filter(([, n]) => typeof n === "number" && n > 0 && Number.isFinite(n)));
  try {
    const raw = JSON.parse(localStorage.getItem(FLEX_KEY) ?? "null") as { w?: unknown; h?: unknown } | null;
    return { w: clean(raw?.w), h: clean(raw?.h) };
  } catch {
    return { w: {}, h: {} };
  }
}

const flex = readFlex();

/** The column's width with `top` as its first pane, against the chat's 2. */
export const columnFlex = (top: PaneId) => flex.w[top] ?? (BIG.has(top) ? 3 : 1);

/** A pane's share of the column's height. */
export const rowFlex = (pane: PaneId) => flex.h[pane] ?? 1;

/** Remembers dragged sizes; undefined goes back to the default. */
export function saveFlex(kind: "w" | "h", values: Partial<Record<PaneId, number | undefined>>): void {
  for (const [pane, value] of Object.entries(values) as [PaneId, number | undefined][]) {
    if (value === undefined) delete flex[kind][pane];
    else flex[kind][pane] = Math.round(value * 1000) / 1000;
  }
  writePref(FLEX_KEY, JSON.stringify(flex));
}

/**
 * Two neighbours' flex after their shared edge moved `delta` px (c9543da06 fi): the first takes
 * what the second gives, each kept at least `min` px (or half the room when there is less).
 */
export function moveEdge(flexes: [number, number], sizes: [number, number], delta: number, min: number): [number, number] {
  const total = sizes[0] + sizes[1];
  if (total <= 0) return flexes;
  const floor = Math.min(min, total / 2);
  const first = Math.min(Math.max(sizes[0] + delta, floor), total - floor);
  const sum = flexes[0] + flexes[1];
  return [(sum * first) / total, (sum * (total - first)) / total];
}

/**
 * 隐藏空白更改: inside a hunk, a run of removed lines followed by as many added lines that match
 * once whitespace is dropped becomes context (git diff -w for the common case).
 * ponytail: runs of different lengths stay as they are.
 */
export function ignoreWhitespace(diff: string): string {
  const lines = diff.split("\n");
  const out: string[] = [];
  const squash = (line: string) => line.slice(1).replace(/\s+/g, "");
  let hunk = false;
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (line.startsWith("@@")) hunk = true;
    else if (line.startsWith("diff ")) hunk = false;
    if (!hunk || !line.startsWith("-")) {
      out.push(line);
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].startsWith("-")) j += 1;
    let k = j;
    while (k < lines.length && lines[k].startsWith("+")) k += 1;
    const removed = lines.slice(i, j);
    const added = lines.slice(j, k);
    if (removed.length === added.length && removed.every((old, n) => squash(old) === squash(added[n]))) out.push(...added.map((text) => ` ${text.slice(1)}`));
    else out.push(...removed, ...added);
    i = k;
  }
  return out.join("\n");
}

/**
 * A changes-pane card's rows, the diff they come from and its counts. 隐藏空白更改 (`ws`) folds the
 * hunks, never the counts: the head shows the file's own (c44d00c7f ml). Folded to no change left,
 * the file is whitespace only and has no rows (Nr: vr's whitespaceOnly gives Cr, no hunks).
 */
export function fileRows(file: FileDiff, ws: boolean): { diff: string; rows: DiffRow[]; stats: { added: number; removed: number }; whitespaceOnly: boolean } {
  const diff = ws && !file.whole ? ignoreWhitespace(file.diff) : file.diff;
  const rows = parseDiff(diff, file.kind, file.whole);
  const stats = filesStats([file]);
  const whitespaceOnly = ws && stats.added + stats.removed > 0 && !rows.some((row) => row.kind === "add" || row.kind === "del");
  return { diff, rows: whitespaceOnly ? [] : rows, stats, whitespaceOnly };
}

export interface SplitCell {
  kind: "add" | "del" | "ctx";
  no?: number;
  text: string;
}

export type SplitRow = { gap: true } | { left: SplitCell | null; right: SplitCell | null };

/** 并排显示 rows: context on both sides, removed lines on the left paired with the added ones after them. */
export function splitRows(rows: DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const row = rows[i];
    if (row.kind === "gap") {
      out.push({ gap: true });
      i += 1;
    } else if (row.kind === "ctx") {
      out.push({ left: { kind: "ctx", no: row.oldNo, text: row.text }, right: { kind: "ctx", no: row.newNo, text: row.text } });
      i += 1;
    } else {
      const removed: DiffRow[] = [];
      const added: DiffRow[] = [];
      while (rows[i]?.kind === "del") removed.push(rows[i++]);
      while (rows[i]?.kind === "add") added.push(rows[i++]);
      for (let n = 0; n < Math.max(removed.length, added.length); n += 1)
        out.push({
          left: removed[n] ? { kind: "del", no: removed[n].oldNo, text: removed[n].text } : null,
          right: added[n] ? { kind: "add", no: added[n].newNo, text: added[n].text } : null,
        });
    }
  }
  return out;
}
