// Rich content renderers: markdown and unified diffs.

import { createContext, memo, use, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from "react";
import { basename, mayReadUnasked, parentDir, relativePath } from "../lib/format";
import { parseDiff, type FileDiff } from "../lib/diff";
import { fileSize, fileSizes, mediaUrl } from "../lib/files";
import { highlight, LIGHTBOX_IMAGE, renderBlocks, renderMarkdown } from "../lib/markdown";
import { readImage } from "../lib/codex";
import { fileRows, openDiff } from "../lib/panes";
import { getState, useStore } from "../lib/store";
import {
  BLOCK_CHARS,
  extendShown,
  firstInk,
  JOIN_ABOVE,
  Ledger,
  noteShown,
  PACE,
  paceCeiling,
  paceStep,
  PREFIX_AFTER_MS,
  PREFIX_MIN,
  REJOIN_ABOVE,
  remapShown,
  runPieces,
  shownBefore,
  stepSize,
  stepWait,
  type Reveal,
} from "../lib/reveal";
import { parseFileRef, resolvePath } from "../lib/transcript";
import { askDefaultApp } from "./FileMenu";
import { openLightbox } from "./Lightbox";
import { Icon, fileGlyph } from "./ui";

/** The open session's folder. */
export function sessionFolder(): string {
  const { activeId, threads, prefs } = getState();
  const thread = activeId ? threads[activeId] : undefined;
  return thread?.settings?.cwd ?? thread?.meta.cwd ?? prefs.cwd;
}

/** `path` resolved against the open session's folder. */
const sessionPath = (path: string) => resolvePath(path, sessionFolder());

/**
 * U24: hand `path` to the preview pane (E), relative paths resolved against the open session's
 * folder. An image opens in the lightbox instead, or in the pane when it cannot be read (c19e90103 hb).
 */
export function openFile(path: string, line?: number): void {
  const full = sessionPath(path);
  const pane = () => window.dispatchEvent(new CustomEvent("codex:open-file", { detail: { path: full, line } }));
  if (LIGHTBOX_IMAGE.test(full)) readImage(full).then((src) => openLightbox(src), pane);
  else pane();
}

// c19e90103 ab / ib: each local image read so far by path, as its data URL or null when it could
// not be read, holding 32M chars of data URLs at most (the oldest go first). ponytail: a path that
// failed stays a link until the app reloads, where Claude tries again as the image mounts again.
const images = new Map<string, Promise<string | null>>();
const imageChars = new Map<string, number>();
let heldChars = 0;

function loadImage(path: string): Promise<string | null> {
  let image = images.get(path);
  if (!image) {
    image = readImage(path).then(
      (src) => {
        imageChars.set(path, src.length);
        heldChars += src.length;
        for (const [old, chars] of imageChars) {
          if (heldChars <= 32 * 1024 * 1024) break;
          imageChars.delete(old);
          images.delete(old);
          heldChars -= chars;
        }
        return src;
      },
      () => null,
    );
    images.set(path, image);
  }
  return image;
}

/**
 * c19e90103 yb: a local image's link (markdown.ts) turns into the image once read, a held-back
 * 120px skeleton till then (eb), and stays the link when the file cannot be read or shown. It
 * works as the HTML lands, before a streaming reply's words fade in or paint, and each path is
 * read once, so a block rendered again while the reply streams shows the image again at once.
 */
class MarkdownImage extends HTMLElement {
  connectedCallback() {
    const link = this.querySelector<HTMLElement>("[data-path]");
    const path = link?.dataset.path && sessionPath(link.dataset.path);
    if (!link || !path || !mayReadUnasked(path)) return;
    this.innerHTML = '<span class="skeleton md-image-wait" data-hold="delayed" aria-hidden="true"><span class="skeleton-line"></span></span>';
    void loadImage(path).then((src) => {
      if (src === null) return this.replaceChildren(link);
      const image = new Image();
      image.alt = link.textContent ?? "";
      image.src = src;
      image.onerror = () => this.replaceChildren(link);
      this.replaceChildren(image);
    });
  }
}
if (!customElements.get("md-image")) customElements.define("md-image", MarkdownImage);

/** Inside a button (a tool group's line), file names read as plain text. */
export const PlainLinks = createContext(false);

/** A file name that opens the preview; an inline span so a truncated detail keeps its ellipsis. */
/** preferDiff (c856385e2 In): an edit row's file opens its diff in the changes pane instead. */
export function FileLink({
  path,
  line,
  tip,
  className = "",
  preferDiff = false,
  children,
}: {
  path: string;
  line?: number;
  /** The tip, where it says more than the path. */
  tip?: string;
  className?: string;
  preferDiff?: boolean;
  children: ReactNode;
}) {
  const plain = use(PlainLinks);
  const open = (event: SyntheticEvent) => {
    event.stopPropagation();
    if (preferDiff) openDiff(path);
    else openFile(path, line);
  };
  if (plain) return <>{children}</>;
  return (
    <span
      role="link"
      tabIndex={0}
      className={`file-link ${className}`}
      data-tip={tip ?? (line ? `${path}:${line}` : path)}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        open(event);
      }}
    >
      {children}
    </span>
  );
}

