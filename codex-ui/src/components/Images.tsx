// The 图像 page in the main column (lib/images.ts): the Codex desktop app 26.1023's /images in
// Claude's page parts. The prompt catalog (tabs by section over its cards) leads; a card opens its
// preview (PreviewDialog: the example, the prompt, 宽高比例 and the photos it takes) or, for a
// sketch card, the 绘图 board; with the preview switched off (statsig, /api/images/available) a
// styles card sends or opens its photo dialog and any other one fills the composer, with the
// reference picker over the page when it takes photos. 我的图像 lists ChatGPT's history and the images generated on this
// machine as square tiles (the desktop app's history grid), more pages as it scrolls, with 打开资料库
// beside its heading while the library is there; one opens in a viewer column on the right with
// 上一张 / 下一张, 打开对话, 分享 (a ChatGPT image), 下载 and the edit tools on a floating toolbar
// (标注, 添加评论, 移除背景, 擦除, 调整大小) over 描述修改内容; the composer at the foot starts an
// image session. Every send opens its new session, as the desktop app moves to /c/<id>.

import { Component, Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { fail, newChat, openLibrary, openThread } from "../lib/codex";
import { mediaUrl } from "../lib/files";
import {
  ASPECT_RATIOS, NO_SHARE, addDraftImages, aspectInstruction, cardRoute, catalogSections, cloudSrc, cloudThumb, commentPrompt, editPrompt, fileBytes, gallery, imageChannel, imageQuotaReset, imageSrc,
  imagesEdit, imagesSend, imagesState, loadCatalog, loadHistory, loadLocal, loadReferences, loadUploads, markupPrompt, photoSrc, prefill, promptValid, readShareSource, readableSrc,
  refreshImagesAvailable, removeDraftImage, savePromptEdit, sectionLabel, sendDraft, setDraftText, shareDestination, shareImageLink, shareKey, sharePrompt, shareable, takesPhotos, unpublishable,
  useImages, visitImages, type CloudImage, type GalleryImage, type PromptContent, type PromptGroup, type PromptItem, type PromptSource, type RecentPhoto, type SavedReference,
} from "../lib/images";
import { useLibrary } from "../lib/library";
import { getState, toast, useStore } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, readAsDataUrl } from "./Composer";
import { saveImage } from "./FileMenu";
import { openLightbox } from "./Lightbox";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Dialog, dialogOpen, Icon, MenuItem, Popover, Segmented, Spinner, usePageDrop } from "./ui";

const IMAGE_TITLE = "生成的图像";
const EDIT_FAILED = "未能编辑此图像。请重试";
const SEND_FAILED = "未能启动图像生成。请重试";

/** The pictures among `files` the page takes (its types, 30 MB each) as data URLs; a toast says what was left. */
async function readImages(files: File[]): Promise<{ name: string; url: string }[]> {
  const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
  if (images.length < files.length) toast("warning", "仅支持 PNG、JPEG、GIF 和 WebP 图片。");
  const small = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
  if (small.length < images.length) toast("warning", "部分图片过大，无法附加。最大为 30 MB。");
  return Promise.all(small.map(async (file) => ({ name: file.name || "粘贴的图片", url: await readAsDataUrl(file) })));
}

/** `files` into the composer's draft, five images at most. */
async function addPageFiles(files: File[]): Promise<void> {
  const read = await readImages(files);
  if (read.length && !addDraftImages(read, MAX_IMAGES)) toast("warning", `最多允许 ${MAX_IMAGES} 张图片。`);
}

/** A render error shows in the page's place with 重试 (codex.errorBoundary), not a blank column. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="main-col">
        <div className="transcript-empty" role="alert">
          <div className="transcript-empty-text">
            <p className="transcript-empty-title">出现了问题</p>
            <p className="transcript-empty-body">{this.state.error.message}</p>
          </div>
          <div className="transcript-empty-actions">
            <Button variant="primary" onClick={() => this.setState({ error: null })}>重试</Button>
          </div>
        </div>
      </div>
    );
  }
}

const thumbOf = (image: GalleryImage) => (image.kind === "local" ? mediaUrl(image.path) : cloudThumb(image));
/** A tile whose picture failed hides until it has another address (another connection, a fresh signature), as the desktop app's Wt retries on new data. */
const hiddenKey = (image: GalleryImage) => `${image.key}\n${thumbOf(image)}`;

export function ImagesView() {
  return (
    <Boundary>
      <ImagesPage />
    </Boundary>
  );
}

function ImagesPage() {
  const entry = useImages((s) => s.entry);
  const local = useImages((s) => s.local);
  const history = useImages((s) => s.history);
  const channel = useStore(imageChannel);
  const account = useStore((s) => (s.account?.account?.type === "chatgpt" ? s.account.account.email : null));
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const [viewing, setViewing] = useState<string | null>(null);
  // The viewer's lock (an edit typed, sent or in a tool's mode) holds the tiles too.
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<PromptItem | null>(null);
  const [sketch, setSketch] = useState<PromptItem | null>(null);
  const [prompting, setPrompting] = useState<PromptItem | null>(null);
  const gates = useImages((s) => s.gates);
  const template = useImages((s) => s.template);
  // The reference picker shows over the page while the composer holds a card that takes photos, until 返回建议.
  const [picking, setPicking] = useState(false);
  const picker = picking && !!template && takesPhotos(template);
  const input = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const shownOf = (s: Pick<ReturnType<typeof imagesState>, "local" | "history">) =>
    gallery(s.local ?? [], s.history.items ?? [], !!s.history.cursor, viewing).filter((image) => !hidden.has(hiddenKey(image)));
  const shown = shownOf({ local, history });
  const viewed = shown.find((image) => image.key === viewing);

  // The desktop app's Navigate to "/" once the entry goes (another login, in_app_chat off).
  useEffect(() => {
    if (entry === null) newChat();
  }, [entry]);
  useEffect(() => {
    document.title = "图像 - Codex";
  }, []);
  useEffect(() => void loadLocal(), []);
  useEffect(() => visitImages(account), [account]);
  // The catalog's queries refetch every five minutes, on focus and back online (prompts chunk K).
  useEffect(() => {
    const again = () => void loadCatalog();
    const timer = window.setInterval(again, 5 * 60_000);
    window.addEventListener("focus", again);
    window.addEventListener("online", again);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", again);
      window.removeEventListener("online", again);
    };
  }, []);

  // A card does nothing while the composer cannot send; else it goes where cardRoute says: 绘图,
  // its preview, a send with the composer's images, the photo dialog, or the composer (focused, the
  // reference picker over the page when the card takes photos).
  const select = (item: PromptItem) => {
    if (!channel) return;
    const route = cardRoute(item, gates, imagesState().draft.images.length);
    if (route === "preview") setPreview(item);
    else if (route === "send") void sendDraft(item.prompt).catch(fail(SEND_FAILED));
    else if (route === "dialog") setPrompting(item);
    else if (route === "prefill") {
      prefill(item);
      setPicking(true);
      requestAnimationFrame(() => input.current?.focus());
    } else if (imagesState().draft.images.length >= MAX_IMAGES) toast("danger", "Sketch 目前不可用");
    else setSketch(item);
  };
  // 返回建议, Esc or the scrim: the picker goes, the composer keeps its text and focus.
  const dismissPicker = () => {
    setPicking(false);
    input.current?.focus();
  };
  // Esc from anywhere on the page, focus or not (a picked photo's tile goes disabled and drops it to the body);
  // a dialog, the palette or a menu takes its own, and the viewer lets the picker have it.
  useEffect(() => {
    if (!picker) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element && event.target !== document.body ? event.target : null;
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.defaultPrevented || getState().lightbox || (target && !target.closest(".main-col"))) return;
      event.preventDefault();
      dismissPicker();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picker]);
  // The photo dialog's send: the card's prompt with the photo picked or chosen (none for a prompt-only card), as a new draft.
  const sendPrompt = (item: PromptItem, urls: string[]) => {
    setPrompting(null);
    void sendDraft(item.prompt, urls.map((url) => ({ type: "image" as const, url }))).catch(fail(SEND_FAILED));
  };
  // 草图.png joins the draft with the card's prompt in the composer, focused once the board has handed focus back.
  const sketched = (item: PromptItem, image: { name: string; url: string }) => {
    setSketch(null);
    if (!addDraftImages([image], MAX_IMAGES)) return toast("danger", "Sketch 目前不可用");
    setDraftText(item.prompt);
    requestAnimationFrame(() => input.current?.focus());
  };
  // The image after `key` once ChatGPT's next page is in (the viewer at the end); false when that page failed.
  const nextAfter = async (key: string): Promise<string | null | false> => {
    if (!(await loadHistory(true))) return false;
    const list = shownOf(imagesState());
    const index = list.findIndex((image) => image.key === key);
    return index < 0 ? null : list[index + 1]?.key ?? null;
  };

  const bar = (
    <header className="chat-header" data-tip-group="" data-density="compact" data-collapsed={(!sidebarOpen && !slot) || undefined}>
      <h1 className="draft-title cloud-title">
        <span className="cloud-title-text">图像</span>
      </h1>
    </header>
  );

  return (
    <div className="main-col" onContextMenu={quietMenu}>
      {slot ? createPortal(bar, slot) : bar}
      <div className="session-row">
        <div className="session-chat images-chat">
          <div className="images-scroll" inert={picker}>
            <div className="images-page">
              <PromptCatalog disabled={!channel} onSelect={select} />
              <MyImages images={shown} viewing={viewing} locked={locked} onOpen={setViewing} onHide={(image) => setHidden((current) => new Set(current).add(hiddenKey(image)))} />
            </div>
          </div>
          {/* The discovery layout's picker (suggestions Qt): the page inert under a scrim, the picker and the composer above it. */}
          {picker && <div className="images-scrim" aria-hidden="true" onClick={dismissPicker} />}
          <div
            className="dock images-dock"
            role={picker ? "group" : undefined}
            data-picking={picker || undefined}
          >
            {picker && (
              <div className="images-picker">
                <RecentPhotos
                  layout="carousel"
                  disabled={!channel}
                  onBack={dismissPicker}
                  onUpload={() => upload.current?.click()}
                  onPick={(image) => {
                    if (!addDraftImages([image], MAX_IMAGES)) toast("warning", `最多允许 ${MAX_IMAGES} 张图片。`);
                  }}
                />
                <input
                  ref={upload}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    void addPageFiles([...(event.currentTarget.files ?? [])]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            )}
            <ImagesComposer inputRef={input} files={!preview && !prompting} />
          </div>
        </div>
        {viewed && <Viewer key={viewed.key} images={shown} image={viewed} more={!!history.cursor} onShow={setViewing} onLock={setLocked} onMore={nextAfter} />}
      </div>
      {preview && <PreviewDialog item={preview} onClose={() => setPreview(null)} />}
      {prompting && <PromptDialog item={prompting} onClose={() => setPrompting(null)} onSend={(urls) => sendPrompt(prompting, urls)} />}
      {sketch && <SketchDialog onClose={() => setSketch(null)} onSave={(image) => sketched(sketch, image)} />}
    </div>
  );
}

