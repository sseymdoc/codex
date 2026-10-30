// Pure logic behind the Code session list and the working line (claude.ai audit W13,
// W14). No DOM and no store, so `pnpm test` can run it directly.

import type { Thread } from "@protocol/v2/Thread";
import { basename, normalizePath } from "./format.ts";

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

/**
 * The nested sessions that outlive their family root: Codex archives and deletes a thread with
 * every sub-agent it spawned, so only the ones it does not reach by spawn links alone (forks, and
 * what they spawned) can stay. `spawner` gives a session's parentThreadId.
 */
export function outliving(root: string, nested: string[], spawner: (id: string) => string | null | undefined): string[] {
  const spawned = (id: string) => {
    for (let at = spawner(id), depth = 0; at && depth < MAX_DEPTH; at = spawner(at), depth++) if (at === root) return true;
    return false;
  };
  return nested.filter((id) => !spawned(id));
}

/** The session a sub-agent runs in: its spawn links walked up to the top (itself when spawned by no one). */
export function spawnRoot(id: string, spawner: (id: string) => string | null | undefined): string {
  for (let at = spawner(id), depth = 0; at && depth < MAX_DEPTH; at = spawner(at), depth++) id = at;
  return id;
}

/** The sub-agents from a session down to `id`, the session's own child first (empty when `id` is no sub-agent). */
export function spawnPath(id: string, spawner: (id: string) => string | null | undefined): string[] {
  const path: string[] = [];
  for (let at: string | null | undefined = id, depth = 0; at && spawner(at) && depth < MAX_DEPTH; at = spawner(at), depth++) path.unshift(at);
  return path;
}

/** A sub-agent's spawn record (SubAgentSource thread_spawn); null for any other thread. */
export function spawnOf(thread: Pick<Thread, "source">) {
  const { source } = thread;
  return source !== null && typeof source === "object" && "subAgent" in source && typeof source.subAgent === "object" && "thread_spawn" in source.subAgent
    ? source.subAgent.thread_spawn
    : null;
}

/**
 * A sub-agent's parent and nickname, from its spawn record where the thread leaves them out:
 * thread/list mixing interactive and sub-agent sources returns parentThreadId null (Codex's own
 * p$() reads the source the same way).
 */
export function withLineage(thread: Thread): Thread {
  const spawn = spawnOf(thread);
  return spawn ? { ...thread, parentThreadId: thread.parentThreadId ?? spawn.parent_thread_id, agentNickname: thread.agentNickname ?? spawn.agent_nickname } : thread;
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
 * folder with the latest activity first. Sessions in no folder of the user's (null: a projectless
 * scheduled run's) share one, 不在项目中工作 as the task's card says, with nowhere to start one.
 */
export function folderBuckets<T>(families: (FamilyTime<T> & { folder: string | null })[]): (Bucket<T> & { folder?: string })[] {
  const byFolder = new Map<string | null, { folder: string | null; rows: T[]; latest: number }>();
  for (const family of families) {
    const key = family.folder === null ? null : normalizePath(family.folder);
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
    .map(([key, bucket]) => bucket.folder === null ? { key: "projectless", label: "不在项目中工作", rows: bucket.rows } : { key: `folder:${key}`, label: basename(bucket.folder) || "无文件夹", folder: bucket.folder, rows: bucket.rows });
}

/** Shift-click: the ids from the anchor to the target in list order, or just the target. */
export function rangeIds(order: string[], anchor: string | null, target: string): string[] {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(target);
  if (from === -1 || to === -1) return [target];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// ---------------------------------------------------------------------------
// Working line (code-working-line, chat chrome: c96d752d0 w8 over c734f318c TurnStatus)

/** en-US narrow: 12s, 1m 5s, 1h 2m 3s (a running command's time). */
export function clockText(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const x = s % 60;
  return h ? `${h}h ${m}m ${x}s` : m ? `${m}m ${x}s` : `${x}s`;
}

const UNITS: [Intl.NumberFormatOptions["unit"], number][] = [
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];
const unitFormats = new Map<string | undefined, Intl.NumberFormat>();

/** The status line's clock (shared-frame Ij()), zh-CN narrow: the largest unit above 0 and the two after it (23分钟 5秒, 1小时 0分钟 5秒). */
export function elapsedText(totalSeconds: number): string {
  let left = Math.max(0, Math.floor(totalSeconds));
  const parts = UNITS.map(([unit, size]) => {
    const count = Math.floor(left / size);
    left -= count * size;
    return [unit, count] as const;
  });
  const first = parts.findIndex(([, count]) => count > 0);
  return (first === -1 ? parts.slice(-1) : parts.slice(first, first + 3))
    .map(([unit, count]) => {
      if (!unitFormats.has(unit)) unitFormats.set(unit, new Intl.NumberFormat("zh-CN", { style: "unit", unit, unitDisplay: "narrow" }));
      return unitFormats.get(unit)!.format(count);
    })
    .join(" ");
}

/** 1 个 token, 950 个 token, 1.0k 个 token, 1.3M 个 token (shared-8 AV(): one decimal, the next unit from 999.95 on). */
export function tokenText(count: number): string {
  const tenths = (n: number) => Number(n.toFixed(1));
  const text =
    count >= 1e9
      ? `${(count / 1e9).toFixed(1)}B`
      : count >= 1e6
        ? tenths(count / 1e6) >= 1e3
          ? `${(count / 1e9).toFixed(1)}B`
          : `${tenths(count / 1e6).toFixed(1)}M`
        : count >= 1e3
          ? tenths(count / 1e3) >= 1e3
            ? `${(count / 1e6).toFixed(1)}M`
            : `${tenths(count / 1e3).toFixed(1)}k`
          : String(count);
  return `${text} 个 token`;
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
