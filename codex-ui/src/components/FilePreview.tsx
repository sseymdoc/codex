// 文件 pane (U24; Claude Desktop 2.42304.0.0 cccc2cf0a kC / AC / jC, c3fde7009 document
// preview). D's file links send window `codex:open-file` ({ path, line? }): the file opens as a
// tab of the session on screen and the pane shows (Ctrl+Shift+F also toggles it). A file opened
// from a link is a preview tab (italic) that the next one replaces until it is kept (保持打开, or
// a double click); 预览标签页 off keeps every file. Markdown renders through D's Markdown, one
// top-level block per chunk; any other file is highlighted code with line numbers; past 200 000
// characters both show as plain text with c3fde7009's note; a PDF of up to 30 MB shows in the
// browser's viewer (PdfView). When the file is rewritten
// (fs/watch) it is read again and the added blocks or lines are marked (data-changed a / b,
// cleared after 2s, none when more than half the file is new: c3fde7009 ht / jt). `line`
// scrolls there and flashes it (code-reply-flash 1.2s; a Markdown block lands with
// epitaxy-document-landed 1.6s). Markdown with at least 3 headings (h1–h3) gets the rail: ticks
// (aria-hidden) that open the outline on hover, and a visually hidden 显示目录 button for the
// keyboard (c3fde7009 Hn / Jn).
// ponytail: read-only (no editor, save or file tree); one chunk per top-level block, so
// reference-style link definitions only resolve inside their own block.

import { lexer } from "marked";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { call, errorMessage, readTextFile, watchFile } from "../lib/codex";
import { basename, joinPath, parentDir, relativePath } from "../lib/format";
import { highlight } from "../lib/markdown";
import { innerClose, closePane, openPane } from "../lib/panes";
import { NO_MARKS, docLevels, nextMarks, overlaps, splitHighlighted, withTab, type FileTab, type Marks } from "../lib/preview";
import { getState, readPref, writePref, type ThreadState } from "../lib/store";
import { Markdown } from "./content";
import { GoToFile, PaneEmpty, PaneFrame, gotoKey, type GotoItem } from "./Panes";
import { Icon, MenuItem, MenuSep, Popover, Spinner, useReducedMotion } from "./ui";

interface OpenFile extends FileTab {
  line?: number;
  /** Bumped by every open, so the same line can flash again. */
  nonce: number;
}

/** Open files per session, and the one shown. */
const views = new Map<string, { tabs: OpenFile[]; active: string | null }>();
let version = 0;
let nonce = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

function viewOf(key: string) {
  let view = views.get(key);
  if (!view) views.set(key, (view = { tabs: [], active: null }));
  return view;
}

/** 预览标签页 (on by default) and 自动换行 (off) from the pane's menu (jC). */
const prefs = {
  preview: readPref("codex-ui:files-preview-tabs", ["on", "off"], "on") === "on",
  wrap: readPref("codex-ui:files-wrap", ["on", "off"], "off") === "on",
};

function setPrefs(patch: Partial<typeof prefs>) {
  Object.assign(prefs, patch);
  writePref("codex-ui:files-preview-tabs", prefs.preview ? "on" : "off");
  writePref("codex-ui:files-wrap", prefs.wrap ? "on" : "off");
  emit();
}

export function openFileTab(key: string, path: string, line?: number) {
  const view = viewOf(key);
  view.tabs = withTab(view.tabs, { path, preview: prefs.preview, line, nonce: ++nonce });
  view.active = path;
  openPane("files", key);
  emit();
}

/** Closes tabs; the neighbour of the shown one takes over, and the last one takes the pane. */
function closeTabs(key: string, paths: string[]) {
  const view = viewOf(key);
  const at = view.tabs.findIndex((tab) => tab.path === view.active);
  view.tabs = view.tabs.filter((tab) => !paths.includes(tab.path));
  if (view.active && paths.includes(view.active)) view.active = view.tabs[Math.min(Math.max(at, 0), view.tabs.length - 1)]?.path ?? null;
  if (view.tabs.length === 0) closePane("files", key);
  emit();
}

