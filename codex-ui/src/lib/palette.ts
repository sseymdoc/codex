// Pure pieces of the command palette (Claude Desktop 2.42304.0.0 ion-dist c2771e1f6, ce8be540f,
// cdfb0c433): row recency words, the row budget, match ranges and action matching.

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Wall-clock milliseconds, so a DST shift never moves a day boundary (shared-104 Ec / Dc). */
const wall = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

/** ce8be540f Cn(): a session row's recency word; nothing for a year or more. */
export function timeBucket(ms: number, now = Date.now()): string | null {
  if (Number.isNaN(ms)) return null;
  if (now - ms < 300_000) return "刚刚";
  if (now - ms < 3_600_000) return "过去一小时";
  const today = new Date(now);
  const then = new Date(ms);
  if (sameDay(today, then)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(yesterday, then)) return "昨天";
  const days = (wall(today) - wall(then)) / 86_400_000;
  return days < 7 ? "过去一周" : days < 30 ? "过去一个月" : days < 365 ? "过去一年" : null;
}

/** cdfb0c433 t(): every non-overlapping place the lowercase query occurs in `text`. */
export function hitRanges(text: string, lower: string): [number, number][] {
  const hay = text.toLowerCase();
  // A few letters lowercase to more code units; cdfb0c433 maps offsets for those, here they go unmarked.
  if (!lower || hay.length !== text.length) return [];
  const ranges: [number, number][] = [];
  for (let at = hay.indexOf(lower); at !== -1; at = hay.indexOf(lower, at + lower.length)) ranges.push([at, at + lower.length]);
  return ranges;
}

/**
 * Actions matching the lowercase query on their label or a search hint (c2771e1f6 Uu): label
 * prefix first, then anywhere in the label, then a hint. Past 50 characters nothing matches.
 * ponytail: substrings only; the original runs Fuse (threshold .2), which also forgives a typo.
 */
export function matchActions<T extends { label: string; hints?: string[] }>(items: T[], lower: string): T[] {
  if (!lower || lower.length > 50) return [];
  const rank = (item: T) => {
    const label = item.label.toLowerCase();
    return label.startsWith(lower) ? 0 : label.includes(lower) ? 1 : item.hints?.some((hint) => hint.toLowerCase().includes(lower)) ? 2 : 3;
  };
  return items
    .map((item) => ({ item, rank: rank(item) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}
