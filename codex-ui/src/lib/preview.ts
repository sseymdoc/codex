// File preview helpers (U24; Claude Desktop 2.42304.0.0 c3fde7009): which parts of a rewritten
// file to mark, highlighted code split into lines, and the document rail's heading levels.

export type Range = [number, number];

/** Added text marked after a rewrite; the stamp alternates so a second rewrite restarts the animation. */
export interface Marks {
  ranges: Range[];
  stamp: "a" | "b";
}

export const NO_MARKS: Marks = { ranges: [], stamp: "a" };

const linesOf = (text: string) => (text.endsWith("\n") ? text : `${text}\n`).match(/[^\n]*\n/g) ?? [];

/**
 * Character ranges of `next` (whole lines) that `prev` lacks, adjacent lines merged; jsdiff
 * diffLines semantics (c3fde7009 bt). ponytail: an LCS table instead of jsdiff's Myers search;
 * past 1M cells it marks the whole changed span, as the original does when jsdiff gives up.
 */
export function addedRanges(prev: string, next: string): Range[] {
  if (prev === next) return [];
  const a = linesOf(prev);
  const b = linesOf(next);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  const added = new Array<boolean>(m).fill(true);
  if (n * m <= 1_000_000) {
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1)
      for (let j = m - 1; j >= 0; j -= 1)
        lcs[i * width + j] = midA[i] === midB[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        added[j] = false;
        i += 1;
        j += 1;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) i += 1;
      else j += 1;
    }
  }
  const ranges: Range[] = [];
  let offset = b.slice(0, head).reduce((sum, line) => sum + line.length, 0);
  for (let k = 0; k < m; k += 1) {
    const end = Math.min(next.length, offset + midB[k].length);
    if (added[k] && end > offset) {
      const last = ranges.at(-1);
      if (last && last[1] === offset) last[1] = end;
      else ranges.push([offset, end]);
    }
    offset += midB[k].length;
  }
  return ranges;
}

/** Marks for a rewrite of the same file: none when nothing was added or more than half the file is new (c3fde7009 ht). */
export function nextMarks(prev: string, next: string, last: Marks): Marks {
  const ranges = addedRanges(prev, next);
  const size = ranges.reduce((sum, [start, end]) => sum + end - start, 0);
  return ranges.length === 0 || size > next.length * 0.5 ? NO_MARKS : { ranges, stamp: last.stamp === "a" ? "b" : "a" };
}

export const overlaps = (ranges: Range[], start: number, end: number) => ranges.some(([s, e]) => s < end && start < e);

/** highlight.js HTML split into lines, each with its open spans closed and reopened. */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  for (const [token] of html.matchAll(/<span[^>]*>|<\/span>|\n|[^<\n]+|</g)) {
    if (token === "\n") {
      lines.push(line + "</span>".repeat(open.length));
      line = open.join("");
    } else if (token.startsWith("<span")) {
      open.push(token);
      line += token;
    } else if (token === "</span>") {
      open.pop();
      line += token;
    } else line += token;
  }
  lines.push(line + "</span>".repeat(open.length));
  return lines;
}

/**
 * Rail tick levels 0–2 from heading depths (c3fde7009 On): relative to the shallowest heading,
 * one deeper when the first heading is the only one at that depth (the document's title).
 */
export function docLevels(depths: number[]): number[] {
  if (depths.length === 0) return [];
  const top = Math.min(...depths);
  const title = depths[0] === top && depths.filter((depth) => depth === top).length === 1;
  return depths.map((depth, index) => Math.max(0, Math.min(title && index > 0 ? depth - top - 1 : depth - top, 2)));
}
