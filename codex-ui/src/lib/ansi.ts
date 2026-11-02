// Colored command output, as Claude Desktop 4.4212's Code tab draws it (c966e2bd9: the escape
// pattern e, the Tomorrow palette i / a, SGR state s, spans l, inline style u). Only SGR (`ESC[…m`)
// changes the style; every other escape is dropped.

export interface AnsiStyle {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b(?:\[[0-9:;<=>?]*[ -/]*[@-~]|[\]P^_Xk][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]*[0-OQ-WYZ\\`a-jl-~])/g;
const NORMAL = ["#4d4d4c", "#c82829", "#718c00", "#eab700", "#4271ae", "#8959a8", "#3e999f", "#d6d6d6"];
const BRIGHT = ["#8e908c", "#f5871f", "#a2bd40", "#f0c674", "#6ca4e0", "#b777db", "#6bc8cd", "#ffffff"];

export const hasAnsi = (text: string): boolean => {
  ESCAPE.lastIndex = 0;
  return ESCAPE.test(text);
};

const hex = (n: number) => n.toString(16).padStart(2, "0");

/** The xterm 256-color table: 16 named, a 6×6×6 cube, then 24 grays. */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined;
  if (n < 8) return NORMAL[n];
  if (n < 16) return BRIGHT[n - 8];
  if (n < 232) {
    const c = n - 16, level = (v: number) => hex(v === 0 ? 0 : 55 + v * 40);
    return `#${level(Math.floor(c / 36))}${level(Math.floor((c % 36) / 6))}${level(c % 6)}`;
  }
  const gray = hex(8 + (n - 232) * 10);
  return `#${gray}${gray}${gray}`;
}

function sgr(codes: number[], from: AnsiStyle): AnsiStyle {
  let style = { ...from };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) style = {};
    else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 7) style.inverse = true;
    else if (code === 9) style.strikethrough = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 27) style.inverse = false;
    else if (code === 29) style.strikethrough = false;
    else if (code === 39) delete style.fg;
    else if (code === 49) delete style.bg;
    else if (code >= 30 && code <= 37) style.fg = NORMAL[code - 30];
    else if (code >= 40 && code <= 47) style.bg = NORMAL[code - 40];
    else if (code >= 90 && code <= 97) style.fg = BRIGHT[code - 90];
    else if (code >= 100 && code <= 107) style.bg = BRIGHT[code - 100];
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg";
      if (codes[i + 1] === 5 && i + 2 < codes.length) {
        style[key] = color256(codes[i + 2] ?? 0);
        i += 2;
      } else if (codes[i + 1] === 2 && i + 4 < codes.length) {
        style[key] = `#${hex(codes[i + 2] ?? 0)}${hex(codes[i + 3] ?? 0)}${hex(codes[i + 4] ?? 0)}`;
        i += 4;
      }
    }
  }
  return style;
}

/** The text between escapes, each with the SGR style in force where it starts. */
export function ansiSpans(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let style: AnsiStyle = {}, at = 0;
  ESCAPE.lastIndex = 0;
  for (let match; (match = ESCAPE.exec(text)) !== null; ) {
    if (match.index > at) spans.push({ text: text.slice(at, match.index), style });
    at = match.index + match[0].length;
    const escape = match[0], params = escape.slice(2, -1);
    if (escape.startsWith("\x1b[") && escape.endsWith("m") && /^[0-9;]*$/.test(params)) {
      style = sgr(params === "" ? [0] : params.split(";").map((part) => parseInt(part, 10) || 0), style);
    }
  }
  if (at < text.length) spans.push({ text: text.slice(at), style });
  return spans;
}

/** u(): a span's inline style, or undefined for plain text. Inverse falls back to the page's colors. */
export function ansiCss(style: AnsiStyle): Record<string, string | number> | undefined {
  const css: Record<string, string | number> = {};
  if (style.bold) Object.assign(css, { fontWeight: "bold", fontVariationSettings: "normal" });
  if (style.dim) css.opacity = 0.7;
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  if (style.strikethrough) css.textDecoration = style.underline ? "underline line-through" : "line-through";
  const fg = style.inverse ? (style.bg ?? "Canvas") : style.fg;
  const bg = style.inverse ? (style.fg ?? "CanvasText") : style.bg;
  if (fg) css.color = fg;
  if (bg) css.backgroundColor = bg;
  return Object.keys(css).length ? css : undefined;
}

/** Output as the card shows it: trailing blanks and the escapes among them dropped. */
// eslint-disable-next-line no-control-regex
export const trimOutput = (text: string): string => text.replace(/(?:\s|\x1b\[[0-9;]*m)+$/, "");
