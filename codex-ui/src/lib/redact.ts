// What Claude Desktop's plan pane does to a task's text before it renders it (2.42304.0.0:
// cccc2cf0a Nv): secrets masked (shared-104 Xs), a private key left open cut off (sc), and control
// and invisible characters shown (shared-0 rF), the text between word joiners one piece at a time.
// Claude masks secrets in many more places; codex-ui does it where the plan pane does.

/** shared-0 JP: control, format, surrogate, separator and default-ignorable characters, a few
 * blank or invisible letters, and the noncharacters. */
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u{16FE4}\uFDD0-\uFDEF\uFFFE\uFFFF\u{1FFFE}\u{1FFFF}\u{2FFFE}\u{2FFFF}\u{3FFFE}\u{3FFFF}\u{4FFFE}\u{4FFFF}\u{5FFFE}\u{5FFFF}\u{6FFFE}\u{6FFFF}\u{7FFFE}\u{7FFFF}\u{8FFFE}\u{8FFFF}\u{9FFFE}\u{9FFFF}\u{AFFFE}\u{AFFFF}\u{BFFFE}\u{BFFFF}\u{CFFFE}\u{CFFFF}\u{DFFFE}\u{DFFFF}\u{EFFFE}\u{EFFFF}\u{FFFFE}\u{FFFFF}\u{10FFFE}\u{10FFFF}]/u;

/** ys: one character nobody sees (tabs and line breaks aside), marks and unassigned ones too. */
const HIDDEN = new RegExp(String.raw`(?![\t\n\r])${INVISIBLE.source}|[\p{M}\p{Co}\p{Cn}]`, "u");
/** xs: a run of them. */
const HIDDEN_RUN = new RegExp(`(?:${HIDDEN.source})+`, "gu");
/** Ss: anything but printable ASCII, tabs and line breaks. */
const NOT_PLAIN = /[^\t\n\r\x20-\x7E]/;

// Secrets (shared-104 cs), each where no word character or hyphen comes before it (Zo).
const BOUNDARY = "(?<![A-Za-z0-9_-])";
const SPACES = String.raw`\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000`;
const BREAKS = String.raw`\t\v\f\r\n\u2028\u2029 ${SPACES}`;
const GAP = `[${BREAKS}]*`;
const DASHES = "-{4,5}";
const PAD = String.raw`[ \t${SPACES}]*`;
/** rs / is / as: a PEM private key's armor, BEGIN and END lines. */
const KEY_TAIL = new RegExp(`PRIVATE${GAP}KEY(?:${GAP}BLOCK)?${PAD}${DASHES}`);
const KEY_BEGIN = new RegExp(`${DASHES}${PAD}BEGIN[A-Z0-9${BREAKS}]*${KEY_TAIL.source}`);
const KEY_END = new RegExp(`${DASHES}${PAD}END[A-Z0-9${BREAKS}]*${KEY_TAIL.source}`);
const NOT_ARMOR = "(?![A-Za-z0-9_-]*----BEGIN)";
/** ss: a JWE's five parts or a JWT's three. */
const JWT = String.raw`eyJ[A-Za-z0-9_-]{10,}\.(?:${NOT_ARMOR}[A-Za-z0-9_-]*\.(?!-?eyJ)${NOT_ARMOR}[A-Za-z0-9_-]{10,}\.(?!-?eyJ)${NOT_ARMOR}[A-Za-z0-9_-]{10,}\.(?!-?eyJ)(?:[A-Za-z0-9_]|-(?!---)){10,64}(?:(?![A-Za-z0-9_-]*----)[A-Za-z0-9_-]*)?|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})`;

