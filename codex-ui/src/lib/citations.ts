// Codex's file citations in a reply: `:codex-file-citation{path="…" purpose="output|source"
// line_range_start=".." line_range_end=".." label=".."}` (codex-rs tui inline_directives.rs, the
// Codex desktop app's marked `codexDirective`). Inline code, HTML, fences and a link's target stay
// text since marked never lexes them as inline text, a link's label skips it below, and a
// backslash before it is marked's own escape. A citation with no path stays text.

import { Marked, type MarkedExtension, type Tokens } from "marked";
import { emphasis } from "./emphasis.ts";

export interface Citation {
  path: string;
  /** "output": a file the reply hands over; "source": one it points into. Unset means output. */
  purpose: string;
  line?: number;
  label?: string;
}

const NAME = /[A-Za-z0-9_-]*/y;

/** assistant_directives.rs: `backslash` lets `\"` stand for the quote inside a quoted value. */
function attributes(src: string, backslash: boolean): { raw: string; attrs: Map<string, string> } | undefined {
  const head = /^:{1,3}codex-file-citation\{/.exec(src);
  if (!head) return;
  let i = head[0].length;
  const attrs = new Map<string, string>();
  const space = () => {
    while (src[i] === " " || src[i] === "\t") i++;
  };
  for (;;) {
    space();
    if (src[i] === "}") return { raw: src.slice(0, i + 1), attrs };
    NAME.lastIndex = i;
    const key = NAME.exec(src)![0];
    if (!key || attrs.has(key)) return;
    i += key.length;
    space();
    if (src[i++] !== "=") return;
    space();
    const quote = src[i];
    let value = "";
    if (quote === '"' || quote === "'") {
      for (i++; src[i] !== quote; i++) {
        if (i >= src.length || src[i] === "\n" || src[i] === "\r") return;
        if (backslash && src[i] === "\\" && src[i + 1] === quote) i++;
        value += src[i];
      }
      i++;
    } else {
      const end = src.slice(i).search(/[ \t}\n\r]|$/);
      if (end === 0) return;
      value = src.slice(i, (i += end));
    }
    attrs.set(key, value);
  }
}

/** The citation `src` starts with: quotes taken literally first, as Codex does for citations. */
export function parseCitation(src: string): (Citation & { raw: string }) | undefined {
  const found = attributes(src, false) ?? attributes(src, true);
  const path = found?.attrs.get("path");
  if (!found || !path) return;
  const line = Number(found.attrs.get("line_range_start"));
  return { raw: found.raw, path, purpose: found.attrs.get("purpose") || "output", line: line > 0 ? line : undefined, label: found.attrs.get("label") || undefined };
}

export type CitationToken = Tokens.Generic & Citation;

/** The inline token; markdown.ts draws it as a file link. */
export const citations: MarkedExtension = {
  extensions: [
    {
      name: "codexCitation",
      level: "inline",
      start: (src) => src.search(/:+codex-file-citation\{/),
      tokenizer(src) {
        if (this.lexer.state.inLink) return;
        // Four colons or more are text whole, so no tail of the run starts one.
        const run = /^:{4,}/.exec(src)?.[0];
        if (run) return { type: "text", raw: run, text: run };
        const found = parseCitation(src);
        return found && { type: "codexCitation", ...found };
      },
    },
  ],
};

const lexer = new Marked(emphasis, citations);

/** Every citation in a reply, in order. */
export function fileCitations(text: string): Citation[] {
  if (!text.includes("codex-file-citation")) return [];
  const found: Citation[] = [];
  lexer.walkTokens(lexer.lexer(text), (token) => {
    if (token.type === "codexCitation") found.push(token as CitationToken);
  });
  return found;
}
