// The collapsed sidebar's edge magnet (Claude Desktop 3.1623 cec084e62 EdgeMagnetPeek over
// shared-16 ag / og, drawn while __gb__741807810 is on: 设置 → 通用 → 外观 → 侧边栏边缘提示). As a
// mouse nears the window's start edge, the hint strip leans out on a spring, more the straighter
// the pointer heads for the edge; resting at the tip opens the peek. A fast fly-by, a press, a wheel
// or a release just before do not count, and after an open the pointer must leave the tip before it
// can open again. Pure state: Sidebar.tsx's SidebarEdge feeds it a sample each frame.

/** shared-16 ag. */
export const MAGNET = {
  farPx: 100,
  tipPx: 12,
  leanFraction: 0.045,
  shade: 0.05,
  curve: 3.1,
  weight: 0,
  snap: 60,
  dwellMs: 10,
  fastDwellMs: 170,
  speedGuardPxPerS: 800,
  quietMs: 400,
  intent: 1,
  roomAware: 1,
  minZonePx: 48,
};
export type MagnetConfig = typeof MAGNET;

/** shared-16 og: with motion reduced, a static hint within 48px and the peek after 100ms within 16px. */
export const STATIC_HINT = { hintPx: 48, openPx: 16, dwellMs: 100 };

/** Physics substep, the longest frame stepped, the room's padding, the smallest tip, wheels apart (d / f / p / m / h). */
const SUBSTEP_MS = 8;
const MAX_FRAME_MS = 32;
const ROOM_PAD = 28;
const MIN_TIP = 10;
const WHEEL_GAP_MS = 150;

export interface Magnet {
  t: number;
  px: number;
  py: number;
  vx: number;
  speed: number;
  speedPeak: number;
  wasDown: boolean;
  lastUp: number;
  lastWheel: number;
  moved: boolean;
  flyby: boolean;
  calmFor: number;
  intent: number;
  lean: number;
  leanV: number;
  dwell: number;
  dwellNeed: number;
  mustLeave: boolean;
  tipPx: number;
  farPx: number;
}

export interface MagnetInput {
  /** From the start edge. */
  x: number;
  y: number;
  buttons: number;
  /** Over the frame below the chrome bar. */
  inFrame: boolean;
  peekOpen: boolean;
  sidebarWidth: number;
  /** How far in the content starts at this height (Infinity: nothing found). */
  roomPx: number;
}

/** g */
export function magnet(px = 1e4, py = 0): Magnet {
  return { t: 0, px, py, vx: 0, speed: 0, speedPeak: 0, wasDown: false, lastUp: -1e9, lastWheel: -1e9, moved: false, flyby: false, calmFor: 0, intent: 0, lean: 0, leanV: 0, dwell: 0, dwellNeed: 0, mustLeave: false, tipPx: MAGNET.tipPx, farPx: MAGNET.farPx };
}

/** v: at the tip already, it must leave before it can open. */
function leaveTip(m: Magnet) {
  if (m.px <= m.tipPx) m.mustLeave = true;
}

/** _: a wheel `ago` ms back; a new burst forgets the movement. */
export function wheeled(m: Magnet, ago = 0) {
  const at = m.t - ago;
  if (at - m.lastWheel > WHEEL_GAP_MS) {
    m.moved = false;
    leaveTip(m);
  }
  m.lastWheel = at;
}

/** y: a button released `ago` ms back. */
export function released(m: Magnet, ago = 0) {
  m.lastUp = m.t - ago;
  m.moved = false;
  leaveTip(m);
}

