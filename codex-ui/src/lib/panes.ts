// Right-hand panes beside the chat (Claude Desktop 2.42304.0.0 tiles with the move / Fill / Tile
// menus off: c03935b01 Ti / Ci, cf53e1812 B, ca5db7aaf expand, c9543da06 boundary keys). Each
// view (a thread id, or "draft" for the new-session page) keeps its own open panes. The first
// opens beside the chat at chat:pane = 2:3 for the big panes (changes, files) and 2:1 for the
// rest; later ones stack under the last. Dragged ratios are remembered in codex-ui:pane-flex:
// the column's width per top pane (against the chat's 2, c03935b01 wi) and each pane's share of
// the column's height.

import type { FileUpdateChange } from "@protocol/v2/FileUpdateChange";
import { filesStats, parseDiff, type DiffRow, type FileDiff } from "./diff.ts";
import { getState, readJson, setState, writePref, type PaneId, type PaneLayout, type ThreadState, type TodoUpdate } from "./store.ts";

export const PANE_NAMES: Record<PaneId, string> = { diff: "更改", files: "文件", terminal: "终端", plan: "计划", background: "后台任务", browser: "浏览器" };

/** c03935b01 Ci: these open at 3 against the chat's 2, the others at 1. */
const BIG = new Set<PaneId>(["diff", "files", "browser"]);

export const NO_PANES: PaneLayout = { open: [], expanded: null };

/** The plan pane has something to show: a goal, a task list (`todos`, store.ts recordTodo) or a proposed plan. */
export const hasPlan = (thread: ThreadState, todos: readonly TodoUpdate[] | undefined): boolean =>
  !!thread.goal || thread.turns.some((turn) => todos?.some((update) => update.turnId === turn.id) || turn.items.some((item) => item.type === "plan"));

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

const pendingDiff = new Map<string, { path: string; preserveScope: boolean }>();

/** c856385e2 preferDiff: an edit row's file name opens that file's diff in the changes pane. */
export function openDiff(path: string, key = viewKey(), preserveScope = false): void {
  pendingDiff.set(key, { path, preserveScope });
  openPane("diff", key);
  window.dispatchEvent(new Event("codex:open-diff"));
}

/** The path openDiff asked for, once (the changes pane reads it on mount and on the event). */
export function takePendingDiff(key = viewKey()) {
  const target = pendingDiff.get(key) ?? null;
  pendingDiff.delete(key);
  return target;
}

const pendingScope = new Map<string, "all" | "turn">();

/** The rail's 更改 row: the changes pane at the scope its numbers came from (所有更改 or 本轮更改). */
export function openChanges(scope: "all" | "turn", key = viewKey()): void {
  pendingScope.set(key, scope);
  openPane("diff", key);
  window.dispatchEvent(new Event("codex:open-diff"));
}

