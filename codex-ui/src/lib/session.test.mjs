// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of session.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { bucket, clockText, familyOrder, nextView, thinkingLabel, thinkingPhase, tokenText } from "./session.ts";

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

test("Ctrl+O cycles normal -> thinking -> verbose", () => {
  assert.equal(nextView("normal"), "thinking");
  assert.equal(nextView("verbose"), "normal");
});
