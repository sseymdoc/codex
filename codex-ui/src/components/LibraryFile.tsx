// The 资料库's file panel: the ChatGPT app's library preview (library-file-route q / J in the
// library page's RightPanelOutlet, library-cloud-file-preview ha and its renderers) as a pane
// beside the list (the session's pane chrome; Claude's ?open= split), alone at narrow widths.
// The head names the file, with 收藏, 下载, 更多操作 (文件信息, 版本历史记录, 在系统应用中打开,
// 删除 where the desktop app enables it) and 关闭; Esc closes it once no menu, dialog or image is
// up. Each file kind gets its renderer once its size passes (previewBlock: unknown → the fallback
// card, past 40 MiB → 文件过大，无法预览): images, PDFs, text and code, Markdown (never this
// machine's files: localLinks off), HTML (its source, then a sandboxed frame), sheets (SheetJS),
// Word (docx-preview), slides (their XML, through jszip) and notebooks. Office files are zips,
// inflated and counted first (unzipWithin). Every library-loaded package comes by import().
// A note opens in its editor (Markdown source and 预览, saved as it is typed), a new one from
// 新建 → 笔记 too, before it has a file; a flashcard set as the library's card grid; a deep
// research report as Markdown. Under the file, 询问此文件 starts a new session's draft with it.

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import type JSZip from "jszip";
import { openLibrary } from "../lib/codex";
import { fileSize } from "../lib/files";
import { downloadLibraryFiles, extensionOf, itemActions, libraryContentUrl, libraryPrefs, loadPath, markLibraryFileOpened, setLibraryFavorite, useFavoriteStatus, useLibrary, type LibraryNode } from "../lib/library";
import {
  downloadFlashcardsCsv,
  fetchDeepResearch,
  fetchFlashcardProgress,
  fetchFlashcards,
  fetchFlashcardsMeta,
  fetchLibraryBytes,
  fetchLibraryFileInfo,
  fetchLibraryNode,
  fetchLibraryText,
  fetchLibraryVersions,
  fetchNoteText,
  fileTypeLabel,
  flashcardQueue,
  flashcardSideTooLong,
  flashcardView,
  FLASHCARD_SIDE_MAX,
  FLASHCARDS_MAX,
  libraryReadOnly,
  libraryRenderer,
  noteSessionOf,
  openLibraryFileInApp,
  openNote,
  previewActions,
  previewBlock,
  restoreLibraryVersion,
  storedZip,
  unzipWithin,
  versionAction,
  versionAuthor,
  versionDays,
  versionNode,
  type Flashcard,
  type LibraryVersion,
  type NoteSession,
} from "../lib/library-preview";
import { askRefusal, attachable, startChatWithLibraryFiles } from "../lib/library-chat";
import { highlight } from "../lib/markdown";
import { NO_MARKS } from "../lib/preview";
import { CloudError } from "../lib/cloud";
import { actionToast, getState, setState, toast, useStore } from "../lib/store";
import { Markdown } from "./content";
import { copied, fileMenuShown } from "./FileMenu";
import { CodeDoc, MarkdownDoc, MAX_FORMAT, PdfView } from "./FilePreview";
import { ConfirmItemsDialog } from "./LibraryDialogs";
import { openLightbox } from "./Lightbox";
import { useLiftSlot } from "./Main";
import { PaneEmpty } from "./Panes";
import { Button, fileGlyph, Icon, MenuItem, MenuSep, Popover, Segmented, Spinner, type IconName } from "./ui";

/** What the panel asks of a renderer that makes its own file: 下载文件 (a flashcard set's CSV, preview Oe). */
export interface PanelHold {
  download?(): void;
}

/** What a renderer gets: the file shown (a picked version as versionNode makes it), and the panel's own. */
export interface PreviewProps {
  file: LibraryNode;
  /** The file as it is now (the current version). */
  node: LibraryNode;
  /** The version picked in 版本历史记录, null for the current one (libraryReadOnly takes it). */
  version: LibraryVersion | null;
  hold: MutableRefObject<PanelHold>;
  /** The renderer wrote a new version (a flashcard set's save): 版本历史记录 reads anew (onSaved's refetch). */
  onChanged(): void;
}

const NO_SUBSCRIBE = () => () => {};

/** The fallback card's 下载文件 and 在系统应用中打开, for the file shown. */
const Acts = createContext<{ download?(): void; openInApp?(): void }>({});

const LOADING = (
  <div className="file-loading">
    <Spinner size={20} label="正在加载预览…" />
  </div>
);

/**
 * `load`'s answer for `key` (null: nothing to load), its failure, and 重试; a newer key's answer
 * wins. `signal` aborts once the answer is no longer wanted (a long read may stop there).
 */
