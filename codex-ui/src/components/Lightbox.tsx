// Full-window image preview (W17 chat image preview; Code tab c4b054ed5 with backdrop "dim"): an
// 80% black scrim, a gradient bar with the close button, the image at most 75vw x 70vh with 1rem
// corners. A click on the image zooms it, a click elsewhere zooms back out or closes. Opening and
// closing morph between the thumbnail and the big image through a View Transition (A's viewImage /
// closeImage); without one the image simply opens. Mounted once by App.

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { setState, useStore } from "../lib/store";
import { closeImage, viewImage } from "./ui";

let show: ((src: string | null) => void) | null = null;
let origin: HTMLElement | null = null;

/** Opens `src` full-window, growing out of `source` (the thumbnail that was clicked). */
export function openLightbox(src: string, source: HTMLElement | null = null): void {
  origin = source;
  viewImage(source, () => {
    // The transition snapshots the page right after this callback, so render the preview now.
    flushSync(() => show?.(src));
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
  const [src, setSrc] = useState<string | null>(null);
  useLayoutEffect(() => {
    show = setSrc;
    return () => {
      show = null;
    };
  }, []);
  // Callers that only set the store (composer attachments) open it without a transition.
  useEffect(() => setSrc(stored), [stored]);
  useEffect(() => {
    if (!src) return;
    // Capture phase, so Esc closes the image instead of interrupting the turn in the composer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeLightbox();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [src]);
  return src ? <Preview key={src} src={src} /> : null;
}

/** Zoomed in, the clicked point stays put: max(natural / fitted width, 2) times (c4b054ed5 T). */
type Zoom = { scale: number; x: number; y: number };

function Preview({ src }: { src: string }) {
  const [zoom, setZoom] = useState<Zoom | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  // Focus moves to the close button and back to whatever had it once the preview goes.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    close.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  const toggleZoom = (event: MouseEvent<HTMLImageElement>) => {
    event.stopPropagation();
    if (zoom) return setZoom(null);
    const image = event.currentTarget;
    const box = image.getBoundingClientRect();
    setZoom({ scale: Math.max(image.naturalWidth / box.width, 2), x: event.clientX - box.left, y: event.clientY - box.top });
  };
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
          <X size={16} />
        </button>
      </div>
      {/* ponytail: one image and a click to zoom; c4b054ed5 also pans by drag, zooms with Ctrl+wheel and pages through several. */}
      <img
        className="lightbox-img"
        src={src}
        alt=""
        data-image-preview-target=""
        data-zoomed={zoom ? "" : undefined}
        style={zoom ? { transform: `scale(${zoom.scale})`, transformOrigin: `${zoom.x}px ${zoom.y}px` } : undefined}
        onClick={toggleZoom}
        onDragStart={(event) => event.preventDefault()}
      />
    </div>
  );
}