/**
 * The prompt catalog (the desktop app's prompts chunk ue / pe): tabs by section when the items
 * have any (热门 for none, 模板 for Templates; in statsig's section_order, the rest after), each
 * group of the tab with its cards (an h2 from the second on); 15 card skeletons while it loads, a
 * line with 重试 when a read failed, the empty state when nothing is left.
 */
function PromptCatalog({ disabled, onSelect }: { disabled: boolean; onSelect(item: PromptItem): void }) {
  const { groups, error } = useImages((s) => s.catalog);
  const order = useImages((s) => s.gates.sectionOrder);
  const [picked, setPicked] = useState<string | null>(null);
  const id = useId();
  if (error === "desktop" && !groups) return <p className="images-state images-desktop">仅桌面版可用</p>;
  const sections = groups ? catalogSections(groups, order) : [];
  const section = picked !== null && sections.includes(picked) ? picked : sections[0] ?? "";
  const tabbed = sections.some(Boolean);
  const shown = (groups ?? []).flatMap((group) => {
    const items = tabbed ? group.items.filter((item) => item.section === section) : group.items;
    return items.length ? [{ ...group, items }] : [];
  });
  const tabs = sections.length ? sections : [""];
  return (
    <div className="images-section">
      {groups ? (
        <div className="images-tabs">
          <div role="tablist" aria-label="图像提示词类别" className="customize-tabs">
            {tabs.map((key, index) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${id}-tab-${index}`}
                aria-selected={key === section}
                aria-controls={key === section ? `${id}-panel` : undefined}
                className="customize-tab"
                onClick={() => setPicked(key)}
              >
                {sectionLabel(key)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="images-tabs-space" aria-hidden="true" />
      )}
      <div
        id={`${id}-panel`}
        className="images-catalog"
        role={groups ? "tabpanel" : undefined}
        aria-labelledby={groups ? `${id}-tab-${tabs.indexOf(section)}` : undefined}
        aria-busy={(!groups && !error) || undefined}
      >
        {error && (
          <div className="images-banner" role="alert">
            <Icon name="Warning" />
            <span className="images-banner-text">部分图像提示无法加载</span>
            <Button size="sm" onClick={() => void loadCatalog()}>重试</Button>
          </div>
        )}
        {!groups && !error && (
          <div className="images-cards" aria-hidden="true">
            {Array.from({ length: 15 }, (_, index) => (
              <span key={index} className="images-card-skeleton" style={{ "--i": index } as CSSProperties} />
            ))}
          </div>
        )}
        {groups && !shown.length && !error && (
          <div className="images-state" data-column="">
            <p className="images-empty-title">从你的创意开始</p>
            <p className="images-empty">描述你想创建的图像</p>
          </div>
        )}
        {shown.map((group, index) => (
          <section key={group.id} className="images-group" aria-label={group.title || undefined}>
            {index > 0 && group.title && <h2 className="images-heading">{group.title}</h2>}
            <div className={group.presentation === "text_pill" ? "images-pills" : group.presentation === "icon_pill" ? "images-icon-cards" : "images-cards"}>
              {group.items.map((item) => (
                <PromptCard key={item.id} item={item} presentation={group.presentation} disabled={disabled} onSelect={() => onSelect(item)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** A card as its group presents it: a 4:5 cover over two lines of title (Claude's gallery card), a pill, or a 48px thumbnail beside two lines. */
function PromptCard({ item, presentation, disabled, onSelect }: { item: PromptItem; presentation: PromptGroup["presentation"]; disabled: boolean; onSelect(): void }) {
  const label = [...new Set([item.title, item.alt].filter(Boolean))].join(", ") || undefined;
  if (presentation === "text_pill") {
    return (
      <Button className="images-pill" aria-label={label} disabled={disabled} onClick={onSelect}>
        <span className="images-pill-text">{item.title}</span>
      </Button>
    );
  }
  const icon = presentation === "icon_pill";
  return (
    <button type="button" className={icon ? "images-icon-card" : "images-card"} aria-label={label} disabled={disabled} onClick={onSelect}>
      <span className={icon ? "images-icon-thumb" : "images-card-cover"}>
        <CardArt src={imageSrc(item.image)} />
      </span>
      <span className={icon ? "images-icon-title" : "images-card-title"}>{item.title}</span>
    </button>
  );
}

/** A card's or a photo tile's picture; a placeholder when there is none or it fails (another address tries again, as the desktop app keys it by src). */
function CardArt({ src }: { src: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  return src && broken !== src ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(src)} /> : <Icon name="Image" size="lg" />;
}

/**
 * 我的图像 (the desktop app's history section): loading, empty, failed, or the tiles, ChatGPT's
 * next page read as the foot comes near (a 1px sentinel, as Plugins' grid pages); in the browser
 * ChatGPT's part is the desktop app's only.
 */
function MyImages({ images, viewing, locked, onOpen, onHide }: {
  images: GalleryImage[];
  viewing: string | null;
  locked: boolean;
  onOpen(key: string): void;
  onHide(image: GalleryImage): void;
}) {
  const listed = useImages((s) => s.local !== null);
  const localError = useImages((s) => s.localError);
  const history = useImages((s) => s.history);
  // The library's own answer (the sidebar's useLibraryEntry keeps it, per login): its shortcut, as the desktop app's `a`.
  const library = useLibrary((s) => s.available?.available === true);
  const sentinel = useRef<HTMLDivElement>(null);
  const loading = (!listed && !localError) || (history.items === null && !history.error);
  const failed = !!localError || history.error?.kind === "error";
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    // A new observer per page reports at once, so a sentinel still in view keeps loading.
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && void loadHistory(true), { root: node.closest(".images-scroll"), rootMargin: "200px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [history]);
  const retry = () => {
    if (localError) void loadLocal();
    if (history.error?.kind === "error") void loadHistory(history.error.more);
  };
  return (
    <section className="images-section" aria-labelledby="images-mine">
      <div className="images-mine-head">
        <div className="images-mine-title">
          <h2 id="images-mine" className="images-heading">我的图像</h2>
          {library && <p className="images-mine-note">可在资料库中找到你的所有图像及更多内容</p>}
        </div>
        {library && <Button icon={<Icon name="Collection" />} onClick={() => openLibrary({ tab: "images" })}>打开资料库</Button>}
      </div>
      {/* Over tiles already shown (this machine's, while ChatGPT's first page is on its way) the wait sits below them, so none moves under the pointer. */}
      {loading && !images.length && (
        <div className="images-state" role="status">
          <Spinner size={16} />
          正在加载图像…
        </div>
      )}
      {/* The desktop app's empty state only stands without an error: 仅桌面版可用 below speaks for an empty list then. */}
      {!loading && !failed && !history.error && !images.length && <p className="images-state images-empty">你用 ChatGPT 创建的图像将显示在这里</p>}
      {images.length > 0 && (
        <div className="images-grid">
          {images.map((image) => {
            const thumb = thumbOf(image);
            return (
              <button
                key={image.key}
                type="button"
                className="images-tile"
                aria-label={(image.kind === "cloud" && image.title) || IMAGE_TITLE}
                data-selected={image.key === viewing || undefined}
                aria-disabled={locked || undefined}
                onClick={() => !locked && onOpen(image.key)}
              >
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" decoding="async" onError={() => onHide(image)} />
                ) : (
                  <span className="images-tile-empty">
                    <Icon name={image.kind === "cloud" && image.blocked ? "Prohibit" : "Image"} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {failed && (
        <div className="images-state" data-column="" role="alert">
          无法加载图像
          <Button variant="secondary" disabled={!!history.loading} onClick={retry}>重试</Button>
        </div>
      )}
      {/* ChatGPT's own state alone, so the observer above (keyed on it) is there whenever this is. */}
      {history.cursor && !history.loading && !history.error && <div ref={sentinel} className="images-sentinel" aria-hidden="true" />}
      {(history.loading === "more" || (loading && images.length > 0)) && (
        <div className="images-state" role="status">
          <Spinner size={16} label="正在加载图像…" />
        </div>
      )}
      {history.error?.kind === "desktop" && <p className="images-state images-desktop">仅桌面版可用</p>}
    </section>
  );
}

/** The page's composer: images (the 「+」 button, pasting, dropping on the page unless `files` is off) and the prompt. */
function ImagesComposer({ inputRef, files }: { inputRef: Ref<HTMLTextAreaElement>; files: boolean }) {
  const draft = useImages((s) => s.draft);
  const channel = useStore(imageChannel);
  const reset = useStore(imageQuotaReset);
  const count = draft.images.length;

  const top = count > 0 && (
    <div className="attachments">
      {draft.images.map((image) => (
        <div key={image.key} className="attachment" data-tip={image.name}>
          <img src={image.url} alt={image.name} />
          <button type="button" className="attachment-remove" aria-label={`移除 ${image.name}`} data-tip={`移除 ${image.name}`} onClick={() => removeDraftImage(image.key)}>
            <Icon name="X" size="xs" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <>
      <CloudComposer
        value={draft.text}
        onChange={setDraftText}
        onSend={sendDraft}
        disabled={!channel}
        placeholder={count === 0 ? "描述新图像" : count === 1 ? "描述或编辑这张图像" : "描述或编辑这些图像"}
        top={top || undefined}
        inputRef={inputRef}
        onFiles={files ? (picked) => void addPageFiles(picked) : undefined}
        canSendEmpty={count > 0}
        dropLabel="添加任何内容"
        failure={SEND_FAILED}
      />
      {/* chatgptConversations.imageGenerationLimit.*, below the composer as there; 升级 is no link here. */}
      {!channel ? (
        <p className="images-limit">此账户无法使用图像生成功能</p>
      ) : reset !== null && (
        <p className="images-limit">
          还可生成 0 张图像。请等到 {new Date(reset * 1000).toLocaleTimeString("zh-CN", { hour: "numeric", minute: "2-digit" })} 用量重置，或升级以获取更多额度。
        </p>
      )}
    </>
  );
}

type EditMode = "remove" | "comment" | "markup";

/** Each mode's tool button (imageSidePanel.*: 擦除 in the image tools, not compact's 移除) and what takes focus in it. */
const MODES: Record<EditMode, { tool: string; focus: string }> = {
  markup: { tool: "标注", focus: ".images-tools-input" },
  comment: { tool: "添加评论", focus: ".images-comment-surface" },
  remove: { tool: "擦除", focus: ".images-brush-size" },
};

/** The paging button the next viewer takes focus on (Viewer's `page`). */
let pagedBy: string | null = null;

/**
 * One image beside the grid (the desktop app's ImagesHistoryPreview): paging, 打开对话 and the
 * tiles (`onLock`) wait while an edit is typed, sent or in a tool's mode, and the viewer stays
 * open while one is sent; Esc closes the 调整大小 menu first, then the mode (its comment editor
 * drops its own draft), then the viewer. 下一张 at the end reads ChatGPT's next page (`onMore`)
 * while it has one. A ChatGPT image opens its chat on chatgpt.com and edits as its bytes; it
 * edits and shares (分享) only with its file and chat known (the desktop app's `j`), and a blocked
 * one never loads.
 */
function Viewer({ images, image, more, onShow, onLock, onMore }: {
  images: GalleryImage[];
  image: GalleryImage;
  /** ChatGPT has another page. */
  more: boolean;
  onShow(key: string | null): void;
  onLock(locked: boolean): void;
  onMore(key: string): Promise<string | null | false>;
}) {
  const channel = useStore(imageChannel);
  const src = image.kind === "local" ? mediaUrl(image.path) : cloudSrc(image);
  const blocked = image.kind === "cloud" && image.blocked;
  const source = image.kind === "local" ? image : image.fileId && image.conversationId ? { fileId: image.fileId } : null;
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(src ? "loading" : "failed");
  const [paging, setPaging] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [mode, setMode] = useState<EditMode | null>(null);
  const paint = useStrokes();
  const [brush, setBrush] = useState(BRUSH.start);
  const [note, setNote] = useState("");
  const [comments, setComments] = useState<ImageComment[]>([]);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [broken, setBroken] = useState(false);
  const [sharing, setSharing] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const alive = useRef(true);
  const index = images.indexOf(image);
  const locked = submitting || mode !== null || prompt.trim().length > 0;
  const editable = channel && status === "ready" && source !== null;
  const last = index >= images.length - 1;

  useEffect(() => {
    onLock(locked);
    return () => onLock(false);
  }, [locked, onLock]);
  // A page that comes in after the viewer closed or moved to another tile pages nothing.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Paging remounts the viewer (keyed per image): focus stays on the paging button, or the other
  // one at the end of the list.
  const page = (key: string, label: string) => {
    pagedBy = label;
    onShow(key);
  };
  const next = async () => {
    if (!last) return page(images[index + 1].key, "下一张图像");
    setMoreFailed(false);
    setPaging(true);
    const found = await onMore(image.key);
    if (!alive.current) return;
    setPaging(false);
    if (found === false) setMoreFailed(true);
    else if (found) page(found, "下一张图像");
  };
  useEffect(() => {
    const label = pagedBy;
    pagedBy = null;
    if (label) (card.current?.querySelector<HTMLElement>(`[aria-label="${label}"]:not(:disabled)`) ?? card.current?.querySelector<HTMLElement>(`[aria-label="上一张图像"]:not(:disabled), [aria-label="下一张图像"]:not(:disabled)`))?.focus();
  }, []);

  // The tools are keyed per mode, so the control that switched it is gone: focus moves into the
  // mode, and back to its tool button out of it.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target) card.current?.querySelector<HTMLElement>(target)?.focus();
  });

  /** Into a tool's mode (null: out of it) with nothing drawn, noted or placed. */
  const enter = (next: EditMode | null) => {
    focusNext.current = next ? MODES[next].focus : mode && `.images-tools [aria-label="${MODES[mode].tool}"]`;
    setResizing(false);
    setMode(next);
    paint.clear();
    setNote("");
    setComments([]);
    setDraft(null);
    setBroken(false);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only from the page (or nothing focused): a dialog, the palette or a menu takes its own Esc. A
      // dialog up takes it with focus on the body too (分享's buttons go disabled under it while they wait).
      const target = event.target instanceof Element && event.target !== document.body ? event.target : null;
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.defaultPrevented || getState().lightbox || dialogOpen() || (target && !target.closest(".main-col"))) return;
      // The comment editor closes itself first, the reference picker (over the page, wherever focus is) before the viewer.
      if (target?.closest(".images-comment-editor") || document.querySelector(".images-dock[data-picking]")) return;
      event.preventDefault();
      event.stopPropagation();
      if (resizing) setResizing(false);
      else if (mode) {
        if (!submitting) enter(null);
      } else if (!submitting) onShow(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [resizing, mode, submitting, onShow]);

  // The source image leads (imagesEdit); the new session opens once it has the message.
  const send = async (task: () => Promise<unknown>) => {
    setSubmitting(true);
    try {
      await task();
    } finally {
      setSubmitting(false);
    }
  };
  const edit = (text: string, second?: string) => (source ? imagesEdit(source, text, second) : Promise.reject(new Error(EDIT_FAILED)));
  const tool = (text: string) => void send(() => edit(text)).catch(fail(EDIT_FAILED));
  const sendRemove = () => void send(async () => edit(editPrompt("remove"), await paintPng("remove", paint.strokes, src))).catch(fail(EDIT_FAILED));
  const sendMarkup = () =>
    void send(async () => {
      const marked = await paintPng("markup", paint.strokes, src).catch(() => null);
      if (marked) await edit(markupPrompt(note.trim()), marked);
      else toast("warning", "无法准备标注。请重试");
    }).catch(fail(EDIT_FAILED));
  const sendComments = () => void send(() => edit(commentPrompt(comments))).catch(fail("未成功添加图像评论"));
  const chat = image.kind === "cloud" ? image.conversationId : null;
  const download = readableSrc(src);
  const save = () => saveImage(download, image.kind === "local" ? image.name : `${image.title || IMAGE_TITLE}.png`).catch(() => toast("warning", "无法下载图像"));
  const cancel = (label: string) => <Button variant="ghost" icon={<Icon name="X" />} label={label} disabled={submitting} onClick={() => enter(null)} />;

  const tools =
    mode === "remove" ? (
      <Fragment key="remove">
        {paint.canUndo || paint.canRedo ? <UndoRedo paint={paint} disabled={submitting} /> : <span className="images-tools-note">在要移除的内容上涂抹</span>}
        <input
          type="range"
          className="images-brush-size"
          aria-label="画笔大小"
          min={BRUSH.min}
          max={BRUSH.max}
          value={brush}
          style={{ "--pos": (brush - BRUSH.min) / (BRUSH.max - BRUSH.min) } as CSSProperties}
          disabled={submitting}
          onChange={(event) => setBrush(Number(event.target.value))}
        />
        <Button variant="primary" disabled={submitting || !paint.canUndo} onClick={sendRemove}>发送</Button>
        {cancel("取消")}
      </Fragment>
    ) : mode === "comment" ? (
      <Fragment key="comment">
        <span className="images-tools-note" data-count={comments.length || undefined}>{comments.length ? `${comments.length} 条评论` : "点击图像以添加评论"}</span>
        <Button variant="primary" disabled={submitting || !comments.length || draft !== null} onClick={sendComments}>发送</Button>
        {cancel("取消")}
      </Fragment>
    ) : mode === "markup" ? (
      <Fragment key="markup">
        <UndoRedo paint={paint} disabled={submitting} />
        <input
          className="input images-tools-input"
          placeholder="添加说明…"
          value={note}
          disabled={submitting}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229 && paint.canUndo && !submitting) sendMarkup();
          }}
        />
        <Button variant="primary" disabled={submitting || !paint.canUndo} onClick={sendMarkup}>发送</Button>
        {cancel("取消标注")}
      </Fragment>
    ) : (
      <Fragment key="tools">
        <Button variant="ghost" icon={<Icon name="Edit" />} label={MODES.markup.tool} disabled={submitting} onClick={() => enter("markup")} />
        <Button variant="ghost" icon={<Icon name="ChatSimple" />} label={MODES.comment.tool} disabled={submitting} onClick={() => enter("comment")} />
        <Button variant="ghost" icon={<Icon name="Image" />} label="移除背景" disabled={submitting} onClick={() => tool(editPrompt("removeBackground"))} />
        <Button variant="ghost" icon={<Icon name="Placeholder" />} label={MODES.remove.tool} disabled={submitting} onClick={() => enter("remove")} />
        <Popover
          open={resizing}
          onClose={() => setResizing(false)}
          placement="top-start"
          anchor={<Button variant="ghost" icon={<Icon name="Expand" />} label="调整大小" disabled={submitting} onClick={() => setResizing(!resizing)} />}
        >
          {ASPECT_RATIOS.map(({ label, ratio }) => (
            <MenuItem key={ratio} label={label} value={ratio} onClick={() => { setResizing(false); tool(editPrompt({ aspectRatio: ratio })); }} />
          ))}
        </Popover>
      </Fragment>
    );

  return (
    <aside className="images-viewer" aria-label={IMAGE_TITLE}>
      <div ref={card} className="images-viewer-card">
        <div className="images-viewer-head" data-tip-group="">
          <Button variant="ghost" icon={<Icon name="CaretLeft" />} label="上一张图像" disabled={locked || paging || index <= 0} onClick={() => page(images[index - 1].key, "上一张图像")} />
          <Button variant="ghost" icon={<Icon name="CaretRight" />} label="下一张图像" disabled={locked || paging || (last && !more)} onClick={() => void next()} />
          {image.kind === "local" ? (
            <Button variant="ghost" icon={<Icon name="ChatSimple" />} disabled={locked} onClick={() => void openThread(image.threadId)}>打开对话</Button>
          ) : (
            chat && <Button variant="ghost" icon={<Icon name="ArrowOutSquare" />} disabled={locked} onClick={() => window.open(`https://chatgpt.com/c/${encodeURIComponent(chat)}`, "_blank", "noopener")}>打开对话</Button>
          )}
          <span className="spacer" />
          <div role="group" aria-label="图像操作" className="images-viewer-actions">
            {/* A ChatGPT image with its chat and file (the desktop app's showShareText button), once it shows; this machine's have none. */}
            {image.kind === "cloud" && shareable(image) && (
              <Button variant="ghost" icon={<Icon name="ArrowUpRight" />} disabled={submitting || status !== "ready"} onClick={() => setSharing(true)}>分享</Button>
            )}
            <Button variant="ghost" icon={<Icon name="Download" />} label="下载图像" disabled={!download} onClick={() => void save()} />
            <Button variant="ghost" icon={<Icon name="X" />} label="关闭" disabled={submitting} onClick={() => onShow(null)} />
          </div>
        </div>
        {sharing && image.kind === "cloud" && <ShareDialog image={image} src={src} onDownload={download ? save : null} onClose={() => setSharing(false)} />}
        {moreFailed && <p className="images-viewer-note" role="alert">无法加载更多图像。请再次点击“下一张图像”</p>}
        <div className="images-viewer-stage" aria-busy={status === "loading" || undefined}>
          {src && (
            <div className="images-frame" hidden={status !== "ready" || broken}>
              <button type="button" className="images-viewer-image" aria-label={(image.kind === "cloud" && image.title) || IMAGE_TITLE} disabled={mode !== null} onClick={() => openLightbox(src, picture.current)}>
                <img key={attempt} ref={picture} src={src} alt="" onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} />
              </button>
              {(mode === "remove" || mode === "markup") && (
                <PaintCanvas key={mode} src={src} mode={mode} pen={mode === "remove" ? brush : PEN} strokes={paint.strokes} onStroke={paint.add} onError={() => setBroken(true)} />
              )}
              {mode === "comment" && <CommentLayer comments={comments} draft={draft} onDraft={setDraft} onChange={setComments} />}
            </div>
          )}
          {status === "loading" && <Spinner size={20} label="正在加载图像…" />}
          {status === "failed" && (
            <div className="images-state" data-column="" role="alert">
              无法加载此图像
              {!blocked && src && <Button variant="secondary" onClick={() => { setStatus("loading"); setAttempt((n) => n + 1); }}>重试预览</Button>}
            </div>
          )}
          {broken && (
            <div className="images-state" data-column="" role="alert">
              无法加载标注。请重新加载后重试
              <Button variant="secondary" onClick={() => enter(null)}>返回图像</Button>
            </div>
          )}
          {editable && !broken && <Toolbar>{tools}</Toolbar>}
        </div>
        {editable && !mode && (
          <div className="images-viewer-edit">
            <CloudComposer
              value={prompt}
              onChange={setPrompt}
              onSend={(text) => send(() => edit(text))}
              disabled={submitting}
              placeholder="描述修改内容"
              label="描述修改内容"
              sendLabel="发送图像编辑指令"
              failure={EDIT_FAILED}
              autoFocus={false}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

type ShareFailure = "blocked" | "create-failed" | "copy-failed";
/** chatgptConversations.shareDialog's inline errors and toasts. */
const SHARE_FAILURES: Record<ShareFailure, string> = { blocked: "此对话无法分享", "create-failed": "无法创建分享链接", "copy-failed": "分享链接已创建，但无法复制" };
const DESTINATIONS = [["x", "X"], ["linkedin", "领英"], ["reddit", "Reddit"]] as const;
// workspaceMediaRightsAudience has no zh-CN; its sibling's (workspaceImageRightsAudienceWithContentType, 26.1027) says the same.
const WORKSPACE_NOTE = "只有工作空间成员可以查看链接。请确认你有权分享这张图像。";

/**
 * 分享 for a ChatGPT image (chatgpt-image-share st over chatgpt-conversation-share-dialog pn).
 * Opening reads the prompt behind it while prompt sharing is on, and makes no other call; 分享形式
 * shows once one is found. 仅图像 previews the image under its title (分享图像 with the choice),
 * 提示及图像 the prompt's card with 编辑图像提示. 复制链接 makes the link if it is not made yet and
 * copies it (已复制 after; the footer's copyLabel, never 创建链接); X, 领英 and Reddit, for a public
 * link, make it too and open their share page;
 * 下载 saves the image. Who the link reaches shows above the actions.
 * ponytail: brand marks are left out (not in the icon font); the destinations are named buttons.
 */
function ShareDialog({ image, src, onDownload, onClose }: { image: CloudImage; src: string; onDownload: (() => Promise<unknown>) | null; onClose(): void }) {
  const promptShare = useImages((s) => s.gates.promptShare);
  const withPrompt = useImages((s) => s.gates.promptShareLabel) === "image_with_prompt";
  const audience = useImages((s) => s.gates.shareAudience);
  const share = useImages((s) => s.shares[shareKey(image)]) ?? NO_SHARE;
  const [source, setSource] = useState<PromptSource | null>(null);
  const [mode, setMode] = useState<"image" | "template">("image");
  const [stage, setStage] = useState<"idle" | "creating" | "copied">("idle");
  const [failure, setFailure] = useState<ShareFailure | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    if (promptShare) readShareSource(image).then(setSource, () => {});
  }, [promptShare]); // eslint-disable-line react-hooks/exhaustive-deps

  const offered = promptShare && source !== null;
  const template = offered && mode === "template" ? source : null;
  const content: PromptContent | null = template ? share.edited ?? { ...template.content, title: share.post?.title ?? template.content.title } : null;
  const link = template ? share.post : share.link;
  const creating = stage === "creating";
  const disabled = creating || failure === "blocked" || (content !== null && !promptValid(content));
  const imageTitle = image.title.trim() || IMAGE_TITLE;
  const title = template ? (withPrompt ? "分享图像及其提示" : "分享提示和图像") : offered ? "分享图像" : imageTitle;
  const heading = audience === "public" ? (template ? "共享此提示的公开链接" : "分享此图像的公开链接") : template ? "共享此提示的链接" : "分享此图像的链接";
  const note = audience === "public" ? (template ? "任何拥有此链接的人都可以查看此提示" : "任何拥有此链接的人都可以查看此图像。请确认你有权分享此图像。") : audience === "workspace" ? WORKSPACE_NOTE : template ? null : "请确认你有权分享这张图像。";

  // A failure says itself here and as a toast; a refused prompt is 此对话无法分享 until it is edited.
  const failed = (error: unknown, kind: ShareFailure) => {
    const shown = template && unpublishable(error) ? "blocked" : kind;
    setFailure(shown);
    setStage("idle");
    toast("danger", SHARE_FAILURES[shown]);
  };
  const make = () => (template ? sharePrompt(image, template) : shareImageLink(image));
  const copy = async () => {
    if (disabled) return;
    setFailure(null);
    setStage("creating");
    let kind: ShareFailure = template || !link ? "create-failed" : "copy-failed";
    try {
      const made = await make();
      kind = "copy-failed";
      await navigator.clipboard.writeText(made.url);
      setStage("copied");
    } catch (error) {
      failed(error, kind);
    }
  };
  const social = async (to: (typeof DESTINATIONS)[number][0]) => {
    if (disabled || audience !== "public") return;
    setFailure(null);
    const before = stage;
    setStage("creating");
    try {
      const made = await make();
      window.open(shareDestination(to, made.url, made.title ?? imageTitle), "_blank", "noopener");
      setStage(before);
    } catch (error) {
      failed(error, "create-failed");
    }
  };
  const download = async () => {
    if (!onDownload || downloading) return;
    setDownloading(true);
    await onDownload();
    setDownloading(false);
  };
  // Another format starts afresh (the desktop app keys the dialog by it); each keeps its own link.
  const pick = (next: "image" | "template") => {
    setMode(next);
    setStage("idle");
    setFailure(null);
  };
  // An unchanged edit saves nothing; a saved one clears the refusal so the prompt can post again.
  const saveEdit = async (next: PromptContent) => {
    if (!template || !content) return;
    if (next.title.trim() !== content.title.trim() || next.prompt !== content.prompt) await savePromptEdit(image, template, { title: next.title.trim(), prompt: next.prompt });
    setFailure(null);
    setStage("idle");
  };

  return (
    <>
      <Dialog
        title={title}
        onClose={onClose}
        // The desktop app's onOpenAutoFocus focuses the popup itself.
        focusPanel
        footer={
          <>
            <Button variant="primary" className="images-share-copy" icon={creating ? <Spinner size={14} inherit /> : <Icon name={stage === "copied" ? "Check" : "Link"} />} disabled={disabled} aria-busy={creating || undefined} onClick={() => void copy()}>
              <span aria-live="polite">{stage === "copied" ? "已复制" : "复制链接"}</span>
            </Button>
            {audience === "public" && DESTINATIONS.map(([to, name]) => <Button key={to} disabled={disabled} onClick={() => void social(to)}>{name}</Button>)}
            {!template && onDownload && <Button icon={<Icon name="Download" />} disabled={downloading} aria-busy={downloading || undefined} onClick={() => void download()}>下载</Button>}
          </>
        }
      >
        <div className="images-share">
          {template && content ? (
            <div className="images-share-card">
              <div className="images-share-card-head">
                {!missing && <img className="images-share-thumb" src={src} alt={imageTitle} draggable={false} onError={() => setMissing(true)} />}
                <Button variant="ghost" className="images-share-edit" icon={<Icon name="Edit" />} label="编辑图像提示" disabled={creating} onClick={() => setEditing(true)} />
              </div>
              <p className="images-share-card-title">{content.title}</p>
              <p className="images-share-card-prompt">{content.prompt}</p>
            </div>
          ) : (
            <div className="images-share-preview">
              {missing ? (
                <span className="images-share-missing">
                  <Icon name="Image" />
                  图像预览不可用
                </span>
              ) : (
                <img src={src} alt={imageTitle} draggable={false} onError={() => setMissing(true)} />
              )}
            </div>
          )}
          {offered && (
            <div className="images-share-mode">
              <Segmented label="分享形式" value={mode} disabled={creating} options={[{ value: "image", label: "仅图像" }, { value: "template", label: withPrompt ? "图像及提示" : "提示及图像" }]} onChange={pick} />
            </div>
          )}
          <div className="images-share-info">
            <p className="images-share-heading">
              {audience !== "unknown" && <Icon name={audience === "public" ? "Globe" : "Organization"} size="sm" />}
              {heading}
            </p>
            {note && <p className="images-share-note">{note}</p>}
          </div>
          {failure && (
            <p className="images-share-error" role="alert">
              {SHARE_FAILURES[failure]}
            </p>
          )}
          {/* The link to copy by hand when the clipboard would not take it (shareDialog.thread.linkLabel). */}
          {failure === "copy-failed" && link && <input className="input" readOnly aria-label="分享链接" value={link.url} onFocus={(event) => event.currentTarget.select()} />}
        </div>
      </Dialog>
      {editing && content && <PromptEditor content={content} onSave={saveEdit} onClose={() => setEditing(false)} />}
    </>
  );
}

/**
 * 编辑图像提示 (chatgpt-image-share Ke): 标题 and 提示, 保存 once both are filled and short enough
 * (promptValid); a refused or failed save stays open to try again, and nothing closes it meanwhile.
 */
function PromptEditor({ content, onSave, onClose }: { content: PromptContent; onSave(content: PromptContent): Promise<void>; onClose(): void }) {
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"blocked" | "failed" | null>(null);
  const form = useId();
  const change = (patch: Partial<PromptContent>) => {
    setDraft({ ...draft, ...patch });
    setError(null);
  };
  const submit = async () => {
    if (saving || !promptValid(draft)) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (failure) {
      setError(unpublishable(failure) ? "blocked" : "failed");
      setSaving(false);
    }
  };
  const close = () => !saving && onClose();
  return (
    <Dialog
      title={
        <span className="images-share-edit-title">
          <Button variant="ghost" size="sm" icon={<Icon name="ArrowLeft" />} label="返回" disabled={saving} onClick={close} />
          编辑图像提示
        </span>
      }
      onClose={close}
      closeButton={!saving}
      footer={
        <>
          <Button disabled={saving} onClick={close}>取消</Button>
          <Button type="submit" form={form} variant="primary" disabled={saving || !promptValid(draft)} aria-busy={saving || undefined}>
            {saving && <Spinner size={14} inherit />}
            保存
          </Button>
        </>
      }
    >
      <form
        id={form}
        className="images-share-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void submit();
        }}
      >
        <fieldset className="images-share-fields" disabled={saving}>
          <label className="images-share-field">
            <span className="images-share-label">标题</span>
            <textarea className="input" data-autofocus="" rows={1} maxLength={400} required value={draft.title} onChange={(event) => change({ title: event.target.value })} />
          </label>
          <label className="images-share-field">
            <span className="images-share-label">提示</span>
            <textarea className="input" rows={2} maxLength={200_000} required value={draft.prompt} onChange={(event) => change({ prompt: event.target.value })} />
          </label>
        </fieldset>
        {error && (
          <p className="images-share-error" role="alert">
            {error === "blocked" ? "此提示无法分享。请编辑后重试。" : "无法保存你的修改。请重试。"}
          </p>
        )}
      </form>
    </Dialog>
  );
}

/** Where the tools sit off the stage's bottom centre (px): kept while paging, as the desktop app keeps it. */
let toolbarOffset = { x: 0, y: 0 };
const TOOLBAR_EDGE = 8;

/**
 * The floating tools (imageSidePanel.tools, the desktop app's movable toolbar): at the bottom
 * centre of the stage, dragged by the handle or moved 10px an arrow key, Home back; kept inside
 * the stage as it or the tools change size. ponytail: not remembered across visits (the desktop
 * app stores image-editing-toolbar-position-v2).
 */
function Toolbar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const grab = useRef<{ id: number; x: number; y: number; from: typeof toolbarOffset } | null>(null);
  const [offset, setOffset] = useState(toolbarOffset);
  const hint = useId();
  const move = (to: typeof toolbarOffset) => {
    const node = bar.current;
    const stage = node?.parentElement;
    if (!node || !stage) return;
    const x = Math.max(0, (stage.clientWidth - node.offsetWidth) / 2 - TOOLBAR_EDGE);
    const y = Math.max(0, stage.clientHeight - node.offsetHeight - 2 * TOOLBAR_EDGE);
    const next = { x: Math.min(Math.max(to.x, -x), x), y: Math.min(Math.max(to.y, -y), 0) };
    toolbarOffset = next;
    setOffset((current) => (current.x === next.x && current.y === next.y ? current : next));
  };
  useEffect(() => {
    const node = bar.current;
    if (!node?.parentElement) return;
    const observer = new ResizeObserver(() => move(toolbarOffset));
    observer.observe(node);
    observer.observe(node.parentElement);
    return () => observer.disconnect();
  }, []);
  const release = (event: ReactPointerEvent) => {
    if (grab.current?.id === event.pointerId) grab.current = null;
  };
  const steps: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
  return (
    <div ref={bar} role="toolbar" aria-label="图像编辑工具" className="images-tools" data-tip-group="" style={{ translate: `${offset.x}px ${offset.y}px` }}>
      <button
        type="button"
        className="images-tools-handle"
        aria-label="移动工具栏"
        aria-describedby={hint}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          grab.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: offset };
        }}
        onPointerMove={(event) => {
          const from = grab.current;
          if (from?.id === event.pointerId) move({ x: from.from.x + event.clientX - from.x, y: from.from.y + event.clientY - from.y });
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(event) => {
          const step = steps[event.key];
          if (!step && event.key !== "Home") return;
          event.preventDefault();
          event.stopPropagation();
          move(step ? { x: offset.x + step[0], y: offset.y + step[1] } : { x: 0, y: 0 });
        }}
      >
        <Icon name="Reorder" />
      </button>
      <span id={hint} hidden>拖动或使用方向键移动。按 Home 键重置。</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawing: 移除's mask, 标注's marked-up copy and the 绘图 sketch

type PaintMode = "markup" | "remove" | "sketch";

/** A stroke in the canvas's own pixels (the image's natural size, a sketch's 1024 square). */
interface Stroke {
  width: number;
  points: [number, number][];
}

const SKETCH_SIZE = 1024;
/** 移除's brush on the desktop app's scale (image-tools-toolbar): 5 to 130, 70 to start; a stroke is the shorter side × size / 500 wide. */
const BRUSH = { min: 5, max: 130, start: 70 };
/** 标注's and the sketch's pen on that scale. ponytail: one width, no pen size or colour (the desktop app's editor has them). */
const PEN = 6;
const RED = "#e33b33";

const strokeWidth = (width: number, height: number, pen: number) => (Math.min(width, height) * pen) / 500;

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], ink: string) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const { width, points } of strokes) {
    ctx.beginPath();
    if (points.length === 1) {
      // A tap is a dot: a zero-length line draws nothing.
      ctx.arc(points[0][0], points[0][1], width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.lineWidth = width;
    points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法加载此图像"));
    image.src = src;
  });

/**
 * The PNG a mode sends, as a data URL: 标注 is the image with its red strokes, 移除 a mask the
 * image's size (white strokes on black), the sketch black strokes on 1024 white. The image comes
 * from mediaUrl, same origin, so the canvas stays untainted; a tainted one throws a SecurityError.
 */
async function paintPng(mode: PaintMode, strokes: Stroke[], src?: string): Promise<string> {
  const image = src ? await loadImage(src) : null;
  const canvas = document.createElement("canvas");
  canvas.width = image?.naturalWidth ?? SKETCH_SIZE;
  canvas.height = image?.naturalHeight ?? SKETCH_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  if (mode === "markup" && image) {
    ctx.drawImage(image, 0, 0);
  } else {
    ctx.fillStyle = mode === "remove" ? "#000" : "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawStrokes(ctx, strokes, mode === "markup" ? RED : mode === "remove" ? "#fff" : "#000");
  return canvas.toDataURL("image/png");
}

/** A stroke stack with its redo stack (image-tools-toolbar's 撤销 / 重做): a new stroke clears redo. */
function useStrokes() {
  const [stack, setStack] = useState<{ done: Stroke[]; undone: Stroke[] }>({ done: [], undone: [] });
  return {
    strokes: stack.done,
    canUndo: stack.done.length > 0,
    canRedo: stack.undone.length > 0,
    add: (stroke: Stroke) => setStack((s) => ({ done: [...s.done, stroke], undone: [] })),
    undo: () => setStack((s) => (s.done.length ? { done: s.done.slice(0, -1), undone: [...s.undone, s.done[s.done.length - 1]] } : s)),
    redo: () => setStack((s) => (s.undone.length ? { done: [...s.done, s.undone[s.undone.length - 1]], undone: s.undone.slice(0, -1) } : s)),
    clear: () => setStack({ done: [], undone: [] }),
  };
}

function UndoRedo({ paint, disabled = false }: { paint: ReturnType<typeof useStrokes>; disabled?: boolean }) {
  return (
    <>
      <Button variant="ghost" icon={<Icon name="ArrowCounterClockwise" />} label="撤销" disabled={disabled || !paint.canUndo} onClick={paint.undo} />
      <Button variant="ghost" icon={<Icon name="ArrowClockwise" />} label="重做" disabled={disabled || !paint.canRedo} onClick={paint.redo} />
    </>
  );
}

/**
 * A canvas to draw on (在图像上绘图; 移除's is 标记要移除的区域): laid over the image at its
 * natural size, or a 1024 white square for a sketch. The strokes are the caller's (useStrokes);
 * pointer events with capture, so a finger draws as a mouse does; 移除 rings the pointer at the
 * brush's size. `onError`: the image would not load.
 */
export function PaintCanvas({ src, mode, pen, strokes, onStroke, onError }: {
  src?: string;
  mode: PaintMode;
  /** The pen on the desktop app's 5–130 scale. */
  pen: number;
  strokes: Stroke[];
  onStroke(stroke: Stroke): void;
  onError?(): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ id: number; stroke: Stroke } | null>(null);
  const [size, setSize] = useState<[number, number] | null>(src ? null : [SKETCH_SIZE, SKETCH_SIZE]);
  const [ring, setRing] = useState<{ x: number; y: number; d: number } | null>(null);

  useEffect(() => {
    if (!src) return;
    let current = true;
    loadImage(src).then(
      (image) => current && setSize([image.naturalWidth, image.naturalHeight]),
      () => current && onError?.(),
    );
    return () => {
      current = false;
    };
  }, [src]);

  // 移除 draws in the canvas's CSS colour on screen and white in its mask.
  const ink = (node: HTMLCanvasElement) => (mode === "remove" ? getComputedStyle(node).color : mode === "markup" ? RED : "#000");
  const redraw = () => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    ctx.clearRect(0, 0, node.width, node.height);
    if (mode === "sketch") {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, node.width, node.height);
    }
    drawStrokes(ctx, strokes, ink(node));
  };
  useEffect(redraw, [size, strokes]);

  if (!size) return null;
  // ponytail: same mapping as Browser's Annotate; merge them on a third caller
  const at = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const node = event.currentTarget;
    const r = node.getBoundingClientRect();
    return [((event.clientX - r.left) * node.width) / r.width, ((event.clientY - r.top) * node.height) / r.height];
  };
  const draw = (node: HTMLCanvasElement, stroke: Stroke) => {
    const ctx = node.getContext("2d");
    if (ctx) drawStrokes(ctx, [stroke], ink(node));
  };
  // Up keeps the stroke; a cancel (the browser took the pointer) drops it.
  const end = (event: ReactPointerEvent, keep: boolean) => {
    const drawn = live.current;
    if (drawn?.id !== event.pointerId) return;
    live.current = null;
    if (keep) onStroke(drawn.stroke);
    else redraw();
  };
  return (
    <>
      <canvas
        ref={canvas}
        className="images-paint"
        data-mode={mode}
        width={size[0]}
        height={size[1]}
        aria-label={mode === "remove" ? "标记要移除的区域" : "在图像上绘图"}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const stroke = { width: strokeWidth(size[0], size[1], pen), points: [at(event)] };
          live.current = { id: event.pointerId, stroke };
          draw(event.currentTarget, stroke);
        }}
        onPointerMove={(event) => {
          const node = event.currentTarget;
          if (mode === "remove") {
            const r = node.getBoundingClientRect();
            setRing({ x: event.clientX - r.left, y: event.clientY - r.top, d: (strokeWidth(size[0], size[1], pen) * r.width) / node.width });
          }
          const drawn = live.current;
          if (drawn?.id !== event.pointerId) return;
          const point = at(event);
          draw(node, { width: drawn.stroke.width, points: [drawn.stroke.points[drawn.stroke.points.length - 1], point] });
          drawn.stroke.points.push(point);
        }}
        onPointerUp={(event) => end(event, true)}
        onPointerCancel={(event) => end(event, false)}
        onPointerLeave={() => setRing(null)}
      />
      {ring && <span className="images-brush" aria-hidden="true" style={{ left: ring.x, top: ring.y, width: ring.d, height: ring.d }} />}
    </>
  );
}

