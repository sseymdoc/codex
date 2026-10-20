// Full-window image preview (W17 chat image preview; Code tab c4b054ed5 with backdrop "dim"): an
// 80% black scrim, a gradient bar with the close button, the image at most 75vw x 70vh with 1rem
// corners. A click on the image zooms it, a click elsewhere zooms back out or closes. Several
// images sit side by side, 75vw apart plus 32px, sliding 300ms to the one shown; the others are
// dimmed and a click shows them; ‹ 第 N 项，共 M 项 › under them, and ←/→, Home and End, page.
// Opening and closing morph between the thumbnail and the big image through a View Transition
// (A's viewImage / closeImage); without one the image simply opens. Mounted once by App.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { setState, useStore } from "../lib/store";
import { Icon, closeImage, hideSource, viewImage } from "./ui";

/** An image to page to, and the thumbnail it opens from and closes back into. */
export interface Slide {
  src: string;
  origin: HTMLElement | null;
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

/** Zoomed in, the clicked point stays put: max(natural / fitted width, 2) times (c4b054ed5 T). */
type Zoom = { scale: number; x: number; y: number };

function Preview({ slides, start }: { slides: Slide[]; start: number }) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const page = (to: number) => setIndex(Math.min(Math.max(to, 0), slides.length - 1));
  // Focus moves to the close button and back to whatever had it once the preview goes.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  // The image shown changes: unzoomed, its thumbnail hidden in place of the last one's.
  const shown = useRef(start);
  useLayoutEffect(() => {
    setZoom(null);
    if (shown.current === index) return;
    shown.current = index;
    origin = slides[index].origin;
    hideSource(origin);
  }, [index, slides]);
  useEffect(() => {
    // Capture phase, so Esc closes the image instead of interrupting the turn in the composer.
    const onKey = (event: KeyboardEvent) => {
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
  const toggleZoom = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (zoom) return setZoom(null);
    const image = event.currentTarget;
    const box = image.getBoundingClientRect();
    setZoom({ scale: Math.max(image.naturalWidth / box.width, 2), x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const first = index === 0;
  const last = index === slides.length - 1;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={() => (zoom ? setZoom(null) : closeLightbox())}>
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
      {/* ponytail: a click to zoom; c4b054ed5 also pans by drag and zooms with Ctrl+wheel. */}
      <div className="lightbox-track" style={{ "--slide": index } as CSSProperties}>
        {slides.map((slide, at) => (
          <div
            key={at}
            className="lightbox-slide"
            aria-hidden={at !== index || undefined}
            onClick={(event) => {
              if (at === index || zoom) return;
              event.stopPropagation();
              page(at);
            }}
          >
            <img
              className="lightbox-img"
              src={slide.src}
              alt=""
              data-image-preview-target={at === index ? "" : undefined}
              data-current={at === index || undefined}
              data-zoomed={at === index && zoom ? "" : undefined}
              style={at === index && zoom ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.x}px ${zoom.y}px` } : undefined}
              onClick={at === index ? toggleZoom : undefined}
              onDragStart={(event) => event.preventDefault()}
            />
          </div>
        ))}
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
