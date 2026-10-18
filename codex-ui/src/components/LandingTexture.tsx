// Landing texture (c9d397622 LandingTextureLayer; cc43287c9 mH / pH mount it on the draft page):
// faint monospace glyphs under the page that a slow wind moves, the pointer stirs and a click
// ripples. Facts used: shown once the page has been visible for 3s (the timer restarts on
// visibilitychange), fading in over 3s and out over 500ms; none when 背景动画 is 关, a still
// frame under reduced motion; 9px glyphs on a 6.5 × 13 grid (at least 24 × 8), weight 300 (400
// below 1.5 dpr); strength 0.26, cap 0.9, rest 0.03; a calm "composition card" (250 / 80 px);
// glow (.1, .68, 1) dark / (0, .25, 1) light with headroom 3; touch 60–800 px/s; 40ms frames
// (10ms while a ripple runs), 180s of motion then an 8s settle; only while the window is
// focused and visible; the "mixed" glyph look; up to 6 ripples, 48 wake points and a heart on
// every third click.
// ponytail: the wind is value noise with drifting streaks, not the original solver (friction,
// flick, lull, curl, wisp, tail and edge are not modelled), and the calm card is taken to be
// the page's content box with 250 / 80 px of falloff; swap in the real field if it matters.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { readPref } from "../lib/store";
import { useReducedMotion } from "./ui";

type Mode = "system" | "enabled" | "disabled";

/** Settings → 背景动画 (G writes html[data-bg-anim]; the saved pref covers a boot without it). */
function readMode(): Mode {
  const attr = document.documentElement.dataset.bgAnim;
  return attr === "enabled" || attr === "disabled" ? attr : readPref("codex-ui:bg-anim", ["system", "enabled", "disabled"], "system");
}

function subscribeMode(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-bg-anim"] });
  return () => observer.disconnect();
}

/** True once the document has stayed visible for `ms`. */
function useVisibleFor(ms: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = window.setTimeout(() => setReady(true), ms);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [ready, ms]);
  return ready;
}

export function LandingTexture() {
  const mode = useSyncExternalStore(subscribeMode, readMode);
  const reduce = useReducedMotion();
  const ready = useVisibleFor(3000);
  const on = ready && mode !== "disabled";
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (on) {
      setMounted(true);
      // Two frames, so the first paint is at opacity 0 and the fade-in runs.
      let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => setShown(true))));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), 500);
    return () => clearTimeout(timer);
  }, [on]);
  if (!mounted) return null;
  return (
    <div className="landing-texture" data-shown={shown || undefined} aria-hidden="true">
      <Field animate={mode === "enabled" || !reduce} />
    </div>
  );
}

function Field({ animate }: { animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => (canvas.current ? run(canvas.current, animate) : undefined), [animate]);
  return <canvas ref={canvas} />;
}

// ---------------------------------------------------------------------------
// The field

