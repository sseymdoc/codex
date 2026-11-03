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
// keyboard (c3fde7009 Hn / Jn). All that is the reading page (__gb__1590565993, 设置 → 通用 → 外观
// → Markdown 阅读版式); off, Markdown is pane prose without the rail or the marks.
// Claude 4.4212 (c9bd7af9c, c0a74d72b Pi / Oi) adds 显示文件树 (FileTree.tsx) and editing a text file
// of the session's folder in place: 编辑 swaps the highlighted view for a plain editor that saves to
// disk (⌘/Ctrl+S, 自动保存 after a second idle or on leaving), refusing when the file changed on
// disk meanwhile (server/files.mjs writeSessionFile).
// shortcut: the editor is a plain textarea (no highlighting, indent guides or whitespace marks, which
// Claude's CodeMirror has); swap in an editor component if editing becomes a daily path. One chunk
// per top-level block, so reference-style link definitions only resolve inside their own block.

import { lexer } from "marked";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type RefObject } from "react";
import { call, callExperimental, environmentKind, errorMessage, readEditableText, readTextFile, watchFile } from "../lib/codex";
import { basename, joinPath, parentDir, relativePath } from "../lib/format";
import { highlight, languageFor } from "../lib/markdown";
import { innerClose, closePane, openPane } from "../lib/panes";
import { NO_MARKS, docLevels, nextMarks, overlaps, splitHighlighted, withTab, type FileTab, type Marks } from "../lib/preview";
import { getState, readPref, toast, useStore, writePref, type ThreadState } from "../lib/store";
import { Markdown } from "./content";
import { FileTree } from "./FileTree";
import { Edge, GoToFile, PaneEmpty, PaneFrame, gotoKey, type GotoItem } from "./Panes";
import { Button, Icon, MenuItem, MenuSep, Popover, Spinner, Submenu, useReducedMotion } from "./ui";

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

/** 预览标签页 and 自动换行 from the pane's menu (jC), both on by default (cccc2cf0a RE: epitaxy-files-word-wrap). */
const prefs = {
  preview: readPref("codex-ui:files-preview-tabs", ["on", "off"], "on") === "on",
  wrap: readPref("codex-ui:files-wrap", ["on", "off"], "on") === "on",
  // c9bd7af9c / cd2efac6e Dl / od / VO: the tree off, 自动保存 and Tab 键缩进 on, tabs 4 wide.
  tree: readPref("codex-ui:files-tree", ["on", "off"], "off") === "on",
  autoSave: readPref("codex-ui:files-auto-save", ["on", "off"], "on") === "on",
  tabIndent: readPref("codex-ui:files-tab-indent", ["on", "off"], "on") === "on",
  tabSize: Number(readPref("codex-ui:files-tab-size", ["2", "4", "8"], "4")),
};
const PREF_KEYS = { preview: "codex-ui:files-preview-tabs", wrap: "codex-ui:files-wrap", tree: "codex-ui:files-tree", autoSave: "codex-ui:files-auto-save", tabIndent: "codex-ui:files-tab-indent", tabSize: "codex-ui:files-tab-size" } as const;

function setPrefs(patch: Partial<typeof prefs>) {
  Object.assign(prefs, patch);
  // Only the ones changed, so the others keep following their defaults.
  for (const [key, value] of Object.entries(patch) as [keyof typeof prefs, boolean | number][]) writePref(PREF_KEYS[key], typeof value === "number" ? String(value) : value ? "on" : "off");
  emit();
}

/** 在文件树中显示: the tree opens on the file's folder. */
let revealInTree: { path: string; nonce: number } | null = null;

export function openFileTab(key: string, path: string, line?: number) {
  const view = viewOf(key);
  view.tabs = withTab(view.tabs, { path, preview: prefs.preview, line, nonce: ++nonce });
  view.active = path;
  openPane("files", key);
  emit();
}

export const fileTargets = (key: string) => (views.get(key)?.tabs ?? []).map(tab => ({ id: tab.path, label: basename(tab.path) }));

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

