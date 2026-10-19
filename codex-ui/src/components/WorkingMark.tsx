// Claude's working mark (ion-dist cc39db724, its sheets in c8677db5f): the clay sprite of the
// status line and the jump-to-latest key, 20px. The bridge reads the sheets out of the installed
// Claude Desktop (server/claude-marks.mjs); until they decode, and without Claude Desktop, the
// mark is a 7px clay dot. A body plays in, loops, plays out: a new activity waits for the loop's
// next seam (or its end), while to or from blocked, default or the sphere it cuts to the loop's
// last 20 frames under a 300ms crossfade, unless the loop ends within 1.5s anyway. A mark that
// mounts while another plays, or within 500ms of one going (the line moving under the plan
// card), picks up its stage and frame; reduced motion holds each body on its rest frame.

import { memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MarkActivity } from "../lib/transcript";
import { useReducedMotion } from "./ui";

interface Sheet {
  frames: number;
  /** ms per frame */
  speed: number;
  /** Loop frames a non-urgent change may leave at. */
  seams?: number[];
  /** The frame reduced motion holds. */
  rest?: number;
  url: string;
}

interface Sheets {
  info(key: string): Sheet;
  ready(body: string): boolean;
}

type Stage = { kind: "grow" } | { kind: "in" | "loop" | "out" | "tail"; body: string };
type Kind = Stage["kind"];
interface Resume {
  kind: Kind;
  body: string | null;
  ms: number;
}
interface Entry {
  stage: { kind: Kind; body: string | null; since: number } | null;
  leftAt: number | null;
}

const SIZE = 20;
const PRIORITY = ["sphere", "default", "think", "blocked"];
const stagesOf = (body: string) => [`${body}.in`, `${body}.loop`, `${body}.out`];

// ---------------------------------------------------------------------------
// Sheets: fetched once when a mark first mounts, the always-needed bodies decoded first.

let resident: Sheets | null = null;
let loading = false;
const decoded = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const getResident = () => resident;

function load() {
  if (loading) return;
  loading = true;
  fetch("/claude-marks.json")
    .then((response) => response.json() as Promise<{ sheets?: Record<string, Sheet> }>)
    .then(async ({ sheets = {} }) => {
      if (!sheets.grow) return;
      const publish = () => {
        resident = { info: (key) => sheets[key], ready: (body) => stagesOf(body).every((key) => decoded.has(key)) };
        for (const listener of listeners) listener();
      };
      const decode = (key: string) => {
        const image = new Image();
        image.src = sheets[key].url;
        return image.decode().then(() => void decoded.add(key));
      };
      await Promise.all(["grow", ...PRIORITY.flatMap(stagesOf)].map(decode));
      publish();
      const rest = new Map<string, string[]>();
      for (const key of Object.keys(sheets)) if (!decoded.has(key)) rest.set(key.split(".")[0], [...(rest.get(key.split(".")[0]) ?? []), key]);
      for (const keys of rest.values()) Promise.all(keys.map(decode)).then(publish, () => {});
    })
    .catch(() => {});
}

function onIdle(callback: () => void) {
  const id = requestIdleCallback(callback, { timeout: 200 });
  return () => cancelIdleCallback(id);
}

// ---------------------------------------------------------------------------
// Continuity: the marks on screen, and the last one to go.

const live = new Set<Entry>();
let last: Entry | null = null;

function resumeFrom(now: number): Resume | "dot" | undefined {
  let entry: Entry | null = null;
  for (const one of live) entry = one;
  if (!entry && last && now - (last.leftAt ?? now) <= 500) entry = last;
  if (entry) return entry.stage ? { kind: entry.stage.kind, body: entry.stage.body, ms: now - entry.stage.since } : "dot";
}

function register(entry: Entry) {
  entry.leftAt = null;
  live.add(entry);
  return () => {
    entry.leftAt = performance.now();
    live.delete(entry);
    last = entry;
  };
}

// ---------------------------------------------------------------------------
// Stages

const sheetKey = (stage: Stage) => (stage.kind === "grow" ? "grow" : `${stage.body}.${stage.kind === "tail" ? "loop" : stage.kind}`);

