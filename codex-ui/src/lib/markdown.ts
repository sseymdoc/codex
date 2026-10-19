// Markdown for agent output: GFM via marked, sanitized with DOMPurify, code
// highlighted with a small highlight.js language set. Raw HTML is shown as text,
// and remote images become links so rendered output cannot beacon data out.

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdownLang from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { Marked, Renderer, type Tokens } from "marked";
import { emphasis } from "./emphasis";
import { basename, hangQuotes, localPath } from "./format";
import { frontier } from "./frontier";
import { looksLikePath } from "./transcript";

const languages = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown: markdownLang, php, powershell, python, ruby, rust, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, language] of Object.entries(languages)) hljs.registerLanguage(name, language);
hljs.registerAliases(["sh", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["ts", "tsx", "mts"], { languageName: "typescript" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["html", "svg", "vue"], { languageName: "xml" });
hljs.registerAliases(["ps1", "pwsh"], { languageName: "powershell" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["patch"], { languageName: "diff" });

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function highlight(code: string, language: string | undefined): string {
  const lang = language?.toLowerCase();
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // fall through to plain text
    }
  }
  return escapeHtml(code);
}

// The copy key's Copy ↔ Check glyphs (c19e90103 Pg icon), as ui.tsx's Icon renders them.
const COPY_ICON = '<span data-cds="Icon" class="md-copy-icon" aria-hidden="true">&#xe056;</span>'; // Copy
const CHECK_ICON = '<span data-cds="Icon" class="md-check-icon" aria-hidden="true">&#xe03b;</span>'; // Check

/** A local file as a prose link; a click opens it (U24, content.tsx onMarkdownClick). */
const fileLink = (path: string, label: string) => `<span class="prose-link" data-path="${escapeHtml(path)}" role="link" tabindex="0">${label}</span>`;

/** The images Claude shows inline (c19e90103 yb) and in its lightbox (shared-104 dP); an .svg opens as text. */
export const LIGHTBOX_IMAGE = /\.(?:png|jpe?g|gif|bmp|webp)$/i;

/** Inside a link's text a path is code, not a link of its own (c19e90103 inLink). */
let inLink = 0;

// Emphasis pairs as Claude's does (emphasis.ts): next to CJK punctuation too.
const marked = new Marked(emphasis, {
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    // A file path in inline code is a prose link, not a code chip (c19e90103 Yy / Zh).
    codespan({ text }: Tokens.Codespan) {
      return !inLink && looksLikePath(text) ? fileLink(text, escapeHtml(text)) : false;
    },
    // A link to a local file (C:/…, file:, relative) opens it the same way (c19e90103 hb): as an
    // <a>, DOMPurify drops a drive or file: href and anything else leaves the app for the browser.
    link(token: Tokens.Link) {
      inLink++;
      try {
        const path = localPath(token.href);
        return path === null ? Renderer.prototype.link.call(this, token) : fileLink(path, this.parser.parseInline(token.tokens));
      } finally {
        inLink--;
      }
    },
    // A local image is a link to it under its alt text (c19e90103 yb); a bitmap's sits in an
    // <md-image>, which shows the image in its place once it loads (content.tsx).
    image({ href, text }: Tokens.Image) {
      const path = localPath(href);
      if (path === null) return false;
      const link = fileLink(path, escapeHtml(text || basename(path)));
      return LIGHTBOX_IMAGE.test(path) ? `<md-image>${link}</md-image>` : link;
    },
    // Task items (c19e90103 Hy / Uy): a check or a 12px ring instead of a native checkbox.
    listitem(item: Tokens.ListItem) {
      return item.task ? `<li class="md-task"${item.checked ? " data-done" : ""}>${this.parser.parse(item.tokens)}</li>\n` : false;
    },
    checkbox({ checked }: Tokens.Checkbox) {
      return checked
        ? `<span class="md-task-mark">${CHECK_ICON}<span class="sr-only">已完成</span></span>`
        : '<span class="md-task-mark"><span class="md-task-ring" aria-hidden="true"></span><span class="sr-only">未完成</span></span>';
    },
    // Code transcript fence (c19e90103 .epitaxy-codeblock): no header and no line numbers,
    // just the code with an icon-only copy key stuck to the top right.
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0] || "";
      const single = text.includes("\n") ? "" : " data-single";
      return `<div class="md-code" data-lang="${escapeHtml(language || "text")}"${single}><pre><code class="hljs">${highlight(text, language)}</code></pre><button type="button" class="md-copy" data-copy aria-label="复制代码" data-tip="复制代码">${COPY_ICON}${CHECK_ICON}</button></div>`;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src") ?? "";
    // A src DOMPurify dropped leaves the alt text, not a link to the app's own page (c19e90103 yb).
    if (!src) return void node.replaceWith(node.getAttribute("alt") ?? "");
    if (!src.startsWith("data:image/")) {
      const link = document.createElement("a");
      link.href = src;
      link.textContent = node.getAttribute("alt") || src;
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      node.replaceWith(link);
    }
  }
});

/** `breaks`: single newlines become line breaks (a copied user message, c96d752d0 Qd(…, { breaks: true })). */
export function renderMarkdown(text: string, breaks = false): string {
  const html = (marked.parse(text, { async: false, breaks }) as string)
    .replaceAll("<table>", '<div class="md-table"><table>')
    .replaceAll("</table>", "</table></div>");
  return DOMPurify.sanitize(hangQuotes(html), { ADD_TAGS: ["md-image"], ADD_ATTR: ["target", "data-copy"] });
}

// ponytail: a block rendered on its own cannot see reference-link definitions elsewhere
// in the message, so block rendering is only used while a message streams.
const blockCache = new Map<string, string>();

/**
 * Render a streaming message as top-level blocks. Finished blocks come from a cache,
 * so each delta only re-renders the block still being written. While `streaming`, its
 * unfinished end shows as Claude's does (frontier.ts).
 */
export function renderBlocks(text: string, streaming = false): string[] {
  const { tokens: all, last } = streaming ? frontier(text) : { tokens: marked.lexer(text), last: undefined };
  const tokens = all.filter((token) => token.type !== "space");
  return tokens.map((token, index) => {
    // The last block is still being written; render it fresh and keep it out of the cache.
    if (index === tokens.length - 1) return renderMarkdown(last ?? token.raw);
    let html = blockCache.get(token.raw);
    if (html === undefined) {
      html = renderMarkdown(token.raw);
      if (blockCache.size > 200) blockCache.clear();
      blockCache.set(token.raw, html);
    }
    return html;
  });
}
