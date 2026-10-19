// `*` and `_` emphasis as Claude Desktop's Code tab pairs it (2.42304.0.0: Alluvium, c86867935 A
// with its unicodeWhitespaceFlanking fix on). A run may open when no whitespace follows it and close
// when none comes before it; punctuation does not count, so `这是**「重点」**和` and `**注意：**这里`
// are bold where CommonMark (marked's own emStrong) leaves the stars. A `_` run between two ASCII
// letters or digits is text. Runs pair on one stack, CommonMark's rule of three kept.
// Strikethrough shares the stack: a run of exactly two `~` closes the one open there or opens one,
// whatever is around it; other `~` runs are text. marked's GFM del takes one `~` too and asks for
// flanking, so it struck `约 1~2 天，或 3~5 天` through and left `这是~~「删除」~~和` alone.

import type { Lexer, MarkedExtension } from "marked";

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
  kind: "strong" | "em" | "del";
  marker: string;
  /** Where its marker starts. */
  from: number;
  run: number;
  closes: boolean;
}

/**
 * A's `*`, `_` and `~` runs over `text`: each emphasis and strikethrough they make, by where its
 * opener starts: [where its closer ends, 1 (em) or 2 (strong, del)].
 */
function pair(text: string): Map<number, [number, number]> {
  const marks: Opener[] = [];
  const made = new Map<number, [number, number]>();
  /** p: emphasis pairs made; strikethroughs are not counted. */
  let count = 0;
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch !== "*" && ch !== "_" && ch !== "~") {
      i++;
      continue;
    }
    let end = i;
    while (text[end] === ch) end++;
    const run = end - i;
    if (ch === "~") {
      if (run === 2) {
        // What is open above the strikethrough it closes turns to text.
        const del = marks.findLastIndex((mark) => mark.kind === "del");
        if (del >= 0) {
          made.set(marks[del].from, [end, 2]);
          marks.length = del;
        } else if (marks.length < MOST) marks.push({ kind: "del", marker: "~~", from: i, run, closes: false });
      }
      i = end;
      continue;
    }
    const before = text[i - 1] ?? " ";
    const after = text[end] ?? " ";
    // The run's first character no pair has taken.
    let at = i;
    if (ch !== "_" || !ALNUM.test(before) || !ALNUM.test(after)) {
      const opens = !SPACE.test(after);
      while (!SPACE.test(before) && at < end && count < MOST) {
        const left = end - at;
        const k = marks.findLastIndex((mark, k) => mayClose(mark, ch, run, opens) && ((left === run && mark.marker.length === left && mark.marker.length === mark.run) || k === marks.length - 1));
        if (k < 0) break;
        marks.length = k + 1;
        const opener = marks[k];
        let rest = opener.marker.length;
        // Pairs take two characters from each side at a time, from the inside out.
        for (; rest > 0 && at < end && count < MOST; count++) {
          const take = Math.min(2, rest, end - at);
          rest -= take;
          at += take;
          made.set(opener.from + rest, [at, take]);
        }
        if (rest > 0 && count < MOST) {
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

/** A text marked lexes inline, and A's pairs over the source it is part of. */
interface Scope {
  /** marked's maskedSrc for it. */
  masked: string;
  /** Where it starts in that source. */
  offset: number;
  pairs: Map<number, [number, number]>;
}

/** The last text lexed on its own (a block's, a cell's, a link's), paired by itself. */
let root: Scope = { masked: "", offset: 0, pairs: new Map() };
/** The contents of the emphasis and strikethrough being lexed, innermost last. */
const scopes: Scope[] = [];

/**
 * The emphasis or strikethrough A pairs from `src`'s start on, its content lexed with the pairs A
 * made over the whole text: paired again by itself, a run at its edge would lose its neighbour
 * (`a*__b_*` is `a<em>__b_</em>`, not `a<em>_<em>b</em></em>`).
 */
function paired(lexer: Lexer, src: string, maskedSrc: string) {
  let scope = scopes.at(-1);
  if (scope?.masked !== maskedSrc) {
    if (root.masked !== maskedSrc) root = { masked: maskedSrc, offset: 0, pairs: pair(maskedSrc) };
    scope = root;
  }
  const at = maskedSrc.length - src.length;
  const found = scope.pairs.get(scope.offset + at);
  if (!found) return undefined;
  const [end, size] = found;
  const raw = src.slice(0, end - scope.offset - at);
  const text = raw.slice(size, -size);
  scopes.push({ masked: maskedSrc.slice(at + size, at + size + text.length), offset: scope.offset + at + size, pairs: scope.pairs });
  try {
    return { raw, text, size, tokens: lexer.inlineTokens(text) };
  } finally {
    scopes.pop();
  }
}

/**
 * marked's emStrong and del, replaced: emphasis and strikethrough start where A pairs an opener.
 * Code spans, links, tags and escapes are masked out of `maskedSrc` (marked keeps its length), so
 * their characters never pair.
 */
export const emphasis: MarkedExtension = {
  tokenizer: {
    emStrong(src, maskedSrc) {
      const found = (src[0] === "*" || src[0] === "_") && paired(this.lexer, src, maskedSrc);
      if (!found) return undefined;
      const { size, ...token } = found;
      return size === 2 ? { type: "strong", ...token } : { type: "em", ...token };
    },
    del(src, maskedSrc) {
      const found = src[0] === "~" && paired(this.lexer, src, maskedSrc);
      return found ? { type: "del", raw: found.raw, text: found.text, tokens: found.tokens } : undefined;
    },
  },
};