const LOADING = (
  <div className="file-loading">
    <Spinner size={20} label="正在加载文件" />
  </div>
);
const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
/** Past this, formatting would be too slow: plain text with a note (c3fde7009 2790); CodeDoc's `plain`. */
export const MAX_FORMAT = 200_000;
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

  const settingsMenu = (close: () => void) => (
    <>
      <MenuItem label="显示文件树" toggle checked={prefs.tree} onClick={() => setPrefs({ tree: !prefs.tree })} />
      <MenuItem label="预览标签页" toggle checked={prefs.preview} onClick={() => setPrefs({ preview: !prefs.preview })} />
      <MenuSep />
      <MenuItem label="自动换行" toggle checked={prefs.wrap} onClick={() => setPrefs({ wrap: !prefs.wrap })} />
      <MenuItem label="自动保存" toggle checked={prefs.autoSave} onClick={() => setPrefs({ autoSave: !prefs.autoSave })} />
      <MenuItem label="Tab 键缩进" toggle checked={prefs.tabIndent} onClick={() => setPrefs({ tabIndent: !prefs.tabIndent })} />
      <Submenu label="制表符宽度" value={String(prefs.tabSize)}>
        {[2, 4, 8].map((size) => (
          <MenuItem key={size} label={String(size)} checked={prefs.tabSize === size} onClick={() => { close(); setPrefs({ tabSize: size }); }} />
        ))}
      </Submenu>
    </>
  );
  const [treeWidth, setTreeWidth] = useState(() => Number(readPref("codex-ui:files-tree-width", ["180", "220", "260", "300", "340"], "220")));
  const treeEl = useRef<HTMLDivElement>(null);
  const treeStart = useRef(0);
  const editable = environmentKind(key) !== "ssh";

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
      <div className="files-pane-main">
        {prefs.tree && (
          <>
            <div ref={treeEl} className="files-pane-tree" style={{ width: treeWidth }}>
              <FileTree cwd={cwd} reveal={revealInTree} onOpen={(path, line) => openFileTab(key, path, line)} />
            </div>
            <Edge
              orientation="vertical"
              label="调整文件树大小"
              onStart={() => (treeStart.current = treeEl.current?.offsetWidth ?? treeWidth)}
              onMove={(delta, done) => {
                const width = Math.round(Math.min(Math.max(treeStart.current + delta, 140), 480));
                if (treeEl.current) treeEl.current.style.width = `${width}px`;
                if (done) setTreeWidth(width);
              }}
              onReset={() => setTreeWidth(220)}
            />
          </>
        )}
        <div className="files-pane-view">
          {active ? (
            isPdf(active.path) ? (
              <PdfView key={active.path} path={active.path} />
            ) : (
              <FileView key={active.path} file={active} wrap={prefs.wrap} cwd={editable ? cwd : null} />
            )
          ) : (
            <PaneEmpty icon={<Icon name="Folder" size="lg" />} title="打开的文件显示在这里" body={prefs.tree ? "在文件树中选择文件，或点击对话中的文件路径。" : "点击对话中的文件路径即可打开。"} />
          )}
        </div>
      </div>
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={<span className="pane-menu-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />}>
        {menuTab?.preview && (
          <>
            <MenuItem label="保持打开" onClick={act((path) => keepTab(key, path))} />
            <MenuSep />
          </>
        )}
        <MenuItem
          label="在文件树中显示"
          onClick={act((path) => {
            revealInTree = { path, nonce: (revealInTree?.nonce ?? 0) + 1 };
            setPrefs({ tree: true });
          })}
        />
        <MenuSep />
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

function FileView({ file, wrap, cwd }: { file: OpenFile; wrap: boolean; cwd: string | null }) {
  const [text, setText] = useState<string | null>(null);
  // The editor's starting text, read afresh byte for byte when 编辑 is pressed.
  const [editing, setEditing] = useState<string | null>(null);
  const editingRef = useRef(false);
  editingRef.current = editing !== null;
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
          // While editing, the editor keeps its text; a save that finds the file changed says so.
          if (mine !== seq || editingRef.current) return;
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
  if (text === null) return LOADING;
  if (text.includes("\u0000")) return <PaneEmpty title="此文件似乎是二进制数据，无法以文本形式预览" />;
  const plain = text.length > MAX_FORMAT;
  const props = { text, marks, line: file.line, nonce: file.nonce, scroller };
  // Editable: a file of the session's own (local) folder, small enough to format.
  const inside = cwd !== null && relativePath(file.path, cwd) !== file.path;
  if (editing !== null && cwd) return <CodeEditor path={file.path} cwd={cwd} initial={editing} wrap={wrap} onDone={(saved) => { if (saved !== undefined) setText(saved); setEditing(null); }} />;
  const view = isMarkdown(file.path) && !plain ? <MarkdownDoc {...props} /> : <CodeDoc {...props} path={file.path} plain={plain} wrap={wrap} />;
  if (!inside || plain) return view;
  return (
    <div className="file-editable">
      {view}
      <Button variant="secondary" size="sm" className="file-edit-key" icon={<Icon name="Edit" size={14} />} onClick={() => void readEditableText(file.path).then((exact) => (exact === null ? toast("warning", "此文件不是 UTF-8 文本，无法在此编辑。") : setEditing(exact)), (error) => toast("warning", "无法打开文件进行编辑", errorMessage(error)))}>
        编辑
      </Button>
    </div>
  );
}

const hashText = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * The file in a plain editor (c0a74d72b Pi): Tab indents (Esc, then Tab, leaves), ⌘/Ctrl+S saves,
 * 自动保存 saves a second after typing stops; leaving saves either way. A save against a file changed on disk
 * meanwhile is refused (+0+47o3Ngm) and the edits stay here.
 */
function CodeEditor({ path, cwd, initial, wrap, onDone }: { path: string; cwd: string; initial: string; wrap: boolean; onDone(saved?: string): void }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"saved" | "dirty" | "saving" | "conflict">("saved");
  const base = useRef(initial);
  const latest = useRef(text);
  latest.current = text;
  const escaped = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useSyncExternalStore(subscribe, () => version);

  // The textarea reads CRLF back as LF; a CRLF file is saved with its own line endings.
  const crlf = initial.includes("\r\n");
  // One write at a time: a second ⌘S waits for the first and then compares with what it saved.
  const queue = useRef(Promise.resolve(true));
  const save = (): Promise<boolean> => (queue.current = queue.current.then(write, write));
  const write = async (): Promise<boolean> => {
    const typed = latest.current;
    const value = crlf ? typed.replace(/\r?\n/g, "\r\n") : typed;
    if (value === base.current) return true;
    setStatus("saving");
    try {
      const result = await callExperimental<{ conflict: boolean }>("codexUi/files/write", { cwd, path, text: value, expected: await hashText(base.current) });
      if (result.conflict) {
        setStatus("conflict");
        toast("warning", `您对“${basename(path)}”的更改未保存，因为该文件已在磁盘上更改。请重新打开文件查看最新版本。`);
        return false;
      }
      base.current = value;
      setStatus(latest.current === typed ? "saved" : "dirty");
      return true;
    } catch (error) {
      setStatus("dirty");
      toast("warning", "无法保存文件", errorMessage(error));
      return false;
    }
  };
  // 自动保存: a second after the last change.
  useEffect(() => {
    if (!prefs.autoSave || status !== "dirty") return;
    const timer = setTimeout(() => void save(), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save reads the latest text
  }, [text, status]);
  // Leaving with edits saves them (the tab closed, another file shown), 自动保存 or not: no edit is dropped unasked.
  useEffect(() => () => void save(), []);
  useEffect(() => area.current?.focus(), []);

  const label = status === "saving" ? "正在保存…" : status === "conflict" ? "文件已在磁盘上更改" : status === "dirty" ? "未保存的更改" : "已保存";
  return (
    <div className="file-editor">
      <div className="file-editor-bar">
        <span className="file-editor-status" data-status={status} role="status">
          {label}
        </span>
        {status === "conflict" && (
          <Button variant="ghost" size="sm" onClick={() => onDone()}>
            放弃更改
          </Button>
        )}
        {!prefs.autoSave && status === "dirty" && (
          <Button variant="secondary" size="sm" onClick={() => void save()}>
            保存
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => void save().then((ok) => ok && onDone(latest.current))}>
          完成
        </Button>
      </div>
      <textarea
        ref={area}
        className="file-editor-input"
        data-wrap={wrap || undefined}
        style={{ tabSize: prefs.tabSize }}
        spellCheck={false}
        value={text}
        aria-label={`编辑 ${basename(path)}`}
        onChange={(event) => {
          setText(event.target.value);
          if (status !== "conflict") setStatus("dirty");
        }}
        onBlur={() => prefs.autoSave && status === "dirty" && void save()}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            escaped.current = true;
          } else if (event.key === "Tab" && prefs.tabIndent && !escaped.current && !event.shiftKey) {
            event.preventDefault();
            // execCommand keeps the native undo history.
            document.execCommand("insertText", false, "\t");
          } else escaped.current = false;
        }}
      />
    </div>
  );
}