/** shared-104 fP: what Claude draws as a sent image. */
const SENT_IMAGE = /\.(?:png|jpe?g|gif|bmp|webp|avif)$/i;

/** shared-28 bk / Ck: the sent media Claude plays in place. */
const SENT_VIDEO = /\.(?:mp4|webm|mov)$/i;
const SENT_AUDIO = /\.(?:mp3|m4a|aac|wav|flac|opus|ogg|oga)$/i;

/**
 * c289d7154 K, opening in the files pane: a 36px card of the type badge, the name (the extension,
 * I: up to 10 word characters, kept past the cut) and the size; or, `square`, a 120px tile of the
 * badge over the name in two lines and the size. Each sent file carries its path for the file
 * menu (data-sent-path).
 */
function SentCard({ path, square, size }: { path: string; square: boolean; size?: number | null }) {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : "";
  const cut = /^\w{1,10}$/.test(ext);
  const bytes = typeof size === "number" ? <span className="sent-file-size">{fileSize(size)}</span> : null;
  return (
    <button type="button" className="sent-file" data-square={square || undefined} data-sent-path={path} title={path} onClick={() => openFile(path)}>
      <span className="sent-file-badge">{ext || "文件"}</span>
      {square ? (
        <span className="sent-file-text">
          <bdi className="sent-file-name">{name}</bdi>
          {bytes}
        </span>
      ) : (
        <>
          <bdi className="sent-file-name">
            <span>{cut ? name.slice(0, dot) : name}</span>
            {cut && <span>.{ext}</span>}
          </bdi>
          {bytes}
        </>
      )}
    </button>
  );
}

/**
 * cb6930dae Ls / Rs: sent video plays in place (at most 320 x 240, or 480 x 360 when every other
 * file is an image), audio as its name over a 320px player; a breathing tile while the file is
 * looked for, its card when it is gone or will not play.
 */
function SentMedia({ path, size, natural }: { path: string; size: number | null | undefined; natural: boolean }) {
  const [broken, setBroken] = useState(false);
  const audio = SENT_AUDIO.test(path);
  if (size === null || broken) return <SentCard path={path} square={false} size={size} />;
  if (size === undefined)
    return (
      <span className="skeleton sent-media-wait" data-hold="delayed" data-audio={audio || undefined} aria-hidden="true">
        <span className="skeleton-line" />
      </span>
    );
  return audio ? (
    <div className="sent-audio" data-sent-path={path}>
      <p>
        <bdi>{basename(path)}</bdi>
      </p>
      <audio controls preload="metadata" src={mediaUrl(path)} title={basename(path)} onError={() => setBroken(true)} />
    </div>
  ) : (
    <video className="sent-video" data-natural={natural || undefined} data-sent-path={path} controls preload="metadata" src={mediaUrl(path)} title={basename(path)} onError={() => setBroken(true)} />
  );
}

/**
 * cb6930dae Is: a sent image as a 120px tile (`natural`, every file an image: as large as it is,
 * up to 360px tall), a breathing tile while it reads, the square card when it cannot be read; it
 * opens in the lightbox, paging through the images sent with it that have been read (iu fe).
 */
