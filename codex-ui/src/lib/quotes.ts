// Smart quotes in the reply, as Claude Desktop's Code tab sets them (3.6556 c851b27a8 Ne, behind
// __gb__2215170874: 设置 → 通用 → 外观 → 智能引号). Straight quotes in paragraphs, headings and
// table cells turn curly by what is around them: an opening quote after a space or an opening
// bracket, an apostrophe inside or after a word ('90s, 'em, rock 'n' roll), primes kept straight
// for feet and inches (5'10") and for f'(x), and `=` before a quote leaves an attribute alone. Each
// block starts fresh; inline code, images and autolinks break the run. Claude's skipping of its
// streaming marker (U+FDEE) is left out: codex-ui never inserts one.

import type { Token, Tokens } from "marked";

const DQ = 34;
const SQ = 39;
const OPEN_DQ = 0x201c;
const CLOSE_DQ = 0x201d;
const OPEN_SQ = 0x2018;
const CLOSE_SQ = 0x2019;
const EQUALS = 61;
const SPACE = 32;
const LETTER = 97;
const NONE = -1;
const HYPHEN = 45;
const COLON = 58;
const OPEN_PAREN = 40;
const CLOSE_PAREN = 41;
/** Quotes in a row a prime may take (ae). */
const MAX_RUN = 3;

/** D / O / k / A: no quote open, an opening quote open, a prime or straight one, after `=`. */
const IDLE = 0;
const OPEN = 1;
const STRAIGHT = 2;
const ASSIGN = 3;

export interface QuoteState {
  prev: number;
  beforePrev: number;
  double: number;
  single: number;
}

/** se: what a block starts with. */
export function freshQuotes(): QuoteState {
  return { prev: SPACE, beforePrev: NONE, double: IDLE, single: IDLE };
}

/** oe: after something that is not text (code, an image), as if after a letter. */
function afterOther(state: QuoteState) {
  state.prev = LETTER;
  state.beforePrev = LETTER;
}

const isSpace = (c: number) => c === SPACE || (c >= 9 && c <= 13) || c === 160 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x3000;
const isSurrogate = (c: number) => c >= 0xd800 && c <= 0xdfff;
const SYMBOLS = new Set([169, 174, 8252, 8265, 8482, 8505, 9410, 10548, 10549]);
/** de: arrows, technical and geometric symbols, dingbats, emoji presentation selectors. */
const isSymbol = (c: number) => (c >= 8592 && c <= 8703) || (c >= 8960 && c <= 9215) || (c >= 9632 && c <= 10175) || (c >= 11008 && c <= 11263) || c === 0xfe0e || c === 0xfe0f || SYMBOLS.has(c);
const isDigit = (c: number) => c >= 48 && c <= 57;
const isFraction = (c: number) => (c >= 188 && c <= 190) || (c >= 8528 && c <= 8542);
const isNumeric = (c: number) => isDigit(c) || isFraction(c);
/** me: Latin letters. */
const isLatin = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 192 && c <= 879 && c !== 215 && c !== 247) || (c >= 7680 && c <= 7935);
/** N: letters of other scripts (Greek on, CJK, Hangul, full-width forms). */
const isOtherScript = (c: number) =>
  !isSpace(c) && ((c >= 880 && c <= 7679) || (c >= 7936 && c <= 8191) || (c >= 11264 && c <= 55295) || (c >= 63744 && c <= 65023) || (c >= 65136 && c <= 65278) || (c >= 65280 && c <= 65519));
const isLetter = (c: number) => isLatin(c) || isOtherScript(c);
const isWord = (c: number) => isLetter(c) || isDigit(c);
/** ge: what an opening quote may follow besides a space. */
const OPENERS = new Set([40, 91, 123, 45, 8211, 8212, OPEN_DQ, OPEN_SQ]);
const opensAfter = (c: number, self: number) => c !== self && (isSpace(c) || OPENERS.has(c));
/** ve: an open quote of this kind is still open and this one ends a word, so it closes. */
const closesInstead = (prev: number, state: number, next: number) => !isSpace(prev) && state !== IDLE && !isWord(next) && next !== HYPHEN;
const at = (text: string, i: number) => (i < text.length ? text.charCodeAt(i) : NONE);

/** ye: the " ends inches after feet (5'10"): one or two digits, a ', then one or two digits. */
function inches(text: string, quote: number): boolean {
  let i = quote - 1;
  if (i >= 0 && isFraction(text.charCodeAt(i))) i--;
  let digits = 0;
  while (digits < 3 && i >= 0 && isDigit(text.charCodeAt(i))) {
    digits++;
    i--;
  }
  if (digits < 1 || digits > 2 || i < 0 || text.charCodeAt(i) !== SQ) return false;
  i--;
  let feet = 0;
  while (feet < 2 && i >= 0 && isDigit(text.charCodeAt(i))) {
    feet++;
    i--;
  }
  return feet > 0 && (i < 0 || !isWord(text.charCodeAt(i)));
}

