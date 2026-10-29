// Full-window image preview (W17 chat image preview; Code tab c4b054ed5 with backdrop "dim"): an
// 80% black scrim, a gradient bar with the close button, the image at most 75vw x 70vh with 1rem
// corners. Several images sit side by side, 75vw apart plus 32px, sliding 300ms to the one shown;
// the others are dimmed and a click shows them; ‹ 第 N 项，共 M 项 › under them, and ←/→, Home and
// End, page. A click on the image (or Enter on it) zooms in on that point, to its own size and at
// least twice; zoomed, it pans by drag or wheel, Ctrl+wheel zooms smoothly, and a click elsewhere
// or a resize zooms back out. A click on the scrim closes. A right-click gives Claude's image
// menu (FileMenu). Opening and closing morph between the thumbnail and the big image through a
// View Transition (A's viewImage / closeImage); without one the image simply opens. Mounted once
// by App.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { basename } from "../lib/format";
import { setState, useStore } from "../lib/store";
import { fileMenuShown, openFileMenu } from "./FileMenu";
import { Icon, closeImage, hideSource, viewImage } from "./ui";

/** An image to page to, the thumbnail it opens from and closes back into, and its file. */
export interface Slide {
  src: string;
  origin: HTMLElement | null;
  path?: string;
  /** Its file name without a path (a 资料库 image's): the alt text, and the name 保存图片 keeps. */
  name?: string;
}

interface View {
  slides: Slide[];
  index: number;
}

let show: ((view: View | null) => void) | null = null;
/** The thumbnail of the image shown, which the preview closes back into. */
let origin: HTMLElement | null = null;

/**
 * Opens `src` full-window, growing out of `source` (the thumbnail that was clicked); `slides`, the
 * images it pages through (src among them).
 */
export function openLightbox(src: string, source: HTMLElement | null = null, slides: Slide[] = [{ src, origin: source }]): void {
  origin = source;
  const index = Math.max(0, slides.findIndex((slide) => slide.src === src && slide.origin === source));
  viewImage(source, () => {
    // The transition snapshots the page right after this callback, so render the preview now.
    flushSync(() => show?.({ slides, index }));
    setState({ lightbox: src });
  });
}

function closeLightbox(): void {
  const source = origin;
  origin = null;
  closeImage(source, () => {
    flushSync(() => show?.(null));
    setState({ lightbox: null });
  });
}

export function Lightbox() {
  const stored = useStore((s) => s.lightbox);
  const [view, setView] = useState<View | null>(null);
  useLayoutEffect(() => {
    show = setView;
    return () => {
      show = null;
    };
  }, []);
  // Callers that only set the store (composer attachments) open it without a transition.
  useEffect(() => setView((now) => (stored === null ? null : now?.slides.some((slide) => slide.src === stored) ? now : { slides: [{ src: stored, origin: null }], index: 0 })), [stored]);
  return view ? <Preview key={view.slides.map((slide) => slide.src).join("\0")} slides={view.slides} start={view.index} /> : null;
}

// ---------------------------------------------------------------------------
// Zoom (c4b054ed5 T / E / D): the image scales about its centre and moves by tx, ty, held within
// a reach that grows from nothing at 1.05x to its full span at 2x.

interface Fit {
  fitWidth: number;
  fitHeight: number;
  fitCenterX: number;
  fitCenterY: number;
  /** Its own size, and at least twice the fitted one. */
  maxScale: number;
  viewportWidth: number;
  viewportHeight: number;
}

interface Zoom extends Fit {
  scale: number;
  /** Where the image would sit unclamped, so a zoom back out returns it there. */
  idealTx: number;
  idealTy: number;
  tx: number;
  ty: number;
  maxTx: number;
  maxTy: number;
}