function keepTab(key: string, path: string) {
  const view = viewOf(key);
  view.tabs = view.tabs.map((tab) => (tab.path === path ? { ...tab, preview: false } : tab));
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("codex:open-file", (event) => {
    const detail = (event as CustomEvent<{ path?: unknown; line?: unknown }>).detail;
    const key = getState().activeId;
    if (typeof detail?.path !== "string" || !detail.path || !key) return;
    openFileTab(key, detail.path, typeof detail.line === "number" && detail.line >= 1 ? Math.floor(detail.line) : undefined);
  });
}

const EXTRA_LANGUAGES: Record<string, string> = { rb: "ruby", kt: "kotlin", cs: "csharp", h: "c", hpp: "cpp", cc: "cpp", scss: "css", jsonc: "json", cts: "typescript" };
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
/** Past this, formatting would be too slow: plain text with a note (c3fde7009 2790). */
const MAX_FORMAT = 200_000;
const isPdf = (path: string) => /\.pdf$/i.test(path);
/** Claude previews a PDF up to 30 MB (ce05932b2). */
const MAX_PDF = 31_457_280;

/** Restarts a one-shot attribute animation on `el` (data-flash / data-landed). */
function replay(el: Element, attr: string) {
  el.removeAttribute(attr);
  void (el as HTMLElement).offsetWidth;
  el.setAttribute(attr, "");
  setTimeout(() => el.removeAttribute(attr), 1700);
}