const PATTERNS: { id: string; regex: RegExp; trigger: string }[] = [
  ["anthropic", "sk-ant-[A-Za-z0-9_-]{20,}", "sk-ant-"],
  ["openai_proj", "sk-proj-[A-Za-z0-9_-]{20,}", "sk-proj-"],
  ["openai", "sk-[A-Za-z0-9]{20,}", "sk-[A-Za-z0-9]{20}"],
  ["github", "(?:gh[opsu]_|github_pat_)[A-Za-z0-9_]{20,}", "gh[opsu]_|github_pat_"],
  ["aws", "AKIA[A-Z0-9]{16}", "AKIA"],
  ["slack", "xox[abprs]-[A-Za-z0-9-]{10,}", "xox[abprs]-"],
  ["google", "AIza[A-Za-z0-9_-]{35}", "AIza"],
  ["stripe", "(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}", "[sr]k_(?:live|test)_[A-Za-z0-9]{20}"],
  ["stripe_webhook", "whsec_[A-Za-z0-9]{20,}", "whsec_[A-Za-z0-9]{20}"],
  ["age", "AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}", "AGE-SECRET-KEY-1"],
  ["jwt", JWT, String.raw`\.eyJ|(?:^|[^A-Za-z0-9_-])-?eyJ[A-Za-z0-9_-]{10,}\.`],
].map(([id, source, trigger]) => ({ id, regex: new RegExp(BOUNDARY + source), trigger }));
PATTERNS.push({
  id: "private_key",
  regex: new RegExp(String.raw`${KEY_BEGIN.source}[A-Za-z0-9+/=$\\\r\n\u2028\u2029${SPACES}]{0,5000}?${KEY_END.source}`),
  trigger: KEY_TAIL.source,
});

/** ls / us: any secret; each but the key as it reads with no boundary. */
const ANY = new RegExp(PATTERNS.map(({ regex }) => `(?:${regex.source})`).join("|"), "g");
const BARE = PATTERNS.filter(({ regex }) => regex.source.startsWith(BOUNDARY)).map(({ regex }) => `(?:${regex.source.slice(BOUNDARY.length)})`);
/** ds: one right after a lone hyphen; fs: a JWT right after a dot. */
const AFTER_HYPHEN = new RegExp(`(?<=${BOUNDARY}-)(?:${BARE.join("|")})`, "g");
const AFTER_DOT = new RegExp(String.raw`(?<=\.)(?=(${JWT}))`, "g");
/** ps: armor dashes or PRIVATE in what looks like a JWT. */
const ARMOR = /(?<!-)-{4,}(?=BEGIN|END|$)|PRIVATE/;
/** ms: a cheap test that a secret may be there. */
const TRIGGER = new RegExp(PATTERNS.map(({ trigger }) => `(?:${trigger})`).join("|"));
/** ks / js: a secret starts here (with no boundary), or a JWT does (512 characters on). */
const SECRET_START = new RegExp(`^(?:${[...BARE, KEY_BEGIN.source].join("|")})`);
const JWT_START = /^eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}$/;
const LOOK = 512;
const WORD = /[A-Za-z0-9_-]/;
/** Ns: the rest of the word a secret ends in. */
const WORD_TAIL = /(?:[A-Za-z0-9_]|(?<=[A-Za-z0-9_])-(?=[A-Za-z0-9_]))*/y;
/** vs: Ls looks at this much at once; Ys goes over longer text in windows that overlap by 8192. */
const MAX = 262144;
const STRIDE = MAX - 8192;

interface Found {
  start: number;
  end: number;
  value: string;
  patternId: string;
}

/** gs: where secrets read in `text`; `atEnd`: nothing comes after it. */
function* matches(text: string, atEnd: boolean): Generator<{ index: number; value: string }> {
  for (const m of text.matchAll(ANY)) yield { index: m.index, value: m[0] };
  for (const m of text.matchAll(AFTER_HYPHEN)) {
    const armor = m[0].search(/(?<!-)-{4,}(?=BEGIN|END|$)/);
    yield { index: m.index, value: armor < 0 ? m[0] : m[0].slice(0, armor) };
  }
  if (!text.includes(".eyJ")) return;
  for (const m of text.matchAll(AFTER_DOT)) {
    const next = text.codePointAt(m.index + m[1].length);
    const ch = next === undefined ? "" : String.fromCodePoint(next);
    if ((ch === "" ? atEnd : !WORD.test(ch) && !(NOT_PLAIN.test(ch) && HIDDEN.test(ch))) && !ARMOR.test(m[1])) yield { index: m.index, value: m[1] };
  }
}

