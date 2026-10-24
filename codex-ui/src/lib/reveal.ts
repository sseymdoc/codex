// How Claude Desktop's Code tab brings a reply in as it is written (2.42304.0.0): the text is
// paced out a step at a time (shared-10 Tf, with the reply's options c19e90103 jx), every word
// shown fades in on a schedule kept by a ledger (c19e90103 Jp in word mode; c19e90103 Mx picks the
// phrase mode with __gb__2846116625 on, off in the user's Claude: 设置 → 通用 → 外观 → 按短语淡入回复),
// and a busy turn's reply rises once (c4a9ee384 Eu / ku). The DOM side is in components/content.tsx
// and items.tsx.

// ---------------------------------------------------------------------------
// Pacing (shared-10 Tf, c19e90103 jx: open marks are not held back, block markers are)

/** shared-10 Gu: a step of 22 chars, sized so any backlog drains in about 550ms, 25–150ms apart. */
export const PACE = { stepChars: 22, targetLagMs: 550, minStepMs: 25, maxStepMs: 150 } as const;
/** shared-10 ed: a backlog past what 25ms steps drain joins a step as the wait since the last nears 75ms. */
const CATCH_UP_MS = 75;
/** c19e90103 jx.joinAboveChars: more than this waiting when pacing starts shows at once. */
export const JOIN_ABOVE = 400;
/** c19e90103 xx (jx.rejoinAboveChars): a delta and a backlog both over this show at once. */
export const REJOIN_ABOVE = 600;

const LEAD = String.raw`[ \t]*(?:>[ \t]*)*`;
/** shared-10 ad: a line that is so far only a list marker, or a marker and the start of a task box. */
const LIST_MARKER = new RegExp(String.raw`^${LEAD}(?:(?:[-*+]|\d{1,9}[.)]?)$|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[(?:[ xX](?:\][ \t]*)?)?)?$)`);
/** shared-10 cd: a line that is so far only a heading's hashes. */
const HEADING_MARKER = /^ {0,3}(?:>[ \t]*)*#{1,6}[ \t]*$/;

/** shared-10 yf: where the first non-space character is, or -1. */
export function firstInk(text: string): number {
  return text.search(/\S/);
}

/** shared-10 wf: a cut never splits a surrogate pair. */
function whole(text: string, at: number): number {
  return at > 0 && (text.charCodeAt(at) & 0xfc00) === 0xdc00 ? at - 1 : at;
}

/** shared-10 hf: the start of the line ending at `at` when that line is only a block marker, else -1. */
function markerLine(text: string, at: number): number {
  if (at === 0) return -1;
  const start = text.lastIndexOf("\n", at - 1) + 1;
  if (start === at) return -1;
  const line = text.slice(start, at);
  return LIST_MARKER.test(line) || HEADING_MARKER.test(line) ? start : -1;
}

/** shared-10 _f: how far pacing may show; a last line that is only a block marker waits. */
export function paceCeiling(text: string): number {
  const held = markerLine(text, text.length);
  return whole(text, held === -1 ? text.length : held);
}

/** shared-10 mf: `chars` on from `from`, cut back to the last space when that keeps over half. */
function stepWords(text: string, from: number, ceiling: number, chars: number): number {
  const to = Math.min(from + chars, ceiling);
  if (to < ceiling) {
    const space = text.lastIndexOf(" ", to);
    if (space > from + chars / 2) return space + 1;
  }
  return whole(text, to);
}

/** shared-10 gf: the next step, which never ends just after a block marker. */
export function paceStep(text: string, from: number, ceiling: number, chars: number): number {
  let to = stepWords(text, from, ceiling, chars);
  for (let marker = markerLine(text, to); marker !== -1; marker = markerLine(text, to)) {
    if (marker > from) return marker;
    if (to >= ceiling) return ceiling;
    to = stepWords(text, to, ceiling, chars);
  }
  return to;
}

/** shared-10 Tf: the wait before the next step, 550ms over the steps a backlog needs. */
export function stepWait(backlog: number): number {
  return Math.min(Math.max((PACE.targetLagMs * PACE.stepChars) / backlog, PACE.minStepMs), PACE.maxStepMs);
}

/** shared-10 Tf: a step's size, with what 25ms steps would not drain in 550ms joining as `since` nears 75ms. */
export function stepSize(backlog: number, since: number): number {
  const excess = Math.max(0, backlog - (PACE.targetLagMs * PACE.stepChars) / PACE.minStepMs);
  return PACE.stepChars + Math.ceil(excess * Math.min(1, since / CATCH_UP_MS));
}