/**
 * 绘图 (composer.sketch.*): a 1024 white square to draw on; 保存 hands back 草图.png as a data URL
 * (the composer's draft image shape) and the caller closes the dialog.
 */
export function SketchDialog({ onClose, onSave }: { onClose(): void; onSave(image: { name: string; url: string }): void }) {
  const paint = useStrokes();
  const save = () => void paintPng("sketch", paint.strokes).then((url) => onSave({ name: "草图.png", url }), fail("Sketch 目前不可用"));
  return (
    <Dialog
      title="绘图"
      onClose={onClose}
      focusPanel
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!paint.canUndo} onClick={save}>保存</Button>
        </>
      }
    >
      <div className="images-sketch">
        <div className="images-sketch-tools" data-tip-group="">
          <UndoRedo paint={paint} />
        </div>
        <PaintCanvas mode="sketch" pen={PEN} strokes={paint.strokes} onStroke={paint.add} />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A prompt card's preview (the desktop app's ImagePromptPreviewDialog)

const RATIOS = ["auto", "1:1", "2:3", "3:2", "16:9", "9:16"];
const ratioLabel = (ratio: string) => (ratio === "auto" ? "自动" : ratio);

/** A photo the preview sends: a file picked, pasted or dropped (its data URL), or a ChatGPT one read as its bytes. */
interface Photo {
  key: string;
  name: string;
  fileId: string | null;
  url: string | null;
  status: "loading" | "ready" | "error";
}