/**
 * Fs: `text` with its hidden runs taken out, and the way back to its offsets. Given the text so
 * read once (`first`), a run between a word and a secret's start leaves a NUL there, so the
 * secret still starts a word.
 */
function shadowOf(text: string, first?: string): { shadow: string; edges: number; toRaw(at: number): number } {
  let removed = 0;
  const after: number[] = [];
  const shift: number[] = [];
  let net = 0;
  let edges = 0;
  const shadow = text.replace(HIDDEN_RUN, (run: string, at: number) => {
    const inFirst = at - removed;
    removed += run.length;
    const ahead = first !== undefined && at > 0 && WORD.test(text[at - 1]) ? first.slice(inFirst, inFirst + LOOK) : undefined;
    const edge = ahead !== undefined && (SECRET_START.test(ahead) || (ahead.length === LOOK && JWT_START.test(ahead))) ? "\0" : "";
    edges += edge.length;
    after.push(at - net + edge.length);
    net += run.length - edge.length;
    shift.push(net);
    return edge;
  });
  const toRaw = (at: number) => {
    let lo = 0;
    let hi = after.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (after[mid] <= at) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? at : at + shift[lo - 1];
  };
  return { shadow, edges, toRaw };
}

/** Ls: the secrets in `text`, merged where they overlap and run on to the end of their word. */
function secretsIn(text: string, atEnd: boolean): Found[] {
  if (text.length > MAX) return [];
  const found: Omit<Found, "value">[] = [];
  const add = (start: number, end: number, value: string) => found.push({ start, end, patternId: PATTERNS.find(({ regex }) => regex.test(value))?.id ?? "unknown" });
  if (TRIGGER.test(text)) for (const m of matches(text, atEnd)) add(m.index, m.index + m.value.length, m.value);
  // A secret broken up by hidden characters still reads once they are out.
  if (HIDDEN.test(text)) {
    const pass = (first?: string) => {
      const { shadow, edges, toRaw } = shadowOf(text, first);
      if ((first === undefined || edges !== 0) && TRIGGER.test(shadow))
        for (const m of matches(shadow, atEnd)) add(toRaw(m.index), toRaw(m.index + m.value.length - 1) + 1, m.value);
      return shadow;
    };
    pass(pass());
  }
  found.sort((a, b) => a.start - b.start);
  const merged: Omit<Found, "value">[] = [];
  for (const item of found) {
    const last = merged.at(-1);
    if (last !== undefined && item.start < last.end) last.end = Math.max(last.end, item.end);
    else merged.push({ ...item });
  }
  merged.forEach((item, i) => {
    if (item.patternId === "private_key") return;
    WORD_TAIL.lastIndex = item.end;
    const tail = WORD_TAIL.exec(text)?.[0].length ?? 0;
    item.end = Math.min(item.end + tail, merged[i + 1]?.start ?? text.length);
  });
  return merged.map((item) => ({ ...item, value: text.slice(item.start, item.end) }));
}

/** Hs: where a PEM header's closing dashes end (hidden characters between them don't count). */
function headerEnd(text: string): number {
  let dashes = 0;
  for (let i = 10; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    if (ch === "-") {
      if (++dashes === 5) return i + 1;
    } else if (!HIDDEN.test(ch)) {
      if (dashes === 4) return i;
      dashes = 0;
    }
    i += ch.length;
  }
  return -1;
}

const DOTS = "\u2022";
/** Rs: the characters a long secret keeps. */
const KEEP = 8;

/**
 * Us: a secret in bullets, its first 8 visible characters kept when it has more than 12; a PEM
 * block keeps its armor lines and line breaks.
 */
