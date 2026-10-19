// Pure logic behind the Code session list and the working line (claude.ai audit W13,
// W14). No DOM and no store, so `pnpm test` can run it directly.

import { basename } from "./format.ts";

export type SessionSort = "recency" | "alpha" | "created";

export interface LineageRow {
  id: string;
  title: string;
  recency: number;
  created: number;
  /** The session this one came from: the fork source or the spawning parent. */
  parent: string | null;
}

export interface ListEntry<T> {
  row: T;
  /** flat: no family; head: a family root; nested: a member under the head before it. */
  place: "flat" | "head" | "nested";
}

const MAX_DEPTH = 32;

/**
 * Orders sessions with their families (shared-21 rz() / az()): every fork or sub-agent
 * hangs one level under its family root, depth first by direct parent. Sorted by
 * recency a family rises with its most recent member; by name or creation time it
 * stays where its root sorts.
 */
export function familyOrder<T extends LineageRow>(rows: T[], sort: SessionSort): ListEntry<T>[] {
  const compare =
    sort === "alpha"
      ? (a: T, b: T) => a.title.localeCompare(b.title, "zh")
      : sort === "created"
        ? (a: T, b: T) => b.created - a.created
        : (a: T, b: T) => b.recency - a.recency;
  const sorted = [...rows].sort(compare);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const headOf = new Map<string, string>();
  for (const row of rows) {
    let head = row.parent;
    for (let depth = 0; head && depth < MAX_DEPTH; depth++) {
      const up = byId.get(head)?.parent;
      if (!up || !byId.has(up) || up === row.id) break;
      head = up;
    }
    if (head && head !== row.id && byId.has(head)) headOf.set(row.id, head);
  }
  const heads = new Set(headOf.values());
  const kids = new Map<string, T[]>();
  for (const row of sorted) {
    const head = headOf.get(row.id);
    if (head === undefined) continue;
    const key = row.parent && headOf.get(row.parent) === head ? row.parent : head;
    kids.set(key, [...(kids.get(key) ?? []), row]);
  }
  const out: ListEntry<T>[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    for (const kid of kids.get(id) ?? []) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      out.push({ row: kid, place: "nested" });
      walk(kid.id, depth + 1);
    }
  };
  for (const row of sorted) {
    const head = headOf.get(row.id);
    if (head !== undefined && sort !== "recency") continue;
    const id = head ?? row.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ row: byId.get(id)!, place: heads.has(id) ? "head" : "flat" });
    walk(id, 0);
  }
  return out;
}

/** A family to bucket: its rows in list order and the seconds it sorts by (its latest member). */
export interface FamilyTime<T> {
  rows: T[];
  time: number;
}

export interface Bucket<T> {
  key: string;
  label: string;
  rows: T[];
}

/**
 * Group by Date (shared-22 vw()): Today, Yesterday, the five days before by date, then Older,
 * newest first. A family goes where its latest activity falls.
 */
