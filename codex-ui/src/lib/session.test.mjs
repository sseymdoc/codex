// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of session.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, clockText, dateBuckets, familyOrder, folderBuckets, nextView, rangeIds, STEADY, steadyStep, thinkingLabel, thinkingPhase, tokenText } from "./session.ts";

const rows = [
  { id: "a", title: "重构设置页", recency: 5, created: 1, parent: null },
  { id: "b", title: "重构设置页 (fork)", recency: 9, created: 2, parent: "a" },
  { id: "c", title: "补齐表单校验", recency: 7, created: 3, parent: "b" },
  { id: "d", title: "修复登录回跳", recency: 6, created: 4, parent: null },
  { id: "e", title: "整理图标导出", recency: 2, created: 5, parent: "gone" },
];
const order = (sort) => familyOrder(rows, sort).map(({ row, place }) => `${row.id}:${place}`);

test("by recency a family rises with its most recent member, children depth first", () => {
  assert.deepEqual(order("recency"), ["a:head", "b:nested", "c:nested", "d:flat", "e:flat"]);
});

test("by name or creation time a family stays where its root sorts", () => {
  assert.deepEqual(order("created"), ["e:flat", "d:flat", "a:head", "b:nested", "c:nested"]);
  assert.deepEqual(order("alpha").slice(-3), ["a:head", "b:nested", "c:nested"]);
});

test("date buckets: today, yesterday, the days before by date, older; a family by its time", () => {
  const now = new Date(2026, 9, 18, 15, 0);
  const at = (day, hour = 12) => new Date(2026, 9, 18 - day, hour).getTime() / 1000;
  const buckets = dateBuckets(
    [
      { rows: ["a", "a1"], time: at(0, 1) },
      { rows: ["b"], time: at(1, 23) },
      { rows: ["c"], time: at(4) },
      { rows: ["d"], time: at(9) },
    ],
    now,
  );
  assert.deepEqual(
    buckets.map(({ key, label, rows }) => [key, label, rows.join()]),
    [
      ["day-0", "今天", "a,a1"],
      ["day-1", "昨天", "b"],
      ["day-4", "10月14日", "c"],
      ["older", "更早", "d"],
    ],
  );
});

test("folder buckets merge one folder however it is written, latest activity first", () => {
  const buckets = folderBuckets([
    { rows: ["a"], time: 5, folder: "D:\\work\\api" },
    { rows: ["b"], time: 9, folder: "D:/work/web/" },
    { rows: ["c"], time: 7, folder: "d:/work/API" },
  ]);
  assert.deepEqual(buckets.map(({ label, rows }) => [label, rows.join()]), [["web", "b"], ["api", "a,c"]]);
});

test("shift-click selects the run between the anchor and the target", () => {
  assert.deepEqual(rangeIds(["a", "b", "c", "d"], "c", "a"), ["a", "b", "c"]);
  assert.deepEqual(rangeIds(["a", "b"], null, "b"), ["b"]);
  assert.deepEqual(rangeIds(["a", "b"], "gone", "a"), ["a"]);
});

test("a cycle in the parent links still lists every session once", () => {
  const loop = [
    { id: "x", title: "x", recency: 2, created: 1, parent: "y" },
    { id: "y", title: "y", recency: 1, created: 2, parent: "x" },
  ];
  assert.deepEqual(familyOrder(loop, "recency").map((entry) => entry.row.id).sort(), ["x", "y"]);
});

test("the status line steps through its labels by elapsed time", () => {
  assert.deepEqual([0, 1.9, 2, 14, 15, 44, 60].map(bucket), [0, 0, 2, 2, 15, 30, 60]);
  assert.equal(thinkingLabel(3), "思考中…");
  assert.equal(thinkingLabel(16), "仍在思考…");
  assert.equal(thinkingLabel(75), "快想好了…");
  assert.equal(clockText(12), "12s");
  assert.equal(clockText(65), "1m 5s");
  assert.equal(clockText(3723), "1h 2m 3s");
  assert.equal(tokenText(1), "1 token");
  assert.equal(tokenText(950), "950 tokens");
  assert.equal(tokenText(1000), "1.0k tokens");
  assert.equal(tokenText(1_250_000), "1.3M tokens");
});

test("a short thought is held for 2s, then reads 'thought for' for 2s", () => {
  const start = 10_000;
  assert.deepEqual(thinkingPhase(10_200, start, null), { kind: "active", open: true });
  assert.deepEqual(thinkingPhase(11_000, start, 10_500), { kind: "active", open: false });
  assert.deepEqual(thinkingPhase(12_500, start, 10_500), { kind: "done", seconds: 1 });
  assert.equal(thinkingPhase(14_100, start, 10_500), null);
  assert.deepEqual(thinkingPhase(30_000, start, 29_000), { kind: "done", seconds: 19 });
});

test("the waiting label shows at once, debounces changes 150ms and stays 650ms", () => {
  let state = STEADY;
  const step = (label, hold, working, now) => {
    const out = steadyStep(state, label, hold, working, now);
    state = out.state;
    return [state.shown, out.wake];
  };
  assert.deepEqual(step("等待 Codex…", false, true, 0), ["等待 Codex…", null], "null -> text at once");
  assert.deepEqual(step("正在运行工具…", false, true, 100), ["等待 Codex…", 250], "text -> text after 150ms");
  assert.deepEqual(step("正在运行工具…", false, true, 250), ["等待 Codex…", 650], "then waits out the 650ms");
  assert.deepEqual(step("正在运行工具…", false, true, 650), ["正在运行工具…", null]);
  assert.deepEqual(step(null, true, true, 2000), ["正在运行工具…", null], "hold keeps the last text");
  assert.deepEqual(step(null, false, true, 2100), [null, null], "text -> null at once once it has stayed");
  assert.deepEqual(step(null, false, false, 2200), [null, null]);
  assert.deepEqual(step("正在发送…", false, true, 2210), ["正在发送…", null], "a new working stretch switches at once");
});

test("Ctrl+O cycles normal -> thinking -> verbose", () => {
  assert.equal(nextView("normal"), "thinking");
  assert.equal(nextView("verbose"), "normal");
});
