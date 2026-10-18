// File preview pane (U24; Claude Desktop 2.42304.0.0 c3fde7009 document preview). D's file
// links send window `codex:open-file` ({ path, line? }); the file opens for the session on
// screen in the right-hand pane slot, one pane at a time with the changes pane and the session
// rail. Markdown renders through D's Markdown, one top-level block per chunk; any other file is
// highlighted code with line numbers. When the file is rewritten (fs/watch) it is read again and
// the added blocks or lines are marked (data-changed a / b, cleared after 2s, none when more
// than half the file is new: c3fde7009 ht / jt). `line` scrolls there and flashes it
// (code-reply-flash 1.2s; a Markdown block lands with epitaxy-document-landed 1.6s). Markdown
// with at least 3 headings (h1–h3) gets the rail ticks (c3fde7009 Hn: --document-rail-tick 8px,
// current = last heading above 20% of the view, read = the ones before it).
// ponytail: one chunk per top-level block, so reference-style link definitions only resolve
// inside their own block, and the rail's hover outline is left out.

import { X } from "lucide-react";
import { lexer } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { errorMessage, readTextFile, watchFile } from "../lib/codex";
import { basename, parentDir, relativePath } from "../lib/format";
import { highlight } from "../lib/markdown";
import { NO_MARKS, docLevels, nextMarks, overlaps, splitHighlighted, type Marks } from "../lib/preview";
import { getState, setState, useStore, type ThreadState } from "../lib/store";
import { Markdown } from "./content";
import { Button, Skeleton, useReducedMotion } from "./ui";

interface OpenFile {
  threadId: string | null;
  path: string;
  line?: number;
  /** Bumped by every open, so the same line can flash again. */
  nonce: number;
}

let opened: OpenFile | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const setOpened = (next: OpenFile | null) => {
  opened = next;
  listeners.forEach((listener) => listener());
};

if (typeof window !== "undefined") {
  window.addEventListener("codex:open-file", (event) => {
    const detail = (event as CustomEvent<{ path?: unknown; line?: unknown }>).detail;
    if (typeof detail?.path !== "string" || !detail.path) return;
    const line = typeof detail.line === "number" && detail.line >= 1 ? Math.floor(detail.line) : undefined;
    setState({ panel: null });
    setOpened({ threadId: getState().activeId, path: detail.path, line, nonce: (opened?.nonce ?? 0) + 1 });
  });
}

const EXTRA_LANGUAGES: Record<string, string> = { rb: "ruby", kt: "kotlin", cs: "csharp", h: "c", hpp: "cpp", cc: "cpp", scss: "css", jsonc: "json", cts: "typescript" };
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
const MAX_HIGHLIGHT = 200_000;
const MAX_LINES = 10_000;

/** Restarts a one-shot attribute animation on `el` (data-flash / data-landed). */
function replay(el: Element, attr: string) {
  el.removeAttribute(attr);
  void (el as HTMLElement).offsetWidth;
  el.setAttribute(attr, "");
  setTimeout(() => el.removeAttribute(attr), 1700);
}

export function FilePreview({ thread }: { thread: ThreadState }) {
  const file = useSyncExternalStore(subscribe, () => opened);
  const panel = useStore((s) => s.panel);
  // The changes pane or the session rail takes the slot.
  useEffect(() => {
    if (panel !== null && opened) setOpened(null);
  }, [panel]);
  if (!file || file.threadId !== thread.meta.id) return null;
  return <FilePane key={file.path} file={file} cwd={thread.settings?.cwd ?? thread.meta.cwd} />;
}

function FilePane({ file, cwd }: { file: OpenFile; cwd: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const latest = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      readTextFile(file.path).then(
        (next) => {
          if (mine !== seq) return;
          const prev = latest.current;
          latest.current = next;
          if (prev !== null && prev !== next) setMarks((last) => nextMarks(prev, next, last));
          setText(next);
          setError(null);
        },
        (reason) => mine === seq && setError(errorMessage(reason)),
      );
    };
    load();
    const unwatch = watchFile(file.path, load);
    return () => {
      seq += 1;
      unwatch();
    };
  }, [file.path]);

  // Marks fade with the animation and are cleared after 2s; the stamp carries over.
  useEffect(() => {
    if (marks.ranges.length === 0) return;
    const timer = setTimeout(() => setMarks((last) => ({ ranges: [], stamp: last.stamp })), 2000);
    return () => clearTimeout(timer);
  }, [marks]);

  const rel = relativePath(file.path, cwd);
  const dir = rel === file.path ? parentDir(file.path) : rel.includes("/") || rel.includes("\\") ? parentDir(rel) : "";
  const binary = text?.includes("\u0000") ?? false;
  return (
    <aside className="side-panel file-panel" aria-label={`预览：${basename(file.path)}`}>
      <div className="side-head">
        <h2 className="side-title file-title" data-tip={file.path}>
          {basename(file.path)}
        </h2>
        {dir && <span className="file-dir">{dir}</span>}
        <span className="spacer" />
        <Button variant="ghost" muted icon={<X size={16} />} label="关闭面板" onClick={() => setOpened(null)} />
      </div>
      {error ? (
        <div className="side-empty">无法读取文件：{error}</div>
      ) : text === null ? (
        <div className="file-loading">
          <Skeleton lines={6} />
        </div>
      ) : binary ? (
        <div className="side-empty">二进制文件无法预览</div>
      ) : isMarkdown(file.path) ? (
        <MarkdownDoc text={text} marks={marks} line={file.line} nonce={file.nonce} scroller={scroller} />
      ) : (
        <CodeDoc text={text} path={file.path} marks={marks} line={file.line} nonce={file.nonce} scroller={scroller} />
      )}
    </aside>
  );
}