function mask(secret: string): string {
  if (secret.startsWith("-----BEGIN")) {
    const end = secret.lastIndexOf("-----END");
    const body = end >= 0 && /^[^-]*(?:-[^A-Za-z0-9]*)?$/.test(secret.slice(end + 8)) ? end : secret.length;
    const head = headerEnd(secret);
    const from = head >= 0 && head <= body ? head : 10;
    return redactSecrets(secret.slice(0, from)) + secret.slice(from, body).replace(/[^\n]/g, DOTS) + redactSecrets(secret.slice(body));
  }
  if (!HIDDEN.test(secret)) return secret.length <= 12 ? DOTS.repeat(secret.length) : secret.slice(0, KEEP) + DOTS.repeat(secret.length - KEEP);
  let seen = 0;
  let cut = 0;
  for (let i = 0; i < secret.length; ) {
    const ch = String.fromCodePoint(secret.codePointAt(i) ?? 0);
    i += ch.length;
    if (!HIDDEN.test(ch) && ++seen === KEEP) cut = i;
  }
  return seen <= 12 ? DOTS.repeat(secret.length) : secret.slice(0, cut) + DOTS.repeat(secret.length - cut);
}

/** qs */
function splice(text: string, found: Found[]): string {
  let out = "";
  let at = 0;
  for (const item of found) {
    out += text.slice(at, item.start) + mask(item.value);
    at = item.end;
  }
  return out + text.slice(at);
}

/** Xs (Ys with Us): `text` with every secret in it masked. */
export function redactSecrets(text: string): string {
  if (text.length <= MAX) return splice(text, secretsIn(text, true));
  const found: Found[] = [];
  for (let at = 0; at < text.length; at += STRIDE)
    for (const item of secretsIn(text.slice(at, at + MAX), at + MAX >= text.length)) found.push({ ...item, start: at + item.start, end: at + item.end });
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Found[] = [];
  for (const item of found) {
    const last = merged.at(-1);
    if (last !== undefined && item.start <= last.end) {
      if (item.end > last.end) {
        last.end = item.end;
        last.value = text.slice(last.start, last.end);
      }
    } else merged.push(item);
  }
  return splice(text, merged);
}

/**
 * sc: `text` cut before a private key's BEGIN line when the key isn't closed, or is followed by
 * another BEGIN before its END, or shows anything but bullets and space before it.
 */
export function cutOpenKey(text: string): string {
  if (!KEY_TAIL.test(text) && !NOT_PLAIN.test(text)) return text;
  const { shadow, toRaw } = shadowOf(text);
  const masked = new RegExp(`${DOTS}-{0,4}[A-Z0-9${BREAKS}]*${KEY_TAIL.source}`).exec(shadow);
  const limit = masked === null ? Infinity : toRaw(masked.index) + 1;
  const begin = new RegExp(`${KEY_BEGIN.source}|${DASHES}${PAD}BEGIN[A-Z0-9${BREAKS}]*${DOTS}[A-Z0-9${BREAKS}${DOTS}]*${DASHES}`, "g");
  const end = new RegExp(KEY_END.source, "g");
  for (let m = begin.exec(shadow); m !== null; m = begin.exec(shadow)) {
    const after = m.index + m[0].length;
    end.lastIndex = after;
    const close = end.exec(shadow);
    begin.lastIndex = after;
    const again = begin.exec(shadow);
    if (close === null || (again !== null && again.index < close.index) || /[^\s\u2022]/.test(shadow.slice(after, close.index))) return text.slice(0, Math.min(toRaw(m.index), limit));
    begin.lastIndex = close.index + close[0].search(/-+$/);
  }
  return masked === null ? text : text.slice(0, limit);
}

/** shared-0 QP: what rF swaps; tabs and newlines stay. */
const SHOWN = new RegExp(String.raw`(?![\t\n])${INVISIBLE.source}`, "gu");

/**
 * rF with keepLegibilityJoiners: a control character as its control picture (DEL as U+2421), anything
 * else nobody sees as U+FFFD, but for the joiners and variation selectors emoji are made of.
 */
export function showControls(text: string): string {
  return text.replace(SHOWN, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x200c || code === 0x200d || code === 0xfe0e || code === 0xfe0f) return ch;
    return code <= 31 ? String.fromCharCode(0x2400 + code) : code === 127 ? "\u2421" : "\uFFFD";
  });
}

/** Nv: a task's text as the plan pane shows it; a word joiner between two word characters stays. */
export function taskText(text: string): string {
  return cutOpenKey(redactSecrets(text))
    .split(/(?<=[\w-])\u2060(?=[\w-])/)
    .map(showControls)
    .join("\u2060");
}