/** The loop's last 20 frames, where an urgent change cuts to. */
const tailRange = (frames: number) => [Math.max(0, frames - 20), frames];

function wantedBody(activity: string, blocked: boolean, ready: (body: string) => boolean) {
  const body = blocked ? "blocked" : activity;
  return ready(body) ? body : ready("default") ? "default" : "sphere";
}

const entryStage = (body: string): Stage => (body === "sphere" ? { kind: "loop", body } : { kind: "in", body });

function next(stage: Stage, wanted: string): Stage {
  switch (stage.kind) {
    case "grow":
      return { kind: "in", body: wanted };
    case "tail":
      return stage.body === wanted ? { kind: "loop", body: stage.body } : { kind: "out", body: stage.body };
    case "in":
      return stage.body === "sphere" && wanted !== "sphere" ? { kind: "out", body: "sphere" } : { kind: "loop", body: stage.body };
    case "loop":
      return stage.body === wanted ? stage : { kind: "out", body: stage.body };
    case "out":
      return { kind: "in", body: wanted };
  }
}

function resumeStage(resume: Resume | undefined, sheets: Sheets): { stage: Stage; ms: number } | undefined {
  if (!resume) return;
  const ms = Math.max(0, resume.ms);
  if (resume.kind === "grow") return { stage: { kind: "grow" }, ms };
  if (resume.body === null || !sheets.ready(resume.body)) return;
  return resume.kind === "tail" ? { stage: { kind: "out", body: resume.body }, ms: 0 } : { stage: { kind: resume.kind, body: resume.body }, ms };
}

const offset = (frame: number) => `translateY(${-frame * SIZE}px)`;