const sentSlides = (tile: HTMLElement) =>
  [...tile.parentElement!.querySelectorAll<HTMLElement>("button.sent-image")].map((origin) => ({ src: origin.querySelector("img")!.src, origin, path: origin.dataset.sentPath }));

function SentImage({ path, natural, size }: { path: string; natural: boolean; size?: number | null }) {
  const [src, setSrc] = useState<string | null | undefined>(() => (mayReadUnasked(path) ? undefined : null));
  useEffect(() => {
    let live = true;
    if (mayReadUnasked(path)) void loadImage(path).then((image) => live && setSrc(image));
    return () => {
      live = false;
    };
  }, [path]);
  if (src === null) return <SentCard path={path} square size={size} />;
  if (src === undefined)
    return (
      <div className="sent-file sent-image" data-square="" aria-hidden="true">
        <span className="skeleton" data-hold="delayed">
          <span className="skeleton-line" />
        </span>
      </div>
    );
  return (
    <button
      type="button"
      className="sent-file sent-image"
      data-sent-path={path}
      title={path}
      aria-label={`查看图片 ${basename(path)}`}
      onClick={(event) => openLightbox(src, event.currentTarget, sentSlides(event.currentTarget))}
    >
      <img src={src} alt="" data-natural={natural || undefined} onError={() => setSrc(null)} />
    </button>
  );
}

/**
 * The files a turn's replies hand over, as Claude's attachments for the files SendUserFile sends
 * (cb6930dae iu → c289d7154 J): media playing first, then images as thumbnails and the rest as
 * cards, all square once an image is among them, wrapping 8px apart.
 */