const LOOK = "ab0cAde1fEgh2iGjk3lHmn4oKpq5rMst6uRvw7xSyz8nT9eW";
const CELL_W = 6.5;
const CELL_H = 13;
const GLYPH_PX = 9;
const BASE = 0.26;
const CAP = 0.9;
const REST = 0.03;
const HEADROOM = 3;
const FRAME_MS = 40;
const RIPPLE_FRAME_MS = 10;
const BUDGET_MS = 180_000;
const SETTLE_MS = 8_000;
const REVEAL_MS = 4_000;
const MORPH = 3;
const WAKE_MS = 1200;
const TAP_MS = 1600;
const HEART_MS = 2200;

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Draws into `canvas` until the returned stop is called. */
function run(canvas: HTMLCanvasElement, animate: boolean): () => void {
  const ctx = canvas.getContext("2d");
  const box = canvas.parentElement;
  if (!ctx || !box) return () => {};
  const zone: HTMLElement = box.closest<HTMLElement>(".main-col") ?? document.body;

  let w = 0;
  let h = 0;
  let cols = 0;
  let rows = 0;
  let dpr = 1;
  let seeds = new Float32Array(0);
  let energy = new Float32Array(0);
  let ink: HTMLCanvasElement | null = null;
  let glow: HTMLCanvasElement | null = null;
  let rest: HTMLCanvasElement | null = null;

  const wake: { x: number; y: number; t: number; s: number }[] = [];
  const taps: { x: number; y: number; t: number; heart: boolean }[] = [];
  let clicks = 0;
  let pointer: { x: number; y: number; t: number } | null = null;

  const born = performance.now();
  let activeAt = born;
  let clock = 0;
  let prev = born;
  let lastDraw = 0;
  let raf = 0;
  // The content box (title, turn zero, composer) in canvas px, re-measured twice a second.
  let card = { l: 0, t: 0, r: 0, b: 0 };
  let measuredAt = -Infinity;
  const measure = (now: number) => {
    measuredAt = now;
    const base = canvas.getBoundingClientRect();
    const parts = [...(zone.querySelector(".landing-col")?.children ?? [])].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!parts.length) return;
    card = {
      l: Math.min(...parts.map((r) => r.left)) - base.left,
      t: Math.min(...parts.map((r) => r.top)) - base.top,
      r: Math.max(...parts.map((r) => r.right)) - base.left,
      b: Math.max(...parts.map((r) => r.bottom)) - base.top,
    };
  };

  const atlas = (color: string, weight: number, family: string) => {
    const cw = Math.ceil(CELL_W * dpr);
    const ch = Math.ceil(CELL_H * dpr);
    const sheet = document.createElement("canvas");
    sheet.width = cw * LOOK.length;
    sheet.height = ch;
    const g = sheet.getContext("2d");
    if (!g) return sheet;
    g.font = `${weight} ${GLYPH_PX * dpr}px ${family}`;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < LOOK.length; i++) g.fillText(LOOK[i], i * cw + cw / 2, ch / 2);
    return sheet;
  };

  const layout = () => {
    dpr = window.devicePixelRatio || 1;
    w = box.clientWidth;
    h = box.clientHeight;
    cols = Math.max(24, Math.floor(w / CELL_W));
    rows = Math.max(8, Math.floor(h / CELL_H));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    seeds = new Float32Array(cols * rows);
    for (let i = 0; i < seeds.length; i++) seeds[i] = hash(i % cols, Math.floor(i / cols) + 7919);
    energy = new Float32Array(cols * rows);
    const css = getComputedStyle(box);
    const weight = dpr < 1.5 ? 400 : 300;
    const dark = document.documentElement.classList.contains("dark");
    ink = atlas(css.color, weight, css.fontFamily);
    glow = atlas(dark ? "rgb(26 173 255)" : "rgb(0 64 255)", weight, css.fontFamily);
    // The resting glyphs never change: one bitmap, blitted under every frame.
    rest = document.createElement("canvas");
    rest.width = canvas.width;
    rest.height = canvas.height;
    const r = rest.getContext("2d");
    if (r && ink) {
      r.globalAlpha = REST;
      for (let i = 0; i < seeds.length; i++) blit(r, ink, Math.floor(seeds[i] * LOOK.length), i % cols, Math.floor(i / cols));
    }
  };

  const blit = (g: CanvasRenderingContext2D, sheet: HTMLCanvasElement, glyph: number, col: number, row: number) => {
    const cw = Math.ceil(CELL_W * dpr);
    const ch = Math.ceil(CELL_H * dpr);
    g.drawImage(sheet, glyph * cw, 0, cw, ch, Math.round(col * CELL_W * dpr), Math.round(row * CELL_H * dpr), cw, ch);
  };

  /** Adds `amount` to the cell under (x, y) in CSS px. */
  const splat = (x: number, y: number, amount: number) => {
    const col = Math.floor(x / CELL_W);
    const row = Math.floor(y / CELL_H);
    if (col < 0 || row < 0 || col >= cols || row >= rows) return;
    energy[row * cols + col] += amount;
  };

  const stir = (now: number) => {
    energy.fill(0);
    const sigma = 28;
    const reach = sigma * 3;
    for (const p of wake) {
      const fade = 1 - (now - p.t) / WAKE_MS;
      if (fade <= 0) continue;
      for (let y = Math.max(0, p.y - reach); y < Math.min(h, p.y + reach); y += CELL_H)
        for (let x = Math.max(0, p.x - reach); x < Math.min(w, p.x + reach); x += CELL_W) {
          const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
          splat(x, y, p.s * fade * Math.exp(-d2 / (2 * sigma * sigma)));
        }
    }
    for (const tap of taps) {
      const age = now - tap.t;
      if (tap.heart) {
        const fade = 1 - age / HEART_MS;
        if (fade <= 0) continue;
        const size = 70;
        for (let y = tap.y - size * 1.3; y < tap.y + size * 1.3; y += CELL_H)
          for (let x = tap.x - size * 1.3; x < tap.x + size * 1.3; x += CELL_W) {
            const X = (x - tap.x) / size;
            const Y = -(y - tap.y) / size + 0.2;
            if ((X * X + Y * Y - 1) ** 3 - X * X * Y ** 3 <= 0) splat(x, y, 0.9 * fade);
          }
        continue;
      }
      const fade = 1 - age / TAP_MS;
      if (fade <= 0) continue;
      const radius = age * 0.35;
      const steps = Math.max(12, Math.ceil((2 * Math.PI * radius) / CELL_W));
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        splat(tap.x + Math.cos(angle) * radius, tap.y + Math.sin(angle) * radius * 0.6, 0.8 * fade);
      }
    }
  };

  const draw = (now: number) => {
    if (!ink || !glow || !rest || !w || !h) return;
    const t = clock / 1000;
    const revealed = animate ? smooth(0, 1, clock / REVEAL_MS) : 1;
    if (now - measuredAt > 500) measure(now);
    stir(now);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(rest, 0, 0);
    const gust = 0.8 + 0.2 * Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1.3);
    for (let row = 0; row < rows; row++) {
      const y = (row + 0.5) * CELL_H;
      const dy = Math.max(card.t - y, 0, y - card.b) / 80;
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = (col + 0.5) * CELL_W;
        const dx = Math.max(card.l - x, 0, x - card.r) / 250;
        // Still over the content, stirring up within 250 px across / 80 px down of it.
        const calm = smooth(0, 1, Math.max(dx, dy));
        const u = col * 0.035 - t * 0.3;
        const v = row * 0.11 + Math.sin(col * 0.02 + t * 0.3) * 0.65;
        const n = noise(u, v) * 0.65 + noise(u * 2.7, v * 2.7 + t * 0.2) * 0.6 * 0.35;
        const wind = smooth(0.58, 0.9, n) * gust * calm * (x / w <= revealed ? 1 : 0);
        const touch = energy[i];
        const alpha = Math.min(CAP, REST + BASE * wind + BASE * HEADROOM * touch);
        if (alpha <= REST + 0.01) continue;
        const glyph = Math.floor(seeds[i] * LOOK.length + t * MORPH * (wind + touch)) % LOOK.length;
        ctx.globalAlpha = alpha;
        blit(ctx, touch > 0.08 ? glow : ink, glyph, col, row);
      }
    }
  };

  const live = () => !document.hidden && document.hasFocus();

  const tick = (now: number) => {
    raf = 0;
    const idle = now - activeAt - BUDGET_MS;
    const motion = 1 - smooth(0, SETTLE_MS, idle);
    clock += (now - prev) * motion;
    prev = now;
    while (wake.length && now - wake[0].t > WAKE_MS) wake.shift();
    while (taps.length && now - taps[0].t > HEART_MS) taps.shift();
    const rippling = taps.some((tap) => now - tap.t < (tap.heart ? HEART_MS : TAP_MS));
    if (now - lastDraw >= (rippling ? RIPPLE_FRAME_MS : FRAME_MS)) {
      lastDraw = now;
      draw(now);
    }
    if ((motion > 0 || rippling || wake.length) && live()) raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (!animate || raf || !live()) return;
    prev = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const wakeUp = () => {
    activeAt = performance.now();
    start();
  };

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onMove = (event: PointerEvent) => {
    const now = performance.now();
    const p = local(event);
    if (pointer) {
      const speed = (Math.hypot(p.x - pointer.x, p.y - pointer.y) / Math.max(1, now - pointer.t)) * 1000;
      const s = smooth(60, 800, speed);
      if (s > 0) {
        wake.push({ x: p.x, y: p.y, t: now, s });
        if (wake.length > 48) wake.shift();
      }
    }
    pointer = { ...p, t: now };
    wakeUp();
  };

  const onDown = (event: PointerEvent) => {
    const p = local(event);
    clicks += 1;
    taps.push({ ...p, t: performance.now(), heart: clicks % 3 === 0 });
    if (taps.length > 6) taps.shift();
    wakeUp();
  };

  layout();
  draw(born);
  const resize = new ResizeObserver(() => {
    layout();
    draw(performance.now());
  });
  resize.observe(box);
  const theme = new MutationObserver(() => {
    layout();
    draw(performance.now());
  });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  if (animate) {
    zone.addEventListener("pointermove", onMove, { passive: true });
    zone.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("focus", start);
    document.addEventListener("visibilitychange", start);
    start();
  }
  return () => {
    cancelAnimationFrame(raf);
    resize.disconnect();
    theme.disconnect();
    zone.removeEventListener("pointermove", onMove);
    zone.removeEventListener("pointerdown", onDown);
    window.removeEventListener("focus", start);
    document.removeEventListener("visibilitychange", start);
  };
}
