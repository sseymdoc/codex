// Pure logic behind the Code session list and the working line (claude.ai audit W13,
// W14). No DOM and no store, so `pnpm test` can run it directly.

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
