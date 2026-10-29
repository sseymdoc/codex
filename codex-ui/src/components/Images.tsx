// The 图像 page in the main column (lib/images.ts): the Codex desktop app 26.1023's /images in
// Claude's page parts. 我的图像 lists the images generated on this machine as square tiles (the
// desktop app's history grid); one opens in a viewer column on the right with 上一张 / 下一张,
// 打开对话, 下载 and the edit tools (调整大小, 移除背景, 描述修改内容); the composer at the foot
// starts an image session. Every send opens its new session, as the desktop app moves to /c/<id>.

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fail, newChat, openThread } from "../lib/codex";
import { mediaUrl } from "../lib/files";
import {
  ASPECT_RATIOS, addDraftImages, editPrompt, imageChannel, imageQuotaReset, imagesSend, loadLocal, removeDraftImage, sendDraft, setDraftText, useImages,
  type LocalImage,
} from "../lib/images";
import { getState, toast, useStore } from "../lib/store";
import { CloudComposer } from "./CloudTask";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, readAsDataUrl } from "./Composer";
import { saveImage } from "./FileMenu";
import { openLightbox } from "./Lightbox";
import { quietMenu, useLiftSlot } from "./Main";
import { Button, Icon, MenuItem, Popover, Spinner } from "./ui";

const IMAGE_TITLE = "生成的图像";

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
              <MyImages images={shown} viewing={viewing} onOpen={setViewing} onHide={(path) => setHidden((current) => new Set(current).add(path))} />
            </div>
          </div>
          <div className="dock">
            <ImagesComposer />
          </div>
        </div>
        {viewed && <Viewer key={viewed.path} images={shown} image={viewed} onShow={setViewing} />}
      </div>
    </div>
  );
}

/** 我的图像 (the desktop app's history section): loading, empty, failed, or the tiles. */
function MyImages({ images, viewing, onOpen, onHide }: { images: LocalImage[]; viewing: string | null; onOpen(path: string): void; onHide(path: string): void }) {
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
              onClick={() => onOpen(image.path)}
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

/**
 * One image beside the grid (the desktop app's ImagesHistoryPreview): paging and 打开对话 wait
 * while an edit is typed or sent; Esc closes the 调整大小 menu first, then the viewer.
 */
function Viewer({ images, image, onShow }: { images: LocalImage[]; image: LocalImage; onShow(path: string | null): void }) {
  const channel = useStore(imageChannel);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resizing, setResizing] = useState(false);
  const picture = useRef<HTMLImageElement>(null);
  const index = images.indexOf(image);
  const locked = submitting || prompt.trim().length > 0;
  const src = mediaUrl(image.path);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Only from the page (or nothing focused): a dialog, the palette or a menu takes its own Esc.
      const target = event.target instanceof Element && event.target !== document.body ? event.target : null;
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.defaultPrevented || getState().lightbox || (target && !target.closest(".main-col"))) return;
      event.preventDefault();
      event.stopPropagation();
      if (resizing) setResizing(false);
      else onShow(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [resizing, onShow]);

  // The source image leads; the new session opens once it has the message.
  const edit = async (text: string) => {
    setSubmitting(true);
    try {
      await imagesSend(text, [{ type: "localImage", path: image.path }]);
    } finally {
      setSubmitting(false);
    }
  };
  const tool = (text: string) => void edit(text).catch(fail("未能编辑此图像。请重试"));

  return (
    <aside className="images-viewer" aria-label={IMAGE_TITLE}>
      <div className="images-viewer-card">
        <div className="images-viewer-head" data-tip-group="">
          <Button variant="ghost" icon={<Icon name="CaretLeft" />} label="上一张图像" disabled={locked || index <= 0} onClick={() => onShow(images[index - 1].path)} />
          <Button variant="ghost" icon={<Icon name="CaretRight" />} label="下一张图像" disabled={locked || index >= images.length - 1} onClick={() => onShow(images[index + 1].path)} />
          <Button variant="ghost" icon={<Icon name="ChatSimple" />} disabled={locked} onClick={() => void openThread(image.threadId)}>打开对话</Button>
          <span className="spacer" />
          <div role="group" aria-label="图像操作" className="images-viewer-actions">
            <Button variant="ghost" icon={<Icon name="Download" />} label="下载图像" onClick={() => void saveImage(src, image.name).catch(() => toast("warning", "无法下载图像"))} />
            <Button variant="ghost" icon={<Icon name="X" />} label="关闭" onClick={() => onShow(null)} />
          </div>
        </div>
        <div className="images-viewer-stage" aria-busy={status === "loading" || undefined}>
          <button type="button" className="images-viewer-image" aria-label={IMAGE_TITLE} hidden={status !== "ready"} onClick={() => openLightbox(src, picture.current)}>
            <img key={attempt} ref={picture} src={src} alt="" onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} />
          </button>
          {status === "loading" && <Spinner size={20} label="正在加载图像…" />}
          {status === "failed" && (
            <div className="images-state" data-column="" role="alert">
              无法加载此图像
              <Button variant="secondary" onClick={() => { setStatus("loading"); setAttempt((n) => n + 1); }}>重试预览</Button>
            </div>
          )}
        </div>
        {status === "ready" && channel && (
          <div className="images-viewer-edit">
            <div role="toolbar" aria-label="图像编辑工具" className="images-tools" data-tip-group="">
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
              <Button variant="ghost" icon={<Icon name="Image" />} label="移除背景" disabled={submitting} onClick={() => tool(editPrompt("removeBackground"))} />
            </div>
            <CloudComposer
              value={prompt}
              onChange={setPrompt}
              onSend={edit}
              disabled={submitting}
              placeholder="描述修改内容"
              label="描述修改内容"
              sendLabel="发送图像编辑指令"
              failure="未能编辑此图像。请重试"
              autoFocus={false}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
