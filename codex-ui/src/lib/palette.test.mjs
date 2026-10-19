// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of palette.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { hitRanges, matchActions, sessionBudget, timeBucket } from "./palette.ts";

test("timeBucket follows ce8be540f Cn() boundaries", () => {
  const now = new Date(2026, 9, 18, 12, 0, 0).getTime();
  const at = (...parts) => new Date(...parts).getTime();
  assert.equal(timeBucket(now - 60_000, now), "刚刚");
  assert.equal(timeBucket(now - 10 * 60_000, now), "过去一小时");
  assert.equal(timeBucket(at(2026, 9, 18, 0, 5), now), "今天");
  assert.equal(timeBucket(at(2026, 9, 17, 23, 0), now), "昨天");
  assert.equal(timeBucket(at(2026, 9, 12, 13, 0), now), "过去一周");
  assert.equal(timeBucket(at(2026, 8, 25), now), "过去一个月");
  assert.equal(timeBucket(at(2026, 0, 2), now), "过去一年");
  assert.equal(timeBucket(at(2025, 9, 1), now), null);
  assert.equal(timeBucket(Number.NaN, now), null);
});

test("sessionBudget takes turns with the actions, sessions first", () => {
  assert.equal(sessionBudget(7, 10, 0), 7);
  assert.equal(sessionBudget(7, 10, 1), 6);
  assert.equal(sessionBudget(7, 10, 3), 4);
  assert.equal(sessionBudget(7, 10, 10), 4);
  assert.equal(sessionBudget(7, 2, 10), 2);
  assert.equal(sessionBudget(25, 40, 0), 25);
});

test("hitRanges marks every occurrence, case-insensitively", () => {
  assert.deepEqual(hitRanges("Fix the Fixture", "fix"), [[0, 3], [8, 11]]);
  assert.deepEqual(hitRanges("修复测试修复", "修复"), [[0, 2], [4, 6]]);
  assert.deepEqual(hitRanges("abc", ""), []);
});

test("matchActions ranks label prefix, label, then hints", () => {
  const items = [{ label: "删除会话", hints: ["移除"] }, { label: "会话设置" }, { label: "归档会话", hints: ["隐藏"] }];
  assert.deepEqual(matchActions(items, "会话").map((item) => item.label), ["会话设置", "删除会话", "归档会话"]);
  assert.deepEqual(matchActions(items, "隐藏").map((item) => item.label), ["归档会话"]);
  assert.deepEqual(matchActions(items, "x".repeat(51)), []);
});