export function SentFiles({ paths }: { paths: string[] }) {
  const [sizes, setSizes] = useState<Record<string, number | null>>({});
  const key = paths.join("\0");
  useEffect(() => {
    let live = true;
    const asked = key.split("\0");
    void fileSizes(asked).then((found) => live && setSizes(Object.fromEntries(asked.map((path, index) => [path, found[index]]))));
    return () => {
      live = false;
    };
  }, [key]);
  const media = paths.filter((path) => SENT_VIDEO.test(path) || SENT_AUDIO.test(path));
  const files = paths.filter((path) => !media.includes(path));
  const images = files.filter((path) => SENT_IMAGE.test(path));
  // iu j: as large as they are while nothing else among them is a card (or audio).
  const natural = images.length === files.length && !media.some((path) => SENT_AUDIO.test(path));
  return (
    <div className="sent-block" data-find-omitted="">
      {media.map((path) => (
        <SentMedia key={path} path={path} size={sizes[path]} natural={natural} />
      ))}
      {files.length > 0 && (
        <div className="sent-files">
          {files.map((path) =>
            SENT_IMAGE.test(path) ? (
              <SentImage key={path} path={path} natural={natural} size={sizes[path]} />
            ) : (
              <SentCard key={path} path={path} square={images.length > 0} size={sizes[path]} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function openPathRef(el: HTMLElement, defaultApp = false): boolean {
  const ref = el.closest<HTMLElement>("[data-path]")?.dataset.path;
  if (!ref) return false;
  const { path, line } = parseFileRef(ref);
  const full = sessionPath(path);
  // c856385e2 An: Ctrl+click opens a file of the session's folder in the app the system has for it.
  if (defaultApp && relativePath(full, sessionFolder()) !== full) askDefaultApp(full);
  else openFile(path, line);
  return true;
}

function onMarkdownKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key === "Enter" && openPathRef(event.target as HTMLElement)) event.preventDefault();
}

function onMarkdownClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target instanceof HTMLImageElement) {
    openLightbox(target.src, target);
    return;
  }
  if (openPathRef(target, event.ctrlKey || event.metaKey)) return;
  const button = target.closest<HTMLElement>("[data-copy]");
  if (!button) return;
  const code = button.closest(".md-code")?.querySelector("code")?.textContent ?? "";
  void navigator.clipboard.writeText(code);
  const label = (text: string) => {
    button.setAttribute("aria-label", text);
    button.dataset.tip = text;
  };
  button.dataset.copied = "";
  label("已复制");
  setTimeout(() => {
    delete button.dataset.copied;
    label("复制代码");
  }, 1200);
}

// ---------------------------------------------------------------------------
// A reply as it is written (lib/reveal.ts): paced out, every word shown fading in.

/**
 * shared-10 Tf with the reply's options (c19e90103 jx): the text to show, which follows `text` a
 * step at a time — 22 chars to a word, sized so any backlog shows within about 550ms, 25–150ms
 * apart — and holds back a last line that is only a block marker. More than `joinAbove` waiting
 * when pacing starts shows at once, as does a backlog over 600 that one delta of over 600 made,
 * and everything when the window comes back into view. Disabled, it is `text`.
 */
function usePaced(text: string, enabled: boolean, joinAbove: number): string {
  const [shown, setShown] = useState(0);
  const shownNow = useRef(0);
  const [seen, setSeen] = useState(() => !enabled && firstInk(text) !== -1);
  const latest = useRef({ text, ceiling: 0 });
  const wake = useRef<(() => void) | undefined>(undefined);
  const [wasEnabled, setWasEnabled] = useState(enabled);
  let at = shown;
  if (wasEnabled !== enabled) {
    setWasEnabled(enabled);
    if (enabled && at !== 0) {
      at = 0;
      setShown(0);
    }
  }
  const [before, setBefore] = useState(text);
  let cut = at;
  const delta = text.length - before.length;
  if (enabled && text !== before) {
    if (at > 0 && !text.startsWith(before.slice(0, at))) {
      cut = remapShown(before, text, at);
      setShown(cut);
    }
    setBefore(text);
  }
  const ceiling = useMemo(() => (enabled ? paceCeiling(text) : text.length), [text, enabled]);
  if (enabled && at > 0 && ceiling - at > REJOIN_ABOVE && delta > REJOIN_ABOVE) setShown(ceiling);
  if (enabled && at === 0 && ceiling > 0) {
    const ink = firstInk(text);
    if (ink !== -1 && ink < ceiling) {
      const to = seen || ceiling > joinAbove ? ceiling : paceStep(text, ink, ceiling, PACE.stepChars);
      if (to > 0) setShown(to);
    }
  }
  useInsertionEffect(() => {
    shownNow.current = at;
  });
  useInsertionEffect(() => {
    latest.current = { text, ceiling };
    wake.current?.();
  }, [text, ceiling]);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let last = performance.now();
    let idle = false;
    const later = (ms: number) => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        tick(performance.now());
      }, Math.max(0, Math.ceil(ms)));
    };
    const tick = (now: number) => {
      const live = latest.current;
      const backlog = live.ceiling - shownNow.current;
      if (document.hidden) {
        if (shownNow.current > 0 && backlog > REJOIN_ABOVE) setShown((shownNow.current = live.ceiling));
        return;
      }
      if (backlog <= 0) {
        last = now;
        idle = true;
        return;
      }
      const since = now - last;
      const wait = stepWait(backlog);
      if (since < wait) return later(wait - since);
      last = now;
      const ink = firstInk(live.text);
      if (ink === -1 || ink >= live.ceiling) {
        idle = true;
        return;
      }
      const to = paceStep(live.text, Math.max(shownNow.current, ink), live.ceiling, stepSize(backlog, since));
      if (to > shownNow.current) setShown((shownNow.current = to));
      later(PACE.minStepMs);
    };
    wake.current = () => {
      if (idle) {
        idle = false;
        last = performance.now();
      }
      later(0);
    };
    later(0);
    const onVisible = () => {
      if (document.hidden) return;
      const { ceiling } = latest.current;
      if (ceiling > shownNow.current) setShown((shownNow.current = ceiling));
      later(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      wake.current = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  const out = enabled ? text.slice(0, Math.min(cut, ceiling, text.length)) : text;
  if (!seen && firstInk(out) !== -1) setSeen(true);
  return out;
}

/** c19e90103 Ax: once 22 chars have shown for 400ms the reply's start is noted, and grows with it to 64. */
function useNoteShown(key: string | undefined, shown: string, growing: boolean): void {
  const latest = useRef(shown);
  const noted = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = shown;
    if (key !== undefined && noted.current === key) extendShown(key, shown);
  }, [shown, key]);
  const ready = key !== undefined && growing && shown.trim().length >= PREFIX_MIN;
  useEffect(() => {
    if (!ready || key === undefined) return;
    const timer = setTimeout(() => {
      noteShown(key, latest.current);
      noted.current = key;
    }, PREFIX_AFTER_MS);
    return () => clearTimeout(timer);
  }, [ready, key]);
}

