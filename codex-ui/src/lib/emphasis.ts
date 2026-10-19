// `*` and `_` emphasis as Claude Desktop's Code tab pairs it (2.42304.0.0: Alluvium, c86867935 A
// with its unicodeWhitespaceFlanking fix on). A run may open when no whitespace follows it and close
// when none comes before it; punctuation does not count, so `这是**「重点」**和` and `**注意：**这里`
// are bold where CommonMark (marked's own emStrong) leaves the stars. A `_` run between two ASCII
// letters or digits is text. Runs pair on one stack, CommonMark's rule of three kept.

import type { MarkedExtension } from "marked";

/** C / ne: marks open and emphasis pairs made, at most. */
export const MOST = 256;

const ALNUM = /^[A-Za-z0-9]$/;
const SPACE = /^\s$/;

/** rt: whether a run of `run` `ch`s may close `mark` (CommonMark's rule of three). */
export function mayClose(mark: { kind: string; marker: string; run?: number; closes?: boolean }, ch: string, run: number, opens: boolean): boolean {
  const length = mark.run ?? mark.marker.length;
  return (mark.kind === "strong" || mark.kind === "em") && mark.marker[0] === ch && ((!opens && !mark.closes) || (length + run) % 3 !== 0 || (length % 3 === 0 && run % 3 === 0));
}

interface Opener {
  kind: "strong" | "em";
  marker: string;
  /** Where its marker starts. */
  from: number;
  run: number;
  closes: boolean;
}

/** A's `*` and `_` runs over `text`: each emphasis they make, by where its opener starts: [where its closer ends, 1 (em) or 2 (strong)]. */
function pair(text: string): Map<number, [number, number]> {
  const marks: Opener[] = [];
  const made = new Map<number, [number, number]>();
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch !== "*" && ch !== "_") {
      i++;
      continue;
    }
    let end = i;
    while (text[end] === ch) end++;
    const run = end - i;
    const before = text[i - 1] ?? " ";
    const after = text[end] ?? " ";
    // The run's first character no pair has taken.
    let at = i;
    if (ch !== "_" || !ALNUM.test(before) || !ALNUM.test(after)) {
      const opens = !SPACE.test(after);
      while (!SPACE.test(before) && at < end && made.size < MOST) {
        const left = end - at;
        const k = marks.findLastIndex((mark, k) => mayClose(mark, ch, run, opens) && ((left === run && mark.marker.length === left && mark.marker.length === mark.run) || k === marks.length - 1));
        if (k < 0) break;
        marks.length = k + 1;
        const opener = marks[k];
        let rest = opener.marker.length;
        // Pairs take two characters from each side at a time, from the inside out.
        while (rest > 0 && at < end && made.size < MOST) {
          const take = Math.min(2, rest, end - at);
          rest -= take;
          at += take;
          made.set(opener.from + rest, [at, take]);
        }
        if (rest > 0 && made.size < MOST) {
          opener.marker = ch.repeat(rest);
          opener.kind = rest >= 2 ? "strong" : "em";
        } else marks.pop();
      }
      if (at < end && opens && marks.length < MOST) marks.push({ kind: end - at >= 2 ? "strong" : "em", marker: ch.repeat(end - at), from: at, run, closes: !SPACE.test(before) });
    }
    i = end;
  }
  return made;
}

let masked = "";
let pairs = new Map<number, [number, number]>();

/**
 * marked's emStrong, replaced: emphasis starts where A pairs an opener. Code spans, links, tags and
 * escapes are masked out of `maskedSrc` (marked keeps its length), so their characters never pair.
 */
export const emphasis: MarkedExtension = {
  tokenizer: {
    emStrong(src, maskedSrc) {
      if (src[0] !== "*" && src[0] !== "_") return undefined;
      if (maskedSrc !== masked) [masked, pairs] = [maskedSrc, pair(maskedSrc)];
      const at = maskedSrc.length - src.length;
      const found = pairs.get(at);
      if (!found) return undefined;
      const [end, size] = found;
      const raw = src.slice(0, end - at);
      const text = raw.slice(size, -size);
      const tokens = this.lexer.inlineTokens(text);
      return size === 2 ? { type: "strong", raw, text, tokens } : { type: "em", raw, text, tokens };
    },
  },
};
