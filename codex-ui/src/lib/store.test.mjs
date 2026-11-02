// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of store.ts).
import assert from "node:assert/strict";
import { test } from "node:test";

// setState notifies subscribers once per frame.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { canStepRoute, dismissToast, getState, holdToasts, recordRoute, refuseStreamed, setState, stepRoute, toast } = await import("./store.ts");

/** What openThread / newChat do: show `to`, recording the move. */
function go(to) {
  const from = getState().activeId;
  setState({ activeId: to });
  recordRoute(from, to);
}

test("返回 / 前进 walk the history like a browser and skip sessions that are gone", () => {
  setState({ threads: { a: {}, b: {}, c: {} } });
  go("a");
  go("b");
  assert.equal(stepRoute(-1), "a");
  go("a"); // the move stepRoute asked for is not recorded again
  assert.deepEqual(getState().nav, { stack: [null, "a", "b"], index: 1 });
  assert.equal(stepRoute(-1), null);
  go(null);
  assert.equal(canStepRoute(getState(), -1), false);
  assert.equal(stepRoute(-1), undefined);
  assert.equal(stepRoute(1), "a");
  go("a");
  go("c"); // a new move drops what was ahead
  assert.deepEqual(getState().nav, { stack: [null, "a", "c"], index: 2 });
  assert.equal(canStepRoute(getState(), 1), false);
  setState({ threads: { c: {} } }); // "a" was deleted
  assert.equal(stepRoute(-1), null);
});

test("a remembered new-session model the catalog no longer offers goes with its effort; an unsupported effort goes alone", async () => {
  const { offeredPicks } = await import("./store.ts");
  const model = (id, efforts) => ({ id, model: id, supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort, description: "" })) });
  const models = [model("gpt-a", ["low", "high"]), model("gpt-b", ["medium"])];
  const prefs = (model, effort) => ({ cwd: "", model, effort, planMode: false });
  const kept = prefs("gpt-a", "high");
  assert.equal(offeredPicks(kept, models), kept);
  // A provider switch took the model away.
  assert.deepEqual(offeredPicks(prefs("gpt-x", "high"), models), prefs(null, null));
  assert.deepEqual(offeredPicks(prefs("gpt-b", "high"), models), prefs("gpt-b", null));
  // An effort picked for the default model stays.
  const effortOnly = prefs(null, "high");
  assert.equal(offeredPicks(effortOnly, models), effortOnly);
});

test("a repeated toast counts up instead of stacking, for at most 30s after it first showed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const live = () => getState().toasts.filter((x) => !x.ending).map((x) => [x.kind, x.title, x.count]);
  // A notice shows 6.5s, a warning 10s; a shorter time asked for is 6s.
  toast("warning", "保存失败", "磁盘已满");
  toast("warning", "保存失败", "磁盘已满");
  toast("neutral", "已复制");
  toast("neutral", "已归档 2 个会话", undefined, 3000);
  assert.deepEqual(live(), [
    ["warning", "保存失败", 2],
    ["neutral", "已复制", 1],
    ["neutral", "已归档 2 个会话", 1],
  ]);
  t.mock.timers.tick(5999);
  assert.equal(live().length, 3);
  t.mock.timers.tick(1);
  assert.equal(live().length, 2);
  t.mock.timers.tick(500);
  assert.deepEqual(live(), [["warning", "保存失败", 2]]);
  t.mock.timers.tick(3500);
  assert.deepEqual(live(), []);
  t.mock.timers.tick(200);
  assert.deepEqual(getState().toasts, []);

  // Repeats at 6, 12, 18 and 24s restart the timer; one at 29s only counts. It goes at 30s.
  toast("warning", "网络不稳定");
  for (let i = 0; i < 4; i++) {
    t.mock.timers.tick(6000);
    toast("warning", "网络不稳定");
  }
  t.mock.timers.tick(5000);
  toast("warning", "网络不稳定");
  assert.deepEqual(live(), [["warning", "网络不稳定", 6]]);
  t.mock.timers.tick(999);
  assert.equal(live().length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual(live(), []);

  // It hit the 30s cap with copies merged, so the same warning stays away for 30s.
  toast("warning", "网络不稳定");
  assert.deepEqual(live(), []);
  t.mock.timers.tick(30_000);
  toast("warning", "网络不稳定");
  assert.deepEqual(live(), [["warning", "网络不稳定", 1]]);
});

test("a hold pauses each toast, and its release resumes the time left", (t) => {
  // The test before leaves a toast whose timer belongs to its own mock clock.
  for (const x of getState().toasts) dismissToast(x.id);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  setState({ toasts: [] });
  const live = () => getState().toasts.filter((x) => !x.ending).map((x) => x.title);
  toast("neutral", "已复制");
  t.mock.timers.tick(4000);
  const release = holdToasts();
  toast("neutral", "已保存");
  t.mock.timers.tick(60_000);
  assert.deepEqual(live(), ["已复制", "已保存"]);
  release();
  t.mock.timers.tick(2499);
  assert.deepEqual(live(), ["已复制", "已保存"]);
  t.mock.timers.tick(1);
  assert.deepEqual(live(), ["已保存"], "2.5s were left of its 6.5s");
  t.mock.timers.tick(4000);
  assert.deepEqual(live(), [], "one shown while held starts its time at the release");
});

test("a streamed patch that never started fails once another item of its turn starts", () => {
  const patch = (id, status = "inProgress") => ({ type: "fileChange", id, status, changes: [] });
  const turn = { id: "t", items: [patch("refused"), patch("applying"), patch("done", "completed")] };
  // item/started gave "applying" its timing; "refused" only ever streamed.
  const timing = { applying: [1] };
  const next = refuseStreamed(turn, "reply", timing);
  assert.deepEqual(next.items.map((item) => item.status), ["failed", "inProgress", "completed"]);
  // Its own start, or nothing left to refuse, leaves the turn as it was.
  assert.equal(refuseStreamed(turn, "refused", timing), turn);
  assert.equal(refuseStreamed(next, "reply", timing), next);
});
