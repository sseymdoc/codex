// What a reply still being written shows at its unfinished end, as Claude Desktop's Code tab parses
// it (2.42304.0.0: Alluvium, c86867935 `en` with c19e90103 wm(ss(), $f()) = Sm, the user's
// __gb__3019411446 on). Blocks before the last are final. The last line, until its newline comes,
// is held back while it could still turn into a block marker (buildFrontier: Jr / Xr / Qr, or a
// fence's closer). The marks the last block leaves open draw open (A with final false: me2), which
// for marked means closing them; a link's "[" stays text. renderBlocks (markdown.ts) uses it while
// a reply streams, lexing with its options.

import { Marked, type Token, type Tokens } from "marked";
import { emphasis, mayClose, MOST } from "./emphasis.ts";

/** Lexes as markdown.ts does, its emphasis (emphasis.ts) included. */
const marked = new Marked(emphasis);
/** With markdown.ts's `breaks`; marked.lexer given options uses them in place of its defaults. */
const lex = (text: string, breaks: boolean) => marked.lexer(text, { ...marked.defaults, breaks });

/** xn: Alluvium's nesting cap. */
const DEEPEST = 32;

// ---------------------------------------------------------------------------
// The last line (buildFrontier)

/** Jr's Pr: a rule or setext underline so far. */
const RULE = /^(?:[-*_=]+|([-*_])(?:[ \t]*\1)+[ \t]*|=+[ \t]+)$/;

/** c86867935 Zr: whether the last line `line` waits for more (Xr, Jr's "ambiguous", or Qr). */
function waits(line: string, depth = 0): boolean {
  if (!line.trim() || /^ {4}/.test(line)) return false;
  const lead = line.replace(/^ {0,3}/, "");
  if (lead === "\\" || lead === "\\(" || lead.startsWith("\\[")) return true;
  if (
    /^[*+-]$/.test(lead) ||
    RULE.test(lead) ||
    /^_[ \t]+$/.test(lead) ||
    /^#{1,6}$/.test(lead) ||
    /^ {0,3}\d{1,9}[.)]?$/.test(line) ||
    lead === ">" ||
    /^(?:`+|\$+)$/.test(lead) ||
    (/^[\s|:-]+$/.test(line) && /[|:]/.test(line) && !/^\s*[-*+]\s/.test(line))
  )
    return true;
  let match = /^ {0,3}#{1,6}\s+(.*)$/.exec(line);
  if (match) return match[1] === "";
  if (/^#{1,6}\S/.test(lead)) return false;
  match = /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/.exec(line) ?? /^ {0,3}>[ \t]?(.*)$/.exec(line);
  if (match) return bare(match[1], depth);
  return !/^(?:`{3,}|~{3,}|`{1,2}[^`])/.test(lead) && lead.startsWith("$$");
}

/** $r: a list item or quote holding nothing yet but what may still be a marker. */
function bare(content: string, depth: number): boolean {
  const ink = content.search(/[A-Za-z]|[^\x00-\x7F\s]/);
  if (ink === 0 || (ink > 0 && !content.includes("$$") && !content.includes("\\["))) return false;
  return !content.trim() || (depth < DEEPEST && waits(content, depth + 1));
}

/** buildFrontier: a fence's last line waits while it could still be the start of its closer. */
function closerWaits(code: Tokens.Code): boolean {
  const lines = code.raw.split("\n");
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0])?.[1];
  const line = lines.at(-1)!.replace(/^ {0,3}/, "");
  return marker !== undefined && line !== "" && line.length <= marker.length && marker.startsWith(line);
}

interface Tail {
  /** The last leaf block: a paragraph, a list item's text, a heading, a table, a fence… */
  leaf?: Token;
  inList: boolean;
  /** A blank line came after it. */
  closed: boolean;
}

/** The last leaf block, down through the last list item and quote. */
function tail(tokens: Token[]): Tail {
  let inList = false;
  let closed = false;
  for (let list = tokens; ; ) {
    const at = list.findLastIndex((token) => token.type !== "space");
    if (at < list.length - 1) closed = true;
    const token = list[at];
    if (token?.type === "list") {
      inList = true;
      list = (token as Tokens.List).items.at(-1)?.tokens ?? [];
    } else if (token?.type === "blockquote") {
      if (/\n[ \t>]*\n[ \t>]*$/.test(token.raw)) closed = true;
      list = (token as Tokens.Blockquote).tokens;
    } else return { leaf: token, inList, closed };
  }
}

// ---------------------------------------------------------------------------
// Marks left open (c86867935 A, final false)