function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): { value: T | undefined; error: unknown; failed: boolean; retry(): void } {
  const [held, setHeld] = useState<{ key: string | null; attempt: number; value?: T; error?: unknown; failed?: boolean }>({ key, attempt: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (key === null) return;
    const gone = new AbortController();
    load(gone.signal).then(
      (value) => !gone.signal.aborted && setHeld({ key, attempt, value }),
      (error: unknown) => !gone.signal.aborted && setHeld({ key, attempt, error, failed: true }),
    );
    return () => gone.abort();
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = held.key === key && held.attempt === attempt ? held : null;
  return { value: now?.value, error: now?.error, failed: !!now?.failed, retry: () => setAttempt(attempt + 1) };
}

const glyphOf = (file: LibraryNode): IconName => (file.category === "image" || file.mime?.startsWith("image/") ? "Image" : fileGlyph(file.name));

/**
 * The panel for `id`: the list's node when it has it (`known`), else read by id (…/node, as
 * 在资料库中打开 gives only an id); or for `note`, 新建 → 笔记's new note, which has no file until
 * its first save with text makes one (`onCreated` then puts it in the route). A note's session
 * (its text and autosave) is held here while the panel is up, so a picked version or a restore
 * keeps it; closing saves first and stays open when that fails (ne2). It takes focus as it
 * opens, a new note's editor instead; `onClose` hands it back. The list's node is kept while
 * the list reads anew (a new search or filter), so the panel neither reads /node nor redraws.
 */
export function LibraryFile({ id, note, known, onClose, onCreated }: { id?: string; note?: string; known?: LibraryNode; onClose(): void; onCreated?(id: string): void }) {
  // Looked up as the panel renders, while a panel just let go still holds it: a note's last save
  // under way (or failed) is this session's, never a new one over the text read meanwhile.
  const [routed] = useState(() => noteSessionOf(note ?? id ?? ""));
  const isNew = !!note && routed !== null;
  const [last, setLast] = useState(known);
  useEffect(() => {
    if (known) setLast(known);
  }, [known]);
  const listNode = known ?? last;
  const read = useLoad(listNode || routed || note || !id ? null : id, () => fetchLibraryNode(id!));
  // A restore's answer is the file as it now is, ahead of the list reading it anew; once the list
  // carries the restored file id (its items have no version number), the list's node is the file
  // again, so a later rename or move there shows.
  const [restored, setRestored] = useState<LibraryNode | null>(null);
  const caughtUp = !!restored && listNode?.fileId === restored.fileId;
  useEffect(() => {
    if (caughtUp) setRestored(null);
  }, [caughtUp]);
  const [opened, setOpened] = useState<NoteSession | null>(null);
  const session = routed ?? opened;
  const noted = useSyncExternalStore(session?.subscribe ?? NO_SUBSCRIBE, () => session?.state ?? null);
  const node = (caughtUp ? null : restored) ?? listNode ?? read.value ?? noted?.file ?? null;
  const isNote = !!routed || (node !== null && libraryRenderer(node) === "note");
  // An existing note's text as the library holds it now (content_url: Wt), then its session.
  const text = useLoad(isNote && !routed && node ? `note:${node.id}` : null, () => fetchNoteText(node!));
  useEffect(() => {
    const held = routed ?? (text.value !== undefined && node ? openNote(node, text.value) : null);
    if (!held) return;
    setOpened(held);
    return held.attach();
  }, [routed, text.value]); // eslint-disable-line react-hooks/exhaustive-deps
  // Renamed in the list beside it: the note saves under the new name.
  useEffect(() => {
    if (known && session) session.adopt(known);
  }, [known?.name, session]); // eslint-disable-line react-hooks/exhaustive-deps
  const created = isNew ? noted?.file?.id : undefined;
  useEffect(() => {
    if (created) onCreated?.(created);
  }, [created]); // eslint-disable-line react-hooks/exhaustive-deps
  const [side, setSide] = useState<"info" | "versions" | null>(null);
  // 版本历史记录 over a narrow panel steps aside once a version is picked (artifact-accessories W:
  // phase "preview"), the version still shown; 更多操作 → 版本历史记录 brings the list back.
  const [aside, setAside] = useState(false);
  const [version, setVersion] = useState<LibraryVersion | null>(null);
  const [listed, setListed] = useState<readonly LibraryVersion[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [rev, setRev] = useState(0);
  const [changes, setChanges] = useState(0);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const hold = useRef<PanelHold>({});
  const marked = useRef(false);
  const latest = useRef(onClose);
  latest.current = async () => {
    if (session && !(await session.close())) return;
    onClose();
  };
  // Alone in a narrow page, the head clears the collapsed sidebar's trigger as the list's titlebar does.
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();

  useEffect(() => {
    if (!isNew) panel.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!node || marked.current) return;
    marked.current = true;
    markLibraryFileOpened(node);
  }, [node]);
  // ha's Esc (capture, past a composition): menus, dialogs and the lightbox take it first; away
  // from the panel, a field keeps it and so does the page's selection.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector(".popover, .dialog-backdrop:not([inert])") || getState().lightbox || fileMenuShown()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !panel.current?.contains(target)) {
        if (target?.closest("input, select, textarea, [contenteditable]:not([contenteditable='false'])")) return;
        if (document.querySelector(".library-selection")) return;
      }
      event.preventDefault();
      void latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const close = () => void latest.current();
  const head = (title: ReactNode, actions?: ReactNode) => (
    <div className="pane-head library-panel-head" data-tip-group="" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <div className="pane-title">{title}</div>
      <div className="pane-actions">
        {actions}
        <Button variant="ghost" icon={<Icon name="X" size={18} />} label="关闭预览" tipSide="bottom" onClick={close} />
      </div>
    </div>
  );
  const frame = (name: string, children: ReactNode) => (
    <div className="pane-column library-panel-column">
      <section ref={panel} className="pane library-panel" aria-label={name} tabIndex={-1}>
        {children}
      </section>
    </div>
  );

  if (!node && !routed) {
    const status = read.error instanceof CloudError ? read.error.status : 0;
    // A new note's key names nothing on this account (another one signed in since): nothing to open.
    const failed = read.failed || !!note;
    return frame(
      "文件预览",
      <>
        {head(null)}
        {failed ? (
          <PaneEmpty icon={<Icon name="File" size="lg" />} title="无法打开此文件">
            {read.failed && status !== 403 && status !== 404 && (
              <Button variant="secondary" size="sm" onClick={read.retry}>
                重试
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={close}>
              关闭预览
            </Button>
          </PaneEmpty>
        ) : (
          LOADING
        )}
      </>,
    );
  }

  const file = node && version ? versionNode(node, version) : node;
  const renderer = isNote ? "note" : libraryRenderer(node!);
  const actions = node ? previewActions(node, renderer) : null;
  const shown = file ? previewActions(file, version ? libraryRenderer(file) : renderer) : null;
  const current = listed.find((item) => item.current) ?? null;
  // A note's own text is read by its id (its file id is the version the list last saw).
  const target = file && isNote && !version ? { ...file, fileId: null } : file;
  /** The note saved first (下载, 在系统应用中打开, 版本历史记录, 删除): false, it could not be. */
  const flush = async () => !session || (await session.flush());
  const download = async () => {
    if (renderer === "flashcards") return hold.current.download?.();
    if (target && (await flush())) downloadLibraryFiles([target]);
  };
  const openInApp = async () => {
    if (!target || !(await flush())) return;
    const outcome = await openLibraryFileInApp(target);
    if (outcome === "refused") actionToast("无法在系统应用中打开此文件，请改为下载", { label: "下载", run: () => downloadLibraryFiles([target]) }, "warning");
    else if (outcome === "failed") toast("danger", "无法准备此文件");
  };
  const openSide = async (next: "info" | "versions") => {
    setMenu(false);
    if (next === "versions" && !(await flush())) return;
    setSide(next);
    setAside(false);
  };
  const closeSide = () => {
    setSide(null);
    setAside(false);
    setVersion(null);
  };
  const restore = async () => {
    if (!node || !version || !current || restoring) return;
    setRestoring(true);
    const next = await restoreLibraryVersion(node, version, current);
    setRestoring(false);
    if (!next) return;
    // The answer is the file's record; fields it may leave out keep what the panel had.
    const now = { ...node, fileId: next.fileId ?? node.fileId, name: next.name || node.name, mime: next.mime ?? node.mime, size: next.size ?? node.size, category: next.category ?? node.category, version: next.version, updatedAt: next.updatedAt ?? node.updatedAt };
    setRestored(now);
    setVersion(null);
    setRev(rev + 1);
    // The note's text, read anew (sn's k2): editing waits until it comes.
    if (session) void session.reload(now);
  };
  const favorite = node && itemActions(node, false).favorite && node.own;
  const title = session && !version ? noted!.fileName : file!.name;

  return frame(
    title,
    <Acts.Provider value={{ download: shown?.download ? () => void download() : undefined, openInApp: shown?.openInApp ? () => void openInApp() : undefined }}>
      {head(
        <>
          <span className="pane-name library-panel-name" title={title}>
            {title}
          </span>
          {version && <span className="library-panel-version">版本 {version.number}</span>}
          {/* libraryNext.note.save.pending: an icon with its words in a tip and to a reader. */}
          {session && noted!.saving && !noted!.failure && (
            <span className="library-panel-status" data-tip="正在保存…">
              <Spinner size={12} label="正在保存…" />
            </span>
          )}
        </>,
        node && (
          <>
            {version && (
              <Button variant="secondary" size="sm" disabled={restoring || !current} onClick={() => void restore()}>
                {restoring && <Spinner size={12} inherit />}
                恢复此版本
              </Button>
            )}
            {favorite && <FavoriteButton node={node} />}
            {(shown?.download || renderer === "flashcards") && <Button variant="ghost" icon={<Icon name="Download" size={18} />} label="下载文件" tipSide="bottom" onClick={() => void download()} />}
            <Popover
              open={menu}
              onClose={() => setMenu(false)}
              placement="bottom-end"
              anchor={<Button variant="ghost" icon={<Icon name="DotsHorizontal" size={18} />} label="更多操作" tipSide="bottom" active={menu} onClick={() => setMenu(!menu)} />}
            >
              <MenuItem label="文件信息" onClick={() => void openSide("info")} />
              {actions!.versionHistory && <MenuItem label="版本历史记录" onClick={() => void openSide("versions")} />}
              {shown!.openInApp && (
                <MenuItem
                  label="在系统应用中打开"
                  onClick={() => {
                    setMenu(false);
                    void openInApp();
                  }}
                />
              )}
              {actions!.delete && (
                <>
                  <MenuSep />
                  <MenuItem
                    label="删除"
                    danger
                    onClick={() => {
                      setMenu(false);
                      void flush().then((saved) => saved && setDeleting(true));
                    }}
                  />
                </>
              )}
            </Popover>
          </>
        ),
      )}
      <div className="library-panel-main">
        <div className="pane-body library-panel-body">
          {session && !version ? (
            // The editor stays read-only while the versions are up or a restore runs (Xt's xe2).
            <NoteEditor session={session} locked={side === "versions" || restoring} autoFocus={isNew} />
          ) : isNote && !version ? (
            text.failed ? (
              <div className="library-fallback">
                <Button variant="secondary" onClick={text.retry}>
                  重新加载笔记
                </Button>
              </div>
            ) : (
              LOADING
            )
          ) : (
            // A flashcard set's grid is keyed by the version alone: its saves bring the list a new file id.
            <Preview
              key={renderer === "flashcards" ? `cards:${version?.number ?? ""}:${rev}` : `${file!.fileId}:${file!.version}:${rev}`}
              file={file!}
              node={node!}
              version={version}
              hold={hold}
              onChanged={() => setChanges((count) => count + 1)}
            />
          )}
        </div>
        {node && side === "info" && <FileInfo key={rev} node={node} onClose={closeSide} />}
        {node && side === "versions" && (
          <Versions
            key={`${rev}:${changes}`}
            node={node}
            picked={version}
            hidden={aside}
            onPick={(item, over) => {
              setVersion(item);
              if (over) setAside(true);
            }}
            onItems={setListed}
            onClose={closeSide}
          />
        )}
      </div>
      {/* ha's bottomContent: not while 版本历史记录 is up (Ct2). */}
      {node && side !== "versions" && attachable(node) && <AskFile key={node.id} node={node} />}
      {node && deleting && <ConfirmItemsDialog nodes={[node]} action="delete" onDone={(ids) => ids.includes(node.id) && onClose()} onClose={() => setDeleting(false)} />}
    </Acts.Provider>,
  );
}

/**
 * 询问此文件 (library-cloud-file-preview Ea, as a local chat has it): the session composer's card
 * on one line under the file. Where the desktop app sends the question at once, it opens a new
 * session's draft with the file attached and the words in, for you to send. A file of no known
 * size or past 40 MiB keeps it from asking, saying why (libraryFilePreview.localFileSizeLimit).
 */
function AskFile({ node }: { node: LibraryNode }) {
  const [text, setText] = useState("");
  const refused = askRefusal(node);
  const ask = () => {
    const words = text.trim();
    if (refused || !words) return;
    void startChatWithLibraryFiles([node], words).then((outcome) => outcome === "unavailable" && toast("danger", "无法使用这些项目开始聊天"));
  };
  return (
    <div className="library-ask composer-wrap">
      {/* Ea's aboveComposerContent: a polite warning banner, as the library page draws one. */}
      {refused && (
        <div className="library-notice library-ask-note" role="status" aria-live="polite">
          <Icon name="Warning" size="sm" className="library-notice-icon" />
          <p className="library-notice-text">{refused}</p>
        </div>
      )}
      <div className="composer">
        <div className="composer-body">
          <div className="composer-editor">
            <textarea
              className="composer-input"
              rows={1}
              value={text}
              placeholder="询问此文件"
              aria-label="询问此文件"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                ask();
              }}
            />
          </div>
          <div className="composer-trailing">
            <Button variant="ghost" icon={<Icon name="ArrowReturn" />} label="开始聊天" disabled={!!refused || !text.trim()} onClick={ask} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** vSs: 添加到收藏夹 / 从收藏夹中移除 once the file's status is known. */
function FavoriteButton({ node }: { node: LibraryNode }) {
  const status = useFavoriteStatus(node);
  const busy = useLibrary((s) => !!s.busy[node.id]);
  const gate = useLibrary((s) => !!s.available?.favorites);
  if (!gate) return null;
  const on = !!status?.favoriteId;
  return (
    <Button
      variant="ghost"
      icon={<Icon name={on ? "StarFilled" : "Star"} size={18} />}
      label={on ? "从收藏夹中移除" : "添加到收藏夹"}
      tipSide="bottom"
      aria-pressed={on}
      disabled={!status || status.unavailable || busy}
      onClick={() => void setLibraryFavorite(node, !on)}
    />
  );
}

// ---------------------------------------------------------------------------
// Which renderer (library-cloud-file-preview Ji), behind the size check

function Preview(props: PreviewProps) {
  const { file } = props;
  const renderer = libraryRenderer(file);
  const block = previewBlock(file, renderer);
  if (block === "tooLarge") return <TooLarge file={file} />;
  if (block === "unknown") return <Fallback file={file} />;
  switch (renderer) {
    case "image":
      return <ImagePreview file={file} />;
    case "pdf":
      return <PdfView src={libraryContentUrl(file, "content")} name={file.name} size={file.size ?? 0} />;
    case "text":
    case "markdown":
      return <TextPreview file={file} markdown={renderer === "markdown"} />;
    case "html":
      return <HtmlPreview file={file} />;
    case "csv":
    case "tsv":
    case "xlsx":
      return <SheetPreview file={file} kind={renderer} />;
    case "docx":
      return <DocxPreview file={file} />;
    case "pptx":
      return <SlidesPreview file={file} />;
    case "ipynb":
      return <NotebookPreview file={file} />;
    // The panel draws a note's current text in its editor; an old version is read-only Markdown.
    case "note":
      return <TextPreview file={file} markdown />;
    case "flashcards":
      return <FlashcardsPreview {...props} />;
    case "deep-research":
      return <DeepResearchPreview file={file} />;
    default:
      return <Fallback file={file} />;
  }
}

/**
 * library-file-preview-fallback l: the 64px icon box, the name, 无法预览 (or `title`), what can
 * still be done, and 下载文件 / 在系统应用中打开 (or 重试预览 after a failure).
 */
function Fallback({ file, title = "无法预览", description, retry }: { file: LibraryNode; title?: string; description?: string; retry?(): void }) {
  const acts = useContext(Acts);
  const said = description ?? (acts.download ? (acts.openInApp ? "此文件类型可下载，或在系统应用中打开" : "此文件类型可下载") : "此类文件无法下载");
  return (
    <div className="library-fallback">
      <div className="library-fallback-card">
        <span className="library-fallback-icon">
          <Icon name={glyphOf(file)} size={32} />
        </span>
        <div className="library-fallback-text">
          <p className="library-fallback-name">{file.name}</p>
          <p className="library-fallback-note">{title}</p>
          <p className="library-fallback-note">{said}</p>
        </div>
        <div className="library-fallback-actions">
          {retry && (
            <Button variant="secondary" onClick={retry}>
              重试预览
            </Button>
          )}
          {acts.download && (
            <Button variant="secondary" onClick={acts.download}>
              下载文件
            </Button>
          )}
          {acts.openInApp && (
            <Button variant="secondary" onClick={acts.openInApp}>
              在系统应用中打开
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Past 40 MiB, or inflating past 200 MiB (libraryFilePreview.tooLargeTitle, its description in codex-ui's words). */
function TooLarge({ file }: { file: LibraryNode }) {
  const acts = useContext(Acts);
  return <Fallback file={file} title="文件过大，无法预览" description={acts.openInApp ? "你仍可下载此文件，或在系统应用中打开" : "你仍可下载此文件"} />;
}

/** A renderer that could not read or draw its file (libraryArtifactPreview.error). */
const Failed = ({ file, retry }: { file: LibraryNode; retry(): void }) => <Fallback file={file} title="无法显示预览" description="" retry={retry} />;

// ---------------------------------------------------------------------------
// Images, text, HTML

/**
 * The desktop app's image (p-6 > img.max-h-full.max-w-full.rounded-lg.object-contain.shadow-lg);
 * a click on it (or Enter / Space on the button round it, its ring drawn on the image) opens the
 * lightbox.
 */
function ImagePreview({ file }: { file: LibraryNode }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = libraryContentUrl(file, "content");
  if (failed)
    return (
      <Failed
        file={file}
        retry={() => {
          setFailed(false);
          setAttempt(attempt + 1);
        }}
      />
    );
  return (
    <div className="library-image">
      <button
        type="button"
        className="library-image-open"
        onClick={(event) => {
          const image = event.currentTarget.querySelector("img");
          if (event.detail !== 0 && event.target !== image) return;
          openLightbox(src, image, [{ src, origin: image, name: file.name }]);
        }}
      >
        <img key={attempt} src={src} alt={file.name} draggable={false} onError={() => setFailed(true)} />
      </button>
    </div>
  );
}

/** Text and code (CodeDoc, highlighted by the name), or Markdown (MarkdownDoc with this machine's paths as text); cut at 5e6 characters. */
function TextPreview({ file, markdown = false }: { file: LibraryNode; markdown?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const read = useLoad("text", () => fetchLibraryText(file));
  if (read.failed) return read.error instanceof CloudError && read.error.status === 413 ? <TooLarge file={file} /> : <Failed file={file} retry={read.retry} />;
  if (!read.value) return LOADING;
  const { text, truncated } = read.value;
  if (text.includes(String.fromCharCode(0))) return <Fallback file={file} title="此文件似乎是二进制数据，无法以文本形式预览" />;
  const plain = text.length > MAX_FORMAT;
  const doc = { text, marks: NO_MARKS, nonce: 0, scroller };
  return (
    <>
      {truncated && <p className="file-note library-note">文件过长，仅显示前 5,000,000 个字符。</p>}
      {markdown && !plain ? <MarkdownDoc {...doc} localLinks={false} /> : <CodeDoc {...doc} path={file.name} plain={plain} wrap />}
    </>
  );
}

/** HTML: its source first; 预览 shows it in a frame that may run nothing and send no referrer (the bridge's kind=html adds its CSP). */
function HtmlPreview({ file }: { file: LibraryNode }) {
  const [mode, setMode] = useState<"source" | "preview">("source");
  return (
    <>
      <div className="library-panel-bar">
        <Segmented<"source" | "preview">
          label="显示方式"
          value={mode}
          options={[
            { value: "source", label: "源代码" },
            { value: "preview", label: "预览" },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === "source" ? (
        <TextPreview file={file} />
      ) : (
        <iframe className="library-html-frame" title={`${file.name} 的预览`} sandbox="" referrerPolicy="no-referrer" src={libraryContentUrl(file, "html")} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sheets (SheetJS: rows capped while it parses, every cell as its formatted text)

const SHEET_ROWS = 1000;
/** ponytail: columns past this are left out; a wide sheet's far columns need the file itself. */
const SHEET_COLUMNS = 100;

interface Sheet {
  name: string;
  rows: string[][];
  /** The first row and column shown (the sheet's range may start past A1). */
  row: number;
  column: number;
  /** Rows or columns were left out. */
  cut: boolean;
}

async function readSheets(file: LibraryNode, kind: "csv" | "tsv" | "xlsx"): Promise<Sheet[] | null> {
  const [XLSX, bytes] = await Promise.all([import("xlsx"), fetchLibraryBytes(file)]);
  const options = { sheetRows: SHEET_ROWS, dense: true, cellHTML: false, cellFormula: false } as const;
  let book: import("xlsx").WorkBook;
  if (kind === "xlsx") {
    // SheetJS reads the counted entries alone (storedZip), not the file's own directory.
    const zip = await unzipWithin(bytes);
    if (!zip) return null;
    book = XLSX.read(await storedZip(zip), { ...options, type: "array" });
  } else {
    // As text, so a CSV without a BOM reads as UTF-8 rather than as bytes.
    book = XLSX.read(new TextDecoder().decode(bytes), { ...options, type: "string", ...(kind === "tsv" ? { FS: "\t" } : {}) });
  }
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : null;
    const full = sheet["!fullref"] ? XLSX.utils.decode_range(sheet["!fullref"]) : range;
    const rows = range ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: true }) : [];
    const width = range ? range.e.c - range.s.c + 1 : 0;
    return {
      name,
      rows: rows.map((row) => row.slice(0, SHEET_COLUMNS).map((cell) => (cell == null ? "" : String(cell)))),
      row: range?.s.r ?? 0,
      column: range?.s.c ?? 0,
      cut: !!full && !!range && (full.e.r > range.e.r || width > SHEET_COLUMNS),
    };
  });
}

/** A column's letters (0 → A, 26 → AA). */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Each sheet a tab (an Excel-like strip under the table), the cells as text in a numbered grid. */
function SheetPreview({ file, kind }: { file: LibraryNode; kind: "csv" | "tsv" | "xlsx" }) {
  const read = useLoad(kind, () => readSheets(file, kind));
  const [at, setAt] = useState(0);
  if (read.failed) return <Failed file={file} retry={read.retry} />;
  if (read.value === undefined) return LOADING;
  if (read.value === null) return <TooLarge file={file} />;
  const sheets = read.value;
  const sheet = sheets[Math.min(at, sheets.length - 1)];
  if (!sheet) return <Fallback file={file} />;
  const columns = Math.min(SHEET_COLUMNS, Math.max(0, ...sheet.rows.map((row) => row.length)));
  return (
    <div className="library-sheet">
      <div className="library-sheet-scroll" tabIndex={0} role="region" aria-label={sheet.name}>
        <table className="library-sheet-table">
          <thead>
            <tr>
              <th aria-hidden="true" />
              {Array.from({ length: columns }, (_, index) => (
                <th key={index} scope="col">
                  {columnName(sheet.column + index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, index) => (
              <tr key={index}>
                <th scope="row">{sheet.row + index + 1}</th>
                {Array.from({ length: columns }, (_, column) => (
                  <td key={column}>{row[column] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.cut && <p className="file-note library-note">仅显示前 {SHEET_ROWS} 行、{SHEET_COLUMNS} 列。</p>}
      {sheets.length > 1 && (
        <div className="library-sheet-tabs" role="tablist" aria-label="工作表">
          {sheets.map((entry, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              className="library-sheet-tab"
              aria-selected={entry === sheet}
              tabIndex={entry === sheet ? 0 : -1}
              onClick={() => setAt(index)}
              onKeyDown={(event) => {
                const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                event.preventDefault();
                const next = (index + step + sheets.length) % sheets.length;
                setAt(next);
                (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Word (docx-preview, as docx-preview-panel renders it)

/** Gr: a link that is not http(s) loses its href; kept ones open outside the app. Nothing framed or scripted stays. */
function stripLinks(root: Element): void {
  for (const link of root.querySelectorAll("a[href]")) {
    let protocol = "";
    try {
      protocol = new URL(link.getAttribute("href") ?? "", window.location.href).protocol;
    } catch {
      // No URL: no link.
    }
    if (protocol !== "http:" && protocol !== "https:") link.removeAttribute("href");
    else if (!link.getAttribute("href")?.startsWith("#")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }
  for (const element of root.querySelectorAll("iframe, frame, object, embed, script")) element.remove();
}

/** A rendered Office document's state: drawing, drawn, past the inflate limit, or failed. */
type Drawn = "loading" | "done" | "tooLarge" | "failed";

/** The document's own frame, after docx-preview's rules: the grey wrapper padded 16, a page wider than the panel from its start edge. */
const DOCX_FRAME = ".library-docx-wrapper { padding: 16px; align-items: safe center; }";
const DOCX_PAD = 32;

/**
 * docx-preview-panel: alt chunks off (their HTML would be a same-origin srcdoc frame), images as
 * data: URLs, no embedded fonts; drawn off the page, links stripped (Gr), then moved in. Unlike
 * the desktop app's, the document and its <style>s go into a shadow root in a paint-contained
 * scroller: docx-preview writes the file's colors, fonts and style ids into that CSS as they are,
 * so a crafted file could style the whole window, or lay a fixed layer over it. A picture is read
 * and encoded once however often the document uses it (docx-preview reads one per use). The pages
 * scale down to the panel's width (zr's fit-width, its default).
 */
function DocxPreview({ file }: { file: LibraryNode }) {
  const view = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Drawn>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const at = host.current;
    if (!at) return;
    const root = at.shadowRoot ?? at.attachShadow({ mode: "open" });
    let live = true;
    setState("loading");
    (async (): Promise<Drawn> => {
      const bytes = await fetchLibraryBytes(file);
      if (!(await unzipWithin(bytes))) return "tooLarge";
      const docx = await import("docx-preview");
      const options = { className: "library-docx", renderAltChunks: false, useBase64URL: true, ignoreFonts: true };
      const doc = await docx.parseAsync(bytes, options);
      const pictures = new Map<string, Promise<string | null>>();
      const once = (load: (id: string, part?: unknown) => Promise<string | null>, base: () => unknown) => (id: string, part?: unknown) => {
        const path: string | null = doc.getPathById(part ?? base(), id);
        if (!path) return Promise.resolve(null);
        if (!pictures.has(path)) pictures.set(path, load.call(doc, id, part));
        return pictures.get(path)!;
      };
      doc.loadDocumentImage = once(doc.loadDocumentImage, () => doc.documentPart);
      doc.loadNumberingImage = once(doc.loadNumberingImage, () => doc.numberingPart);
      const into = document.createElement("div");
      into.append(...(await docx.renderDocument(doc, options)));
      stripLinks(into);
      const frame = document.createElement("style");
      frame.textContent = DOCX_FRAME;
      if (live) root.replaceChildren(...into.childNodes, frame);
      return "done";
    })().then(
      (next) => live && setState(next),
      () => live && setState("failed"),
    );
    return () => {
      live = false;
      root.replaceChildren();
    };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Fit to width: the widest page at full size (measured once, before any zoom), then zoomed to the scroller as it resizes.
  useEffect(() => {
    const scroller = view.current;
    const wrapper = host.current?.shadowRoot?.querySelector<HTMLElement>(".library-docx-wrapper");
    if (state !== "done" || !scroller || !wrapper) return;
    wrapper.style.zoom = "";
    const width = Math.max(0, ...Array.from(wrapper.querySelectorAll<HTMLElement>("section.library-docx"), (page) => page.offsetWidth)) + DOCX_PAD;
    // Next frame, not in the callback: the zoom changes the scroller's height (its horizontal scrollbar goes), which is no resize loop then.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (scroller.clientWidth) wrapper.style.zoom = String(Math.min(1, scroller.clientWidth / width));
      });
    });
    observer.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [state]);
  return (
    <>
      {state === "loading" && LOADING}
      {state === "tooLarge" && <TooLarge file={file} />}
      {state === "failed" && <Failed file={file} retry={() => setAttempt(attempt + 1)} />}
      <div ref={view} className="library-docx-view" hidden={state !== "done"}>
        <div ref={host} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Slides: each slide's text boxes and pictures where its XML puts them (a:off / a:ext).
// ponytail: no theme colors, charts, tables, SmartArt, shape fills or rotation; text a
// placeholder inherits takes its box from the layout or master, its size 18pt (40 for titles).

const NS = {
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};
const PICTURES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };
const ALIGN: Record<string, CSSProperties["textAlign"]> = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Run {
  text: string;
  size: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string | null;
  href: string | null;
}
interface SlideItem {
  box: Box;
  title: boolean;
  paragraphs?: { align: string | null; runs: Run[] }[];
  image?: string;
}
interface Deck {
  width: number;
  height: number;
  slides: SlideItem[][];
  /** Slides past SLIDES_MAX were left out. */
  cut: boolean;
}
type Rels = Map<string, { target: string; type: string; external: boolean }>;

const child = (el: Element | null | undefined, ns: string, name: string) => (el ? (Array.from(el.children).find((each) => each.namespaceURI === ns && each.localName === name) ?? null) : null);
const descendant = (el: Element | null | undefined, ns: string, name: string) => el?.getElementsByTagNameNS(ns, name)[0] ?? null;
const number = (el: Element | null, name: string) => Number(el?.getAttribute(name)) || 0;

/** A part's path from `from`'s folder (a rels target: relative, or from the package root). */
function partPath(from: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const text = await zip.file(path)?.async("string");
  if (text === undefined) return null;
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

/** A deck's parts, each inflated and parsed once however often the deck names it; reading stops once `signal` aborts. */
interface DeckReader {
  xml(path: string): Promise<Document | null>;
  rels(path: string): Promise<Rels>;
  /** A picture's bytes as base64. */
  picture(path: string): Promise<string | undefined>;
}

function deckReader(zip: JSZip, signal: AbortSignal): DeckReader {
  const once = <T,>(known: Map<string, Promise<T>>, path: string, read: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    if (!known.has(path)) known.set(path, read());
    return known.get(path)!;
  };
  const [docs, rels, pictures] = [new Map<string, Promise<Document | null>>(), new Map<string, Promise<Rels>>(), new Map<string, Promise<string | undefined>>()];
  const reader: DeckReader = {
    xml: (path) => once(docs, path, () => readXml(zip, path)),
    rels: (path) => once(rels, path, () => readRels(reader.xml, path)),
    picture: (path) => once(pictures, path, async () => zip.file(path)?.async("base64")),
  };
  return reader;
}

async function readRels(xml: DeckReader["xml"], path: string): Promise<Rels> {
  const slash = path.lastIndexOf("/");
  const doc = await xml(`${path.slice(0, slash)}/_rels/${path.slice(slash + 1)}.rels`);
  const rels: Rels = new Map();
  for (const rel of doc ? Array.from(doc.getElementsByTagName("Relationship")) : []) {
    const external = rel.getAttribute("TargetMode") === "External";
    const target = rel.getAttribute("Target") ?? "";
    rels.set(rel.getAttribute("Id") ?? "", { target: external ? target : partPath(path, target), type: rel.getAttribute("Type") ?? "", external });
  }
  return rels;
}

/** An a:xfrm's offset and extent (or a group's child ones: chOff / chExt). */
function boxOf(xfrm: Element | null, offset = "off", extent = "ext"): Box | null {
  const off = child(xfrm, NS.a, offset);
  const ext = child(xfrm, NS.a, extent);
  return off && ext ? { x: number(off, "x"), y: number(off, "y"), w: number(ext, "cx"), h: number(ext, "cy") } : null;
}

/** A layout's or master's placeholders' boxes, by idx and by type. */
function placeholders(doc: Document | null): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const shape of doc ? Array.from(doc.getElementsByTagNameNS(NS.p, "sp")) : []) {
    const ph = descendant(child(shape, NS.p, "nvSpPr"), NS.p, "ph");
    const box = boxOf(child(child(shape, NS.p, "spPr"), NS.a, "xfrm"));
    if (!ph || !box) continue;
    const idx = ph.getAttribute("idx");
    if (idx !== null && !boxes.has(`idx:${idx}`)) boxes.set(`idx:${idx}`, box);
    const type = `type:${ph.getAttribute("type") ?? "body"}`;
    if (!boxes.has(type)) boxes.set(type, box);
  }
  return boxes;
}

/** A link a slide may keep: http(s) only. */
function safeHref(target: string): string | null {
  try {
    const url = new URL(target);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function paragraphsOf(body: Element | null, rels: Rels): { align: string | null; runs: Run[] }[] {
  return (body ? Array.from(body.children).filter((each) => each.namespaceURI === NS.a && each.localName === "p") : []).map((paragraph) => {
    const runs: Run[] = [];
    for (const part of Array.from(paragraph.children)) {
      if (part.namespaceURI !== NS.a) continue;
      if (part.localName === "br") runs.push({ text: "\n", size: null, bold: false, italic: false, underline: false, color: null, href: null });
      if (part.localName !== "r" && part.localName !== "fld") continue;
      const props = child(part, NS.a, "rPr");
      const link = child(props, NS.a, "hlinkClick")?.getAttributeNS(NS.r, "id");
      const rel = link ? rels.get(link) : undefined;
      const color = child(child(props, NS.a, "solidFill"), NS.a, "srgbClr")?.getAttribute("val") ?? "";
      const underline = props?.getAttribute("u");
      runs.push({
        text: child(part, NS.a, "t")?.textContent ?? "",
        size: number(props, "sz") || null,
        bold: props?.getAttribute("b") === "1",
        italic: props?.getAttribute("i") === "1",
        underline: !!underline && underline !== "none",
        color: /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null,
        href: rel?.external ? safeHref(rel.target) : null,
      });
    }
    return { align: child(paragraph, NS.a, "pPr")?.getAttribute("algn") ?? null, runs };
  });
}

/** A shape tree's text boxes and pictures, groups mapped from their child frame into the slide's. */
async function shapesOf(read: DeckReader, tree: Element, rels: Rels, holders: Map<string, Box>[], place: (box: Box) => Box, items: SlideItem[]): Promise<void> {
  for (const shape of Array.from(tree.children)) {
    if (shape.namespaceURI !== NS.p) continue;
    if (shape.localName === "sp") {
      const ph = descendant(child(shape, NS.p, "nvSpPr"), NS.p, "ph");
      const idx = ph?.getAttribute("idx");
      const type = ph?.getAttribute("type") ?? "body";
      const inherited = ph ? holders.map((boxes) => (idx != null ? boxes.get(`idx:${idx}`) : undefined) ?? boxes.get(`type:${type}`)).find(Boolean) : undefined;
      const box = boxOf(child(child(shape, NS.p, "spPr"), NS.a, "xfrm")) ?? inherited;
      const paragraphs = paragraphsOf(child(shape, NS.p, "txBody"), rels);
      if (box && paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()))) items.push({ box: place(box), title: !!ph && (type === "title" || type === "ctrTitle"), paragraphs });
    } else if (shape.localName === "pic") {
      const embed = descendant(child(shape, NS.p, "blipFill"), NS.a, "blip")?.getAttributeNS(NS.r, "embed");
      const rel = embed ? rels.get(embed) : undefined;
      const type = rel && !rel.external ? PICTURES[extensionOf(rel.target) ?? ""] : undefined;
      const box = boxOf(child(child(shape, NS.p, "spPr"), NS.a, "xfrm"));
      const data = type && box ? await read.picture(rel!.target) : undefined;
      if (box && data) items.push({ box: place(box), title: false, image: `data:${type};base64,${data}` });
    } else if (shape.localName === "grpSp") {
      const xfrm = child(child(shape, NS.p, "grpSpPr"), NS.a, "xfrm");
      const outer = boxOf(xfrm);
      const inner = boxOf(xfrm, "chOff", "chExt");
      const scale = outer && inner?.w && inner.h ? { x: outer.w / inner.w, y: outer.h / inner.h } : null;
      const map = outer && inner && scale ? (box: Box) => place({ x: outer.x + (box.x - inner.x) * scale.x, y: outer.y + (box.y - inner.y) * scale.y, w: box.w * scale.x, h: box.h * scale.y }) : place;
      await shapesOf(read, shape, rels, holders, map, items);
    }
  }
}

/** ponytail: slides past this many are left out (a note says so); a longer deck needs the file itself. */
const SLIDES_MAX = 500;

/** The deck: its slide size (sldSz) and its slides in sldIdLst's order, each slide once. */
async function readDeck(zip: JSZip, signal: AbortSignal): Promise<Deck> {
  const read = deckReader(zip, signal);
  const presentation = await read.xml("ppt/presentation.xml");
  if (!presentation) throw new Error("No presentation part");
  const size = presentation.getElementsByTagNameNS(NS.p, "sldSz")[0] ?? null;
  const rels = await read.rels("ppt/presentation.xml");
  const known = new Map<string, Promise<Map<string, Box>>>();
  const holdersOf = (path: string | undefined) => {
    if (!path) return Promise.resolve(new Map<string, Box>());
    if (!known.has(path)) known.set(path, read.xml(path).then(placeholders));
    return known.get(path)!;
  };
  const slides: SlideItem[][] = [];
  const seen = new Set<string>();
  let cut = false;
  for (const entry of Array.from(presentation.getElementsByTagNameNS(NS.p, "sldId"))) {
    const path = rels.get(entry.getAttributeNS(NS.r, "id") ?? "")?.target;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (slides.length === SLIDES_MAX) {
      cut = true;
      break;
    }
    const tree = (await read.xml(path))?.getElementsByTagNameNS(NS.p, "spTree")[0];
    if (!tree) continue;
    const slideRels = await read.rels(path);
    const layout = [...slideRels.values()].find((rel) => rel.type.endsWith("/slideLayout"))?.target;
    const master = layout ? [...(await read.rels(layout)).values()].find((rel) => rel.type.endsWith("/slideMaster"))?.target : undefined;
    const items: SlideItem[] = [];
    await shapesOf(read, tree, slideRels, await Promise.all([holdersOf(layout), holdersOf(master)]), (box) => box, items);
    slides.push(items);
  }
  return { width: number(size, "cx") || 12_192_000, height: number(size, "cy") || 6_858_000, slides, cut };
}

const percent = (part: number, whole: number) => `${(100 * part) / whole}%`;

/** The slides one under another, each white and as wide as the panel; text scales with it (cqw). */
function SlidesPreview({ file }: { file: LibraryNode }) {
  const read = useLoad("deck", async (signal) => {
    const zip = await unzipWithin(await fetchLibraryBytes(file));
    return zip && readDeck(zip, signal);
  });
  if (read.failed) return <Failed file={file} retry={read.retry} />;
  if (read.value === undefined) return LOADING;
  if (read.value === null) return <TooLarge file={file} />;
  const { width, height, slides, cut } = read.value;
  if (!slides.length) return <Fallback file={file} />;
  return (
    <div className="library-slides">
      {cut && <p className="file-note library-note">仅显示前 {SLIDES_MAX} 张幻灯片。</p>}
      {slides.map((items, index) => (
        <section key={index} className="library-slide" aria-label={`第 ${index + 1} 张，共 ${slides.length} 张`} style={{ aspectRatio: `${width} / ${height}` }}>
          {items.map((item, at) => (
            <div
              key={at}
              className="library-slide-item"
              style={{ left: percent(item.box.x, width), top: percent(item.box.y, height), width: percent(item.box.w, width), height: percent(item.box.h, height) }}
            >
              {item.image ? (
                <img src={item.image} alt="" draggable={false} />
              ) : (
                item.paragraphs!.map((paragraph, line) => (
                  <p key={line} style={{ textAlign: ALIGN[paragraph.align ?? ""] }}>
                    {paragraph.runs.length === 0 && <br />}
                    {paragraph.runs.map((run, part) => {
                      // sz is in hundredths of a point, 12 700 EMU each: its share of the slide's width.
                      const style: CSSProperties = {
                        fontSize: `${((run.size ?? (item.title ? 4000 : 1800)) * 12_700) / width}cqw`,
                        fontWeight: run.bold ? 600 : undefined,
                        fontStyle: run.italic ? "italic" : undefined,
                        textDecoration: run.underline || run.href ? "underline" : undefined,
                        color: run.color ?? undefined,
                      };
                      return run.href ? (
                        <a key={part} href={run.href} target="_blank" rel="noopener noreferrer" style={style}>
                          {run.text}
                        </a>
                      ) : (
                        <span key={part} style={style}>
                          {run.text}
                        </span>
                      );
                    })}
                  </p>
                ))
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notebooks: Markdown cells through Markdown (sanitized, paths as text), code highlighted, and of
// the outputs only text, raster and SVG images (as data: URLs in <img>) and HTML as its source.

type Output = { text: string; error?: boolean } | { image: string } | { source: string };
interface Cell {
  kind: string;
  source: string;
  count: number | null;
  outputs: Output[];
}

const joined = (value: unknown) => (Array.isArray(value) ? value.filter((part) => typeof part === "string").join("") : typeof value === "string" ? value : "");
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const RASTERS = ["image/png", "image/jpeg", "image/gif"];

function outputOf(raw: unknown): Output | null {
  const output = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (output.output_type === "stream") return { text: joined(output.text) };
  if (output.output_type === "error") return { text: (Array.isArray(output.traceback) ? output.traceback.filter((line) => typeof line === "string").join("\n") : `${output.ename}: ${output.evalue}`).replace(ANSI, ""), error: true };
  const data = (output.data && typeof output.data === "object" ? output.data : {}) as Record<string, unknown>;
  const raster = RASTERS.find((type) => typeof data[type] === "string" || Array.isArray(data[type]));
  if (raster) {
    const base64 = joined(data[raster]).replace(/\s+/g, "");
    return /^[A-Za-z0-9+/]*={0,2}$/.test(base64) ? { image: `data:${raster};base64,${base64}` } : null;
  }
  if (data["image/svg+xml"] !== undefined) {
    const bytes = new TextEncoder().encode(joined(data["image/svg+xml"]));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return { image: `data:image/svg+xml;base64,${btoa(binary)}` };
  }
  if (data["text/plain"] !== undefined) return { text: joined(data["text/plain"]) };
  if (data["text/html"] !== undefined) return { source: joined(data["text/html"]) };
  return null;
}

async function readNotebook(file: LibraryNode): Promise<{ language: string; cells: Cell[] }> {
  const notebook = JSON.parse(new TextDecoder().decode(await fetchLibraryBytes(file))) as Record<string, unknown>;
  const meta = (notebook.metadata ?? {}) as { language_info?: { name?: unknown }; kernelspec?: { language?: unknown } };
  const language = [meta.language_info?.name, meta.kernelspec?.language].find((name): name is string => typeof name === "string") ?? "python";
  if (!Array.isArray(notebook.cells)) throw new Error("Not a notebook");
  const cells = notebook.cells.map((raw): Cell => {
    const cell = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      kind: typeof cell.cell_type === "string" ? cell.cell_type : "raw",
      source: joined(cell.source),
      count: typeof cell.execution_count === "number" ? cell.execution_count : null,
      outputs: Array.isArray(cell.outputs) ? cell.outputs.map(outputOf).filter((output) => output !== null) : [],
    };
  });
  return { language, cells };
}

function NotebookPreview({ file }: { file: LibraryNode }) {
  const read = useLoad("notebook", () => readNotebook(file));
  if (read.failed) return <Failed file={file} retry={read.retry} />;
  if (!read.value) return LOADING;
  const { language, cells } = read.value;
  return (
    <div className="library-notebook">
      {cells.map((cell, index) =>
        cell.kind === "markdown" ? (
          <div key={index} className="library-nb-cell library-nb-markdown">
            <Markdown text={cell.source} className="epitaxy file-prose" localLinks={false} />
          </div>
        ) : (
          <div key={index} className="library-nb-cell">
            {cell.kind === "code" && <span className="library-nb-count">[{cell.count ?? " "}]:</span>}
            <pre className="library-nb-code hljs">{cell.kind === "code" ? <code dangerouslySetInnerHTML={{ __html: highlight(cell.source, language) }} /> : <code>{cell.source}</code>}</pre>
            {cell.outputs.map((output, at) =>
              "image" in output ? (
                <img key={at} className="library-nb-image" src={output.image} alt="" draggable={false} />
              ) : (
                <pre key={at} className="library-nb-output" data-error={("error" in output && output.error) || undefined}>
                  {"text" in output ? output.text : output.source}
                </pre>
              ),
            )}
          </div>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notes (preview-7136203c296a Xt): the text as Markdown source, 预览 drawing it. ponytail: no
// writing block (WYSIWYG, / commands, the AI tools); upgrade to an editor of that kind if asked.

const NOTE_FAILURE = { size: "此笔记过大，请缩短内容后重试", save: "你的修改尚未保存。请重试" } as const;

/**
 * The note's editor over its session: typing saves (500 ms after the last change), leaving the
 * field saves now; a failed save says so inline with 重试 (a full storage says so in its toast),
 * and a restored version loads first, editing locked until it has (重试 on a failure). `locked`:
 * read-only meanwhile (versions up, a restore running).
 */
function NoteEditor({ session, locked, autoFocus }: { session: NoteSession; locked: boolean; autoFocus: boolean }) {
  const state = useSyncExternalStore(session.subscribe, () => session.state);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const field = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="library-panel-bar">
        <Segmented<"edit" | "preview">
          label="显示方式"
          value={mode}
          options={[
            { value: "edit", label: "编辑" },
            { value: "preview", label: "预览" },
          ]}
          onChange={setMode}
        />
      </div>
      {state.restore === "pending" && (
        <p className="library-note-notice" role="status">
          正在加载已恢复的版本…
        </p>
      )}
      {state.restore === "failed" && (
        <div className="library-note-notice" role="alert" data-danger="">
          此版本已恢复，但加载失败。请重试后再编辑
          <Button variant="ghost" size="sm" onClick={() => void session.reload()}>
            重试
          </Button>
        </div>
      )}
      {state.failure && state.failure !== "storage" && (
        <div className="library-note-notice" role="alert" data-danger="">
          {NOTE_FAILURE[state.failure]}
          <Button variant="ghost" size="sm" onClick={() => void session.flush()}>
            重试
          </Button>
        </div>
      )}
      {state.restore === null &&
        (mode === "edit" ? (
          <textarea
            ref={field}
            className="library-note-field"
            aria-label={state.fileName}
            placeholder="开始写作"
            value={state.content}
            readOnly={locked}
            onChange={(event) => session.edit(event.target.value)}
            onBlur={() => session.state.failure !== "storage" && void session.flush()}
          />
        ) : state.content.length > MAX_FORMAT ? (
          <CodeDoc text={state.content} marks={NO_MARKS} nonce={0} scroller={scroller} path={state.fileName} plain wrap />
        ) : (
          <MarkdownDoc text={state.content} marks={NO_MARKS} nonce={0} scroller={scroller} localLinks={false} />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Flashcards (FlashcardsPreview je in the library's preview, the grid t: not a chat's study cards)

type CardFilter = "all" | "known" | "missed";
interface CardEditor {
  card: Flashcard;
  /** As it was when the editor opened (persistence T checks it); null for 添加卡片. */
  previousCard: Flashcard | null;
  /** What the editor says: a side too long (editorSideLengthError), or a write that failed (saveError). */
  error: "length" | "save" | null;
}

/**
 * The set's cards, each its front (three lines at most) with, for its owner, its last review's
 * badge, the 全部 / 已掌握 / 未掌握 filter and 添加卡片 while there are under 100; a card opens its
 * two sides in an editor over the grid (Ctrl/Cmd+Enter saves, Esc cancels, the last card stays).
 * Edits queue and are written one at a time (flashcardQueue); a failed one comes back in the editor
 * with its draft. An old version, or a set the account does not own, is 仅限查看. 下载文件 saves
 * the CSV.
 */
function FlashcardsPreview({ file, node, version, hold, onChanged }: PreviewProps) {
  const queue = useMemo(() => flashcardQueue(node.id), [node.id]);
  const state = useSyncExternalStore(queue.subscribe, () => queue.state);
  // data g: without access_kind on the list's item, the set's own (an unreadable one is read-only).
  const meta = useLoad(!version && node.access === null ? "meta" : null, () => fetchFlashcardsMeta(node.id));
  const readOnly = version ? true : node.access !== null ? libraryReadOnly(node) : (meta.value?.readOnly ?? true);
  const current = useLoad(version ? null : "deck", () => queue.load());
  const old = useLoad(version ? "deck" : null, () => fetchFlashcards(file, file.fileId));
  const deck = version ? old.value : readOnly ? state.deck : flashcardView(state);
  const progress = useLoad(readOnly ? null : "progress", () => fetchFlashcardProgress(node.id));
  const [filter, setFilter] = useState<CardFilter>("all");
  const [editing, setEditing] = useState<CardEditor | null>(null);
  const [reopened, setReopened] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const ids = useId();
  useEffect(() => {
    hold.current.download = deck ? () => downloadFlashcardsCsv(deck) : undefined;
    return () => {
      hold.current.download = undefined;
    };
  }, [deck, hold]);
  // je's P2: the last write that failed comes back in the editor, once, its draft and saveError in it.
  const failed = state.failed.at(-1);
  if (failed && failed.id !== reopened && !editing && !readOnly && deck) {
    setReopened(failed.id);
    setSaved(false);
    setEditing({ card: failed.card, previousCard: failed.previousCard, error: "save" });
  }

  const load = version ? old : current;
  if (!deck)
    return load.failed ? (
      <div className="library-fallback" role="alert">
        <div className="library-fallback-card">
          <p className="library-fallback-note">无法加载这组闪卡</p>
          <Button variant="secondary" onClick={load.retry}>
            重试
          </Button>
        </div>
      </div>
    ) : (
      LOADING
    );

  const outcomes = progress.value ?? {};
  const cards = deck.cards.filter((card) => filter === "all" || outcomes[card.id] === filter);
  const missing = !!editing?.previousCard && !deck.cards.some((card) => card.id === editing.card.id);
  const tooLong = !!editing && (flashcardSideTooLong(editing.card.front.trim()) || flashcardSideTooLong(editing.card.back.trim()));
  const canSave = !!editing && !readOnly && !missing && !!editing.card.front.trim() && !!editing.card.back.trim();
  const canDelete = !!editing?.previousCard && !readOnly && !missing && deck.cards.length > 1;
  const message = editing?.error === "save" ? "更改未能保存。卡片组可能已发生变化，或编辑功能不可用。你的草稿还在。" : editing?.error === "length" && tooLong ? `每面的内容请勿超过 ${FLASHCARD_SIDE_MAX} 个字符` : null;

  const closeEditor = () => {
    setEditing(null);
    requestAnimationFrame(() => (opener.current?.isConnected ? opener.current : grid.current?.querySelector("button"))?.focus());
  };
  const cancel = () => {
    if (editing) queue.clearFailure(editing.card.id);
    closeEditor();
  };
  // 恢复草稿 (onRecoverDraft): the set's panel again, where its failed draft reopens in the editor.
  const recover = () => {
    const route = getState().libraryRoute;
    if (!route) openLibrary({ tab: libraryPrefs().lastTab, fileId: node.id });
    else if (route.fileId !== node.id || route.note) setState({ libraryRoute: { ...route, fileId: node.id, note: undefined } });
  };
  const save = () => {
    if (!editing || !canSave) return;
    const card = { ...editing.card, front: editing.card.front.trim(), back: editing.card.back.trim() };
    if (flashcardSideTooLong(card.front) || flashcardSideTooLong(card.back)) return setEditing({ ...editing, error: "length" });
    if (editing.previousCard?.front === editing.card.front && editing.previousCard.back === editing.card.back) {
      queue.clearFailure(card.id);
      return closeEditor();
    }
    queue.enqueue({ id: crypto.randomUUID(), card, previousCard: editing.previousCard }, { onSaved: onChanged, onRecover: recover });
    setSaved(true);
    closeEditor();
  };
  const remove = () => {
    if (!editing || !canDelete) return;
    queue.enqueue({ id: crypto.randomUUID(), card: editing.card, previousCard: editing.previousCard, delete: true }, { onSaved: onChanged, onRecover: recover });
    setSaved(true);
    closeEditor();
  };
  const edit = (patch: Partial<Flashcard>) => editing && setEditing({ ...editing, card: { ...editing.card, ...patch } });

  return (
    <div className="library-flashcards">
      <div className="library-panel-bar">
        {readOnly ? (
          <p className="library-flashcards-note">仅限查看</p>
        ) : (
          <Segmented<CardFilter>
            label="筛选"
            value={filter}
            options={[
              { value: "all", label: "全部" },
              { value: "known", label: "已掌握" },
              { value: "missed", label: "未掌握" },
            ]}
            onChange={setFilter}
          />
        )}
      </div>
      {progress.failed && (
        <p className="library-flashcards-note" role="status">
          无法加载复习进度
        </p>
      )}
      {saved && !editing && state.pending.length === 0 && (
        <p className="sr-only" role="status">
          更改已保存
        </p>
      )}
      <div className="library-flashcards-scroll" inert={!!editing}>
        {cards.length === 0 && filter !== "all" && (
          <p className="library-flashcards-empty" role="status">
            {filter === "known" ? "复习更多卡片，看看你掌握了哪些" : "暂时没有答错的卡片"}
          </p>
        )}
        <div ref={grid} className="library-flashcards-grid">
          {cards.map((card) => {
            const outcome = readOnly ? undefined : outcomes[card.id];
            const front = (
              <span id={`${ids}-${card.id}`} className="library-flashcard-front" dir="auto">
                {card.front}
              </span>
            );
            return (
              <section key={card.id} className="library-flashcard" data-flashcard-id={card.id}>
                {outcome && (
                  <span className="library-flashcard-badge" data-outcome={outcome}>
                    <Icon name={outcome === "known" ? "Check" : "X"} size={12} />
                    <span className="sr-only">{outcome === "known" ? "已掌握" : "未掌握"}</span>
                  </span>
                )}
                {readOnly ? (
                  front
                ) : (
                  <button
                    type="button"
                    className="library-flashcard-edit"
                    aria-label="编辑卡片"
                    aria-describedby={`${ids}-${card.id}`}
                    onClick={(event) => {
                      // Not while the front's text is being selected.
                      const selection = event.currentTarget.ownerDocument.getSelection();
                      const button = event.currentTarget;
                      if (event.detail !== 0 && selection && !selection.isCollapsed && (button.contains(selection.anchorNode) || button.contains(selection.focusNode))) return;
                      opener.current = button;
                      setEditing({ card, previousCard: card, error: null });
                    }}
                  >
                    {front}
                    <span className="library-flashcard-pencil" aria-hidden="true">
                      <Icon name="Edit" size={14} />
                    </span>
                  </button>
                )}
              </section>
            );
          })}
          {!readOnly && filter === "all" && deck.cards.length < FLASHCARDS_MAX && (
            <button
              type="button"
              className="library-flashcard library-flashcard-add"
              aria-label="添加卡片"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setEditing({ card: { id: crypto.randomUUID(), front: "", back: "" }, previousCard: null, error: null });
              }}
            >
              <Icon name="Add" size={20} />
            </button>
          )}
        </div>
      </div>
      {editing && !readOnly && (
        <div
          className="library-flashcard-editor"
          role="dialog"
          aria-label={deck.title}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            // The editor's, not the panel's (Pe).
            event.preventDefault();
            cancel();
          }}
        >
          <button type="button" className="library-flashcard-backdrop" aria-label="关闭编辑器" tabIndex={-1} onClick={cancel} />
          <form
            className="library-flashcard-form"
            noValidate
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
              event.preventDefault();
              event.currentTarget.requestSubmit();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="library-flashcard-fields">
              {(["front", "back"] as const).map((side) => (
                <label key={side} className="library-flashcard-side">
                  <textarea
                    name={side}
                    aria-label={side === "front" ? "正面" : "背面"}
                    placeholder={side === "front" ? "正面" : "背面"}
                    aria-invalid={message ? true : undefined}
                    aria-describedby={message ? `${ids}-error` : undefined}
                    required
                    autoFocus={side === "front"}
                    dir="auto"
                    value={editing.card[side]}
                    onChange={(event) => edit({ [side]: event.target.value })}
                  />
                </label>
              ))}
            </div>
            {missing && (
              <p className="library-flashcard-alert" role="alert">
                这张卡片已不在卡组中
              </p>
            )}
            {message && (
              <p id={`${ids}-error`} className="library-flashcard-alert" role="alert">
                {message}
              </p>
            )}
            <div className="library-flashcard-actions">
              <div className="library-flashcard-group">
                <Button variant="ghost" icon={<Icon name="Copy" size={16} />} label="复制" onClick={() => void copied(`${editing.card.front}; ${editing.card.back}`)} />
                {editing.previousCard && (
                  <span data-tip={canDelete ? undefined : "卡组中至少需保留一张卡片"}>
                    <Button variant="ghost" icon={<Icon name="Trash" size={16} />} label="删除卡片" tip={canDelete ? undefined : ""} disabled={!canDelete} onClick={remove} />
                  </span>
                )}
              </div>
              <div className="library-flashcard-group">
                <Button variant="secondary" onClick={cancel}>
                  取消
                </Button>
                <Button variant="primary" type="submit" disabled={!canSave}>
                  保存
                </Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deep research (library-deep-research-preview re): the saved report's text as Markdown, not the
// desktop app's MCP widget (ponytail: no inline images, export or widget state); nothing to show,
// the fallback card with 重试预览.

function DeepResearchPreview({ file }: { file: LibraryNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const read = useLoad("report", () => fetchDeepResearch(file.id));
  if (read.failed || read.value === null) return <Fallback file={file} retry={read.retry} />;
  if (read.value === undefined) return LOADING;
  const doc = { text: read.value, marks: NO_MARKS, nonce: 0, scroller };
  return read.value.length > MAX_FORMAT ? <CodeDoc {...doc} path={`${file.name}.md`} plain wrap /> : <MarkdownDoc {...doc} localLinks={false} />;
}

// ---------------------------------------------------------------------------
// 文件详情 and 版本历史记录 (artifact-accessories: a column at the panel's end)

function Side({ title, closeLabel, hidden, onClose, children }: { title: string; closeLabel: string; hidden?: boolean; onClose(): void; children: ReactNode }) {
  return (
    <aside className="library-side" aria-label={title} hidden={hidden}>
      <div className="library-side-head">
        <h2 className="library-side-title">{title}</h2>
        <Button variant="ghost" size="sm" icon={<Icon name="X" size="sm" />} label={closeLabel} tipSide="bottom" onClick={onClose} />
      </div>
      <div className="library-side-body">{children}</div>
    </aside>
  );
}

const dateTime = (ms: number | null) => (ms === null ? "—" : new Date(ms).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }));

/**
 * FileInfoPanel: the name and where it sits, then 文件类型, 最近更新, 创建时间, 文件大小 and the chat
 * that made it (关联聊天, by its title only: codex-ui does not open ChatGPT chats).
 */
function FileInfo({ node, onClose }: { node: LibraryNode; onClose(): void }) {
  const info = useLoad(node.id, () => fetchLibraryFileInfo(node));
  const path = useLibrary((s) => (node.parentId ? s.paths[node.parentId] : undefined));
  useEffect(() => {
    if (node.parentId) void loadPath(node.parentId);
  }, [node.parentId]);
  const rows: [string, ReactNode][] = [
    ["文件类型", fileTypeLabel(node)],
    ["最近更新", info.value ? dateTime(info.value.updatedAt) : "…"],
    ["创建时间", dateTime(node.createdAt)],
    ["文件大小", node.size === null ? "—" : fileSize(node.size)],
  ];
  if (info.value?.chat) rows.push(["关联聊天", info.value.chat.title ?? "未命名聊天"]);
  return (
    <Side title="文件详情" closeLabel="关闭文件信息面板" onClose={onClose}>
      <p className="library-info-name">{node.name}</p>
      <p className="library-info-place">{["资料库", ...(path?.crumbs.map((crumb) => crumb.name) ?? [])].join(" / ")}</p>
      <dl className="library-info">
        {rows.map(([label, value]) => (
          <div key={label} className="library-info-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Side>
  );
}

const VERSION_KIND: Record<string, string> = { create: "已创建", restore: "已恢复" };

/**
 * The file's versions by day (context O: 20 at a time, 显示更多 for the next), each its time, what
 * it was (当前版本, its reason, or 已创建 / 已恢复 / 已编辑) and who (versionAuthor). Picking one
 * previews it, `over` when the list lies over the preview (a narrow panel); picking the current
 * one goes back. `onItems` hears the versions listed (the restore's expected current version is
 * the list's). `hidden`: stepped aside, still loaded.
 */
function Versions({ node, picked, hidden, onPick, onItems, onClose }: { node: LibraryNode; picked: LibraryVersion | null; hidden: boolean; onPick(version: LibraryVersion | null, over: boolean): void; onItems(items: readonly LibraryVersion[]): void; onClose(): void }) {
  const me = useLibrary((s) => s.available?.accountUserId ?? null);
  const [pages, setPages] = useState<{ items: LibraryVersion[]; cursor: string | null; loading: boolean; failed: boolean }>({ items: [], cursor: null, loading: true, failed: false });
  const live = useRef(true);
  const load = (cursor: string | null) => {
    setPages((now) => ({ ...now, loading: true, failed: false }));
    fetchLibraryVersions(node.id, cursor).then(
      (page) => live.current && setPages((now) => ({ items: cursor ? [...now.items, ...page.items] : page.items, cursor: page.cursor, loading: false, failed: false })),
      () => live.current && setPages((now) => ({ ...now, loading: false, failed: true })),
    );
  };
  useEffect(() => {
    live.current = true;
    load(null);
    return () => {
      live.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onItems(pages.items), [pages.items]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = new Date().getFullYear();
  const dayName = (day: number, kind: string) =>
    kind === "today" ? "今天" : kind === "yesterday" ? "昨天" : day ? new Date(day).toLocaleDateString("zh-CN", { month: "long", day: "numeric", ...(new Date(day).getFullYear() !== today ? { year: "numeric" } : {}) }) : "—";
  return (
    <Side title="版本历史记录" closeLabel="关闭版本历史记录" hidden={hidden} onClose={onClose}>
      {pages.items.length === 0 && pages.loading && (
        <p className="library-side-status">
          <Spinner size={14} />
          正在加载版本历史记录…
        </p>
      )}
      {pages.items.length === 0 && !pages.loading && !pages.failed && <p className="library-side-status">暂无已保存的版本</p>}
      {versionDays(pages.items).map((group) => (
        <section key={group.day} className="library-versions">
          <h3 className="library-versions-day">{dayName(group.day, group.kind)}</h3>
          <ul>
            {group.items.map((item) => {
              const selected = picked ? picked.number === item.number : item.current;
              const actor = versionAuthor(item, me);
              return (
                <li key={item.number}>
                  <button
                    type="button"
                    className="library-version"
                    aria-current={selected || undefined}
                    onClick={(event) => onPick(item.current ? null : item, getComputedStyle(event.currentTarget.closest(".library-side")!).position === "absolute")}
                  >
                    <span className="library-version-line">
                      <span className="library-version-time">{item.createdAt === null ? "—" : new Date(item.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span className="library-version-what">{item.current ? "当前版本" : (item.reason ?? VERSION_KIND[versionAction(item)] ?? "已编辑")}</span>
                    </span>
                    <span className="library-version-meta">
                      版本 {item.number}
                      {actor && ` · ${actor}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {pages.failed && (
        <div className="library-side-status" role="alert">
          无法加载版本历史记录
          <Button variant="ghost" size="sm" onClick={() => load(pages.items.length ? pages.cursor : null)}>
            重试
          </Button>
        </div>
      )}
      {pages.cursor && !pages.failed && (
        <Button variant="ghost" size="sm" className="library-versions-more" disabled={pages.loading} onClick={() => load(pages.cursor)}>
          显示更多
        </Button>
      )}
    </Side>
  );
}
