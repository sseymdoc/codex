// Rich content renderers: markdown and unified diffs.

import { createContext, memo, use, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import { basename, mayReadUnasked, parentDir } from "../lib/format";
import { parseDiff, type FileDiff } from "../lib/diff";
import { highlight, LIGHTBOX_IMAGE, renderBlocks, renderMarkdown } from "../lib/markdown";
import { readImage } from "../lib/codex";
import { fileRows, openDiff } from "../lib/panes";
import { getState } from "../lib/store";
import { parseFileRef, resolvePath, wordDelay } from "../lib/transcript";
import { openLightbox } from "./Lightbox";
import { Icon, fileGlyph } from "./ui";

/** `path` resolved against the open session's folder. */
function sessionPath(path: string): string {
  const { activeId, threads, prefs } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  return resolvePath(path, thread?.settings?.cwd ?? thread?.meta.cwd ?? prefs.cwd);
}

/**
 * U24: hand `path` to the preview pane (E), relative paths resolved against the open session's
 * folder. An image opens in the lightbox instead, or in the pane when it cannot be read (c19e90103 hb).
 */
export function openFile(path: string, line?: number): void {
  const full = sessionPath(path);
  const pane = () => window.dispatchEvent(new CustomEvent("codex:open-file", { detail: { path: full, line } }));
  if (LIGHTBOX_IMAGE.test(full)) readImage(full).then((src) => openLightbox(src), pane);
  else pane();
}

// c19e90103 ab / ib: each local image read so far by path, as its data URL or null when it could
// not be read, holding 32M chars of data URLs at most (the oldest go first). ponytail: a path that
// failed stays a link until the app reloads, where Claude tries again as the image mounts again.
const images = new Map<string, Promise<string | null>>();
const imageChars = new Map<string, number>();
let heldChars = 0;

function loadImage(path: string): Promise<string | null> {
  let image = images.get(path);
  if (!image) {
    image = readImage(path).then(
      (src) => {
        imageChars.set(path, src.length);
        heldChars += src.length;
        for (const [old, chars] of imageChars) {
          if (heldChars <= 32 * 1024 * 1024) break;
          imageChars.delete(old);
          images.delete(old);
          heldChars -= chars;
        }
        return src;
      },
      () => null,
    );
    images.set(path, image);
  }
  return image;
}

/**
 * c19e90103 yb: a local image's link (markdown.ts) turns into the image once read, a held-back
 * 120px skeleton till then (eb), and stays the link when the file cannot be read or shown. It
 * works as the HTML lands, before a streaming reply's words fade in or paint, and each path is
 * read once, so a block rendered again while the reply streams shows the image again at once.
 */
class MarkdownImage extends HTMLElement {
  connectedCallback() {
    const link = this.querySelector<HTMLElement>("[data-path]");
    const path = link?.dataset.path && sessionPath(link.dataset.path);
    if (!link || !path || !mayReadUnasked(path)) return;
    this.innerHTML = '<span class="skeleton md-image-wait" data-hold="delayed" aria-hidden="true"><span class="skeleton-line"></span></span>';
    void loadImage(path).then((src) => {
      if (src === null) return this.replaceChildren(link);
      const image = new Image();
      image.alt = link.textContent ?? "";
      image.src = src;
      image.onerror = () => this.replaceChildren(link);
      this.replaceChildren(image);
    });
  }
}
if (!customElements.get("md-image")) customElements.define("md-image", MarkdownImage);

/** Inside a button (a tool group's line), file names read as plain text. */
export const PlainLinks = createContext(false);

/** A file name that opens the preview; an inline span so a truncated detail keeps its ellipsis. */
/** preferDiff (c856385e2 In): an edit row's file opens its diff in the changes pane instead. */
export function FileLink({
  path,
  line,
  tip,
  className = "",
  preferDiff = false,
  children,
}: {
  path: string;
  line?: number;
  /** The tip, where it says more than the path. */
  tip?: string;
  className?: string;
  preferDiff?: boolean;
  children: ReactNode;
}) {
  const plain = use(PlainLinks);
  const open = (event: SyntheticEvent) => {
    event.stopPropagation();
    if (preferDiff) openDiff(path);
    else openFile(path, line);
  };
  if (plain) return <>{children}</>;
  return (
    <span
      role="link"
      tabIndex={0}
      className={`file-link ${className}`}
      data-tip={tip ?? (line ? `${path}:${line}` : path)}
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

function openPathRef(el: HTMLElement): boolean {
  const ref = el.closest<HTMLElement>("[data-path]")?.dataset.path;
  if (!ref) return false;
  const { path, line } = parseFileRef(ref);
  openFile(path, line);
  return true;
}

function onMarkdownKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Enter" && openPathRef(event.target as HTMLElement)) event.preventDefault();
}

function onMarkdownClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement) {
    openLightbox(target.src, target);
    return;
  }
  if (openPathRef(target)) return;
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
  }, 1200);
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
  /** The agent's reply: optically hung quotes, by the interface font's metrics (transcript.css). */
  voice?: boolean;
}) {
  const html = useMemo(() => (streaming ? null : renderMarkdown(text)), [text, streaming]);
  const blocks = useMemo(() => (streaming ? renderBlocks(text) : null), [text, streaming]);
  const props = { className: `markdown ${className}`, onClick: onMarkdownClick, onKeyDown: onMarkdownKeyDown, "data-hang-face": voice ? "" : undefined };
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

// ponytail: a row count stands in for the diffs library's size check (not traced).
const MAX_ROWS = 3000;

/**
 * Unified diff (cb6930dae vu + diffs: classic +/- indicators, hunks 4px apart with no @@ line,
 * wrapping); too big, the removed and the added text show separately (Nu), 200px each.
 */
export const DiffView = memo(function DiffView({
  diff,
  path,
  kind = "update",
  whole = false,
}: {
  diff: string;
  path: string;
  kind?: "add" | "delete" | "update";
  /** `diff` is the added or deleted file as is, not hunks (FileDiff.whole). */
  whole?: boolean;
}) {
  const rows = useMemo(() => parseDiff(diff, kind, whole), [diff, kind, whole]);
  const language = languageFor(path);
  if (rows.length > MAX_ROWS) {
    const side = (which: "add" | "del") =>
      rows
        .filter((row) => row.kind === which)
        .map((row) => row.text)
        .join("\n");
    return (
      <div className="diff diff-split">
        <p className="diff-note">改动太多，无法以差异视图显示。将分别显示删除和新增的文本。</p>
        <pre className="diff-side diff-del" role="group" aria-label="删除的文本">
          {side("del")}
        </pre>
        <pre className="diff-side diff-add" role="group" aria-label="新增的文本">
          {side("add")}
        </pre>
      </div>
    );
  }
  return (
    <div className="diff" role="table" data-pure={whole || undefined}>
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={index} className="diff-gap" aria-hidden="true" />
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
    </div>
  );
});

/**
 * A changes-pane card's head (c219730b0 Lt): the path, where it moved from (zt), the labels in Lt's
 * order (binary, whitespace only, mode), and +N −N always, 0 too. With no lines (`lines` false) it
 * opens nothing (c44d00c7f ml: no hunks, aria-disabled).
 */
export function FileDiffHead({
  file,
  stats,
  whitespaceOnly,
  lines,
  open,
  onToggle,
}: {
  file: FileDiff;
  stats: { added: number; removed: number };
  whitespaceOnly: boolean;
  lines: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const path = file.movePath ?? file.path;
  const from = file.movePath ? file.path : null;
  const labels = [
    file.binary && "二进制文件",
    whitespaceOnly && "仅空白更改",
    file.executable === true && "已设为可执行",
    file.executable === false && "不再可执行",
  ].filter((label) => typeof label === "string");
  return (
    <div className="file-diff-head" onClick={lines ? onToggle : undefined}>
      <button
        type="button"
        className="file-diff-toggle"
        aria-expanded={lines ? open : undefined}
        aria-disabled={!lines || undefined}
        aria-label={open ? "收起差异" : "展开差异"}
      >
        <Icon name="CaretRight" size="sm" className="tool-caret" />
        <Icon name={fileGlyph(path)} size="xs" className={`file-kind file-kind-${file.kind}`} />
      </button>
      {/* The path's tip names the move and every label, which give way first (Lt S). */}
      <FileLink path={path} tip={labels.reduce((tip, label) => `${tip}（${label}）`, from ? `${from} → ${path}` : path)} className="file-path">
        {path}
      </FileLink>
      {from && (
        <span className="file-diff-moved">
          <span>重命名自</span>
          <span data-tip={from}>{parentDir(from) === parentDir(path) ? basename(from) : from}</span>
        </span>
      )}
      {labels.map((label) => (
        <span key={label} className="file-diff-label">
          {label}
        </span>
      ))}
      <span className="diff-stat">
        <span className="plus">+{stats.added}</span>
        <span className="minus">−{stats.removed}</span>
      </span>
    </div>
  );
}

export function FileDiffCard({ file, ws = false, defaultOpen = false }: { file: FileDiff; ws?: boolean; defaultOpen?: boolean }) {
  const { diff, rows, stats, whitespaceOnly } = useMemo(() => fileRows(file, ws), [file, ws]);
  const lines = rows.length > 0;
  const [picked, setPicked] = useState(defaultOpen);
  const open = lines && picked;
  return (
    <div className={`file-diff ${open ? "open" : ""}`}>
      <FileDiffHead file={file} stats={stats} whitespaceOnly={whitespaceOnly} lines={lines} open={open} onToggle={() => setPicked(!open)} />
      {open && <DiffView diff={diff} path={file.movePath ?? file.path} kind={file.kind} whole={file.whole} />}
    </div>
  );
}