interface Mark {
  kind: "code" | "strong" | "em" | "del" | "link";
  marker: string;
  /** Where its content starts. */
  at: number;
  /** origLen and canClose of an emphasis run. */
  run?: number;
  closes?: boolean;
  /** A link was drawn inside it, so it can no longer take a destination. */
  anchored?: boolean;
}

interface Open {
  marks: Mark[];
  /** Characters at the very end Alluvium leaves out: a lone `\` or `~`, a code span's short closer. */
  drop: number;
  /** What an inline link's destination, running to the end, still waits for: its `)` or title quote. */
  dest: string;
  /** A literal run of `*`, `_` or `~` that ends the text's ink: closers after it are escaped from it. */
  literal: number;
}

const PUNCT = /^[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]$/;
const ALNUM = /^[A-Za-z0-9]$/;
const SPACE = /^\s$/;

/** Fe: where a bare http(s) URL at `at` ends (trailing punctuation and unbalanced `)` left out). */
function urlEnd(text: string, at: number): number {
  if (!/^https?:\/\/[\w-]/i.test(text.slice(at, at + 9))) return at;
  const least = at + (text[at + 4] === ":" ? 7 : 8);
  let end = at;
  let depth = 0;
  for (; end < text.length && !SPACE.test(text[end]) && text[end] !== "<"; end++) depth += text[end] === "(" ? 1 : text[end] === ")" ? -1 : 0;
  for (;;) {
    if (end <= least) return at;
    const last = text[end - 1];
    if (`?!.,:*~'"`.includes(last)) end--;
    else if (last === ")" && depth < 0) {
      depth++;
      end--;
    } else if (last === ";") {
      end--;
      end -= /&[a-zA-Z]+$/.exec(text.slice(Math.max(at, end - 32), end))?.[0].length ?? 0;
    } else return end;
  }
}