/** shared-10 tf: where `shown` lands when the text was rewritten, not extended. */
export function remapShown(before: string, after: string, shown: number): number {
  const most = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < most && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < most - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const inside = shown > prefix && shown < before.length - suffix;
  return whole(after, inside ? Math.min(shown, after.length) : shown <= prefix ? shown : shown + after.length - before.length);
}

// ---------------------------------------------------------------------------
// Fade ledger (c19e90103 Jp)

/** Rp: a chunk stays open at least this long, then closes where the next word starts (a phrase: at any new text). */
const CLOSE_AFTER_MS = 100;
/** zp / Bp: chars a chunk takes in the pass that opened it, and in later passes. */
const PASS_CHARS = 16;
const CHUNK_CHARS = 48;
/** Vp: a word's fade; Wp: a phrase's (shared-10 pm draws it as a 400ms ramp). */
export const FADE_MS = 200;
const PHRASE_FADE_MS = 500;
/** Hp: no word waits longer than this to start. */
const AHEAD_MS = 600;
/** Up: the ledger is dropped this long after the text stops growing (a phrase ledger: its fade and 200ms). */
export const SETTLE_MS = 1000;
/** Gp: chars per ms over which (twice running) words stop staggering. */
const TOO_FAST = 1.6;
/** shared-10 Ju: each char puts the next chunk 2.5ms later. */
const CHAR_MS = 2.5;
/** lm: what a block's own fade (a list item, a table row, a code block) costs. */
export const BLOCK_CHARS = 6;

export interface Reveal {
  delayMs: number;
  endsAt: number;
  pass: number;
  chars: number;
  done: boolean;
}

/** qp: what everything gets while the ledger is primed. */
const SHOWN: Reveal = { delayMs: 0, endsAt: 0, pass: 0, chars: 0, done: true };

export type FadeMode = "word" | "phrase";

/**
 * Which chunk each piece of text (keyed by where it sits) fades in with. A chunk opens when a
 * piece finds none open (or the open one full) and starts 2.5ms per char after the last one
 * assigned, never more than 600ms out; it closes once it has been open 100ms and a new word
 * comes. A piece is settled, and drawn without a fade, once a chunk closed after its fade ended.
 * In phrase mode everything new joins the open chunk at once, which any growth closes after 100ms.
 */
export class Ledger {
  readonly mode: FadeMode;
  readonly fadeMs: number;
  readonly settleMs: number;
  private readonly reveals = new Map<string, Reveal>();
  private readonly runs = new Map<string, { len: number; steps: Step[] }>();
  private lastAssigned = 0;
  private pass = 0;
  private open: Reveal | null = null;
  private openedAt = 0;
  private horizon = 0;
  private tooFast = false;
  private priming: boolean;
  private lastText: string;
  private speed: { since: number; len: number; fastAt: number };
  /** Prefixes this message showed before it mounted again: a first delivery that starts with one does not fade. */
  private guards: string[] | undefined;
  private readonly now: () => number;

  /** `primed`: the text already showing, which does not fade. */
  constructor(primed?: string, guards?: string[], now: () => number = () => performance.now(), mode: FadeMode = "word") {
    this.mode = mode;
    this.fadeMs = mode === "phrase" ? PHRASE_FADE_MS : FADE_MS;
    this.settleMs = mode === "phrase" ? PHRASE_FADE_MS + 200 : SETTLE_MS;
    this.now = now;
    this.priming = !!primed;
    this.lastText = primed ?? "";
    this.speed = { since: now(), len: this.lastText.length, fastAt: -Infinity };
    this.guards = this.priming ? undefined : guards;
  }

  /** Each render, with the text shown. */
  sync(text: string): void {
    const now = this.now();
    this.pass += 1;
    const { since, len, fastAt } = this.speed;
    if (now - since >= CLOSE_AFTER_MS) {
      const fast = (text.length - len) / (now - since) > TOO_FAST * (this.tooFast ? 0.75 : 1);
      this.tooFast = fast ? this.tooFast || fastAt === since : this.tooFast && now - fastAt < 400;
      this.speed = { since: now, len: text.length, fastAt: fast ? now : fastAt };
    }
    if (this.guards !== undefined && text.trim() !== "") {
      const lead = text.trimStart();
      const seen = this.guards.some((guard) => lead.startsWith(guard));
      this.guards = undefined;
      if (seen) {
        this.priming = true;
        this.lastText = text;
        return;
      }
    }
    if (text.startsWith(this.lastText)) {
      const grew = this.mode === "phrase" ? text !== this.lastText : /\s\S/.test(this.lastText.slice(-1) + text.slice(this.lastText.length));
      if (this.open && now - this.openedAt >= CLOSE_AFTER_MS && grew) this.close(now);
    } else {
      for (const reveal of this.reveals.values()) reveal.done = true;
      this.close(now);
    }
    if (text !== this.lastText) this.priming = false;
    this.lastText = text;
  }

