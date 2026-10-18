// Rich content renderers: markdown and unified diffs.

import { ChevronRight, FileMinus, FilePen, FilePlus } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import { basename, diffStats } from "../lib/format";
import { parseDiff, type FileDiff } from "../lib/diff";
import { highlight, renderBlocks, renderMarkdown } from "../lib/markdown";
import { getState } from "../lib/store";
import { parseFileRef, resolvePath, wordDelay } from "../lib/transcript";
import { openLightbox } from "./Lightbox";

/** U24: hand `path` to the preview pane (E), relative paths resolved against the open session's folder. */
export function openFile(path: string, line?: number): void {
  const { activeId, threads, prefs } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  const cwd = thread?.settings?.cwd ?? thread?.meta.cwd ?? prefs.cwd;
  window.dispatchEvent(new CustomEvent("codex:open-file", { detail: { path: resolvePath(path, cwd), line } }));
}

/** A file name that opens the preview; an inline span so a truncated detail keeps its ellipsis. */
export function FileLink({ path, line, className = "", children }: { path: string; line?: number; className?: string; children: ReactNode }) {
  const open = (event: SyntheticEvent) => {
    event.stopPropagation();
    openFile(path, line);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      className={`file-link ${className}`}
      data-tip={line ? `${path}:${line}` : path}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        open(event);
      }}
    >
      {children}
    </span>
  );
}

function onMarkdownClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement) {
    openLightbox(target.src, target);
    return;
  }
  const pathCode = target.closest<HTMLElement>("code[data-path]");
  if (pathCode?.dataset.path) {
    const ref = parseFileRef(pathCode.dataset.path);
    openFile(ref.path, ref.line);
    return;
  }
  // Links to local files (relative or /absolute; DOMPurify drops file: and drive-letter hrefs).
  const href = target.closest("a")?.getAttribute("href");
  if (href && !/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) {
    event.preventDefault();
    const ref = parseFileRef(decodeURI(href));
    openFile(ref.path, ref.line);
    return;
  }
  const button = target.closest<HTMLElement>("[data-copy]");
  if (!button) return;
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  void navigator.clipboard.writeText(code);
  const label = (text: string) => {
    button.setAttribute("aria-label", text);
    button.dataset.tip = text;
  };
  button.dataset.copied = "";
  label("已复制");
  setTimeout(() => {
    delete button.dataset.copied;
    label("复制代码");
  }, 2000);
}

const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

/**
 * Wrap the words that arrived since `from` characters of text so each fades in (_fadeInText,
 * 200ms linear, c19e90103 wordAnimating). Code stays plain. Returns the text length now shown.
 */
function fadeNewWords(root: HTMLElement, from: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const fresh: { node: Text; start: number }[] = [];
  let seen = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (seen + length > from && !node.parentElement?.closest("pre")) fresh.push({ node, start: Math.max(0, from - seen) });
    seen += length;
  }
  let index = 0;
  for (const { node, start } of fresh) {
    const tail = start > 0 ? node.splitText(start) : node;
    const parts = segmenter ? [...segmenter.segment(tail.data)].map((part) => part.segment) : tail.data.split(/(\s+)/);
    const out = document.createDocumentFragment();
    for (const part of parts) {
      if (!part.trim()) {
        out.append(part);
        continue;
      }
      const word = document.createElement("span");
      word.className = "fade-word";
      word.style.animationDelay = `${wordDelay(index++)}ms`;
      word.textContent = part;
      out.append(word);
    }
    tail.replaceWith(out);
  }
  return seen;
}