interface DocProps {
  text: string;
  marks: Marks;
  line?: number;
  nonce: number;
  scroller: RefObject<HTMLDivElement | null>;
}

/** Scrolls to the element for `line` once per open and plays its flash. */
function useJump(scroller: RefObject<HTMLDivElement | null>, nonce: number, line: number | undefined, find: (line: number) => Element | null, attr: string) {
  const done = useRef(-1);
  useLayoutEffect(() => {
    if (!line || done.current === nonce || !scroller.current) return;
    const target = find(line);
    if (!target) return;
    done.current = nonce;
    target.scrollIntoView({ block: "center" });
    replay(target, attr);
  });
}

function CodeDoc({ text, path, marks, line, nonce, scroller }: DocProps & { path: string }) {
  const name = basename(path).toLowerCase();
  const ext = name.split(".").pop() ?? "";
  const language = name === "dockerfile" ? "dockerfile" : (EXTRA_LANGUAGES[ext] ?? ext);
  const lines = useMemo(() => {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const markup = splitHighlighted(highlight(body, body.length > MAX_HIGHLIGHT ? undefined : language));
    let start = 0;
    return body
      .split("\n")
      .slice(0, MAX_LINES)
      .map((source, index) => {
        const row = { markup: markup[index] ?? "", start, end: start + source.length + 1 };
        start = row.end;
        return row;
      });
  }, [text, language]);
  useJump(scroller, nonce, line, (n) => scroller.current?.querySelector(`[data-line="${n}"]`) ?? null, "data-flash");
  const total = text.split("\n").length;
  return (
    <div ref={scroller} className="file-code scroll-fade-y">
      <pre className="file-pre hljs">
        {lines.map((row, index) => (
          <div
            key={index}
            className="file-line"
            data-line={index + 1}
            data-changed={marks.ranges.length && overlaps(marks.ranges, row.start, row.end) ? marks.stamp : undefined}
          >
            <span className="file-ln" aria-hidden="true">
              {index + 1}
            </span>
            <code dangerouslySetInnerHTML={{ __html: row.markup || " " }} />
          </div>
        ))}
      </pre>
      {total > MAX_LINES && <div className="file-more">只显示前 {MAX_LINES} 行</div>}
    </div>
  );
}

function MarkdownDoc({ text, marks, line, nonce, scroller }: DocProps) {
  const chunks = useMemo(() => {
    let offset = 0;
    let lineAt = 1;
    return lexer(text).map((token) => {
      const chunk = { raw: token.raw, space: token.type === "space", start: offset, end: offset + token.raw.length, line: lineAt };
      offset = chunk.end;
      lineAt += token.raw.split("\n").length - 1;
      return chunk;
    });
  }, [text]);
  const column = useRef<HTMLDivElement>(null);
  useJump(
    scroller,
    nonce,
    line,
    (n) => {
      const index = chunks.findLastIndex((chunk) => !chunk.space && chunk.line <= n);
      return column.current?.querySelector(`[data-chunk="${index}"]`) ?? null;
    },
    "data-landed",
  );
  return (
    <div ref={scroller} className="doc-page scroll-fade-y">
      <div ref={column} className="doc-column">
        <DocRail scroller={scroller} column={column} version={text} />
        {chunks.map((chunk, index) =>
          chunk.space ? null : (
            <div
              key={index}
              className="doc-chunk"
              data-chunk={index}
              data-changed={marks.ranges.length && overlaps(marks.ranges, chunk.start, chunk.end) ? marks.stamp : undefined}
            >
              <Markdown text={chunk.raw} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** "On this page" ticks in the left gutter, shown when the gutter has 4.75rem to spare (CSS). */
function DocRail({ scroller, column, version }: { scroller: RefObject<HTMLDivElement | null>; column: RefObject<HTMLDivElement | null>; version: string }) {
  const [heads, setHeads] = useState<{ el: HTMLElement; level: number; text: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const reduce = useReducedMotion();

  // After commit: the column ref is attached after this child's layout effects run.
  useEffect(() => {
    const found = [...(column.current?.querySelectorAll<HTMLElement>(".doc-chunk :is(h1, h2, h3)") ?? [])];
    const levels = docLevels(found.map((el) => Number(el.tagName[1])));
    setHeads(found.map((el, index) => ({ el, level: levels[index], text: el.textContent ?? "" })));
  }, [column, version]);

  useEffect(() => {
    const view = scroller.current;
    if (!view || heads.length < 3) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (view.scrollTop <= 0) return setCurrent(0);
      if (view.scrollHeight > view.clientHeight && view.scrollHeight - view.scrollTop - view.clientHeight <= 8) return setCurrent(heads.length - 1);
      const mark = view.getBoundingClientRect().top + view.clientHeight * 0.2;
      let index = 0;
      heads.forEach((head, i) => {
        if (head.el.getBoundingClientRect().top < mark) index = i;
      });
      setCurrent(index);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    view.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      view.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scroller, heads]);

  if (heads.length < 3) return null;
  return (
    <div className="doc-rail">
      <nav className="doc-rail-nav" aria-label="本页目录">
        <ol className="doc-rail-ticks" style={{ "--document-rail-tick": "8px" } as CSSProperties}>
          {heads.map((head, index) => (
            <li key={index} data-level={head.level || undefined} data-read={index < current || undefined} data-current={index === current || undefined}>
              <button
                type="button"
                aria-label={head.text}
                data-tip={head.text}
                onClick={() => {
                  head.el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
                  replay(head.el, "data-landed");
                }}
              >
                <span />
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
