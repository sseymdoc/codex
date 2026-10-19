// Pure logic behind the new-session page's start card (Claude Desktop 2.42304.0.0 cc43287c9 with
// the session-presets flag on: x3 seats the next steps, r3 / u3 remember dismissals) and the
// narrow relative time the session rail shares. No DOM and no store, so `pnpm test` can run it.

export type Seat<T> = { row: T } | { rest: T[]; whole: boolean };

/**
 * cc43287c9 x3: families in priority order share three seats, one each, then the spare ones go in
 * order to families with more rows than seats. A family that still has more shows one row fewer
 * and a rest seat holding the others (whole when it shows none of them).
 */
export function seat<T>(families: T[][], seats = 3): Seat<T>[] {
  const taken = families
    .filter((rows) => rows.length > 0)
    .slice(0, seats)
    .map((rows) => ({ rows, seats: 1 }));
  for (let spare = seats - taken.length; spare > 0; spare--) {
    const more = taken.find((family) => family.rows.length > family.seats);
    if (!more) break;
    more.seats += 1;
  }
  return taken.flatMap(({ rows, seats: n }) => {
    const shown = rows.length <= n ? rows.length : n - 1;
    const out: Seat<T>[] = rows.slice(0, shown).map((row) => ({ row }));
    return shown < rows.length ? [...out, { rest: rows.slice(shown), whole: shown === 0 }] : out;
  });
}

/** Dismissed rows: key → the stamp they were dismissed at (cc43287c9 startCardDismissals); a row returns once its stamp moves. */
export type Dismissals = Record<string, string>;

/** Remembers a dismissal; the newest 100 are kept (u3). */
export function dismiss(map: Dismissals, key: string, stamp: string): Dismissals {
  return Object.fromEntries([...Object.entries(map).filter(([k]) => k !== key).slice(-99), [key, stamp]]);
}

/** cc43287c9 continue-branch: uncommitted work on a branch other than the default one (main or master when the remote names none). */
export function continues(status: { branch: string; base: string | null; files: number } | null): boolean {
  return !!status && status.files > 0 && !(status.base ? [status.base] : ["main", "master"]).includes(status.branch);
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