/** The block still being written: only its new words animate (React resets its HTML per delta). */
function StreamingBlock({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(0);
  useLayoutEffect(() => {
    if (ref.current) shown.current = fadeNewWords(ref.current, shown.current);
  }, [html]);
  return <div ref={ref} className="md-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * While `streaming`, each top-level block is its own element so finished blocks stay put and
 * the newest words of the last one fade in. The settled message renders in one piece, with the
 * same layout.
 */
export const Markdown = memo(function Markdown({
  text,
  className = "",
  streaming = false,
  voice = false,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
  /** The agent's reply: optically hung quotes in the transcript's sans face. */
  voice?: boolean;
}) {
  const html = useMemo(() => (streaming ? null : renderMarkdown(text)), [text, streaming]);
  const blocks = useMemo(() => (streaming ? renderBlocks(text) : null), [text, streaming]);
  const props = { className: `markdown ${className}`, onClick: onMarkdownClick, "data-hang-face": voice ? "sans" : undefined };
  if (blocks) {
    return (
      <div {...props} data-streaming="">
        {blocks.map((block, index) =>
          index === blocks.length - 1 ? (
            <StreamingBlock key={index} html={block} />
          ) : (
            <div key={index} className="md-block" dangerouslySetInnerHTML={{ __html: block }} />
          ),
        )}
      </div>
    );
  }
  return <div {...props} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
});

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", rb: "ruby", php: "php",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", css: "css", scss: "css", html: "xml",
  xml: "xml", svg: "xml", json: "json", yaml: "yaml", yml: "yaml", toml: "ini", md: "markdown", sh: "bash",
  bash: "bash", ps1: "powershell", sql: "sql", dockerfile: "dockerfile",
};

function languageFor(path: string): string | undefined {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  return EXTENSION_LANGUAGES[name.split(".").pop() ?? ""];
}

const MAX_ROWS = 3000;

export const DiffView = memo(function DiffView({
  diff,
  path,
  kind = "update",
}: {
  diff: string;
  path: string;
  kind?: "add" | "delete" | "update";
}) {
  const rows = useMemo(() => parseDiff(diff, kind), [diff, kind]);
  const language = languageFor(path);
  const shown = rows.slice(0, MAX_ROWS);
  return (
    <div className="diff" role="table">
      {shown.map((row, index) =>
        row.kind === "hunk" ? (
          <div key={index} className="diff-row diff-hunk">
            <span className="diff-no" />
            <span className="diff-no" />
            <span className="diff-code">{row.text}</span>
          </div>
        ) : (
          <div key={index} className={`diff-row diff-${row.kind}`}>
            <span className="diff-no">{row.oldNo ?? ""}</span>
            <span className="diff-no">{row.newNo ?? ""}</span>
            <span className="diff-code">
              <span className="diff-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}</span>
              <span dangerouslySetInnerHTML={{ __html: highlight(row.text, language) || " " }} />
            </span>
          </div>
        ),
      )}
      {rows.length > MAX_ROWS && <div className="diff-more">还有 {rows.length - MAX_ROWS} 行未显示</div>}
    </div>
  );
});

export function FileDiffCard({ file, defaultOpen = false }: { file: FileDiff; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const stats = useMemo(() => (file.diff.includes("@@") ? diffStats(file.diff) : null), [file.diff]);
  const lines = file.diff.replace(/\n$/, "").split("\n").length;
  const Icon = file.kind === "add" ? FilePlus : file.kind === "delete" ? FileMinus : FilePen;
  return (
    <div className={`file-diff ${open ? "open" : ""}`}>
      <div className="file-diff-head" onClick={() => setOpen(!open)}>
        <button type="button" className="file-diff-toggle" aria-expanded={open} aria-label={open ? "收起差异" : "展开差异"}>
          <ChevronRight size={14} className="tool-caret" />
          <Icon size={14} className={`file-kind file-kind-${file.kind}`} />
        </button>
        <FileLink path={file.movePath ?? file.path} className="file-path">
          {file.movePath ? `${file.path} → ${file.movePath}` : file.path}
        </FileLink>
        <span className="diff-stat">
          {stats ? (
            <>
              <span className="plus">+{stats.added}</span>
              <span className="minus">−{stats.removed}</span>
            </>
          ) : file.kind === "add" ? (
            <span className="plus">+{lines}</span>
          ) : file.kind === "delete" ? (
            <span className="minus">−{lines}</span>
          ) : null}
        </span>
      </div>
      {open && <DiffView diff={file.diff} path={file.movePath ?? file.path} kind={file.kind} />}
    </div>
  );
}