  /** The chunk of the piece `key`, `chars` long; a piece keeps the chunk it first got. */
  reveal(key: string, chars: number): Reveal {
    const known = this.reveals.get(key);
    if (known) return known;
    if (this.priming) {
      this.reveals.set(key, SHOWN);
      return SHOWN;
    }
    const now = this.now();
    let chunk = this.open;
    if (this.mode === "phrase") {
      if (!chunk) {
        this.openedAt = now;
        chunk = this.open = { delayMs: 0, endsAt: 0, pass: this.pass, chars: 0, done: this.tooFast };
      }
    } else if (!chunk || chunk.chars + chars > (chunk.pass === this.pass ? PASS_CHARS : CHUNK_CHARS)) {
      const at = Math.min(Math.max(now, this.lastAssigned) + (this.tooFast ? 0 : chars * CHAR_MS), now + AHEAD_MS);
      if (!chunk) this.openedAt = now;
      const delayMs = Math.round(at - now);
      chunk = this.open = { delayMs, endsAt: 0, pass: this.pass, chars: 0, done: this.tooFast && delayMs === 0 };
      this.lastAssigned = at;
    } else if (!this.tooFast) {
      this.lastAssigned = Math.min(this.lastAssigned + chars * CHAR_MS, now + AHEAD_MS);
    }
    chunk.endsAt = Math.max(chunk.endsAt, now + chunk.delayMs + this.fadeMs);
    chunk.chars += chars;
    this.reveals.set(key, chunk);
    return chunk;
  }

  /**
   * Phrase mode: run `key` (now `len` chars) as the steps it grew by, each fading with the chunk
   * that was open when it came (a step joining the last one's chunk extends it); a shorter run
   * drops the steps past its end.
   */
  revealRun(key: string, len: number): Step[] {
    let run = this.runs.get(key);
    if (!run) {
      run = { len, steps: [{ from: 0, reveal: this.reveal(key, len) }] };
      this.runs.set(key, run);
    } else if (len > run.len) {
      const stepKey = `${key}@${run.len}`;
      const reveal = this.reveal(stepKey, len - run.len);
      if (reveal === run.steps[run.steps.length - 1].reveal) this.reveals.delete(stepKey);
      else run.steps.push({ from: run.len, reveal });
      run.len = len;
    } else if (len < run.len) {
      while (run.steps.length > 1 && run.steps[run.steps.length - 1].from >= len) this.reveals.delete(`${key}@${run.steps.pop()!.from}`);
      run.len = len;
    }
    return run.steps;
  }

  settled(reveal: Reveal): boolean {
    if (reveal.done) return true;
    if (this.horizon < reveal.endsAt) return false;
    reveal.done = true;
    return true;
  }

  private close(now: number): void {
    this.open = null;
    this.horizon = now;
  }
}

/** Where in its run a step starts, and its chunk. */
export interface Step {
  from: number;
  reveal: Reveal;
}

/** A run's text, as is or (with `reveal`) fading in; `at` is where it starts. */
export interface Piece {
  text: string;
  at: number;
  reveal?: Reveal;
}

/** shared-10 Xu: a word and the space after it (the first also takes the run's leading space). */
const WORDS = /(?:^\s+)?\S+\s*/g;

/**
 * c19e90103 om: a run of text at `offset` in block `ns`, as its settled start and then side-by-side
 * words grouped by chunk, or null when nothing in it still fades.
 */
export function runPieces(ledger: Ledger, ns: string, offset: number, run: string): Piece[] | null {
  if (!/\S/.test(run)) return null;
  if (ledger.mode === "phrase") return phrasePieces(ledger, `${ns}:${offset}`, offset, run);
  const words = run.match(WORDS) ?? [];
  let at = offset;
  const marks = words.map((word) => {
    const reveal = ledger.reveal(`${ns}:${at}`, word.length);
    const mark = { at, reveal, settled: ledger.settled(reveal) };
    at += word.length;
    return mark;
  });
  const first = marks.findIndex((mark) => !mark.settled);
  if (first === -1) return null;
  const pieces: Piece[] = first > 0 ? [{ text: words.slice(0, first).join(""), at: offset }] : [];
  for (let i = first; i < words.length; ) {
    let j = i + 1;
    while (j < words.length && marks[j].reveal === marks[i].reveal) j++;
    const text = words.slice(i, j).join("");
    pieces.push(marks[i].settled ? { text, at: marks[i].at } : { text, at: marks[i].at, reveal: marks[i].reveal });
    i = j;
  }
  return pieces;
}