export function takePendingScope(key = viewKey()): "all" | "turn" | null {
  const scope = pendingScope.get(key) ?? null;
  pendingScope.delete(key);
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
  const raw = readJson(FLEX_KEY) as { w?: unknown; h?: unknown } | null;
  return { w: clean(raw?.w), h: clean(raw?.h) };
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

/** c44d00c7f mr: a line without the spaces, tabs and CRs at its ends (the ones inside still count). */
const trimEnds = (line: string): string => line.replace(/^[ \t\r]+|[ \t\r]+$/g, "");

type Part = { count: number; added: boolean; removed: boolean; prev?: Part };
type Path = { oldPos: number; last?: Part };

/**
 * jsdiff 8's diffArrays (cc8da1d42 x on c6438c669's Diff, vr's ut), what vr needs of it: Myers'
 * fewest edits from `old` to `next` as runs of kept, removed and added entries, or undefined past
 * `limit` edits.
 */
function diffArrays(old: string[], next: string[], limit: number): Part[] | undefined {
  // A path's diagonal k is its old index less its new one; slide follows it past equal entries.
  const slide = (path: Path, k: number) => {
    let count = 0;
    while (path.oldPos + 1 < old.length && path.oldPos + 1 - k < next.length && old[path.oldPos + 1] === next[path.oldPos + 1 - k]) {
      path.oldPos++;
      count++;
    }
    if (count) path.last = { count, added: false, removed: false, prev: path.last };
    return path.oldPos + 1 >= old.length && path.oldPos + 1 - k >= next.length;
  };
  const step = ({ oldPos, last }: Path, added: boolean): Path => ({
    oldPos: added ? oldPos : oldPos + 1,
    last: last && last.added === added && last.removed === !added ? { ...last, count: last.count + 1 } : { count: 1, added, removed: !added, prev: last },
  });
  const parts = (last?: Part) => {
    const out: Part[] = [];
    for (; last; last = last.prev) out.push(last);
    return out.reverse();
  };
  const best: Record<number, Path | undefined> = { 0: { oldPos: -1 } };
  if (slide(best[0]!, 0)) return parts(best[0]!.last);
  let min = -Infinity;
  let max = Infinity;
  for (let edits = 1; edits <= Math.min(old.length + next.length, limit); edits++)
    for (let k = Math.max(min, -edits); k <= Math.min(max, edits); k += 2) {
      const remove = best[k - 1];
      const add = best[k + 1];
      best[k - 1] = undefined;
      const canAdd = !!add && add.oldPos - k >= 0 && add.oldPos - k < next.length;
      const canRemove = !!remove && remove.oldPos + 1 < old.length;
      if (!canAdd && !canRemove) {
        best[k] = undefined;
        continue;
      }
      // The path further down the old entries, the added entry on a tie.
      const path = canAdd && (!canRemove || remove!.oldPos < add!.oldPos) ? step(add!, true) : step(remove!, false);
      if (slide(path, k)) return parts(path.last);
      best[k] = path;
      if (path.oldPos + 1 >= old.length) max = Math.min(max, k - 1);
      if (path.oldPos + 1 - k >= next.length) min = Math.max(min, k + 1);
    }
  return undefined;
}

// jsdiff 8 diffWordsWithSpace's tokens: a newline, a run of word characters (Latin letters with
// their accented forms, digits, _), a run of other blanks, or any other single character.
const WORD_CHARS = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
const WORD_TOKEN = new RegExp(`(\\r?\\n)|[${WORD_CHARS}]+|[^\\S\\n\\r]+|[^${WORD_CHARS}]`, "gu");

export type WordRanges = { del: [number, number][]; add: [number, number][] };

/**
 * 突出显示更改的字词 for a removed line and the added one it pairs with: the diffs library's
 * "word-alt" (cc8da1d42 J / w). Changed runs absorb a one-character gap between them; the last
 * piece stands alone. Lines past 1000 characters get none.
 */
export function changedWords(del: string, add: string): WordRanges | undefined {
  if (del.length > 1000 || add.length > 1000) return undefined;
  const old = del.match(WORD_TOKEN) ?? [], next = add.match(WORD_TOKEN) ?? [];
  const parts = diffArrays(old, next, old.length + next.length);
  if (!parts) return undefined;
  const sides: Record<"del" | "add", [number, string][]> = { del: [], add: [] };
  const push = (side: [number, string][], value: string, neutral: boolean, last: boolean) => {
    const prev = side.at(-1);
    if (!prev || last) return void side.push([neutral ? 0 : 1, value]);
    const prevNeutral = prev[0] === 0;
    if (neutral === prevNeutral || (neutral && value.length === 1 && !prevNeutral)) prev[1] += value;
    else side.push([neutral ? 0 : 1, value]);
  };
  let d = 0, a = 0;
  parts.forEach(({ count, added, removed }, index) => {
    const last = index === parts.length - 1;
    if (removed) push(sides.del, old.slice(d, (d += count)).join(""), false, last);
    else if (added) push(sides.add, next.slice(a, (a += count)).join(""), false, last);
    else {
      const value = old.slice(d, (d += count)).join("");
      a += count;
      push(sides.del, value, true, last);
      push(sides.add, value, true, last);
    }
  });
  const ranges = (side: [number, string][]) => {
    const out: [number, number][] = [];
    let at = 0;
    for (const [changed, value] of side) {
      if (changed) out.push([at, at + value.length]);
      at += value.length;
    }
    return out;
  };
  return { del: ranges(sides.del), add: ranges(sides.add) };
}

/**
 * Word ranges per row of a unified diff: in each run, the n-th removed line pairs with the n-th
 * added one. None past 1000 rows (cc8da1d42: lineDiffType "none" for big diffs).
 */
export function rowWords(rows: readonly { kind: string; text: string }[]): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  if (rows.length > 1000) return out;
  for (let i = 0; i < rows.length; ) {
    if (rows[i].kind !== "del") { i++; continue; }
    const dels: number[] = [], adds: number[] = [];
    for (; i < rows.length && rows[i].kind === "del"; i++) dels.push(i);
    for (; i < rows.length && rows[i].kind === "add"; i++) adds.push(i);
    for (let n = 0; n < Math.min(dels.length, adds.length); n++) {
      const words = changedWords(rows[dels[n]].text, rows[adds[n]].text);
      if (words?.del.length) out.set(dels[n], words.del);
      if (words?.add.length) out.set(adds[n], words.add);
    }
  }
  return out;
}

/** 隐藏空白更改 (c44d00c7f vr): foldRuns with lines that match once trimEnds drops their ends' spaces, tabs and CRs. */
export const ignoreWhitespace = (diff: string): string => foldRuns(diff, trimEnds);

/**
 * A change as Codex streams it (item/fileChange/patchUpdated): an update's hunk is apply_patch's
 * chunk as its old lines then its new ones, the context in both (format_update_chunks_for_progress),
 * so what the two sides share becomes context again.
 */