/** be: the character two before the quote is a word character (a time like 12:"). */
function wordTwoBack(text: string, quote: number, before: number): boolean {
  const one = quote - 1;
  if (one < 0) return false;
  const two = one - 1;
  return isWord(two >= 0 ? text.charCodeAt(two) : before);
}

/** xe: single letters that are not function names before a prime. */
const NOT_FUNCTIONS = new Set([100, 106, 108, 111]);

/** Se: a prime after a one-letter function name or a closing bracket, before "(" (f'(x), g''(x)). */
function prime(text: string, after: number, before: number, beforePrev: number, prev: number): boolean {
  const quote = after - 1;
  let run = 1;
  let i = quote - 1;
  if (i >= 0 && text.charCodeAt(i) === SQ && prev !== SQ) return false;
  while (i >= 0 && text.charCodeAt(i) === SQ) {
    if (++run > MAX_RUN) return false;
    i--;
  }
  const name = i >= 0 ? text.charCodeAt(i) : before;
  if (name !== CLOSE_PAREN) {
    if (!isLatin(name) || NOT_FUNCTIONS.has(name)) return false;
    let ahead = beforePrev;
    if (i >= 0) {
      const back = i - 1;
      ahead = back >= 0 ? text.charCodeAt(back) : before;
    }
    if (isLetter(ahead) || ahead === SQ || ahead === OPEN_SQ || ahead === CLOSE_SQ) return false;
  }
  let j = after;
  while (at(text, j) === SQ) {
    if (++run > MAX_RUN) return false;
    j++;
  }
  return at(text, j) === OPEN_PAREN;
}

/** we: `word` (lower case) starts at `from` and ends a word. */
function wordAt(text: string, from: number, word: string): boolean {
  let i = from;
  for (let k = 0; k < word.length; k++) {
    const c = at(text, i);
    if ((c >= 65 && c <= 90 ? c + 32 : c) !== word.charCodeAt(k)) return false;
    i++;
  }
  return !isWord(at(text, i));
}

/** Ce: words that drop their start ('em, 'tis, 'twas, 'cause, 'n'). */
const ELIDED = ["em", "tis", "twas", "cause", "n'"];

/** Te / Ee: an apostrophe that starts a word ('90s, 'em). */
function leadingApostrophe(text: string, from: number): boolean {
  if (isDigit(at(text, from)) && isDigit(at(text, from + 1)) && wordAt(text, from + 2, "s")) return true;
  return ELIDED.some((word) => wordAt(text, from, word));
}

/** De: a double quote. */
function doubleQuote(state: QuoteState, next: number, text: string, quote: number, before: number): number {
  const { prev } = state;
  if ((isWord(prev) || isFraction(prev)) && isWord(next)) {
    if (state.double === OPEN && !isNumeric(prev) && !isDigit(next)) {
      state.double = IDLE;
      return CLOSE_DQ;
    }
    state.double = (!isOtherScript(prev) && !isOtherScript(next)) || state.double !== STRAIGHT ? STRAIGHT : IDLE;
    return DQ;
  }
  if (
    (opensAfter(prev, OPEN_DQ) ||
      isSurrogate(prev) ||
      (state.double === IDLE && ((isSymbol(prev) && isWord(next)) || (prev === COLON && (isLatin(next) || isDigit(next)) && wordTwoBack(text, quote, before))))) &&
    !closesInstead(prev, state.double, next)
  ) {
    state.double = isOtherScript(next) ? STRAIGHT : OPEN;
    return state.double === OPEN ? OPEN_DQ : DQ;
  }
  if (prev === EQUALS && (state.double !== OPEN || isWord(next))) {
    state.double = state.double === OPEN ? ASSIGN : STRAIGHT;
    return DQ;
  }
  if (state.double === OPEN && (isSpace(next) || next === NONE || next === DQ) && inches(text, quote)) return DQ;
  const was = state.double;
  state.double = was === ASSIGN ? OPEN : IDLE;
  if (was === ASSIGN) return DQ;
  if (was === OPEN) return CLOSE_DQ;
  return was === STRAIGHT || isNumeric(prev) || isOtherScript(prev) ? DQ : CLOSE_DQ;
}

