// The 图像 page in the main column (lib/images.ts): the Codex desktop app 26.1023's /images in
// Claude's page parts. 我的图像 lists the images generated on this machine as square tiles (the
// desktop app's history grid); one opens in a viewer column on the right with 上一张 / 下一张,
// 打开对话, 下载 and the edit tools on a floating toolbar (标注, 添加评论, 移除背景, 擦除, 调整大小)
// over 描述修改内容; the composer at the foot starts an image session. Every send opens its new
// session, as the desktop app moves to /c/<id>. SketchDialog is the 绘图 board (P3's sketch card).

import { Component, Fragment, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fail, newChat, openThread } from "../lib/codex";
import { mediaUrl } from "../lib/files";
import {
  ASPECT_RATIOS, addDraftImages, commentPrompt, editPrompt, imageChannel, imageQuotaReset, imagesEdit, loadLocal, markupPrompt, removeDraftImage, sendDraft, setDraftText, useImages,
  type LocalImage,
} from "../lib/images";
import { getState, toast, useStore } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, readAsDataUrl } from "./Composer";
import { saveImage } from "./FileMenu";
import { openLightbox } from "./Lightbox";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Dialog, Icon, MenuItem, Popover, Spinner } from "./ui";

const IMAGE_TITLE = "生成的图像";
const EDIT_FAILED = "未能编辑此图像。请重试";

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
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const slot = useLiftSlot();
  const [viewing, setViewing] = useState<string | null>(null);
  // The viewer's lock (an edit typed, sent or in a tool's mode) holds the tiles too.
  const [locked, setLocked] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = (local ?? []).filter((image) => !hidden.has(image.path));
  const viewed = shown.find((image) => image.path === viewing);

  // The desktop app's Navigate to "/" once the entry goes (another login, in_app_chat off).
  useEffect(() => {
    if (entry === null) newChat();
  }, [entry]);
  useEffect(() => {
    document.title = "图像 - Codex";
  }, []);
  useEffect(() => void loadLocal(), []);

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
        <div className="session-chat">
          <div className="images-scroll">
            <div className="images-page">
              <MyImages images={shown} viewing={viewing} locked={locked} onOpen={setViewing} onHide={(path) => setHidden((current) => new Set(current).add(path))} />
            </div>
          </div>
          <div className="dock">
            <ImagesComposer />
          </div>
        </div>
        {viewed && <Viewer key={viewed.path} images={shown} image={viewed} onShow={setViewing} onLock={setLocked} />}
      </div>
    </div>
  );
}

