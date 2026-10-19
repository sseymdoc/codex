// Pure logic behind the new-session page's action center (Claude Desktop 2.42304.0.0 cc43287c9
// PU / _U / bU for Sessions, eU / tU / iU for Projects): which sessions want the user, which
// projects are in flight, and how their rows read. No DOM and no store, so `pnpm test` can run it.

/** The slice of a session the action center reads. */
export interface SessionFacts {
  id: string;
  /** Unix seconds the session last moved (recencyAt ?? updatedAt). */
  at: number;
  /** Waiting on an approval or an answer, or stopped by a system error. */
  blocked: boolean;
  /** A turn is running and nothing is waiting on the user. */
  working: boolean;
  unread: boolean;
  projectId: string | null;
}

export type AttentionKind = "blocked" | "unread";

/**
 * Sessions that want the user (cc43287c9 _U, non-tasks mode): blocked first, then unread, each
 * newest first. A dismissal (`acked`: id → the `at` it was dismissed at) hides a row until the
 * session moves again; a working session is neither.
 */
export function attentionRows(sessions: SessionFacts[], acked: Record<string, number>): { id: string; kind: AttentionKind }[] {
  const blocked: SessionFacts[] = [];
  const unread: SessionFacts[] = [];
  for (const s of sessions) {
    if (s.working || (acked[s.id] ?? -Infinity) >= s.at) continue;
    if (s.blocked) blocked.push(s);
    else if (s.unread) unread.push(s);
  }
  const newest = (a: SessionFacts, b: SessionFacts) => b.at - a.at;
  return [...blocked.sort(newest).map(({ id }) => ({ id, kind: "blocked" as const })), ...unread.sort(newest).map(({ id }) => ({ id, kind: "unread" as const }))];
}

export interface ProjectFacts {
  id: string;
  name: string;
  /** Unix seconds of the newest member session, null when it has none. */
  recencyAt: number | null;
}

export interface ProjectRow<P extends ProjectFacts> {
  project: P;
  unread: boolean;
  /** Unix seconds; undefined when nothing is known. */
  at?: number;
}

/** A week (cc43287c9 $H = 6048e5 ms). */
const IN_FLIGHT_S = 7 * 86400;

/**
 * Projects in flight (cc43287c9 eU + tU): any member unread or working, or activity in the last
 * week. Unread first, then working, then the rest; newest first within, then by name.
 */
export function projectRows<P extends ProjectFacts>(projects: P[], sessions: SessionFacts[], nowS: number): ProjectRow<P>[] {
  const rows: { row: ProjectRow<P>; tier: number }[] = [];
  for (const project of projects) {
    const members = sessions.filter((s) => s.projectId === project.id);
    const unread = members.some((s) => s.unread);
    const working = members.some((s) => s.working);
    const latest = members.reduce<number | undefined>((max, s) => (max === undefined || s.at > max ? s.at : max), undefined);
    const at = project.recencyAt ?? latest;
    if (!unread && !working && !(at !== undefined && at >= nowS - IN_FLIGHT_S)) continue;
    rows.push({ row: { project, unread, ...(at !== undefined ? { at } : {}) }, tier: unread ? 0 : working ? 1 : 2 });
  }
  return rows
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const x = a.row.at;
      const y = b.row.at;
      return x === y ? a.row.project.name.localeCompare(b.row.project.name) : x === undefined ? 1 : y === undefined ? -1 : y - x;
    })
    .map(({ row }) => row);
}

export type ProjectSessionKind = "blocked" | "working";

/** A project's open sessions (cc43287c9 iU): blocked before working, newest first, the first `limit`, plus the counts. */
export function projectSessions(sessions: SessionFacts[], projectId: string, limit: number) {
  const counts: Record<ProjectSessionKind, number> = { blocked: 0, working: 0 };
  const rows: { id: string; kind: ProjectSessionKind; at: number }[] = [];
  for (const s of sessions) {
    if (s.projectId !== projectId) continue;
    const kind = s.blocked ? "blocked" : s.working ? "working" : null;
    if (!kind) continue;
    counts[kind] += 1;
    rows.push({ id: s.id, kind, at: s.at });
  }
  rows.sort((a, b) => Number(a.kind === "working") - Number(b.kind === "working") || b.at - a.at);
  return { rows: rows.slice(0, Math.max(0, limit)), counts };
}

/** `owner/name` from a git remote (https, ssh or scp form); the last segment alone when there is no owner. */
export function repoSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url
    .trim()
    .replace(/\.git\/?$/, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, "")
    .replace(/^[^@/\s]+@[^:/\s]+:/, "");
  const parts = path.split("/").filter(Boolean);
  return parts.length >= 2 ? `${parts.at(-2)}/${parts.at(-1)}` : (parts[0] ?? null);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536e3],
  ["month", 2592e3],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** Narrow relative time, never absolute (shared-2 RelativeTime with relativeFormat "narrow"): 现在, 5分钟前, 昨天. */
export function relativeTime(seconds: number, nowMs: number, locale = "zh-CN"): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const diff = Math.round(seconds - nowMs / 1000);
  const unit = UNITS.find(([, size]) => Math.abs(diff) >= size);
  return unit ? format.format(Math.round(diff / unit[1]), unit[0]) : format.format(0, "second");
}

/** Rows a section shows before 再显示 (cc43287c9 wU: 3, plus one per 100px of window height from 800 to 1100). */
export function rowLimit(windowHeight: number): number {
  return 3 + [800, 900, 1000, 1100].filter((h) => windowHeight >= h).length;
}
