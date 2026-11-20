// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of edgeMagnet.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { MAGNET, advance, edgeLook, magnet, resting, staticZone, wheeled, zone } from "./edgeMagnet.ts";

const frame = (x, extra = {}) => ({ x, y: 300, buttons: 0, inFrame: true, peekOpen: false, sidebarWidth: 288, roomPx: Infinity, ...extra });

/** Walks the pointer from `from` to `to` at `pxPerS`, then rests there; the frame each open came on. */
function run(state, { from, to, pxPerS, restMs = 500, extra = {} }) {
  const opens = [];
  let leanMax = 0;
  let x = from;
  let t = 0;
  for (let i = 0; i < 400 && t < 8000; i++) {
    const step = (pxPerS * 16) / 1000;
    x = x > to ? Math.max(to, x - step) : x;
    const { lean, open } = advance(state, frame(x, extra), 16);
    leanMax = Math.max(leanMax, lean);
    if (open) opens.push(i);
    t += 16;
    if (x === to && (restMs -= 16) <= 0) break;
  }
  return { opens, leanMax };
}

test("a steady approach leans the strip out and resting at the tip opens the peek once", () => {
  const state = magnet(400, 300);
  const { opens, leanMax } = run(state, { from: 400, to: 4, pxPerS: 300 });
  assert.equal(opens.length, 1);
  assert.ok(leanMax > 5 && leanMax <= 24, `lean ${leanMax}`);
});

test("a fly-by at speed does not open on a short stop, and a pointer far from the edge never does", () => {
  assert.deepEqual(run(magnet(600, 300), { from: 600, to: 4, pxPerS: 6000, restMs: 100 }).opens, []);
  assert.deepEqual(run(magnet(600, 300), { from: 600, to: 150, pxPerS: 300 }).opens, []);
});

test("after opening, the pointer must leave the tip before it opens again", () => {
  const state = magnet(400, 300);
  assert.equal(run(state, { from: 400, to: 4, pxPerS: 300 }).opens.length, 1);
  assert.deepEqual(run(state, { from: 4, to: 4, pxPerS: 300, restMs: 600 }).opens, []);
  for (let i = 0; i < 10; i++) advance(state, frame(60), 16);
  assert.equal(run(state, { from: 60, to: 4, pxPerS: 200 }).opens.length, 1);
});

test("a wheel or a press holds it off, and with the peek open the strip stays in", () => {
  const wheel = magnet(400, 300);
  run(wheel, { from: 400, to: 20, pxPerS: 300, restMs: 16 });
  wheeled(wheel);
  assert.deepEqual(run(wheel, { from: 20, to: 4, pxPerS: 300, restMs: 200 }).opens, []);
  assert.deepEqual(run(magnet(400, 300), { from: 400, to: 4, pxPerS: 300, extra: { buttons: 1 } }).opens, []);
  const open = run(magnet(400, 300), { from: 400, to: 4, pxPerS: 300, extra: { peekOpen: true } });
  assert.deepEqual(open.opens, []);
  assert.equal(open.leanMax, 0);
});

test("room near the edge shrinks the zone; the look and the rest test follow the lean", () => {
  assert.deepEqual(zone(MAGNET, Infinity), { scale: 1, tipPx: 12, farPx: 100 });
  const tight = zone(MAGNET, 10);
  assert.equal(tight.scale, 0.48);
  assert.equal(tight.tipPx, 10);
  assert.equal(tight.farPx, 48);
  assert.deepEqual(edgeLook(MAGNET, 0, 288), { line: 0, shade: 0 });
  assert.equal(edgeLook(MAGNET, 24, 288).line, 1);
  assert.ok(resting(magnet()));
  assert.deepEqual([staticZone(16), staticZone(17), staticZone(48), staticZone(49)], ["open", "hint", "hint", "far"]);
});