const REST = { scale: 1, idealTx: 0, idealTy: 0 };
const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value));
/** How far an image `size` long pans in `viewport`: until 30% of the viewport is past its edge. */
const reach = (size: number, viewport: number) => Math.max(0, (size + viewport) / 2 - Math.min(size, viewport * 0.7));
const span = (fit: number, viewport: number, scale: number) => reach(fit * scale, viewport) * Math.min(1, Math.max(0, (scale - 1.05) / 0.95));
const transformOf = (zoom: { tx: number; ty: number; scale: number }) => `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;

function measure(image: HTMLImageElement, frame: HTMLElement): Fit | null {
  if (image.getAnimations().some((animation) => animation.playState === "running")) return null;
  const box = image.getBoundingClientRect();
  const view = frame.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    fitWidth: box.width,
    fitHeight: box.height,
    fitCenterX: box.left + box.width / 2,
    fitCenterY: box.top + box.height / 2,
    maxScale: Math.max(image.naturalWidth / box.width, 2),
    viewportWidth: view.width,
    viewportHeight: view.height,
  };
}

/** Scales `from` to `scale` keeping the point under the pointer where it is. */
function zoomTo(fit: Fit, from: typeof REST, scale: number, point?: { clientX: number; clientY: number }): Zoom {
  const maxTx = span(fit.fitWidth, fit.viewportWidth, scale);
  const maxTy = span(fit.fitHeight, fit.viewportHeight, scale);
  const dx = point ? point.clientX - fit.fitCenterX : 0;
  const dy = point ? point.clientY - fit.fitCenterY : 0;
  const ratio = scale / from.scale;
  const x = dx - (dx - from.idealTx) * ratio;
  const y = dy - (dy - from.idealTy) * ratio;
  const tx = clamp(x, maxTx);
  const ty = clamp(y, maxTy);
  return {
    ...fit,
    scale,
    idealTx: maxTx < span(fit.fitWidth, fit.viewportWidth, from.scale) ? tx : x,
    idealTy: maxTy < span(fit.fitHeight, fit.viewportHeight, from.scale) ? ty : y,
    tx,
    ty,
    maxTx,
    maxTy,
  };
}

/** A click's zoom: all the way in on the point, the image kept over the window. */
function zoomIn(image: HTMLImageElement, frame: HTMLElement, point?: { clientX: number; clientY: number }): Zoom | null {
  const fit = measure(image, frame);
  if (!fit) return null;
  const zoom = zoomTo(fit, REST, fit.maxScale, point);
  const tx = clamp(zoom.tx, Math.max(0, (fit.fitWidth * fit.maxScale - fit.viewportWidth) / 2));
  const ty = clamp(zoom.ty, Math.max(0, (fit.fitHeight * fit.maxScale - fit.viewportHeight) / 2));
  return { ...zoom, tx, ty, idealTx: tx, idealTy: ty };
}

type Drag = { pointerId: number; startX: number; startY: number; tx: number; ty: number };

function Preview({ slides, start }: { slides: Slide[]; start: number }) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const zoomNow = useRef(zoom);
  zoomNow.current = zoom;
  const drag = useRef<Drag | null>(null);
  /** The pointer moved past 4px since it went down: the click that ends the drag is no click. */
  const dragged = useRef(false);
  /** A file menu was up when the pointer went down: that click only closed it. */
  const menuUp = useRef(false);
  const page = (to: number) => setIndex(Math.min(Math.max(to, 0), slides.length - 1));
  const image = () => current.current?.querySelector("img") ?? null;
  // Focus moves to the close button and back to whatever had it once the preview goes.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  // The image shown changes: unzoomed, its thumbnail hidden in place of the last one's, and focus,
  // if it was on nothing or in the preview off a key, on it.
  const shown = useRef(start);
  useLayoutEffect(() => {
    setZoom(null);
    if (shown.current === index) return;
    shown.current = index;
    origin = slides[index].origin;
    hideSource(origin);
    const active = document.activeElement;
    if (!active || active === document.body || (root.current?.contains(active) && !active.closest("a, button"))) current.current?.focus({ preventScroll: true });
  }, [index, slides]);
  useEffect(() => {
    // Capture phase, so Esc closes the image instead of interrupting the turn in the composer.
    const onKey = (event: KeyboardEvent) => {
      if (fileMenuShown()) return;
      const to = { Escape: -1, ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1 }[event.key];
      if (to === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") closeLightbox();
      else page(to);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });
  // A resize zooms back out.
  useEffect(() => {
    if (!zoom) return;
    const out = () => setZoom(null);
    window.addEventListener("resize", out);
    return () => window.removeEventListener("resize", out);
  }, [!zoom]);
  // The wheel: Ctrl zooms in steps of e^(−0.01 · Δy), from 1.25x and out under 1.05x; zoomed in,
  // a plain wheel pans. Not passive, so the page underneath never scrolls.
  useEffect(() => {
    const frame = root.current!;
    const onWheel = (event: WheelEvent) => {
      const shownImage = image();
      if (drag.current || !shownImage) return;
      const line = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 1 : 16;
      const pageMode = event.deltaMode === WheelEvent.DOM_DELTA_PAGE;
      if (event.ctrlKey) {
        event.preventDefault();
        const fresh = zoomNow.current ? null : measure(shownImage, frame);
        const point = { clientX: event.clientX, clientY: event.clientY };
        const factor = Math.exp(-event.deltaY * line * 0.01);
        setZoom((now) => {
          const fit = now ?? fresh;
          if (!fit) return now;
          const from = now ?? REST;
          const next = Math.min(Math.max(from.scale * factor, 1), fit.maxScale);
          if (!now && next === 1) return now;
          const scale = now ? next : Math.min(Math.max(next, 1.25), fit.maxScale);
          return factor < 1 && scale <= 1.05 ? null : now && scale === now.scale ? now : zoomTo(fit, from, scale, point);
        });
        return;
      }
      if (!zoomNow.current) return;
      event.preventDefault();
      const stepX = pageMode ? frame.clientWidth || 16 : line;
      const stepY = pageMode ? frame.clientHeight || 16 : line;
      setZoom((now) => {
        if (!now) return now;
        const tx = clamp(now.tx - event.deltaX * stepX, now.maxTx);
        const ty = clamp(now.ty - event.deltaY * stepY, now.maxTy);
        return tx === now.tx && ty === now.ty ? now : { ...now, tx, ty, idealTx: tx, idealTy: ty };
      });
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);
  const toggleZoom = (point?: { clientX: number; clientY: number }) => {
    const shownImage = image();
    if (shownImage) setZoom((now) => (now ? null : zoomIn(shownImage, root.current!, point)));
  };
  const onImageClick = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (!drag.current) toggleZoom(event);
  };
  const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (!zoom || event.button !== 0 || drag.current) return;
    dragged.current = false;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, tx: zoom.tx, ty: zoom.ty };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
    const held = drag.current;
    if (!held || !zoom || held.pointerId !== event.pointerId) return;
    const dx = event.clientX - held.startX;
    const dy = event.clientY - held.startY;
    if (!dragged.current && Math.hypot(dx, dy) < 4) return;
    dragged.current = true;
    held.tx = clamp(zoom.tx + dx, zoom.maxTx);
    held.ty = clamp(zoom.ty + dy, zoom.maxTy);
    event.currentTarget.style.transform = transformOf({ ...zoom, tx: held.tx, ty: held.ty });
  };
  const onPointerUp = (event: PointerEvent<HTMLImageElement>) => {
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!dragged.current) return;
    setZoom((now) => now && { ...now, tx: held.tx, ty: held.ty, idealTx: held.tx, idealTy: held.ty });
    setTimeout(() => (dragged.current = false), 0);
  };
  const menu = (slide: Slide) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    openFileMenu({ path: slide.path, surface: "attachment", image: slide.src, name: slide.name }, { x: event.clientX, y: event.clientY });
  };
  const first = index === 0;
  const last = index === slides.length - 1;
  return (
    <div
      ref={root}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onPointerDownCapture={() => (menuUp.current = fileMenuShown())}
      onClickCapture={(event) => {
        if (!dragged.current && !menuUp.current) return;
        event.stopPropagation();
        menuUp.current = false;
      }}
      onClick={() => (zoom ? setZoom(null) : closeLightbox())}
    >
      <div className="lightbox-bar">
        <button
          ref={close}
          type="button"
          className="lightbox-close"
          aria-label="关闭"
          onClick={(event) => {
            event.stopPropagation();
            closeLightbox();
          }}
        >
          <Icon name="X" size="sm" />
        </button>
      </div>
      <div className="lightbox-track" style={{ "--slide": index } as CSSProperties}>
        {slides.map((slide, at) => {
          const here = at === index;
          const zoomed = here && zoom ? zoom : null;
          const alt = slide.name ?? (slide.path ? basename(slide.path) : "");
          return (
            <div
              key={at}
              ref={here ? current : undefined}
              className="lightbox-slide"
              aria-hidden={!here || undefined}
              role={here ? "button" : undefined}
              aria-pressed={here ? !!zoom : undefined}
              aria-label={here ? `放大图片：${alt}` : undefined}
              tabIndex={here ? 0 : undefined}
              data-zoomed={zoomed ? "" : undefined}
              onKeyDown={
                here
                  ? (event) => {
                      if ((event.key !== "Enter" && event.key !== " ") || (event.target as Element).closest('a, button, [role="button"]') !== event.currentTarget) return;
                      event.preventDefault();
                      toggleZoom();
                    }
                  : undefined
              }
              onClick={(event) => {
                if (!here) {
                  if (zoom) return;
                  event.stopPropagation();
                  return page(at);
                }
                // An assistive click on the slide itself (no pointer) zooms like Enter.
                if (event.target === event.currentTarget && event.detail === 0) {
                  event.stopPropagation();
                  toggleZoom();
                }
              }}
            >
              <img
                className="lightbox-img"
                src={slide.src}
                alt={alt}
                decoding={here ? "sync" : "async"}
                data-image-preview-target={here ? "" : undefined}
                data-current={here || undefined}
                data-zoomed={zoomed ? "" : undefined}
                style={zoomed ? { transform: transformOf(zoomed) } : undefined}
                onClick={here ? onImageClick : undefined}
                onPointerDown={zoomed ? onPointerDown : undefined}
                onPointerMove={zoomed ? onPointerMove : undefined}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onContextMenu={menu(slide)}
                onDragStart={(event) => event.preventDefault()}
              />
            </div>
          );
        })}
      </div>
      {slides.length > 1 && (
        <div className="lightbox-pager" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="lightbox-page" aria-disabled={first} aria-label="上一张图片" onClick={() => page(index - 1)}>
            <Icon name="CaretLeft" size="md" />
          </button>
          <span className="lightbox-count" aria-live="polite" aria-atomic="true">
            第 {index + 1} 项，共 {slides.length} 项
          </span>
          <button type="button" className="lightbox-page" aria-disabled={last} aria-label="下一张图片" onClick={() => page(index + 1)}>
            <Icon name="CaretRight" size="md" />
          </button>
        </div>
      )}
    </div>
  );
}