export function FilesPane({ thread }: { thread: ThreadState }) {
  const key = thread.meta.id;
  useSyncExternalStore(subscribe, () => version);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const view = viewOf(key);
  const active = view.tabs.find((tab) => tab.path === view.active);

  // Ctrl+\ closes the shown file first (cccc2cf0a Rg "file").
  useEffect(() => {
    innerClose.set("files", () => {
      const current = viewOf(key);
      if (!current.active) return false;
      closeTabs(key, [current.active]);
      return true;
    });
    return () => void innerClose.delete("files");
  }, [key]);

  const select = (path: string) => {
    view.active = path;
    emit();
  };
  const focusTab = (path: string | null | undefined) =>
    path && requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-file-tab="${CSS.escape(path)}"]`)?.focus());
  const openMenu = (event: MouseEvent, path: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, path });
  };
  const act = (fn: (path: string) => void) => () => {
    if (menu) fn(menu.path);
    setMenu(null);
  };
  const search = useMemo(
    () =>
      async (query: string): Promise<GotoItem[]> =>
        (await call("fuzzyFileSearch", { query, roots: [cwd], cancellationToken: "files-pane" })).files
          .filter((file) => file.match_type !== "directory")
          .map((file) => ({ path: joinPath(file.root, file.path) })),
    [cwd],
  );

  const tabs = view.tabs.length > 0 && (
    <div ref={strip} className="pane-strip">
      <div className="pane-tabs" data-tip-group="700" role="tablist" aria-label="打开文件">
        {view.tabs.map((tab, index) => {
          const selected = tab.path === view.active;
          const rel = relativePath(tab.path, cwd);
          const dir = rel.includes("/") || rel.includes("\\") ? parentDir(rel) : "";
          return (
            <div
              key={tab.path}
              className="pane-tab"
              data-file=""
              data-selected={selected || undefined}
              onContextMenu={(event) => openMenu(event, tab.path)}
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event) => event.button === 1 && closeTabs(key, [tab.path])}
            >
              <button
                type="button"
                role="tab"
                className="pane-tab-label"
                data-file-tab={tab.path}
                data-tip={tab.path}
                data-tip-side="bottom"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(tab.path)}
                onDoubleClick={() => keepTab(key, tab.path)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    const next = view.tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + view.tabs.length) % view.tabs.length].path;
                    select(next);
                    focusTab(next);
                  } else if ((event.key === "Delete" || event.key === "Backspace") && !event.repeat) {
                    event.preventDefault();
                    closeTabs(key, [tab.path]);
                    focusTab(viewOf(key).active);
                  }
                }}
              >
                <span className="pane-tab-text" data-preview={tab.preview || undefined}>
                  {basename(tab.path)}
                  {dir && (
                    <span className="pane-tab-desc">
                      <span className="sr-only">, </span>
                      {dir}
                    </span>
                  )}
                  {tab.preview && <span className="sr-only">, 预览</span>}
                </span>
              </button>
              <button type="button" className="pane-tab-close" tabIndex={-1} aria-label="关闭文件" data-tip="关闭文件" data-tip-side="bottom" onClick={() => closeTabs(key, [tab.path])}>
                <Icon name="X" size="xs" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );

  const settingsMenu = () => (
    <>
      <MenuItem label="预览标签页" toggle checked={prefs.preview} onClick={() => setPrefs({ preview: !prefs.preview })} />
      <MenuSep />
      <MenuItem label="自动换行" toggle checked={prefs.wrap} onClick={() => setPrefs({ wrap: !prefs.wrap })} />
    </>
  );

  const menuTab = menu ? view.tabs.find((tab) => tab.path === menu.path) : undefined;
  const menuAt = menu ? view.tabs.findIndex((tab) => tab.path === menu.path) : -1;
  return (
    <PaneFrame
      view={key}
      pane="files"
      title={tabs || undefined}
      trailing={<GoToFile label="转到文件或搜索" placeholder="搜索文件…" search={search} onPick={(path) => openFileTab(key, path)} />}
      menu={settingsMenu}
      onKeyDown={gotoKey}
    >
      {active ? (
        isPdf(active.path) ? (
          <PdfView key={active.path} path={active.path} />
        ) : (
          <FileView key={active.path} file={active} wrap={prefs.wrap} />
        )
      ) : (
        <PaneEmpty icon={<Icon name="Folder" size="lg" />} title="打开的文件显示在这里" body="点击对话中的文件路径即可打开。" />
      )}
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={<span className="pane-menu-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />}>
        {menuTab?.preview && (
          <>
            <MenuItem label="保持打开" onClick={act((path) => keepTab(key, path))} />
            <MenuSep />
          </>
        )}
        <MenuItem label="关闭文件" onClick={act((path) => closeTabs(key, [path]))} />
        <MenuItem label="关闭其他文件" disabled={view.tabs.length < 2} onClick={act((path) => closeTabs(key, view.tabs.filter((tab) => tab.path !== path).map((tab) => tab.path)))} />
        <MenuItem
          label="关闭右侧文件"
          disabled={menuAt < 0 || menuAt === view.tabs.length - 1}
          onClick={act(() => closeTabs(key, view.tabs.slice(menuAt + 1).map((tab) => tab.path)))}
        />
        <MenuItem label="关闭所有文件" onClick={act(() => closeTabs(key, view.tabs.map((tab) => tab.path)))} />
      </Popover>
    </PaneFrame>
  );
}

function FileView({ file, wrap }: { file: OpenFile; wrap: boolean }) {
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

  if (error) return <PaneEmpty title="无法读取此文件" body={error} />;
  if (text === null)
    return (
      <div className="file-loading" role="status">
        <Spinner size={20} />
        <span className="sr-only">正在加载文件</span>
      </div>
    );
  if (text.includes("\u0000")) return <PaneEmpty title="此文件似乎是二进制数据，无法以文本形式预览" />;
  const plain = text.length > MAX_FORMAT;
  const props = { text, marks, line: file.line, nonce: file.nonce, scroller };
  return isMarkdown(file.path) && !plain ? <MarkdownDoc {...props} /> : <CodeDoc {...props} path={file.path} plain={plain} wrap={wrap} />;
}

/**
 * A PDF in the browser's own viewer (ca2ef848d j4 / M4: an iframe, contentTypeHint Pdf), its
 * bytes from the bridge's /api/pdf. A size check (HEAD) runs first: past 30 MB Claude's
 * card text (cb5bb65ab mn, no download) instead. A rewrite reloads it.
 */
function PdfView({ path }: { path: string }) {
  const [state, setState] = useState<{ size: number; rev: number } | { error: string } | null>(null);
  const src = `/api/pdf/${encodeURIComponent(basename(path))}?path=${encodeURIComponent(path)}`;

  useEffect(() => {
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      fetch(src, { method: "HEAD" }).then(
        (res) => {
          if (mine !== seq) return;
          setState(res.ok ? { size: Number(res.headers.get("content-length")), rev: mine } : { error: `${res.status} ${res.statusText}` });
        },
        (reason) => mine === seq && setState({ error: errorMessage(reason) }),
      );
    };
    load();
    const unwatch = watchFile(path, load);
    return () => {
      seq += 1;
      unwatch();
    };
  }, [path, src]);

  if (state && "error" in state) return <PaneEmpty title="无法读取此文件" body={state.error} />;
  if (!state)
    return (
      <div className="file-loading" role="status">
        <Spinner size={20} />
        <span className="sr-only">正在加载文件</span>
      </div>
    );
  if (state.size > MAX_PDF) return <PaneEmpty title={`${(state.size / 1048576).toFixed(1)} MB——过大，无法预览`} />;
  return <iframe className="file-pdf" title={basename(path)} src={`${src}&v=${state.rev}`} />;
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

function CodeDoc({ text, path, plain, wrap, marks, line, nonce, scroller }: DocProps & { path: string; plain: boolean; wrap: boolean }) {
  const name = basename(path).toLowerCase();
  const ext = name.split(".").pop() ?? "";
  const language = name === "dockerfile" ? "dockerfile" : (EXTRA_LANGUAGES[ext] ?? ext);
  const lines = useMemo(() => {
    const body = text.endsWith("\n") ? text.slice(0, -1) : text;
    const markup = plain ? null : splitHighlighted(highlight(body, language));
    let start = 0;
    return body.split("\n").map((source, index) => {
      const row = { markup: markup?.[index], source, start, end: start + source.length + 1 };
      start = row.end;
      return row;
    });
  }, [text, language, plain]);
  useJump(scroller, nonce, line, (n) => scroller.current?.querySelector(`[data-line="${n}"]`) ?? null, "data-flash");
  return (
    <div ref={scroller} className="file-code scroll-fade-y" data-wrap={wrap || undefined}>
      {plain && <p className="file-note">以纯文本显示：格式化此文件会太慢。</p>}
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
            {row.markup === undefined ? <code>{row.source || " "}</code> : <code dangerouslySetInnerHTML={{ __html: row.markup || " " }} />}
          </div>
        ))}
      </pre>
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

/**
 * "On this page" (c3fde7009 Hn): ticks in the left gutter, shown when the gutter has 4.75rem to
 * spare (CSS). Hovering them opens the outline; 显示目录 opens it from the keyboard; Escape or
 * leaving closes it.
 */
function DocRail({ scroller, column, version }: { scroller: RefObject<HTMLDivElement | null>; column: RefObject<HTMLDivElement | null>; version: string }) {
  const [heads, setHeads] = useState<{ el: HTMLElement; level: number; text: string }[]>([]);
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
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
  const jump = (head: (typeof heads)[number]) => {
    setOpen(false);
    head.el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    replay(head.el, "data-landed");
  };
  return (
    <div className="doc-rail">
      <div
        className="doc-rail-nav"
        onMouseLeave={() => setOpen(false)}
        onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }}
      >
        <nav aria-label="本页内容">
          <span className="sr-only">
            <button ref={button} type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
              显示内容
            </button>
          </span>
          <ol aria-hidden="true" className="doc-rail-ticks" style={{ "--document-rail-tick": "8px" } as CSSProperties} onMouseEnter={() => setOpen(true)}>
            {heads.map((head, index) => (
              <li key={index} data-level={head.level || undefined} data-read={index < current || undefined} data-current={index === current || undefined}>
                <span />
              </li>
            ))}
          </ol>
          <div className="doc-outline" data-open={open || undefined}>
            <ol id={listId} role="list">
              {heads.map((head, index) => (
                <li key={index} data-level={head.level || undefined} data-read={index < current || undefined} data-current={index === current || undefined}>
                  <button type="button" tabIndex={open ? 0 : -1} onClick={() => jump(head)}>
                    <span className="doc-outline-tick" />
                    <span className="doc-outline-text">{head.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </nav>
      </div>
    </div>
  );
}