/** 我的图像 (the desktop app's history section): loading, empty, failed, or the tiles. */
function MyImages({ images, viewing, locked, onOpen, onHide }: {
  images: LocalImage[];
  viewing: string | null;
  locked: boolean;
  onOpen(path: string): void;
  onHide(path: string): void;
}) {
  const listed = useImages((s) => s.local !== null);
  const error = useImages((s) => s.localError);
  return (
    <section className="images-section" aria-labelledby="images-mine">
      <h2 id="images-mine" className="images-heading">我的图像</h2>
      {!listed && !error && (
        <div className="images-state" role="status">
          <Spinner size={16} />
          正在加载图像…
        </div>
      )}
      {!listed && error && (
        <div className="images-state" data-column="" role="alert">
          无法加载图像
          <Button variant="secondary" onClick={() => void loadLocal()}>重试</Button>
        </div>
      )}
      {listed && !images.length && <p className="images-state images-empty">你用 ChatGPT 创建的图像将显示在这里</p>}
      {images.length > 0 && (
        <div className="images-grid">
          {images.map((image) => (
            <button
              key={image.path}
              type="button"
              className="images-tile"
              aria-label={IMAGE_TITLE}
              data-selected={image.path === viewing || undefined}
              aria-disabled={locked || undefined}
              onClick={() => !locked && onOpen(image.path)}
            >
              <img src={mediaUrl(image.path)} alt="" loading="lazy" decoding="async" onError={() => onHide(image.path)} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** The page's composer: images (the 「+」 button, pasting, dropping on the page) and the prompt. */
function ImagesComposer() {
  const draft = useImages((s) => s.draft);
  const channel = useStore(imageChannel);
  const reset = useStore(imageQuotaReset);
  const count = draft.images.length;

  const addFiles = async (files: File[]) => {
    const images = files.filter((file) => IMAGE_TYPES.includes(file.type));
    if (images.length < files.length) toast("warning", "仅支持 PNG、JPEG、GIF 和 WebP 图片。");
    const small = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
    if (small.length < images.length) toast("warning", "部分图片过大，无法附加。最大为 30 MB。");
    if (!small.length) return;
    const read = await Promise.all(small.map(async (file) => ({ name: file.name || "粘贴的图片", url: await readAsDataUrl(file) })));
    if (!addDraftImages(read, MAX_IMAGES)) toast("warning", `最多允许 ${MAX_IMAGES} 张图片。`);
  };

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
        onFiles={(files) => void addFiles(files)}
        canSendEmpty={count > 0}
        dropLabel="添加任何内容"
        failure="未能启动图像生成。请重试"
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
 * drops its own draft), then the viewer.
 */
function Viewer({ images, image, onShow, onLock }: { images: LocalImage[]; image: LocalImage; onShow(path: string | null): void; onLock(locked: boolean): void }) {
  const channel = useStore(imageChannel);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
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
  const picture = useRef<HTMLImageElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const focusNext = useRef<string | null>(null);
  const index = images.indexOf(image);
  const locked = submitting || mode !== null || prompt.trim().length > 0;
  const src = mediaUrl(image.path);

  useEffect(() => {
    onLock(locked);
    return () => onLock(false);
  }, [locked, onLock]);

  // Paging remounts the viewer (keyed per image): focus stays on the paging button, or the other
  // one at the end of the list.
  const page = (path: string, label: string) => {
    pagedBy = label;
    onShow(path);
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
      // Only from the page (or nothing focused): a dialog, the palette or a menu takes its own Esc.
      const target = event.target instanceof Element && event.target !== document.body ? event.target : null;
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.defaultPrevented || getState().lightbox || (target && !target.closest(".main-col"))) return;
      if (target?.closest(".images-comment-editor")) return;
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
  const tool = (text: string) => void send(() => imagesEdit(image.path, text)).catch(fail(EDIT_FAILED));
  const sendRemove = () => void send(async () => imagesEdit(image.path, editPrompt("remove"), await paintPng("remove", paint.strokes, src))).catch(fail(EDIT_FAILED));
  const sendMarkup = () =>
    void send(async () => {
      const marked = await paintPng("markup", paint.strokes, src).catch(() => null);
      if (marked) await imagesEdit(image.path, markupPrompt(note.trim()), marked);
      else toast("warning", "无法准备标注。请重试");
    }).catch(fail(EDIT_FAILED));
  const sendComments = () => void send(() => imagesEdit(image.path, commentPrompt(comments))).catch(fail("未成功添加图像评论"));
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
          <Button variant="ghost" icon={<Icon name="CaretLeft" />} label="上一张图像" disabled={locked || index <= 0} onClick={() => page(images[index - 1].path, "上一张图像")} />
          <Button variant="ghost" icon={<Icon name="CaretRight" />} label="下一张图像" disabled={locked || index >= images.length - 1} onClick={() => page(images[index + 1].path, "下一张图像")} />
          <Button variant="ghost" icon={<Icon name="ChatSimple" />} disabled={locked} onClick={() => void openThread(image.threadId)}>打开对话</Button>
          <span className="spacer" />
          <div role="group" aria-label="图像操作" className="images-viewer-actions">
            <Button variant="ghost" icon={<Icon name="Download" />} label="下载图像" onClick={() => void saveImage(src, image.name).catch(() => toast("warning", "无法下载图像"))} />
            <Button variant="ghost" icon={<Icon name="X" />} label="关闭" disabled={submitting} onClick={() => onShow(null)} />
          </div>
        </div>
        <div className="images-viewer-stage" aria-busy={status === "loading" || undefined}>
          <div className="images-frame" hidden={status !== "ready" || broken}>
            <button type="button" className="images-viewer-image" aria-label={IMAGE_TITLE} disabled={mode !== null} onClick={() => openLightbox(src, picture.current)}>
              <img key={attempt} ref={picture} src={src} alt="" onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} />
            </button>
            {(mode === "remove" || mode === "markup") && (
              <PaintCanvas key={mode} src={src} mode={mode} pen={mode === "remove" ? brush : PEN} strokes={paint.strokes} onStroke={paint.add} onError={() => setBroken(true)} />
            )}
            {mode === "comment" && <CommentLayer comments={comments} draft={draft} onDraft={setDraft} onChange={setComments} />}
          </div>
          {status === "loading" && <Spinner size={20} label="正在加载图像…" />}
          {status === "failed" && (
            <div className="images-state" data-column="" role="alert">
              无法加载此图像
              <Button variant="secondary" onClick={() => { setStatus("loading"); setAttempt((n) => n + 1); }}>重试预览</Button>
            </div>
          )}
          {broken && (
            <div className="images-state" data-column="" role="alert">
              无法加载标注。请重新加载后重试
              <Button variant="secondary" onClick={() => enter(null)}>返回图像</Button>
            </div>
          )}
          {status === "ready" && channel && !broken && <Toolbar>{tools}</Toolbar>}
        </div>
        {status === "ready" && channel && !mode && (
          <div className="images-viewer-edit">
            <CloudComposer
              value={prompt}
              onChange={setPrompt}
              onSend={(text) => send(() => imagesEdit(image.path, text))}
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