/** The 资料库 previews a PDF up to 40 MiB (library-cloud-file-preview aa). */
const MAX_LIBRARY_PDF = 41_943_040;

/**
 * A PDF in the browser's own viewer (ca2ef848d j4 / M4: an iframe, contentTypeHint Pdf), its
 * bytes from the bridge's /api/pdf. A size check (HEAD) runs first: past 30 MB Claude's
 * card text (cb5bb65ab mn, no download) instead. A rewrite reloads it. Given `src` (a 资料库
 * file's /api/library/content), its `size` is the file's own (file_size_bytes: the library's
 * answers carry no Content-Length), checked against 40 MiB, with no HEAD and nothing to watch.
 */
export function PdfView({ path = "", src: library, name, size = 0 }: { path: string; src?: undefined; name?: undefined; size?: undefined } | { path?: undefined; src: string; name: string; size: number }) {
  const [checked, setState] = useState<{ size: number; rev: number } | { error: string } | null>(null);
  const state = library ? { size, rev: 0 } : checked;
  const src = library ?? `/api/pdf/${encodeURIComponent(basename(path))}?path=${encodeURIComponent(path)}`;

  useEffect(() => {
    if (library) return;
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
  }, [path, src, library]);

  if (state && "error" in state) return <PaneEmpty title="无法读取此文件" body={state.error} />;
  if (!state) return LOADING;
  if (state.size > (library ? MAX_LIBRARY_PDF : MAX_PDF)) return <PaneEmpty title={`${(state.size / 1048576).toFixed(1)} MB——过大，无法预览`} />;
  return <iframe className="file-pdf" title={name ?? basename(path)} src={`${src}&v=${state.rev}`} />;
}