function Sprite({
  sheets,
  activity,
  blocked,
  fromDot,
  resume,
  onStageStart,
  onStageEnd,
  reduced,
}: {
  sheets: Sheets;
  activity: string;
  blocked: boolean;
  fromDot: boolean;
  resume: Resume | undefined;
  onStageStart(kind: Kind, body: string | null, ms: number): void;
  onStageEnd(): void;
  reduced: boolean;
}) {
  const strips = useRef(new Map<string, HTMLSpanElement>());
  const layers = useRef(new Map<string, HTMLSpanElement>());
  const anim = useRef<Animation | null>(null);
  const [mounted, setMounted] = useState(() => new Set<string>());
  const [resumed] = useState(() => resumeStage(resume, sheets));
  const [stage, setStage] = useState<Stage>(() => resumed?.stage ?? (fromDot ? { kind: "grow" } : { kind: "in", body: wantedBody(activity, blocked, sheets.ready) }));
  const [round, setRound] = useState(0);
  const [fade, setFade] = useState<{ key: string; frame: number; frames: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const wanted = wantedBody(activity, blocked, sheets.ready);
  const wantedNow = useRef(wanted);
  const startNow = useRef(onStageStart);
  const endNow = useRef(onStageEnd);
  useEffect(() => {
    wantedNow.current = wanted;
    startNow.current = onStageStart;
    endNow.current = onStageEnd;
  });
  const still = reduced || failed;
  const shown: Stage = still ? { kind: "loop", body: wanted } : stage;
  const key = sheetKey(shown);
  const { frames, speed, seams, rest } = sheets.info(key);
  const [firstStage] = useState(stage);
  const [startFrame] = useState(() =>
    resumed === undefined ? 0 : resumed.stage.kind === "loop" ? Math.floor(resumed.ms / speed) % frames : Math.min(frames - 1, Math.floor(resumed.ms / speed)),
  );
  const from = stage === firstStage && round === 0 ? startFrame : 0;
  const restFrame = still ? (rest ?? Math.floor(frames / 3)) : stage.kind === "tail" ? tailRange(frames)[0] : from;

  useLayoutEffect(() => {
    if (!still) startNow.current(stage.kind, stage.kind === "grow" ? null : stage.body, from * speed);
  }, [stage, round, from, speed, still]);

  // Play the stage once through, a step per frame, then move on (or loop again).
  useEffect(() => {
    const strip = strips.current.get(key);
    if (!strip || still) return;
    const [start, end] = stage.kind === "tail" ? tailRange(frames) : [0, frames];
    const count = end - start;
    let animation: Animation;
    try {
      animation = strip.animate(
        Array.from({ length: count }, (_, i) => ({ transform: offset(start + i) })),
        { duration: speed * count, iterations: 1, easing: count > 1 ? `steps(${count}, jump-none)` : "linear", fill: "forwards" },
      );
    } catch {
      setFailed(true);
      return;
    }
    anim.current = animation;
    if (from > 0) animation.currentTime = from * speed;
    let alive = true;
    animation.finished
      .then(() => {
        if (!alive) return;
        endNow.current();
        const following = next(stage, wantedNow.current);
        if (following === stage) setRound((n) => n + 1);
        else setStage(following);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (anim.current === animation) anim.current = null;
      animation.cancel();
    };
  }, [stage, round, from, frames, speed, still, key]);

  // A new activity mid-loop: leave at the next seam, or cut to the tail when it is urgent.
  useEffect(() => {
    if (stage.kind !== "loop" || stage.body === wanted || still) return;
    const animation = anim.current;
    if (!animation || animation.currentTime === null) return;
    const at = Number(animation.currentTime);
    if (!(wanted === "blocked" || stage.body === "blocked" || stage.body === "default" || stage.body === "sphere")) {
      const seam = seams?.map((frame) => frame * speed).find((ms) => ms > at + 50);
      if (seam === undefined) return;
      const timer = setTimeout(() => {
        if (wantedNow.current !== stage.body) setStage({ kind: "out", body: stage.body });
      }, seam - at);
      return () => clearTimeout(timer);
    }
    if (speed * frames - at <= 1500) return;
    setFade({ key, frame: Math.min(frames - 1, Math.floor(at / speed)), frames });
    setStage(stage.body === "sphere" ? { kind: "out", body: "sphere" } : { kind: "tail", body: stage.body });
  }, [wanted, stage, speed, frames, seams, key, still]);

  useEffect(() => {
    if (!fade) return;
    const timer = setTimeout(() => setFade(null), 360);
    return () => clearTimeout(timer);
  }, [fade]);

  useLayoutEffect(() => {
    const layer = layers.current.get(key);
    if (!fade || still || !layer) return;
    const animation = layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-in-out" });
    return () => animation.cancel();
  }, [fade, still, key]);

  const strip = (sheet: string, count: number, frame: number, active = false): CSSProperties => ({
    width: SIZE,
    height: count * SIZE,
    backgroundImage: `url(${sheets.info(sheet).url})`,
    transform: offset(frame),
    ...(active && !still && { willChange: "transform", boxShadow: "inset 0 0 0 1px transparent" }),
  });
  // Every sheet that may play next stays mounted (decoded and painted), hidden.
  const keep = [key, sheetKey(next(shown, wanted)), sheetKey(entryStage(wanted)), "sphere.in", "sphere.out"];
  if (wanted !== "sphere") keep.push(`${wanted}.loop`);
  if (fade) keep.push(fade.key);
  if (keep.some((sheet) => !mounted.has(sheet))) setMounted(new Set([...mounted, ...keep]));
  return (
    <span className="working-sprite">
      {fade && (
        <span className="working-sprite-layer" style={still ? { opacity: 0 } : undefined}>
          <span style={strip(fade.key, fade.frames, fade.frame)} />
        </span>
      )}
      {[...new Set([...mounted, key])].map((sheet) => {
        const active = sheet === key;
        return (
          <span
            key={sheet}
            ref={(el) => {
              if (el) layers.current.set(sheet, el);
              else layers.current.delete(sheet);
            }}
            className="working-sprite-layer"
            style={active ? { zIndex: 1 } : { opacity: 0.001 }}
          >
            <span
              ref={(el) => {
                if (el) strips.current.set(sheet, el);
                else strips.current.delete(sheet);
              }}
              style={strip(sheet, sheets.info(sheet).frames, active ? restFrame : 0, active)}
            />
          </span>
        );
      })}
    </span>
  );
}

/** Runs `callback` two frames after `active` turns on (at once in a hidden window). */
function useTwoFrames(active: boolean, callback: () => void) {
  useEffect(() => {
    if (!active) return;
    if (document.visibilityState === "hidden") return void callback();
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(callback);
    });
    return () => cancelAnimationFrame(id);
  }, [active, callback]);
}