/** b: picking up again after `idle` ms at rest. */
export function settle(m: Magnet, x: number, y: number, buttons: number, idle: number) {
  m.t += Math.max(0, idle);
  if (x !== m.px || y !== m.py) m.moved = true;
  m.px = x;
  m.py = y;
  m.wasDown = buttons !== 0;
  m.vx = 0;
  m.speed = 0;
  m.speedPeak = 0;
  leaveTip(m);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const approach = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

/** w: with content close to the edge, the zone shrinks to fit (never under 48px, the tip not under 10). */
export function zone(cfg: MagnetConfig, roomPx: number) {
  const scale = cfg.roomAware < 0.5 ? 1 : Math.max(Math.min(1, cfg.minZonePx / cfg.farPx), Math.min(1, (roomPx + ROOM_PAD) / cfg.farPx));
  const tipPx = scale < 1 ? Math.max(cfg.tipPx * Math.max(scale, 0.5), MIN_TIP) : cfg.tipPx;
  return { scale, tipPx, farPx: Math.max(cfg.farPx * scale, tipPx + 1) };
}

/** T: one substep; true when it opens the peek. */
function tick(m: Magnet, input: MagnetInput, dt: number, vx: number, speed: number, cfg: MagnetConfig): boolean {
  const sec = dt / 1000;
  m.t += dt;
  const k = approach(dt, 35);
  m.vx += (vx - m.vx) * k;
  m.speed += (speed - m.speed) * k;
  m.speedPeak = Math.max(m.speed, m.speedPeak * Math.exp(-dt / 180));
  const down = input.buttons !== 0;
  if (m.wasDown && !down) released(m);
  m.wasDown = down;
  const { scale, tipPx, farPx } = zone(cfg, input.roomPx);
  m.tipPx = tipPx;
  m.farPx = farPx;
  if (m.speed > cfg.speedGuardPxPerS && input.x < farPx + 60) {
    m.flyby = true;
    m.calmFor = 0;
  }
  if (m.flyby) {
    if (m.speed < cfg.speedGuardPxPerS * 0.35) {
      m.calmFor += dt;
      if (m.calmFor > 90) m.flyby = false;
    } else m.calmFor = 0;
  }
  const quiet = m.t - m.lastWheel > cfg.quietMs && m.t - m.lastUp > cfg.quietMs * 0.8;
  const live = input.inFrame && !down && quiet && !m.flyby;
  const heading = live && m.vx < -15;
  m.intent += (+heading - m.intent) * approach(dt, heading ? 70 : 500);
  const pull = smooth((live ? clamp01((farPx - input.x) / (farPx - tipPx)) : 0) ** cfg.curve) * (1 - cfg.intent + cfg.intent * m.intent);
  const target = input.peekOpen ? 0 : Math.min(24, cfg.leanFraction * input.sidebarWidth * pull * scale);
  const omega = input.peekOpen ? cfg.snap : 10 - 8 * cfg.weight;
  const damping = input.peekOpen ? 1 : 1.1;
  m.leanV += (omega * omega * (target - m.lean) - 2 * damping * omega * m.leanV) * sec;
  m.lean += m.leanV * sec;
  if (m.lean < 0) {
    m.lean = 0;
    m.leanV = Math.max(0, m.leanV);
  }
  if (input.peekOpen || !input.inFrame) m.mustLeave = true;
  else if (input.x > tipPx) m.mustLeave = false;
  if (live && !input.peekOpen && !m.mustLeave && m.moved && input.x <= tipPx && m.vx < 200) {
    if (m.dwell === 0) m.dwellNeed = cfg.dwellMs + cfg.fastDwellMs * clamp01((m.speedPeak - cfg.speedGuardPxPerS) / 1000);
    m.dwell += dt;
    if (m.dwell >= m.dwellNeed) {
      m.dwell = 0;
      m.mustLeave = true;
      return true;
    }
  } else m.dwell = 0;
  return false;
}

/** ee: a frame of `dt` ms (stepped at most 32ms, 8ms at a time) with the pointer at `input`. */
export function advance(m: Magnet, input: MagnetInput, dt: number, cfg: MagnetConfig = MAGNET): { lean: number; open: boolean } {
  const frame = Math.min(Math.max(dt, 0), MAX_FRAME_MS);
  if (frame <= 0) return { lean: m.lean, open: false };
  const over = Math.max(dt, frame);
  const vx = ((input.x - m.px) / over) * 1000;
  const vy = ((input.y - m.py) / over) * 1000;
  const speed = Math.hypot(vx, vy);
  if (input.x !== m.px || input.y !== m.py) m.moved = true;
  m.px = input.x;
  m.py = input.y;
  let open = false;
  for (let left = frame; left > 0.001; left -= SUBSTEP_MS) open = tick(m, input, Math.min(left, SUBSTEP_MS), vx, speed, cfg) || open;
  return { lean: m.lean, open };
}

/** E: the web build slides the peeked sidebar in at the snap's pace. */
export function snapTiming(cfg: MagnetConfig = MAGNET) {
  return { durationMs: 6000 / cfg.snap, easing: "cubic-bezier(0.25, 0.2, 0.2, 0.9)" };
}

/** te: the strip's hairline (full by 1.5px of lean) and shade (full at the lean's ceiling). */
export function edgeLook(cfg: MagnetConfig, lean: number, sidebarWidth: number) {
  const ceiling = Math.min(24, Math.max(1, cfg.leanFraction * sidebarWidth));
  return { line: clamp01(lean / 1.5), shade: cfg.shade * smooth(clamp01(lean / ceiling)) };
}

/** ne: nothing left to animate. */
export function resting(m: Magnet): boolean {
  return m.lean < 0.05 && Math.abs(m.leanV) < 0.5 && m.intent < 0.02 && !m.flyby;
}

/** jM: the static hint's zones. */
export function staticZone(x: number): "open" | "hint" | "far" {
  return x <= STATIC_HINT.openPx ? "open" : x <= STATIC_HINT.hintPx ? "hint" : "far";
}