/** je: an inline link's destination from `at`: where its `)` is, or what it still waits for to close. */
function destination(text: string, at: number): { end: number; close: string } | null {
  let end = at;
  let depth = 0;
  for (; end < text.length; end++) {
    if (text[end] === "(" && ++depth > 32) return null;
    if (text[end] === ")" && depth-- === 0) break;
  }
  const dest = text.slice(at, end);
  if (/[\t\n\r]/.test(dest.replace(/^(\S*)\s+(["'])(.*)\2\s*$/, "$1").trim())) return null;
  if (end < text.length) return { end, close: "" };
  const title = /^\S*\s+(["'])(?:(?!\1).)*$/.exec(dest)?.[1];
  return { end, close: title ? `${title})` : ")".repeat(depth + 1) };
}

/**
 * c86867935 A as far as it decides what is still open when `text` ends (`atEnd`: its last line is
 * still being written): ponytail: `$` math, `<…>` tags and autolinks, entities and file: URLs are
 * read as plain text, so a mark inside one counts; Alluvium skips them.
 */
function openMarks(text: string, atEnd: boolean): Open {
  const marks: Mark[] = [];
  const ink = text.trimEnd().length;
  let drop = 0;
  let dest = "";
  let literal = 0;
  let pairs = 0;
  const n = text.length;
  const runEnd = (at: number) => {
    let end = at;
    while (text[end] === text[at]) end++;
    return end;
  };
  for (let i = 0; i < n; ) {
    const ch = text[i];
    const top = marks.at(-1);
    if (ch === "`") {
      const end = runEnd(i);
      if (top?.kind !== "code") {
        if (marks.length < MOST) marks.push({ kind: "code", marker: text.slice(i, end), at: end });
      } else if (end - i === top.marker.length) marks.pop();
      else if (atEnd && end === n && end - i < top.marker.length) drop = end - i;
      i = end;
    } else if (top?.kind === "code") {
      const next = text.indexOf("`", i);
      i = next === -1 ? n : next;
    } else if (ch === "\\") {
      if (i + 1 === n && atEnd) drop = 1;
      i += PUNCT.test(text[i + 1] ?? "") ? 2 : 1;
    } else if (ch === "~") {
      const end = runEnd(i);
      if (atEnd && end === n && end - i === 1) drop = 1;
      else if (end - i === 2) {
        const del = marks.findLastIndex((mark) => mark.kind === "del");
        if (del >= 0) marks.length = del;
        else if (marks.length < MOST) marks.push({ kind: "del", marker: "~~", at: end });
      } else if (end === ink) literal = end - i;
      i = end;
    } else if ((ch === "h" || ch === "H") && !/[A-Za-z0-9._-]/.test(text[i - 1] ?? " ") && !marks.some((mark) => mark.kind === "link") && urlEnd(text, i) > i) {
      i = urlEnd(text, i);
    } else if (ch === "*" || ch === "_") {
      const end = runEnd(i);
      const run = end - i;
      const before = text[i - 1] ?? " ";
      const after = text[end] ?? " ";
      let left = run;
      if (ch !== "_" || !ALNUM.test(before) || !ALNUM.test(after)) {
        const opens = !SPACE.test(after);
        const atRunEnd = atEnd && end === n;
        while (!SPACE.test(before) && left > 0 && pairs < MOST) {
          const at = marks.findLastIndex(
            (mark, k) => mayClose(mark, ch, run, opens) && ((left === run && mark.marker.length === left && mark.marker.length === mark.run) || (k === marks.length - 1 && !(atRunEnd && mark.marker.length > left))),
          );
          if (at < 0) break;
          marks.length = at + 1;
          const opener = marks[at];
          let rest = opener.marker.length;
          for (; rest > 0 && left > 0 && pairs < MOST; pairs++) {
            const take = Math.min(2, rest, left);
            rest -= take;
            left -= take;
          }
          if (rest > 0 && pairs < MOST) {
            opener.marker = ch.repeat(rest);
            opener.kind = rest >= 2 ? "strong" : "em";
          } else marks.pop();
        }
        if (left > 0 && opens && marks.length < MOST) {
          marks.push({ kind: left >= 2 ? "strong" : "em", marker: ch.repeat(left), at: end, run, closes: !SPACE.test(before) });
          left = 0;
        }
      }
      if (left > 0 && end === ink) literal = left;
      i = end;
    } else if (ch === "!" && text[i + 1] === "[") {
      if (marks.length < MOST) marks.push({ kind: "link", marker: "![", at: i + 2 });
      i += 2;
    } else if (ch === "[") {
      const note = /^\[\^[^\s[\]]{1,128}\]/.exec(text.slice(i, i + 132));
      if (!note && marks.length < MOST) marks.push({ kind: "link", marker: "[", at: i + 1 });
      i += note?.[0].length ?? 1;
    } else if (ch === "]") {
      const link = marks.findLastIndex((mark) => mark.kind === "link");
      const to = link >= 0 && !(atEnd && i + 1 === n) && text[i + 1] === "(" && !marks[link].anchored ? destination(text, i + 2) : null;
      if (to) {
        if (marks[link].marker === "[") for (const mark of marks.slice(0, link)) mark.anchored = true;
        marks.length = link;
        dest = to.close;
        i = dest ? n : to.end + 1;
      } else {
        if (link >= 0 && !(atEnd && i + 1 === n)) marks.splice(link, 1);
        i++;
      }
    } else i++;
  }
  return { marks, drop, dest, literal };
}

// ---------------------------------------------------------------------------
// Closing them for marked

/** Inline tokens of the last block's leaf: a paragraph's, a heading's, or the cell `cell` of a table's last row. */
function inlineOf(leaf: Token | undefined, cell: number): Token[] | undefined {
  if (leaf?.type === "table") return (leaf as Tokens.Table).rows.at(-1)?.[cell]?.tokens;
  return leaf?.type === "paragraph" || leaf?.type === "text" || leaf?.type === "heading" ? leaf.tokens : undefined;
}

/** Whether `shut`, closers at the end of `tokens`' source, close marks rather than show as text. */
function consumed(tokens: Token[] | undefined, shut: string): boolean {
  if (!shut) return true;
  const list = tokens ?? [];
  let at = list.length - 1;
  while (at >= 0 && list[at].type === "text" && !list[at].raw.trim()) at--;
  const token = list[at];
  switch (token?.type) {
    case "codespan":
      return shut.length <= /`+$/.exec(token.raw)![0].length;
    case "link":
    case "image":
      return /^!?\[/.test(token.raw) && token.raw.endsWith(shut);
    case "strong":
    case "em":
    case "del":
      return consumed(token.tokens, shut.slice(0, token.type === "em" || !/(.)\1$/.test(token.raw) ? -1 : -2));
    default:
      return false;
  }
}

/** Kr: a table row's cells, split on unescaped pipes (a leading and closing pipe left out). */
function cells(row: string): string[] {
  let line = row.trim();
  if (line.startsWith("|")) line = line.slice(1);
  if (/(?:^|[^\\])(?:\\\\)*\|$/.test(line)) line = line.slice(0, -1);
  return line.split(/(?<=(?:^|[^\\])(?:\\\\)*)\|/);
}

/**
 * `raw`, the last block, with its open marks closed as Alluvium draws them: what it leaves out at
 * the end goes, an open code span with nothing in it yet keeps an empty chip (a zero-width space),
 * and closers marked would show as text are dropped, outermost first.
 */
function closeBlock(raw: string, source: string, cell: number, atEnd: boolean, breaks: boolean): string {
  const { marks, drop, dest, literal } = openMarks(source, atEnd);
  let block = raw.slice(0, raw.trimEnd().length - drop) + raw.slice(raw.trimEnd().length);
  // A strikethrough or emphasis with nothing in it yet draws nothing, its marker included (`**~`).
  let end = source.length - drop;
  let top = marks.at(-1);
  while ((top?.kind === "del" || top?.kind === "strong" || top?.kind === "em") && !source.slice(top.at, end).trim()) {
    marks.pop();
    end = top.at - top.marker.length;
    const ink = block.trimEnd().length;
    block = block.slice(0, ink - top.marker.length) + block.slice(ink);
    top = marks.at(-1);
  }
  const content = top ? source.slice(top.at, end) : "";
  const closers = marks.reverse().flatMap((mark) => (mark.kind === "link" ? [] : [mark.kind === "code" && content === "" && mark === top ? `\u200b${mark.marker}` : mark.marker]));
  if (dest) closers.unshift(dest);
  if (!closers.length) return block;
  const ink = block.trimEnd().length;
  if (literal) block = block.slice(0, ink - literal) + block.slice(ink - literal, ink).replace(/./g, "\\$&") + block.slice(ink);
  const inkEnd = block.trimEnd().length;
  // A code span or link destination takes the spaces after its last word; emphasis ends at it.
  const at = dest || top?.kind === "code" ? inkEnd + /^[ \t]*/.exec(block.slice(inkEnd))![0].length : inkEnd;
  for (let count = closers.length; count > 0; count--) {
    const shut = closers.slice(0, count).join("");
    const closed = block.slice(0, at) + shut + block.slice(at);
    if (consumed(inlineOf(tail(lex(closed, breaks)).leaf, cell), shut.replace("\u200b", ""))) return closed;
  }
  return block;
}

/**
 * c86867935 buildFrontier for a reply still being written: the blocks it shows, and the last one's
 * markdown with its open marks closed (undefined when that is its raw). `breaks`: as rendered.
 */
export function frontier(text: string, breaks = false): { tokens: Token[]; last?: string } {
  let tokens = lex(text, breaks);
  const cut = text.lastIndexOf("\n") + 1;
  const line = text.slice(cut);
  if (line) {
    // Spaces alone are no blank line yet, outside a fence.
    const { leaf, inList } = tail(tokens);
    const fence = leaf?.type === "code" && !(leaf as Tokens.Code).codeBlockStyle && leaf.raw.includes("\n");
    if (fence ? closerWaits(leaf as Tokens.Code) : !line.trim() || waits(inList ? line.trimStart() : line)) tokens = lex((text = text.slice(0, cut)), breaks);
  }
  const block = tokens.findLast((token) => token.type !== "space");
  const { leaf, inList, closed } = tail(tokens);
  if (!block || !leaf || closed) return { tokens };
  // The last line, out of the quotes and list items it sits in.
  const last = text.slice(text.lastIndexOf("\n") + 1).replace(/^(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t])))*[ \t]*/, "");
  const atEnd = last !== "";
  // marked trims a list's last line; the spaces it still ends with count, as in Alluvium.
  const space = atEnd ? text.slice(text.trimEnd().length) : "";
  let raw = atEnd ? block.raw.trimEnd() + space : block.raw;
  // A task's box shows before its text does (marked wants something after "[ ] ").
  if (inList && /^\[[ xX]\][ \t]+$/.test(last)) return { tokens, last: `${raw}\u200b` };
  let source: string | undefined;
  let cell = 0;
  if (leaf.type === "paragraph" || leaf.type === "text") source = atEnd ? leaf.text.trimEnd() + space : leaf.text;
  else if (atEnd && leaf.type === "heading") {
    // A closing run of hashes still shows while the heading is being written (Jr keeps it).
    source = /^#{1,6}\s+(.*)$/.exec(last)?.[1] ?? leaf.text;
    raw = raw.replace(/([ \t])(#+[ \t]*)$/, "$1\\$2");
  } else if (atEnd && leaf.type === "table" && !/(?:^|[^\\])(?:\\\\)*\|\s*$/.test(last)) {
    const row = cells(last);
    cell = row.length - 1;
    source = row[cell].trim();
  }
  if (source === undefined) return { tokens };
  const shut = closeBlock(raw, source, cell, atEnd, breaks);
  return shut === block.raw ? { tokens } : { tokens, last: shut };
}