/** c19e90103 am: a run's settled steps as one piece, then each later step, fading unless settled. */
function phrasePieces(ledger: Ledger, key: string, offset: number, run: string): Piece[] | null {
  const steps = ledger.revealRun(key, run.length);
  const first = steps.findIndex((step) => !ledger.settled(step.reveal));
  if (first === -1) return null;
  const pieces: Piece[] = first > 0 ? [{ text: run.slice(0, steps[first].from), at: offset }] : [];
  steps.slice(first).forEach((step, i) => {
    const text = run.slice(step.from, steps[first + i + 1]?.from ?? run.length);
    const at = offset + step.from;
    pieces.push(ledger.settled(step.reveal) ? { text, at } : { text, at, reveal: step.reveal });
  });
  return pieces;
}

// ---------------------------------------------------------------------------
// What a reply already showed (c19e90103 Sx / Ox / Dx / kx): one that mounts again mid-stream
// shows its text at once and does not fade it again.

const SHOWN_PREFIXES = new Map<string, string>();
/** Cx / Tx / Ex: 64 replies remembered, by their first 64 chars, once 22 show. */
const PREFIXES_KEPT = 64;
const PREFIX_CHARS = 64;
export const PREFIX_MIN = 22;
/** wx: a prefix is noted once the reply has shown 22 chars for 400ms. */
export const PREFIX_AFTER_MS = 400;

/** Ox. */
export function noteShown(key: string, text: string): void {
  const prefix = text.trimStart().slice(0, PREFIX_CHARS);
  if (prefix.trimEnd().length < PREFIX_MIN) return;
  SHOWN_PREFIXES.delete(key);
  SHOWN_PREFIXES.set(key, prefix);
  if (SHOWN_PREFIXES.size > PREFIXES_KEPT) SHOWN_PREFIXES.delete(SHOWN_PREFIXES.keys().next().value!);
}

/** Dx: a noted prefix grows with the reply up to 64 chars. */
export function extendShown(key: string, text: string): void {
  const prefix = SHOWN_PREFIXES.get(key);
  if (prefix !== undefined && prefix.length < PREFIX_CHARS && text.trimStart().startsWith(prefix)) noteShown(key, text);
}

/** kx: the prefixes `key` showed before, if any. */
export function shownBefore(key: string): string[] | undefined {
  const prefix = SHOWN_PREFIXES.get(key);
  return prefix === undefined ? undefined : [prefix];
}

// ---------------------------------------------------------------------------
// The reply's entrance (c4a9ee384 Eu / ku): a busy turn's reply rises (message-fade-up) once.
// A turn that mounts showing nothing yet owes it to its first text; one that mounts already
// showing something rises whole.

const RISES = new Map<string, "owed" | "spent">();
/** bu */
const RISES_KEPT = 200;

function noteRise(key: string, state: "owed" | "spent"): void {
  RISES.delete(key);
  RISES.set(key, state);
  if (RISES.size > RISES_KEPT) RISES.delete(RISES.keys().next().value!);
}

/** Eu's first look: does the reply rise whole now? `allowed`: motion on, and not catching up. */
export function riseAtMount(key: string, busy: boolean, shows: boolean, allowed: boolean): boolean {
  if (!busy) riseEnded(key);
  return busy && shows && allowed && !RISES.has(key);
}

/**
 * Eu's layout effect while the turn is busy, until it returns true (the record is set): a reply
 * showing nothing yet owes its rise (spent at once with motion off), one that rose or shows
 * something spent it; one catching up waits until it shows something.
 */
export function riseDecide(key: string, { shows, rose, catching, motion }: { shows: boolean; rose: boolean; catching: boolean; motion: boolean }): boolean {
  if (RISES.has(key)) return true;
  if (rose || shows) {
    noteRise(key, "spent");
    return true;
  }
  if (catching) return false;
  noteRise(key, motion ? "owed" : "spent");
  return true;
}

/** Eu, the turn over: a rise still owed is let go. */
export function riseEnded(key: string): void {
  if (RISES.get(key) === "owed") noteRise(key, "spent");
}

/** ku takeRise: the turn's first text to paint takes the rise it owes. */
export function takeRise(key: string): boolean {
  if (RISES.get(key) !== "owed") return false;
  noteRise(key, "spent");
  return true;
}