interface Fading {
  ledger: Ledger;
  /** When each fading node was first drawn: React keeps Claude's nodes, a new HTML string replaces these. */
  born: Map<string, number>;
  now: number;
}

const BLOCK_TAGS = new Set(["P", "UL", "OL", "PRE", "BLOCKQUOTE", "TABLE", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "DL"]);
const isBlock = (node: Node): node is Element => node instanceof Element && BLOCK_TAGS.has(node.tagName);
const blockChildren = (el: Element) => [...el.children].filter(isBlock);
/** c19e90103 dm: inline code, keys, file paths, and (below) links with a plain label fade whole. */
const UNIT = "code, kbd, sup, .prose-link";

/**
 * _wordAnimating (a phrase: shared-10 pm's 400ms ramp): `el` fades in as piece `key`, carrying on
 * where it was if it was drawn before.
 */
function fadeIn(el: HTMLElement, key: string, reveal: Reveal, fading: Fading): void {
  let born = fading.born.get(key);
  if (born === undefined) fading.born.set(key, (born = fading.now));
  el.classList.add(fading.ledger.mode === "phrase" ? "fade-phrase" : "fade-word");
  const delay = Math.round(born + reveal.delayMs - fading.now);
  if (delay) el.style.animationDelay = `${delay}ms`;
}

/** um: a block's own share of the ledger, faded on the elements that are drawn whole (none in phrase mode). */
function fadeOwn(el: Element, ns: string, fading: Fading, whole: boolean): void {
  if (fading.ledger.mode === "phrase") return;
  const reveal = fading.ledger.reveal(`${ns}:blk`, BLOCK_CHARS);
  if (whole && !fading.ledger.settled(reveal)) fadeIn(el as HTMLElement, `${ns}:blk`, reveal, fading);
}

/** c19e90103 Yb: top-level block `ns` (b0, b1…). */
function fadeTop(el: Element, ns: string, fading: Fading): void {
  const blocks = blockChildren(el);
  if (!blocks.length) {
    fadeOwn(el, ns, fading, false);
    fadeInline(el, ns, 0, fading);
  } else blocks.forEach((block, i) => fadeBlock(block, i ? `${ns}+${i}` : ns, fading));
}

/** qb: code blocks, rules and quotes fade whole; lists by item, tables by row, the rest by word. */
function fadeBlock(el: Element, ns: string, fading: Fading): void {
  if (el.matches("ul, ol")) {
    fadeOwn(el, ns, fading, false);
    [...el.children].filter((li) => li.tagName === "LI").forEach((li, i) => fadeItem(li, `${ns}.${i}`, fading));
  } else if (el.matches(".md-table, table")) {
    fadeOwn(el, ns, fading, false);
    const table = el instanceof HTMLTableElement ? el : el.querySelector("table");
    const head = table?.tHead?.rows[0];
    if (head) fadeRow(head, `${ns}.h`, fading);
    [...(table?.tBodies[0]?.rows ?? [])].forEach((row, r) => fadeRow(row, `${ns}.r${r}`, fading));
  } else if (el.matches("blockquote")) {
    fadeOwn(el, ns, fading, true);
    blockChildren(el).forEach((child, i) => fadeBlock(child, `${ns}.q${i}`, fading));
  } else if (el.matches(".md-code, pre, hr")) {
    fadeOwn(el, ns, fading, true);
  } else {
    fadeOwn(el, ns, fading, false);
    fadeInline(el, ns, 0, fading);
  }
}

/** Ub + Hb: an item fades whole; its first paragraph's words go under its own name, the blocks after as .c0, .c1… */
function fadeItem(li: Element, ns: string, fading: Fading): void {
  fadeOwn(li, ns, fading, true);
  const nodes = [...li.childNodes];
  const split = nodes.findIndex(isBlock);
  const lead = split === -1 ? nodes : nodes.slice(0, split);
  let blocks = split === -1 ? [] : nodes.slice(split).filter(isBlock);
  if (lead.some((node) => !(node instanceof Element && node.matches(".md-task-mark")) && /\S/.test(node.textContent ?? ""))) fadeNodes(lead, ns, 0, fading);
  else if (blocks[0]?.tagName === "P") {
    fadeInline(blocks[0], ns, 0, fading);
    blocks = blocks.slice(1);
  }
  blocks.forEach((block, i) => fadeBlock(block, `${ns}.c${i}`, fading));
}

