// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of reveal.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extendShown,
  Ledger,
  noteShown,
  paceCeiling,
  paceStep,
  remapShown,
  riseAtMount,
  riseDecide,
  riseEnded,
  runPieces,
  shownBefore,
  stepSize,
  stepWait,
  takeRise,
} from "./reveal.ts";

test("pacing holds back a line that is only a block marker", () => {
  assert.equal(paceCeiling("Plain text"), 10);
  assert.equal(paceCeiling("Intro\n- "), 6);
  assert.equal(paceCeiling("Intro\n1."), 6);
  assert.equal(paceCeiling("Intro\n- [x] "), 6);
  assert.equal(paceCeiling("Intro\n## "), 6);
  assert.equal(paceCeiling("Intro\n- item"), 12);
});

test("a step cuts back to a space and never ends just after a marker", () => {
  const text = "The quick brown fox jumps over the lazy dog";
  assert.equal(paceStep(text, 0, text.length, 22), 20);
  const list = "Intro\n- item one";
  assert.equal(paceStep(list, 0, list.length, 8), 6);
  assert.equal(paceStep(list, 6, list.length, 8), 13);
  assert.equal(paceStep(list, 6, list.length, 2), 10);
});

test("steps drain any backlog in about 550ms", () => {
  assert.equal(stepWait(22), 150);
  assert.equal(stepWait(121), 100);
  assert.equal(stepWait(484), 25);
  assert.equal(stepWait(10_000), 25);
  assert.equal(stepSize(100, 0), 22);
  assert.equal(stepSize(584, 30), 62);
  assert.equal(stepSize(584, 75), 122);
  assert.equal(stepSize(584, 150), 122);
});

test("a rewritten text keeps what showed in place", () => {
  assert.equal(remapShown("hello world", "hello brave world", 3), 3);
  assert.equal(remapShown("hello world", "hello brave world", 11), 17);
  assert.equal(remapShown("hello world", "hello there", 8), 8);
});

test("words share a chunk, later chunks wait 2.5ms a char, and settle once one closes after them", () => {
  let now = 0;
  const ledger = new Ledger(undefined, undefined, () => now);
  ledger.sync("Hello brave new world");
  const pieces = runPieces(ledger, "b0", 0, "Hello brave new world");
  assert.deepEqual(
    pieces.map(({ text, at, reveal }) => [text, at, reveal.delayMs]),
    [
      ["Hello brave new ", 0, 15],
      ["world", 16, 53],
    ],
  );
  const [first, second] = pieces.map((piece) => piece.reveal);

  now = 120;
  ledger.sync("Hello brave new world and");
  assert.equal(ledger.settled(first), false);
  const third = runPieces(ledger, "b0", 0, "Hello brave new world and").at(-1);
  assert.deepEqual([third.text, third.at, third.reveal.delayMs], ["and", 22, 8]);

  now = 400;
  ledger.sync("Hello brave new world and more");
  assert.equal(ledger.settled(first), true);
  assert.equal(ledger.settled(second), true);
  assert.equal(runPieces(ledger, "b0", 0, "Hello brave new world and"), null);
  assert.deepEqual(
    runPieces(ledger, "b0", 0, "Hello brave new world and more").map(({ text, at, reveal }) => [text, at, !!reveal]),
    [
      ["Hello brave new world and ", 0, false],
      ["more", 26, true],
    ],
  );
  assert.equal(runPieces(ledger, "b1", 0, " \n "), null);
});

