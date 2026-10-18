// Rich content renderers: markdown and unified diffs.

import { ChevronRight, FileMinus, FilePen, FilePlus } from "lucide-react";
import { memo, useMemo, useState, type MouseEvent } from "react";
import { basename, diffStats } from "../lib/format";
import { parseDiff, type FileDiff } from "../lib/diff";
import { highlight, renderBlocks, renderMarkdown } from "../lib/markdown";
import { setState } from "../lib/store";

function onMarkdownClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement) {
    setState({ lightbox: target.src });
    return;
  }
  const button = target.closest<HTMLElement>("[data-copy]");
  if (!button) return;
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  void navigator.clipboard.writeText(code);
  button.textContent = "已复制";
  button.classList.add("copied");
  setTimeout(() => {
    button.textContent = "复制";
    button.classList.remove("copied");
  }, 2500);
}

/**
 * While `streaming`, each top-level block is its own element so a new block can
 * resolve out of a blur (CDS grapheme reveal) while finished ones stay put. The
 * settled message renders in one piece, with the same layout.
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
  /** Claude's voice: serif prose with optically hung quotes. */
  voice?: boolean;
}) {
  const html = useMemo(() => (streaming ? null : renderMarkdown(text)), [text, streaming]);
  const blocks = useMemo(() => (streaming ? renderBlocks(text) : null), [text, streaming]);
  const props = { className: `markdown ${className}`, onClick: onMarkdownClick, "data-hang-face": voice ? "serif" : undefined };
  if (blocks) {
    return (
      <div {...props} data-streaming="">
        {blocks.map((block, index) => (
          <div key={index} className="md-block" dangerouslySetInnerHTML={{ __html: block }} />
        ))}
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
      <button type="button" className="file-diff-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className="tool-caret" />
        <Icon size={14} className={`file-kind file-kind-${file.kind}`} />
        <span className="file-path" data-tip={file.path}>
          {file.movePath ? `${file.path} → ${file.movePath}` : file.path}
        </span>
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
      </button>
      {open && <DiffView diff={file.diff} path={file.movePath ?? file.path} kind={file.kind} />}
    </div>
  );
}