/** Wb / Kb: a table row fades whole, each cell's words under .0, .1… */
function fadeRow(row: HTMLTableRowElement, ns: string, fading: Fading): void {
  fadeOwn(row, ns, fading, true);
  [...row.cells].forEach((cell, c) => fadeInline(cell, `${ns}.${c}`, 0, fading));
}

/** zb: inline content from `at` on; returns where it ends. */
function fadeInline(parent: Node, ns: string, at: number, fading: Fading): number {
  return fadeNodes([...parent.childNodes], ns, at, fading);
}

function fadeNodes(nodes: Node[], ns: string, at: number, fading: Fading): number {
  for (const node of nodes) {
    if (node instanceof Text) {
      fadeText(node, ns, at, fading);
      at += node.data.length;
    } else if (!(node instanceof HTMLElement) || node.matches(".md-task-mark, img")) continue;
    else if (node.tagName === "BR") at += 1;
    else if (node.matches(UNIT) || (node.tagName === "A" && node.childNodes.length === 1 && node.firstChild instanceof Text)) {
      const length = node.textContent?.length ?? 0;
      const reveal = fading.ledger.reveal(`${ns}:${at}`, length);
      if (!fading.ledger.settled(reveal)) {
        const wrap = document.createElement("span");
        wrap.dataset.wf = "el";
        node.replaceWith(wrap);
        wrap.append(node);
        fadeIn(wrap, `${ns}:${at}`, reveal, fading);
      }
      at += length;
    } else at = fadeInline(node, ns, at, fading);
  }
  return at;
}

/** Ob + om: a text node line by line (one apart across the newline), its fading words grouped by chunk. */
function fadeText(node: Text, ns: string, at: number, fading: Fading): void {
  let offset = at;
  const lines = node.data.split("\n").map((line) => {
    const pieces = runPieces(fading.ledger, ns, offset, line);
    offset += line.length + 1;
    return { line, pieces };
  });
  if (!lines.some((line) => line.pieces)) return;
  const out: (Node | string)[] = [];
  lines.forEach(({ line, pieces }, i) => {
    if (i > 0) out.push("\n");
    if (!pieces) return void (line && out.push(line));
    for (const piece of pieces) {
      if (!piece.reveal) {
        out.push(piece.text);
        continue;
      }
      const span = document.createElement("span");
      span.dataset.wf = "";
      span.textContent = piece.text;
      fadeIn(span, `${ns}:${piece.at}`, piece.reveal, fading);
      out.push(span);
    }
  });
  node.replaceWith(...out);
}

/**
 * c19e90103 Yb: a reply that mounts still growing gets a ledger; while it has one each top-level
 * block is its own element (finished ones stay put) and every new word fades in, the ledger let
 * go 1s after the text stops growing. Then, and for any other text, it renders in one piece with
 * the same layout. `prime`: what shows at mount does not fade.
 */