/** Oe: a single quote or apostrophe; `after` is the index after it. */
function singleQuote(state: QuoteState, next: number, text: string, after: number, before: number): number {
  const { prev } = state;
  if (opensAfter(prev, OPEN_SQ) && !closesInstead(prev, state.single, next)) {
    if (isOtherScript(next)) {
      state.single = STRAIGHT;
      return SQ;
    }
    if (leadingApostrophe(text, after)) return CLOSE_SQ;
    state.single = OPEN;
    return OPEN_SQ;
  }
  if (prev === EQUALS && (state.single !== OPEN || isWord(next))) {
    state.single = state.single === OPEN ? ASSIGN : STRAIGHT;
    return SQ;
  }
  if (isWord(prev) && isWord(next)) {
    if (isOtherScript(prev) && isOtherScript(next)) return SQ;
    if (isOtherScript(prev) || isOtherScript(next)) {
      if (state.single === OPEN) {
        state.single = IDLE;
        return CLOSE_SQ;
      }
      state.single = state.single === STRAIGHT ? IDLE : STRAIGHT;
      return SQ;
    }
    return isDigit(prev) && !wordAt(text, after, "s") ? SQ : CLOSE_SQ;
  }
  if (state.single === IDLE && prime(text, after, before, state.beforePrev, prev)) return SQ;
  const was = state.single;
  state.single = was === ASSIGN ? OPEN : IDLE;
  return was === ASSIGN || was === STRAIGHT || isOtherScript(prev) || ((isDigit(prev) || (isFraction(prev) && !wordAt(text, after, "s"))) && was !== OPEN) ? SQ : CLOSE_SQ;
}

/** ke: a text run's quotes, carrying `state` on from the run before. */
export function curlQuotes(text: string, state: QuoteState): string {
  const before = state.prev;
  let dq = text.indexOf('"');
  let sq = text.indexOf("'");
  let out = "";
  let from = 0;
  let last = -1;
  while (dq !== -1 || sq !== -1) {
    const double = sq === -1 || (dq !== -1 && dq < sq);
    const i = double ? dq : sq;
    if (i - 1 > last) state.prev = text.charCodeAt(i - 1);
    const next = at(text, i + 1);
    const straight = double ? DQ : SQ;
    const quote = double ? doubleQuote(state, next, text, i, before) : singleQuote(state, next, text, i + 1, before);
    if (quote !== straight) {
      out += text.slice(from, i) + String.fromCharCode(quote);
      from = i + 1;
    }
    state.prev = quote;
    last = i;
    if (double) dq = text.indexOf('"', i + 1);
    else sq = text.indexOf("'", i + 1);
  }
  const end = text.length - 1;
  if (end > last) {
    state.prev = text.charCodeAt(end);
    state.beforePrev = end >= 1 ? text.charCodeAt(end - 1) : NONE;
  }
  return from === 0 ? text : out + text.slice(from);
}

/** je: a link whose text is its address. */
const autolink = (token: Tokens.Link) => token.text === token.href || token.href === `http://${token.text}` || token.href === `mailto:${token.text}`;

/** Me over marked's inline tokens; runs of text and escapes are one text, as in Claude's tree. */
function curlInline(tokens: Token[], state: QuoteState) {
  let run: Tokens.Text[] = [];
  const flush = () => {
    if (!run.length) return;
    const curled = curlQuotes(run.map((token) => token.text).join(""), state);
    let at = 0;
    for (const token of run) {
      token.text = curled.slice(at, at + token.text.length);
      at += token.text.length;
    }
    run = [];
  };
  for (const token of tokens) {
    if ((token.type === "text" && !("tokens" in token && token.tokens)) || token.type === "escape") {
      run.push(token as Tokens.Text);
      continue;
    }
    flush();
    if (token.type === "text" || token.type === "strong" || token.type === "em" || token.type === "del") curlInline((token as Tokens.Generic).tokens ?? [], state);
    else if (token.type === "link") {
      if (autolink(token as Tokens.Link)) afterOther(state);
      else curlInline((token as Tokens.Link).tokens, state);
    } else if (token.type === "br") state.prev = SPACE;
    else if (token.type === "html") {
      if ((token as Tokens.HTML).text.startsWith("</")) afterOther(state);
      else state.prev = SPACE;
    } else afterOther(state);
  }
  flush();
}

/** Pe: each paragraph, heading and table cell from a fresh state; the containers are walked. */
export function curlTokens(tokens: Token[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case "paragraph":
      case "heading":
        curlInline(token.tokens ?? [], freshQuotes());
        break;
      // A tight list item's text is its paragraph.
      case "text":
        if (token.tokens) curlInline(token.tokens, freshQuotes());
        break;
      case "blockquote":
        curlTokens(token.tokens ?? []);
        break;
      case "list":
        for (const item of (token as Tokens.List).items) curlTokens(item.tokens);
        break;
      case "table": {
        const table = token as Tokens.Table;
        for (const cell of [...table.header, ...table.rows.flat()]) curlInline(cell.tokens, freshQuotes());
        break;
      }
    }
  }
}