/**
 * The mark (cc39db724 pe): grows out of the dot it starts as, unless it takes over from a mark on
 * screen or one that just went; a `standalone` one (the jump key's) is never taken over from.
 */
export const WorkingMark = memo(function WorkingMark({
  activity = "default",
  blocked = false,
  standalone = false,
  className,
}: {
  activity?: MarkActivity;
  blocked?: boolean;
  standalone?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [resume] = useState(() => resumeFrom(performance.now()));
  const sheets = useSyncExternalStore(subscribe, getResident, () => null);
  const fromDot = resume === undefined || resume === "dot";
  useEffect(() => (sheets ? undefined : onIdle(load)), [sheets]);
  const [ready, setReady] = useState(false);
  const markReady = useCallback(() => setReady(true), []);
  useTwoFrames(!!sheets && fromDot && !reduced && !ready, markReady);
  const playing = !!sheets && (ready || !fromDot || reduced);
  if (playing && !ready) setReady(true);
  const entry = useRef<Entry>({ stage: null, leftAt: null });
  useLayoutEffect(() => (standalone ? undefined : register(entry.current)), [standalone]);
  const onStageStart = useCallback((kind: Kind, body: string | null, ms: number) => {
    entry.current.stage = { kind, body, since: performance.now() - ms };
  }, []);
  const [ended, setEnded] = useState(false);
  const onStageEnd = useCallback(() => setEnded(true), []);
  const [painted, setPainted] = useState(false);
  const markPainted = useCallback(() => setPainted(true), []);
  useTwoFrames(playing && !painted, markPainted);
  return (
    <span aria-hidden="true" className={className ? `working-mark ${className}` : "working-mark"}>
      {(!playing || (fromDot && !(ended || reduced || painted))) && <span className="working-mark-dot" />}
      {playing && sheets && (
        <Sprite
          sheets={sheets}
          activity={activity}
          blocked={blocked}
          fromDot={fromDot}
          resume={typeof resume === "object" ? resume : undefined}
          onStageStart={onStageStart}
          onStageEnd={onStageEnd}
          reduced={reduced}
        />
      )}
    </span>
  );
});

/**
 * The mark's 20px slot 12px ahead of a busy label (c734f318c TurnStatus leading). When it goes while
 * the row stays it folds away over 400ms (EM, shared-frame): its width and gap with it, the mark
 * shrinking to nothing and fading over the last 40%, the label sliding in behind; at once with
 * reduced motion.
 */
export function MarkSlot({ shown, activity, blocked = false }: { shown: boolean; activity?: MarkActivity; blocked?: boolean }) {
  const reduced = useReducedMotion();
  const [was, setWas] = useState(shown);
  const [leaving, setLeaving] = useState(false);
  if (was !== shown) {
    setWas(shown);
    setLeaving(!shown);
  }
  const slot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = slot.current;
    if (!leaving) return;
    if (!el || reduced) return void setLeaving(false);
    const gap = el.parentElement ? getComputedStyle(el.parentElement).columnGap : "0px";
    const animation = el.animate(
      [
        { offset: 0, width: `${el.getBoundingClientRect().width}px`, marginInlineEnd: getComputedStyle(el).marginInlineEnd, opacity: 1, transform: "scale(1)" },
        { offset: 0.6, opacity: 1 },
        { offset: 1, width: "0px", marginInlineEnd: `calc(-1 * ${gap === "normal" ? "0px" : gap})`, opacity: 0, transform: "scale(0)" },
      ],
      { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
    );
    animation.finished.then(() => setLeaving(false), () => {});
    return () => animation.cancel();
  }, [leaving, reduced]);
  if (!shown && !leaving) return null;
  return (
    <span ref={slot} className="working-mark-slot">
      <WorkingMark activity={activity} blocked={blocked} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// The turn's mark on its rows (cb6930dae Fa / Ra / Ja / Wa / Ba): a row of the live turn that holds
// it draws it on its own line, and the working line keeps quiet. Under the plan card the row moves
// into the outlet in the working line's cell (c96d752d0 _r) for as long as it holds it, then home.
// ponytail: one registry for the one transcript on screen; key it by session (KeptIn) if two ever
// show at once.

const noSubscribe = () => () => {};
const notHeld = () => false;
const noOutlet = () => null;
const holders = new Set<string>();
const heldListeners = new Set<() => void>();
const outletListeners = new Set<() => void>();
/** The boxes a row draws into, and where each one's home is. */
const carried = new Map<HTMLElement, () => HTMLElement | null>();
let outletEl: HTMLElement | null = null;

const emit = (listeners: Set<() => void>) => {
  for (const listener of listeners) listener();
};
const subscribeHeld = (listener: () => void) => {
  heldListeners.add(listener);
  return () => void heldListeners.delete(listener);
};
const isHeld = () => holders.size > 0;
const subscribeOutlet = (listener: () => void) => {
  outletListeners.add(listener);
  return () => void outletListeners.delete(listener);
};
const getOutlet = () => outletEl;

/** A new outlet (or none): a box still in the old one goes home first. */
function setOutlet(el: HTMLElement | null) {
  if (el === outletEl) return;
  for (const [box, home] of carried) {
    const to = home();
    if (to && box.parentNode === outletEl) moveInto(to, box);
  }
  outletEl = el;
  emit(outletListeners);
}

/** Ha: moves `el` into `target` keeping its state where moveBefore can, else its focus. */
function moveInto(target: HTMLElement, el: HTMLElement) {
  if (el.parentNode === target) return;
  const doc = el.ownerDocument;
  const focused = doc.activeElement;
  const moveBefore = (target as HTMLElement & { moveBefore?(node: Node, child: Node | null): void }).moveBefore;
  if (moveBefore && el.isConnected && target.isConnected) {
    try {
      return void moveBefore.call(target, el, null);
    } catch {}
  }
  target.appendChild(el);
  if (focused instanceof HTMLElement && el.contains(focused)) {
    queueMicrotask(() => {
      const now = doc.activeElement;
      if ((now === null || now === doc.body) && el.contains(focused)) focused.focus({ preventScroll: true });
    });
  }
}

/** Ra: holds the turn's mark while `wants`. */
export function useHoldsMark(wants: boolean): boolean {
  const id = useId();
  useLayoutEffect(() => {
    if (!wants) return;
    const was = isHeld();
    holders.add(id);
    if (!was) emit(heldListeners);
    return () => {
      if (holders.delete(id) && !isHeld()) emit(heldListeners);
    };
  }, [wants, id]);
  return wants;
}

/** Ja: whether a row holds the turn's mark. */
export function useMarkHeld(): boolean {
  return useSyncExternalStore(subscribeHeld, isHeld, notHeld);
}

/** Ba: where a row holding the mark goes under the plan card. */
export function MarkOutlet() {
  return <div ref={setOutlet} className="mark-outlet" data-turn-mark-outlet="" />;
}

/**
 * Wa: a row that holds the mark while there is an outlet draws into a box that moves into it, and
 * back to its place in the turn when it lets go (the box stays, so the row keeps its state).
 */
export function MarkBox({ holds, children }: { holds: boolean; children: ReactNode }) {
  const outlet = useSyncExternalStore(holds ? subscribeOutlet : noSubscribe, holds ? getOutlet : noOutlet, noOutlet);
  const home = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  if (box === null && holds && outlet !== null) {
    const el = outlet.ownerDocument.createElement("div");
    el.setAttribute("data-turn-mark-box", "");
    setBox(el);
  }
  useEffect(() => {
    if (!box) return;
    carried.set(box, () => home.current);
    return () => {
      carried.delete(box);
      box.remove();
    };
  }, [box]);
  useLayoutEffect(() => {
    const to = (outlet?.isConnected ? outlet : null) ?? home.current;
    if (box && to) moveInto(to, box);
  }, [box, outlet]);
  if (!box) return children;
  return (
    <>
      <div ref={home} data-turn-mark-home="" />
      {createPortal(children, box)}
    </>
  );
}