function Rendered({ text, streaming, prime, guards, className, voice, breaks }: { text: string; streaming: boolean; prime: boolean; guards?: string[]; className: string; voice: boolean; breaks: boolean }) {
  const phrase = useStore((s) => s.claudeFlags.phraseFade);
  // Mx: a reply keeps the mode it started its ledger with.
  const [ledger] = useState(() => {
    if (!streaming) return null;
    const empty = text.trim() === "";
    return new Ledger(prime && !empty ? text : undefined, prime && empty ? guards : undefined, undefined, phrase ? "phrase" : "word");
  });
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ledger || streaming || settled) return;
    const timer = setTimeout(() => setSettled(true), ledger.settleMs);
    return () => clearTimeout(timer);
  }, [ledger, streaming, settled]);
  const fading = settled ? null : ledger;
  const blocks = useMemo(() => (fading ? renderBlocks(text, streaming, breaks) : null), [text, fading, streaming, breaks]);
  const html = useMemo(() => (fading ? null : renderMarkdown(text, breaks)), [text, fading, breaks]);
  const root = useRef<HTMLDivElement>(null);
  const applied = useRef<string[]>([]);
  const born = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = root.current;
    if (!fading || !blocks || !el) return;
    fading.sync(text);
    const now = performance.now();
    blocks.forEach((block, i) => {
      const target = el.children[i];
      if (applied.current[i] === block || !target) return;
      applied.current[i] = block;
      fadeTop(target, `b${i}`, { ledger: fading, born: born.current, now });
    });
    applied.current.length = blocks.length;
  }, [fading, blocks, text]);
  const props = { className: `markdown ${className}`, onClick: onMarkdownClick, onKeyDown: onMarkdownKeyDown, "data-hang-face": voice ? "" : undefined };
  if (blocks) {
    return (
      <div ref={root} {...props} data-streaming={streaming ? "" : undefined}>
        {blocks.map((block, index) => (
          <div key={index} className="md-block" dangerouslySetInnerHTML={{ __html: block }} />
        ))}
      </div>
    );
  }
  return <div {...props} dangerouslySetInnerHTML={{ __html: html ?? "" }} />;
}

/**
 * Markdown. A reply passes `streaming` while it grows: `paced`, it shows a step at a time
 * (c96d752d0 U5e paceReveal), and its words fade in (c19e90103 Ix).
 */
export const Markdown = memo(function Markdown({
  text,
  className = "",
  streaming = false,
  voice = false,
  paced = false,
  breaks = false,
  revealKey,
  onFirstPaint,
}: {
  text: string;
  className?: string;
  streaming?: boolean;
  /** The agent's reply: optically hung quotes, by the interface font's metrics (transcript.css). */
  voice?: boolean;
  paced?: boolean;
  /** What Claude draws with Alluvium (c19e90103 Ix): a single newline is a line break (markdown.ts). */
  breaks?: boolean;
  /** The text's item: mounting again mid-stream, what it showed before shows at once (c19e90103 kx). */
  revealKey?: string;
  /** Once text first shows. */
  onFirstPaint?: () => void;
}) {
  const [guards] = useState(() => (revealKey === undefined ? undefined : shownBefore(revealKey)));
  const [before, setBefore] = useState<boolean>();
  let seen = before;
  if (seen === undefined && guards !== undefined && text.trim() !== "") {
    const lead = text.trimStart();
    seen = guards.some((guard) => lead.startsWith(guard));
    setBefore(seen);
  }
  const shown = usePaced(text, paced && streaming, seen ? 0 : JOIN_ABOVE);
  useNoteShown(revealKey, shown, streaming);
  const painted = useRef(false);
  useLayoutEffect(() => {
    if (painted.current || !onFirstPaint || shown.trim() === "") return;
    painted.current = true;
    onFirstPaint();
  }, [shown, onFirstPaint]);
  const waiting = guards !== undefined && seen === undefined;
  return <Rendered text={shown} streaming={streaming} prime={seen === true || waiting || shown.length > 400} guards={waiting ? guards : undefined} className={className} voice={voice} breaks={breaks} />;
});

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin", swift: "swift", rb: "ruby", php: "php",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", hpp: "cpp", cs: "csharp", css: "css", scss: "css", html: "xml",
  xml: "xml", svg: "xml", json: "json", yaml: "yaml", yml: "yaml", toml: "ini", md: "markdown", sh: "bash",
  bash: "bash", ps1: "powershell", sql: "sql", dockerfile: "dockerfile",
};

function languageFor(path: string): string | undefined {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  return EXTENSION_LANGUAGES[name.split(".").pop() ?? ""];
}

// ponytail: a row count stands in for the diffs library's size check (not traced).
const MAX_ROWS = 3000;

/**
 * Unified diff (cb6930dae vu + diffs: classic +/- indicators, hunks 4px apart with no @@ line,
 * wrapping); too big, the removed and the added text show separately (Nu), 200px each.
 */