export function dateBuckets<T>(families: FamilyTime<T>[], now: Date): Bucket<T>[] {
  const starts = Array.from({ length: 7 }, (_, day) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
  const days: T[][] = starts.map(() => []);
  const older: T[] = [];
  for (const family of families) {
    const day = starts.findIndex((start) => family.time * 1000 >= start.getTime());
    (day === -1 ? older : days[day]).push(...family.rows);
  }
  const label = (day: number) => (day === 0 ? "今天" : day === 1 ? "昨天" : `${starts[day].getMonth() + 1}月${starts[day].getDate()}日`);
  const out = days.flatMap((rows, day) => (rows.length ? [{ key: `day-${day}`, label: label(day), rows }] : []));
  if (older.length) out.push({ key: "older", label: "更早", rows: older });
  return out;
}

/**
 * Group by Environment (shared-22 xw()): one bucket per working folder, named after it, the
 * folder with the latest activity first.
 */
export function folderBuckets<T>(families: (FamilyTime<T> & { folder: string })[]): (Bucket<T> & { folder: string })[] {
  const byFolder = new Map<string, { folder: string; rows: T[]; latest: number }>();
  for (const family of families) {
    const key = family.folder.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
    const bucket = byFolder.get(key);
    if (bucket) {
      bucket.rows.push(...family.rows);
      bucket.latest = Math.max(bucket.latest, family.time);
    } else {
      byFolder.set(key, { folder: family.folder, rows: [...family.rows], latest: family.time });
    }
  }
  return [...byFolder]
    .sort((a, b) => b[1].latest - a[1].latest)
    .map(([key, bucket]) => ({ key: `folder:${key}`, label: basename(bucket.folder) || "无文件夹", folder: bucket.folder, rows: bucket.rows }));
}

/** Shift-click: the ids from the anchor to the target in list order, or just the target. */
export function rangeIds(order: string[], anchor: string | null, target: string): string[] {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// ---------------------------------------------------------------------------
// Working line (code-working-line, default design)

/** By the turn's elapsed time, not the thinking time (c96d752d0 Net()). */
const THINK_STEPS: [number, string][] = [
  [60, "快想好了…"],
  [45, "还在深入思考…"],
  [30, "再多想一会儿…"],
  [15, "仍在思考…"],
  [0, "思考中…"],
];

/** The status line only redraws when elapsed time crosses one of these (p8()). */
export function bucket(seconds: number): number {
  return [60, 45, 30, 15, 2].find((step) => seconds >= step) ?? 0;
}

export function thinkingLabel(seconds: number): string {
  const step = bucket(seconds);
  return THINK_STEPS.find(([at]) => step >= at)![1];
}

/** en-US narrow: 12s, 1m 5s, 1h 2m 3s. */
export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}h ${m}m ${x}s` : m ? `${m}m ${x}s` : `${x}s`;
}

/** 1 token, 950 tokens, 1.0k tokens, 12.3k tokens, 1.2M tokens. */
export function tokenText(count: number): string {
  if (count === 1) return "1 token";
  if (count < 1000) return `${count} tokens`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k tokens`;
  return `${(count / 1_000_000).toFixed(1)}M tokens`;
}

/** The waiting label as it settles (c96d752d0 S8 + uM). */
export interface Steady {
  /** S8's label after the debounce. */
  want: string | null;
  /** A text -> text change waiting out the 150ms debounce, and since when. */
  next: string | null;
  nextAt: number;
  /** What shows (uM), and since when. */
  shown: string | null;
  shownAt: number;
  working: boolean;
}

export const STEADY: Steady = { want: null, next: null, nextAt: 0, shown: null, shownAt: -Infinity, working: false };

/**
 * One step of the waiting label at `now`: null -> text and text -> null switch at once, text ->
 * text after 150ms; with `hold` a null keeps the last text; whatever shows stays 650ms; a new
 * working stretch switches at once. `wake` is when to step again, null when settled.
 */
export function steadyStep(s: Steady, label: string | null, hold: boolean, working: boolean, now: number): { state: Steady; wake: number | null } {
  const restart = working && !s.working;
  const target = label === null && hold ? s.want : label;
  let { want, next, nextAt, shown, shownAt } = s;
  let wake: number | null = null;
  if (target === want) next = null;
  else if (restart || target === null || want === null) {
    want = target;
    next = null;
  } else {
    if (next !== target) [next, nextAt] = [target, now];
    if (now - nextAt >= 150) [want, next] = [target, null];
    else wake = nextAt + 150;
  }
  if (want !== shown) {
    if (restart || now - shownAt >= 650) [shown, shownAt] = [want, now];
    else wake = Math.min(wake ?? Infinity, shownAt + 650);
  }
  return { state: { want, next, nextAt, shown, shownAt, working }, wake };
}

export type Thinking = null | { kind: "active"; open: boolean } | { kind: "done"; seconds: number };

/**
 * ITe(): while thinking, active; once it ends, stay active until it has shown for at
 * least 2s, then show "已思考 Ns" for 2s, then nothing.
 */
export function thinkingPhase(now: number, start: number, end: number | null): Thinking {
  if (now < start) return null;
  if (end === null || now < end) return { kind: "active", open: true };
  const hold = end + Math.max(0, 2000 - (end - start));
  if (now < hold) return { kind: "active", open: false };
  return now < hold + 2000 ? { kind: "done", seconds: Math.max(1, Math.round((end - start) / 1000)) } : null;
}

// ---------------------------------------------------------------------------
// Transcript views (c03935b01): normal hides thinking, thinking shows it, verbose also
// opens every tool row. Ctrl+O cycles them.

export type TranscriptView = "normal" | "thinking" | "verbose";

export const VIEWS: TranscriptView[] = ["normal", "thinking", "verbose"];

export function nextView(view: TranscriptView): TranscriptView {
  return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length];
}
