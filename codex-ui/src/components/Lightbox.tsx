// Full-window image preview (W17 chat image preview, cd5136de8): opening and closing morph
// between the thumbnail and the big image through a View Transition (A's viewImage /
// closeImage); without one the image simply opens. Mounted once by App.

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { setState, useStore } from "../lib/store";
import { Button, closeImage, viewImage } from "./ui";

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
  if (!src) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看图片" onClick={closeLightbox}>
      <img className="lightbox-img" src={src} alt="" data-image-preview-target="" />
      <Button variant="ghost" className="lightbox-close" icon={<X size={20} />} label="关闭" />
    </div>
  );
}