test("phrase mode: new text joins the open chunk at once and a run fades by the steps it grew", () => {
  let now = 0;
  const ledger = new Ledger(undefined, undefined, () => now, "phrase");
  assert.deepEqual([ledger.fadeMs, ledger.settleMs], [500, 700]);
  const pieces = (text) => runPieces(ledger, "b0", 0, text).map(({ text, at, reveal }) => [text, at, reveal ? reveal.delayMs : null]);
  ledger.sync("Hello brave new world");
  assert.deepEqual(pieces("Hello brave new world"), [["Hello brave new world", 0, 0]]);

  now = 50;
  ledger.sync("Hello brave new world and");
  assert.deepEqual(pieces("Hello brave new world and"), [["Hello brave new world and", 0, 0]]);

  now = 150;
  ledger.sync("Hello brave new world and more");
  assert.deepEqual(pieces("Hello brave new world and more"), [
    ["Hello brave new world and", 0, 0],
    [" more", 25, 0],
  ]);

  now = 700;
  ledger.sync("Hello brave new world and more!");
  assert.deepEqual(pieces("Hello brave new world and more!"), [
    ["Hello brave new world and more", 0, null],
    ["!", 30, 0],
  ]);
});

test("a rewrite shows everything already there", () => {
  let now = 0;
  const ledger = new Ledger(undefined, undefined, () => now);
  ledger.sync("abc def");
  const reveal = ledger.reveal("x:0", 4);
  now = 10;
  ledger.sync("xyz");
  assert.equal(ledger.settled(reveal), true);
});

test("text arriving too fast twice running stops fading", () => {
  let now = 0;
  const ledger = new Ledger(undefined, undefined, () => now);
  now = 100;
  ledger.sync("word ".repeat(40));
  assert.equal(ledger.settled(ledger.reveal("a:0", 5)), false);
  now = 200;
  ledger.sync("word ".repeat(80));
  const reveal = ledger.reveal("a:5", 5);
  assert.equal(reveal.delayMs, 0);
  assert.equal(ledger.settled(reveal), true);
});

test("primed text, or a first delivery a remount already showed, does not fade", () => {
  let now = 0;
  const primed = new Ledger("Already here", undefined, () => now);
  assert.equal(primed.settled(primed.reveal("p:0", 8)), true);
  primed.sync("Already here and more");
  assert.equal(primed.settled(primed.reveal("p:13", 4)), false);

  const guarded = new Ledger(undefined, ["Hello there friend, how"], () => now);
  guarded.sync("Hello there friend, how are you");
  assert.equal(guarded.settled(guarded.reveal("g:0", 6)), true);
});

test("a reply's shown prefix is remembered once 22 chars show, growing to 64", () => {
  noteShown("short", "too short");
  assert.equal(shownBefore("short"), undefined);
  noteShown("long", "  The reply has shown enough text now");
  assert.deepEqual(shownBefore("long"), ["The reply has shown enough text now"]);
  const more = "The reply has shown enough text now, and it keeps going well past sixty-four chars";
  extendShown("long", more);
  assert.deepEqual(shownBefore("long"), [more.slice(0, 64)]);
});

test("a busy reply showing nothing owes its rise to its first text", () => {
  assert.equal(riseAtMount("t1", true, false, true), false);
  assert.equal(riseDecide("t1", { shows: false, rose: false, catching: false, motion: true }), true);
  assert.equal(takeRise("t1"), true);
  assert.equal(takeRise("t1"), false);
});

test("a busy reply already showing something rises whole, once", () => {
  assert.equal(riseAtMount("t2", true, true, true), true);
  assert.equal(riseDecide("t2", { shows: true, rose: true, catching: false, motion: true }), true);
  assert.equal(takeRise("t2"), false);
  assert.equal(riseAtMount("t2", true, true, true), false);
});

test("catching up, reduced motion, or the turn ending let the rise go", () => {
  assert.equal(riseAtMount("t3", true, false, false), false);
  assert.equal(riseDecide("t3", { shows: false, rose: false, catching: true, motion: true }), false);
  assert.equal(riseDecide("t3", { shows: true, rose: false, catching: true, motion: true }), true);
  assert.equal(takeRise("t3"), false);

  assert.equal(riseDecide("t4", { shows: false, rose: false, catching: false, motion: false }), true);
  assert.equal(takeRise("t4"), false);

  riseDecide("t5", { shows: false, rose: false, catching: false, motion: true });
  riseEnded("t5");
  assert.equal(takeRise("t5"), false);
});
