// The tooltip's way from its trigger (ui.tsx TooltipLayer), as Base UI's Tooltip keeps a popup
// open while the pointer heads for it.

export type PolygonPoint = { x: number; y: number; target: Node | null; related?: Node | null; leave: boolean };

/**
 * Base UI's safePolygon (Claude 2.42304 vendor-frame nd) for a tooltip above or below its
 * trigger: after the pointer leaves the trigger at (x, y), each move is checked against the gap
 * between the two and the triangle from the exit point to the tooltip. Leaving on the far side,
 * stalling, or straying out of them calls `close`; a pause inside the triangle closes after 40ms;
 * once the pointer has been on the tooltip, leaving it anywhere but over the trigger closes.
 */
export function safePolygon(x: number, y: number, side: string | undefined, close: () => void) {
  const buffer = 0.5;
  let landed = false;
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastTime = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const within = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) =>
    px >= Math.min(x1, x2) && px <= Math.max(x1, x2) && py >= Math.min(y1, y2) && py <= Math.max(y1, y2);
  const crosses = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => ay >= py !== by >= py && px <= ((bx - ax) * (py - ay)) / (by - ay) + ax;
  const inQuad = (px: number, py: number, q: number[]) => {
    let inside = false;
    for (let i = 0; i < 8; i += 2) if (crosses(px, py, q[i], q[i + 1], q[(i + 2) % 8], q[(i + 3) % 8])) inside = !inside;
    return inside;
  };
  // Under 0.1px/ms the pointer has stopped heading anywhere.
  const slow = (px: number, py: number) => {
    const now = performance.now();
    const elapsed = now - lastTime;
    const fresh = lastX === null || lastY === null || elapsed === 0;
    const moved = fresh ? 0 : (px - lastX!) ** 2 + (py - lastY!) ** 2;
    lastX = px;
    lastY = py;
    lastTime = now;
    return !fresh && moved < elapsed * elapsed * 0.01;
  };
  return (point: PolygonPoint, trigger: Element, popup: Element) => {
    clearTimeout(timer);
    const { x: px, y: py, target, leave } = point;
    if (target && popup.contains(target)) {
      landed = true;
      if (!leave) return;
    }
    if (target && trigger.contains(target)) {
      landed = false;
      if (!leave) {
        landed = true;
        return;
      }
    }
    if (leave && point.related && popup.contains(point.related)) return;
    const ref = trigger.getBoundingClientRect();
    const pop = popup.getBoundingClientRect();
    const right = x > pop.right - pop.width / 2;
    const wide = pop.width > ref.width;
    const start = (wide ? ref : pop).left;
    const end = (wide ? ref : pop).right;
    const top = side !== "bottom";
    if (top ? y >= ref.bottom - 1 : y <= ref.top + 1) return close();
    if (top ? within(px, py, start, ref.top + 1, end, pop.bottom - 1) : within(px, py, start, pop.top + 1, end, ref.bottom - 1)) return;
    if (landed && !within(px, py, ref.left, ref.top, ref.right, ref.bottom)) return close();
    if (!leave && slow(px, py)) return close();
    const n = wide ? buffer / 2 : buffer * 4;
    const ax = wide || right ? x + n : x - n;
    const bx = wide ? x - n : right ? x + n : x - n;
    const quad = top
      ? [ax, y + buffer + 1, bx, y + buffer + 1, pop.left, right || wide ? pop.bottom - buffer : pop.top, pop.right, right ? (wide ? pop.bottom - buffer : pop.top) : pop.bottom - buffer]
      : [ax, y - buffer, bx, y - buffer, pop.left, right || wide ? pop.top + buffer : pop.bottom, pop.right, right ? (wide ? pop.top + buffer : pop.bottom) : pop.top + buffer];
    if (!inQuad(px, py, quad)) close();
    else if (!landed) timer = setTimeout(close, 40);
  };
}