export const DiffView = memo(function DiffView({
  diff,
  path,
  kind = "update",
  whole = false,
}: {
  diff: string;
  path: string;
  kind?: "add" | "delete" | "update";
  /** `diff` is the added or deleted file as is, not hunks (FileDiff.whole). */
  whole?: boolean;
}) {
  const rows = useMemo(() => parseDiff(diff, kind, whole), [diff, kind, whole]);
  const language = languageFor(path);
  if (rows.length > MAX_ROWS) {
    const side = (which: "add" | "del") =>
      rows
        .filter((row) => row.kind === which)
        .map((row) => row.text)
        .join("\n");
    return (
      <div className="diff diff-split">
        <p className="diff-note">更改过多，无法以差异形式显示。现分别显示删除和新增的文本。</p>
        <pre className="diff-side diff-del" role="group" aria-label="已移除的文本">
          {side("del")}
        </pre>
        <pre className="diff-side diff-add" role="group" aria-label="添加的文本">
          {side("add")}
        </pre>
      </div>
    );
  }
  return (
    <div className="diff" role="table" data-pure={whole || undefined}>
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={index} className="diff-gap" aria-hidden="true" />
        ) : (
          <div key={index} className={`diff-row diff-${row.kind}`}>
            <span className="diff-no">{row.oldNo ?? ""}</span>
            <span className="diff-no">{row.newNo ?? ""}</span>
            <span className="diff-code">
              <span className="diff-sign">{row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}</span>
              <span dangerouslySetInnerHTML={{ __html: highlight(row.text, language) || " " }} />
            </span>
          </div>
        ),
      )}
    </div>
  );
});

/**
 * A changes-pane card's head (c219730b0 Lt): the path, where it moved from (zt), the labels in Lt's
 * order (binary, whitespace only, mode), and +N −N always, 0 too. With no lines (`lines` false) it
 * opens nothing (c44d00c7f ml: no hunks, aria-disabled).
 */
export function FileDiffHead({
  file,
  stats,
  whitespaceOnly,
  lines,
  open,
  onToggle,
}: {
  file: FileDiff;
  stats: { added: number; removed: number };
  whitespaceOnly: boolean;
  lines: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const path = file.movePath ?? file.path;
  const from = file.movePath ? file.path : null;
  const labels = [
    file.binary && "二进制文件",
    whitespaceOnly && "仅空白字符",
    file.executable === true && "已设为可执行",
    file.executable === false && "不再可执行",
  ].filter((label) => typeof label === "string");
  return (
    <div className="file-diff-head" onClick={lines ? onToggle : undefined}>
      <button
        type="button"
        className="file-diff-toggle"
        aria-expanded={lines ? open : undefined}
        aria-disabled={!lines || undefined}
        aria-label={open ? "折叠差异" : "展开差异"}
      >
        <Icon name="CaretRight" size="sm" className="tool-caret" />
        <Icon name={fileGlyph(path)} size="xs" className={`file-kind file-kind-${file.kind}`} />
      </button>
      {/* The path's tip names the move and every label, which give way first (Lt S). */}
      <FileLink path={path} tip={labels.reduce((tip, label) => `${tip}（${label}）`, from ? `${from} → ${path}` : path)} className="file-path">
        {path}
      </FileLink>
      {from && (
        <span className="file-diff-moved">
          <span>已从</span>
          <span data-tip={from}>{parentDir(from) === parentDir(path) ? basename(from) : from}</span>
          <span>重命名</span>
        </span>
      )}
      {labels.map((label) => (
        <span key={label} className="file-diff-label">
          {label}
        </span>
      ))}
      <span className="diff-stat" dir="ltr">
        <span className="plus">+{stats.added}</span>
        <span className="minus">−{stats.removed}</span>
      </span>
    </div>
  );
}

export function FileDiffCard({ file, ws = false, defaultOpen = false }: { file: FileDiff; ws?: boolean; defaultOpen?: boolean }) {
  const { diff, rows, stats, whitespaceOnly } = useMemo(() => fileRows(file, ws), [file, ws]);
  const lines = rows.length > 0;
  const [picked, setPicked] = useState(defaultOpen);
  const open = lines && picked;
  return (
    <div className={`file-diff ${open ? "open" : ""}`}>
      <FileDiffHead file={file} stats={stats} whitespaceOnly={whitespaceOnly} lines={lines} open={open} onToggle={() => setPicked(!open)} />
      {open && <DiffView diff={diff} path={file.movePath ?? file.path} kind={file.kind} whole={file.whole} />}
    </div>
  );
}