/**
 * The example beside the card's prompt (four lines, 展开更多), 宽高比例 (自动 or a ratio, said
 * after the prompt) and the photos it takes (推荐图片: upload, saved references, the photos picked,
 * recent uploads; between the action's min_count and max_count, five at most); 试一试 starts the
 * image session with the picked photos. Pasting and dropping add photos here while it is open.
 */
function PreviewDialog({ item, onClose }: { item: PromptItem; onClose(): void }) {
  const channel = useStore(imageChannel);
  const spent = useStore((s) => imageQuotaReset(s) !== null);
  const blocked = !channel || spent;
  // The desktop app's availability reads failing (无法检查是否可用): /api/images/available here.
  const unchecked = useImages((s) => s.availabilityError);
  const savedReferences = useImages((s) => s.gates.savedReferences);
  const [ratio, setRatio] = useState("auto");
  const [choosing, setChoosing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  const [missing, setMissing] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [recent, setRecent] = useState<RecentPhoto[] | "error" | null>(null);
  const [saved, setSaved] = useState<SavedReference[] | "error" | null>(null);
  const [dropped, setDropped] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const promptId = useId();

  const readRecent = () => {
    setRecent(null);
    loadUploads().then(setRecent, () => setRecent("error"));
  };
  // Saved references only where QKa lets them in (server/images.mjs savedReferences): read then, else neither shown nor asked.
  const readSaved = () => {
    setSaved(null);
    loadReferences().then(setSaved, () => setSaved("error"));
  };
  useEffect(() => readRecent(), []);
  useEffect(() => {
    if (savedReferences) readSaved();
  }, [savedReferences]);
  // 展开更多 shows once the four lines cut the prompt short.
  useLayoutEffect(() => {
    const node = text.current;
    if (!node || expanded) return;
    const check = () => setLong(node.scrollHeight > node.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  const max = Math.min(item.action.max ?? MAX_IMAGES, MAX_IMAGES);
  const ready = photos.filter((photo) => photo.status === "ready");
  const uploading = photos.some((photo) => photo.status === "loading");
  const errored = photos.some((photo) => photo.status === "error");
  const full = photos.length >= max;
  const needsPhoto = !blocked && !unchecked && !uploading && !errored && ready.length < item.action.min;
  const disabled = blocked || unchecked || uploading || errored || ready.length < item.action.min || ready.length > max;

  const update = (key: string, patch: Partial<Photo>) => setPhotos((current) => current.map((photo) => (photo.key === key ? { ...photo, ...patch } : photo)));
  const remove = (key: string) => {
    setDropped(false);
    setPhotos((current) => current.filter((photo) => photo.key !== key));
  };
  const addFiles = (files: File[]) => {
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES);
    const room = Math.max(0, max - photos.length);
    setDropped(images.length !== files.length || images.length > room);
    void Promise.all(images.slice(0, room).map(async (file): Promise<Photo> => ({ key: crypto.randomUUID(), name: file.name || "粘贴的图片", fileId: null, url: await readAsDataUrl(file), status: "ready" }))).then(
      (read) => setPhotos((current) => [...current, ...read].slice(0, max)),
      () => setDropped(true),
    );
  };
  usePageDrop(true, (files) => addFiles([...files]));
  // A saved or recent photo: picked again, it goes; else read as its bytes ("照片上传中…" meanwhile).
  const pick = (fileId: string, name: string) => {
    const chosen = photos.find((photo) => photo.fileId === fileId);
    if (chosen) return remove(chosen.key);
    if (full) return;
    const key = crypto.randomUUID();
    setDropped(false);
    setPhotos((current) => [...current, { key, name, fileId, url: null, status: "loading" }]);
    fileBytes(fileId).then((url) => update(key, { url, status: "ready" }), () => update(key, { status: "error" }));
  };
  const submit = async () => {
    if (disabled || submitting) return;
    setSubmitting(true);
    setFailed(false);
    try {
      await imagesSend(aspectInstruction(item.prompt, ratio === "auto" ? null : ratio), ready.map((photo) => ({ type: "image" as const, url: photo.url! })));
      onClose();
    } catch {
      setFailed(true);
      setSubmitting(false);
    }
  };

  const savedList = savedReferences && Array.isArray(saved) ? saved : [];
  const savedIds = new Set(savedList.flatMap((ref) => (ref.fileId ? [ref.fileId] : [])));
  const recentIds = new Set(Array.isArray(recent) ? recent.map((photo) => photo.fileId) : []);
  const pressed = (fileId: string | null) => !!fileId && ready.some((photo) => photo.fileId === fileId);
  // Picked photos show on their own until a saved or recent one is in; it then shows pressed in its place.
  const own = photos.filter((photo) => photo.status !== "ready" || !photo.fileId || (!savedIds.has(photo.fileId) && !recentIds.has(photo.fileId)));
  const scroll = (by: number) => row.current?.scrollBy({ left: by * row.current.clientWidth, behavior: "smooth" });
  const art = imageSrc(item.image);

  return (
    <Dialog title={item.title} onClose={onClose} size="3xl" closeButton={false}>
      <form
        className="images-preview"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        onPaste={(event) => {
          if (!event.clipboardData.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          if (!full) addFiles([...event.clipboardData.files]);
        }}
      >
        <div className="images-preview-art">
          {art && !missing ? (
            <img src={art} alt={item.alt || item.title} draggable={false} onError={() => setMissing(true)} />
          ) : (
            <div className="images-preview-missing">
              <Icon name="Image" />
              预览图不可用
            </div>
          )}
        </div>
        <div className="images-preview-side">
          <div className="images-preview-head">
            <p className="images-preview-title" aria-hidden="true">{item.title}</p>
            <Button variant="ghost" icon={<Icon name="X" size={20} />} label="关闭对话框" tip="" data-autofocus="" onClick={onClose} />
          </div>
          <div className="images-preview-body">
            <section className="images-preview-prompt">
              <p id={promptId} ref={text} className="images-preview-text" data-clamped={!expanded || undefined}>{item.prompt}</p>
              {(expanded || long) && (
                <span className="images-preview-more" data-expanded={expanded || undefined}>
                  {!expanded && <span aria-hidden="true">…</span>}
                  <button type="button" className="link-btn" aria-expanded={expanded} aria-controls={promptId} onClick={() => setExpanded(!expanded)}>
                    {expanded ? "收起提示词" : "展开更多"}
                  </button>
                </span>
              )}
            </section>
            <fieldset className="images-preview-field" disabled={submitting}>
              <legend className="sr-only">宽高比例</legend>
              <span className="images-preview-label">宽高比例</span>
              <Popover
                open={choosing}
                onClose={() => setChoosing(false)}
                placement="bottom-end"
                className="menu-select-menu"
                anchor={
                  <Button variant="ghost" className="menu-select" aria-label={`宽高比例：${ratioLabel(ratio)}`} disabled={submitting} onClick={() => setChoosing(!choosing)}>
                    <span className="menu-select-value">{ratioLabel(ratio)}</span>
                    <Icon name="CaretDown" size="sm" className="caret" />
                  </Button>
                }
              >
                {RATIOS.map((value) => {
                  const [w, h] = value === "auto" ? [1, 1] : value.split(":").map(Number);
                  return (
                    <MenuItem
                      key={value}
                      icon={<span className="images-ratio" data-auto={value === "auto" || undefined} style={{ "--r": w / h } as CSSProperties} />}
                      label={ratioLabel(value)}
                      checked={value === ratio}
                      onClick={() => {
                        setChoosing(false);
                        setRatio(value);
                      }}
                    />
                  );
                })}
              </Popover>
            </fieldset>
            <fieldset className="images-preview-photos" disabled={submitting}>
              <legend className="sr-only">照片</legend>
              <div className="images-preview-row-head" data-tip-group="">
                <span className="images-preview-label">推荐图片</span>
                <span className="spacer" />
                <Button variant="ghost" size="sm" icon={<Icon name="CaretLeft" />} label="上一组推荐图片" onClick={() => scroll(-1)} />
                <Button variant="ghost" size="sm" icon={<Icon name="CaretRight" />} label="下一组推荐图片" onClick={() => scroll(1)} />
              </div>
              <div ref={row} className="images-preview-row" role="group" aria-label="推荐图片">
                <button type="button" className="images-photo-tile" aria-label="上传照片" data-tip="上传照片" disabled={full} onClick={() => picker.current?.click()}>
                  <Icon name="Add" />
                </button>
                {savedList.map((ref) => (
                  <button
                    key={ref.id}
                    type="button"
                    className="images-photo-tile"
                    aria-label={ref.name}
                    data-tip={ref.name}
                    aria-pressed={pressed(ref.fileId)}
                    disabled={!ref.fileId || (!pressed(ref.fileId) && full)}
                    onClick={() => ref.fileId && pick(ref.fileId, ref.name)}
                  >
                    <CardArt src={photoSrc(ref.url, ref.thumbFileId)} />
                  </button>
                ))}
                {own.map((photo) => (
                  <div key={photo.key} className="images-photo">
                    <button type="button" className="images-photo-tile" aria-label={photo.name} aria-pressed="true" aria-busy={photo.status === "loading" || undefined} onClick={() => remove(photo.key)}>
                      {photo.status === "loading" ? <Spinner size={16} /> : <CardArt src={photo.url ?? ""} />}
                    </button>
                    <button type="button" className="images-photo-remove" aria-label={`移除 ${photo.name}`} data-tip={`移除 ${photo.name}`} onClick={() => remove(photo.key)}>
                      <Icon name="X" size="xs" />
                    </button>
                  </div>
                ))}
                {recent === null && <span className="images-photo-tile images-card-skeleton" aria-hidden="true" />}
                {Array.isArray(recent) &&
                  recent.map((photo, index) =>
                    savedIds.has(photo.fileId) ? null : (
                      <button
                        key={photo.fileId}
                        type="button"
                        className="images-photo-tile"
                        aria-label={`照片 ${index + 1}`}
                        aria-pressed={pressed(photo.fileId)}
                        disabled={!pressed(photo.fileId) && full}
                        onClick={() => pick(photo.fileId, `照片 ${index + 1}`)}
                      >
                        <CardArt src={photoSrc(photo.url)} />
                      </button>
                    ),
                  )}
              </div>
              {savedReferences && saved === "error" && (
                <div className="images-preview-error" role="alert">
                  无法加载已保存的参考图像
                  <Button variant="ghost" size="sm" onClick={readSaved}>重试</Button>
                </div>
              )}
              {recent === "error" && (
                <div className="images-preview-error" role="alert">
                  无法加载最近的照片
                  <Button variant="ghost" size="sm" onClick={readRecent}>重试</Button>
                </div>
              )}
              <input
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={full}
                onChange={(event) => {
                  addFiles([...(event.currentTarget.files ?? [])]);
                  event.currentTarget.value = "";
                }}
              />
            </fieldset>
          </div>
          <div className="images-preview-foot">
            <div className="images-preview-status" aria-live="polite">
              {unchecked && (
                <div className="images-preview-error" role="alert">
                  无法检查是否可用
                  <Button variant="ghost" size="sm" onClick={() => void refreshImagesAvailable(true)}>重试</Button>
                </div>
              )}
              {blocked && <span>当前无法生成图像。请稍后重试</span>}
              {uploading && <span>照片上传中…</span>}
              {(dropped || errored) && <span role="alert">未能添加所有照片。请先移除未成功上传的照片，再重新添加。</span>}
              {failed && <span role="alert">未能启动图像生成。请重试</span>}
            </div>
            <span className="images-preview-try" data-tip={needsPhoto && !submitting ? "添加一张照片，即可尝试" : undefined}>
              <Button type="submit" variant="primary" disabled={disabled || submitting} aria-busy={submitting || undefined}>
                {submitting && <Spinner size={14} inherit />}
                试一试
              </Button>
            </span>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// With the preview off: the photo dialog and the reference picker's photos

/**
 * A styles card's photo dialog (the desktop app's ImagePromptDialog): the card's description or
 * title, its prompt in three lines, the four latest uploads (one picked sends with it) and
 * 选择一张新照片 (the photos chosen, pasted or dropped send with them). A prompt-only card shows its
 * prompt in a box that opens on a click and 创建图像 sends it as it is (the dialog's own surface:
 * on the 图像 page only styles cards come here).
 */
function PromptDialog({ item, onClose, onSend }: { item: PromptItem; onClose(): void; onSend(urls: string[]): void }) {
  const promptOnly = item.action.source === "prompt_only";
  const [open, setOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // Photos still being read when the dialog closes (取消, Esc, the scrim) send nothing.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const take = (files: File[]) =>
    void readImages(files).then((read) => {
      if (alive.current && read.length) onSend(read.slice(0, MAX_IMAGES).map((image) => image.url));
    }, fail(SEND_FAILED));
  usePageDrop(!promptOnly, (files) => take([...files]));
  return (
    <Dialog title={item.description || item.title} onClose={onClose} closeButton={false}>
      <form
        className="images-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          if (promptOnly) onSend([]);
        }}
        onPaste={(event) => {
          if (promptOnly || !event.clipboardData.files.length) return;
          event.preventDefault();
          event.stopPropagation();
          take([...event.clipboardData.files]);
        }}
      >
        {promptOnly ? (
          <button type="button" className="images-prompt-box" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="images-prompt-full" data-clamped={!open || undefined}>{item.prompt}</span>
          </button>
        ) : (
          <>
            <p className="images-prompt-text">{item.prompt}</p>
            <RecentPhotos layout="recents" disabled={false} onPick={(image) => onSend([image.url])} />
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                take([...(event.currentTarget.files ?? [])]);
                event.currentTarget.value = "";
              }}
            />
          </>
        )}
        <div className="images-prompt-actions">
          <Button onClick={onClose}>取消</Button>
          {promptOnly ? (
            <Button type="submit" variant="primary">创建图像</Button>
          ) : (
            <Button variant="primary" onClick={() => picker.current?.click()}>选择一张新照片</Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/**
 * ChatGPT's recent uploads to attach (uploads-integration-rail G): the reference picker's carousel
 * (返回建议 and 添加照片 over 上传照片 and every recent upload, a page at a time) or the photo
 * dialog's 最近 row (four squares; nothing at all when there are none). A pick reads the photo's
 * bytes and hands it on as 相片 {position}; one that fails says so under its tile and is picked
 * again to retry. In the carousel a photo already in the composer waits.
 */
function RecentPhotos({ layout, disabled, onBack, onUpload, onPick }: {
  layout: "carousel" | "recents";
  disabled: boolean;
  onBack?(): void;
  onUpload?(): void;
  onPick(image: { name: string; url: string; fileId: string }): void;
}) {
  const [recent, setRecent] = useState<RecentPhoto[] | "error" | null>(null);
  const [tiles, setTiles] = useState<Record<string, "loading" | "error">>({});
  const draft = useImages((s) => s.draft.images);
  const row = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const carousel = layout === "carousel";
  const read = () => {
    setRecent(null);
    loadUploads().then(setRecent, () => setRecent("error"));
  };
  useEffect(() => {
    alive.current = true;
    read();
    return () => {
      alive.current = false;
    };
  }, []);
  if (!carousel && Array.isArray(recent) && !recent.length) return null;

  const attached = new Set(carousel ? draft.flatMap((image) => (image.fileId ? [image.fileId] : [])) : []);
  const pick = (photo: RecentPhoto, index: number) => {
    setTiles((current) => ({ ...current, [photo.fileId]: "loading" }));
    fileBytes(photo.fileId).then(
      (url) => {
        setTiles((current) => {
          const next = { ...current };
          delete next[photo.fileId];
          return next;
        });
        if (alive.current) onPick({ name: `相片 ${index + 1}`, url, fileId: photo.fileId });
      },
      () => setTiles((current) => ({ ...current, [photo.fileId]: "error" })),
    );
  };
  const photos =
    recent === null
      ? Array.from({ length: 4 }, (_, index) => <span key={index} className="images-recent-tile images-card-skeleton" aria-hidden="true" />)
      : Array.isArray(recent)
        ? (carousel ? recent : recent.slice(0, 4)).map((photo, index) => (
            <div key={photo.fileId} className="images-recent-item">
              <button
                type="button"
                className="images-recent-tile"
                aria-label={`最近上传 ${index + 1}`}
                aria-busy={tiles[photo.fileId] === "loading" || undefined}
                disabled={disabled || tiles[photo.fileId] === "loading" || attached.has(photo.fileId)}
                onClick={() => pick(photo, index)}
              >
                {tiles[photo.fileId] === "loading" ? <Spinner size={16} /> : <CardArt src={photoSrc(photo.url)} />}
              </button>
              {tiles[photo.fileId] === "error" && <span className="images-recent-error" role="alert">无法加载照片</span>}
            </div>
          ))
        : null;
  const scroll = (by: number) => row.current?.scrollBy({ left: by * row.current.clientWidth, behavior: "smooth" });

  return (
    <section className="images-recent" data-layout={layout}>
      {recent === "error" && (
        <div className="images-preview-error" role="alert">
          无法加载最近的照片
          <Button variant="ghost" size="sm" onClick={read}>重试</Button>
        </div>
      )}
      {carousel ? (
        <>
          <div className="images-picker-head" data-tip-group="">
            {onBack && <Button variant="secondary" className="images-picker-back" icon={<Icon name="ArrowLeft" />} label="返回建议" onClick={onBack} />}
            <h2 className="images-picker-title">添加照片</h2>
            <span className="spacer" />
            <Button variant="ghost" size="sm" icon={<Icon name="CaretLeft" />} label="上一页照片" onClick={() => scroll(-1)} />
            <Button variant="ghost" size="sm" icon={<Icon name="CaretRight" />} label="下一页照片" onClick={() => scroll(1)} />
          </div>
          <div ref={row} className="images-picker-row" role="group" aria-label="参考照片">
            <button type="button" className="images-picker-upload" disabled={disabled} onClick={onUpload}>
              <Icon name="Add" />
              <span className="images-picker-upload-label">上传照片</span>
            </button>
            {photos}
          </div>
        </>
      ) : (
        <>
          <h2 className="images-recent-title">最近</h2>
          <div className="images-recent-row">{photos}</div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 添加评论

interface ImageComment {
  /** 0 to 1 across and down the image. */
  x: number;
  y: number;
  text: string;
}

interface CommentDraft extends ImageComment {
  /** The comment being edited; null for a new one. */
  index: number | null;
}

/**
 * 添加评论's layer over the image (imageSidePanel.commentSurface …): a click places a numbered
 * draft with 添加评论… at that spot (a keyboard press: the centre); a saved comment's number opens
 * it again to 保存, 取消 or 删除评论; Esc in the editor drops the draft.
 */
function CommentLayer({ comments, draft, onDraft, onChange }: {
  comments: ImageComment[];
  draft: CommentDraft | null;
  onDraft(draft: CommentDraft | null): void;
  onChange(comments: ImageComment[]): void;
}) {
  const save = () => {
    const text = draft?.text.trim();
    if (!draft || !text) return;
    onChange(draft.index === null ? [...comments, { x: draft.x, y: draft.y, text }] : comments.map((comment, index) => (index === draft.index ? { ...comment, text } : comment)));
    onDraft(null);
  };
  const place = (point: ImageComment) => ({ left: `${point.x * 100}%`, top: `${point.y * 100}%` });
  return (
    <>
      <button
        type="button"
        className="images-comment-surface"
        aria-label="图像评论区域"
        onClick={(event) => {
          const r = event.currentTarget.getBoundingClientRect();
          const [x, y] = event.detail === 0 ? [0.5, 0.5] : [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height];
          onDraft({ x, y, text: "", index: null });
        }}
      />
      {comments.map((comment, index) =>
        index === draft?.index ? null : (
          <button key={index} type="button" className="images-comment-pin" style={place(comment)} aria-label={`编辑评论 ${index + 1}`} data-tip={comment.text} onClick={() => onDraft({ ...comment, index })}>
            {index + 1}
          </button>
        ),
      )}
      {draft && (
        <>
          <span className="images-comment-pin" data-draft="" style={place(draft)} aria-hidden="true">
            {(draft.index ?? comments.length) + 1}
          </span>
          <form
            key={`${draft.index}:${draft.x}:${draft.y}`}
            className="images-comment-editor"
            data-above={draft.y > 0.6 || undefined}
            style={{ "--x": draft.x, "--y": draft.y } as CSSProperties}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.stopPropagation();
              onDraft(null);
            }}
          >
            {draft.index === null ? (
              <div className="images-comment-row">
                <input className="input" autoFocus aria-label="添加评论" placeholder="添加评论…" value={draft.text} onChange={(event) => onDraft({ ...draft, text: event.target.value })} />
                <Button type="submit" variant="primary" icon={<Icon name="ArrowUp" />} label="添加评论" disabled={!draft.text.trim()} />
              </div>
            ) : (
              <>
                <textarea
                  className="input"
                  autoFocus
                  rows={3}
                  aria-label={`编辑评论 ${draft.index + 1}`}
                  value={draft.text}
                  onChange={(event) => onDraft({ ...draft, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      save();
                    }
                  }}
                />
                <div className="images-comment-row">
                  <Button
                    variant="ghost"
                    icon={<Icon name="Trash" />}
                    label="删除评论"
                    onClick={() => {
                      onChange(comments.filter((_, index) => index !== draft.index));
                      onDraft(null);
                    }}
                  />
                  <span className="spacer" />
                  <Button onClick={() => onDraft(null)}>取消</Button>
                  <Button type="submit" variant="primary" disabled={!draft.text.trim()}>保存</Button>
                </div>
              </>
            )}
          </form>
        </>
      )}
    </>
  );
}
