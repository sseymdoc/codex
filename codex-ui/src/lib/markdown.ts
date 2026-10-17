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
import { Marked, type Tokens } from "marked";
import { hangQuotes } from "./format";

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

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? "").trim().split(/\s+/)[0] || "";
      const label = escapeHtml(language || "text");
      return `<div class="md-code"><div class="md-code-head"><span>${label}</span><button type="button" class="md-copy" data-copy>复制</button></div><pre><code class="hljs">${highlight(text, language)}</code></pre></div>`;
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

export function renderMarkdown(text: string): string {
  const html = (marked.parse(text, { async: false }) as string)
    .replaceAll("<table>", '<div class="md-table"><table>')
    .replaceAll("</table>", "</table></div>");
  return DOMPurify.sanitize(hangQuotes(html), { ADD_ATTR: ["target", "data-copy"] });
}

// ponytail: a block rendered on its own cannot see reference-link definitions elsewhere
// in the message, so block rendering is only used while a message streams.
const blockCache = new Map<string, string>();

/**
 * Render a streaming message as top-level blocks. Finished blocks come from a cache,
 * so each delta only re-renders the block still being written.
 */
export function renderBlocks(text: string): string[] {
  const tokens = marked.lexer(text).filter((token) => token.type !== "space");
  return tokens.map((token, index) => {
    // The last block is still being written; render it fresh and keep it out of the cache.
    if (index === tokens.length - 1) return renderMarkdown(token.raw);
    let html = blockCache.get(token.raw);
    if (html === undefined) {
      html = renderMarkdown(token.raw);
      if (blockCache.size > 200) blockCache.clear();
      blockCache.set(token.raw, html);
    }
    return html;
  });
}