/** A document's text, its change marks (NO_MARKS: none), the line to land on once per `nonce`, and its scroller. */
export interface DocProps {
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

/** Highlighted code with line numbers, its language by `path`'s name; `plain` past MAX_FORMAT (with its note). */
export function CodeDoc({ text, path, plain, wrap, marks, line, nonce, scroller }: DocProps & { path: string; plain: boolean; wrap: boolean }) {
  const language = languageFor(path);
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

/** Markdown a block at a time; `localLinks` off for a file from elsewhere (Markdown's: paths stay text). */
export function MarkdownDoc({ text, marks, line, nonce, scroller, localLinks = true }: DocProps & { localLinks?: boolean }) {
  const page = useStore((s) => s.claudeFlags.documentPage);
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
  // Markdown 阅读版式 off (__gb__1590565993): cccc2cf0a's "pane" presentation, Ua with typography
  // epitaxy (c3fde7009: no rail, no change marks), a chunk per block as its progressive path draws.
  if (!page)
    return (
      <div ref={scroller} className="file-prose-pane">
        <div ref={column} className="file-prose-column">
          {chunks.map((chunk, index) =>
            chunk.space ? null : (
              <div key={index} className="file-prose-chunk" data-chunk={index}>
                <Markdown text={chunk.raw} className="epitaxy file-prose" localLinks={localLinks} />
              </div>
            ),
          )}
        </div>
      </div>
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
              <Markdown text={chunk.raw} localLinks={localLinks} />
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
