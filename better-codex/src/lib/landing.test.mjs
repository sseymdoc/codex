// Run with `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { continues, dismiss, relativeTime, seat } from "./landing.ts";

const rows = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test("seat gives each family a seat, spares in order, and folds the overflow into a rest seat", () => {
  assert.deepEqual(seat([rows("s", 2), ["c"]]), [{ row: "s1" }, { row: "s2" }, { row: "c" }]);
  assert.deepEqual(seat([rows("s", 4), ["c"]]), [{ row: "s1" }, { rest: ["s2", "s3", "s4"], whole: false }, { row: "c" }]);
  assert.deepEqual(seat([rows("s", 5)]), [{ row: "s1" }, { row: "s2" }, { rest: ["s3", "s4", "s5"], whole: false }]);
  assert.deepEqual(seat([rows("s", 2), ["a"], ["b"]]), [{ rest: ["s1", "s2"], whole: true }, { row: "a" }, { row: "b" }]);
  assert.deepEqual(seat([[], ["c"]]), [{ row: "c" }]);
});

test("dismiss keeps one stamp per row and the newest hundred", () => {
  let map = dismiss({}, "a", "1");
  map = dismiss(map, "a", "2");
  assert.deepEqual(map, { a: "2" });
  for (let i = 0; i < 120; i++) map = dismiss(map, `k${i}`, "x");
  assert.equal(Object.keys(map).length, 100);
  assert.equal(map.k119, "x");
  assert.equal(map.a, undefined);
});

test("continues: uncommitted files off the default branch", () => {
  assert.equal(continues({ branch: "feat/x", base: "main", files: 14 }), true);
  assert.equal(continues({ branch: "main", base: "main", files: 14 }), false);
  assert.equal(continues({ branch: "feat/x", base: "main", files: 0 }), false);
  assert.equal(continues({ branch: "master", base: null, files: 3 }), false);
  assert.equal(continues({ branch: "main", base: "develop", files: 3 }), true);
  assert.equal(continues(null), false);
});

test("relativeTime is narrow and relative", () => {
  const now = 2_000_000_000_000;
  assert.equal(relativeTime(now / 1000 - 20, now), "现在");
  assert.equal(relativeTime(now / 1000 - 5 * 60, now), "5分钟前");
  assert.equal(relativeTime(now / 1000 - 86400, now), "昨天");
});