export function streamedChange(change: FileUpdateChange): FileUpdateChange {
  return change.kind.type === "update" ? { ...change, diff: foldRuns(change.diff, (line) => line) } : change;
}

/**
 * In each hunk, a run of removed and added lines that match (`same` maps each to what is compared)
 * becomes context, in its new text. Otherwise the mapped lines are diffed (up to 2000 lines and
 * 400 edits) and what matches becomes context. A run whose sides differ in "\ No newline at end
 * of file" stays as it is; a hunk left with no change goes.
 */
function foldRuns(diff: string, same: (line: string) => string): string {
  const eol = diff.endsWith("\n");
  const lines = (eol ? diff.slice(0, -1) : diff).split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@@")) out.push(lines[i++]);
  while (i < lines.length) {
    const hunk = out.length;
    let changed = false;
    out.push(lines[i++]);
    while (i < lines.length && !lines[i].startsWith("@@")) {
      if (lines[i][0] !== "-" && lines[i][0] !== "+") {
        out.push(lines[i++]);
        continue;
      }
      // c44d00c7f gr: the run's removed and added lines, and which side has no newline at its end.
      const dels: string[] = [];
      const adds: string[] = [];
      let delNoEol = false;
      let addNoEol = false;
      let end = i;
      for (; end < lines.length; end++) {
        const line = lines[end];
        if (line[0] === "-") dels.push(line.slice(1));
        else if (line[0] === "+") adds.push(line.slice(1));
        else if (line[0] !== "\\") break;
        else if (adds.length) addNoEol = true;
        else delNoEol = true;
      }
      if (delNoEol === addNoEol && dels.length === adds.length && dels.every((line, n) => same(line) === same(adds[n]))) {
        for (const line of adds) out.push(` ${line}`);
        if (addNoEol) out.push("\\ No newline at end of file");
      } else {
        changed = true;
        const parts = !delNoEol && !addNoEol && dels.length && adds.length && dels.length + adds.length <= 2000 ? diffArrays(dels.map(same), adds.map(same), 400) : undefined;
        if (!parts) for (let n = i; n < end; n++) out.push(lines[n]);
        let d = 0;
        let a = 0;
        for (const { count, added, removed } of parts ?? []) {
          // A kept line shows its new text.
          for (let n = 0; n < count; n++) out.push(removed ? `-${dels[d + n]}` : `${added ? "+" : " "}${adds[a + n]}`);
          if (!added) d += count;
          if (!removed) a += count;
        }
      }
      i = end;
    }
    if (!changed) out.length = hunk;
  }
  return out.join("\n") + (eol ? "\n" : "");
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

// 分开显示测试、构建和生成的文件 (Claude 4.4212 cbbf81135 Qn): which kind a changed file is.
// shortcut: path patterns stand in for Claude's classifier (not traced); widen them as projects show up.
const TEST_FILE = /(^|\/)(tests?|__tests__|__mocks__|spec|specs|e2e)\/|\.(test|spec|e2e)\.[^/]+$|_test\.(go|py|rs)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|swift|cs)$/i;
const GENERATED_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|MODULE\.bazel\.lock|flake\.lock)$|\.min\.(js|css)$|\.(pb|generated|g)\.[^/]+$|_pb2\.py$|(^|\/)(generated|__generated__|__snapshots__)\/|\.snap$/i;
const BUILD_FILE = /(^|\/)(dist|build|out|target|coverage|\.next)\/|(^|\/)(Makefile|Dockerfile|Containerfile|CMakeLists\.txt|BUILD(\.bazel)?|WORKSPACE|MODULE\.bazel|justfile|Taskfile\.ya?ml)$|\.(gradle|cmake|bzl)$|(^|\/)\.github\/workflows\/|(^|\/)(vite|webpack|rollup|esbuild|babel|jest|vitest|eslint|prettier|tsconfig)[^/]*\.(c?[jt]s|mjs|json)$/i;

export type FileKind = "test" | "build" | "generated" | null;
export const FILE_KIND_LABELS: Record<Exclude<FileKind, null>, string> = { test: "测试文件", build: "构建文件", generated: "生成的文件" };

export function fileKind(path: string): FileKind {
  const unix = path.replaceAll("\\", "/");
  return GENERATED_FILE.test(unix) ? "generated" : TEST_FILE.test(unix) ? "test" : BUILD_FILE.test(unix) ? "build" : null;
}

/** 按文件夹分组文件 (cbbf81135 Zn): the files under their folder, folders in path order, "" for the root. */
export function byFolder<T extends { path: string; movePath?: string | null }>(files: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const path = (file.movePath ?? file.path).replaceAll("\\", "/");
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    groups.set(folder, [...(groups.get(folder) ?? []), file]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
