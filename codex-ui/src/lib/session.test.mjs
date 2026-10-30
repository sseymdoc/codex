// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of session.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnOf, withLineage } from "./session.ts";
import { clockText, dateBuckets, elapsedText, familyOrder, folderBuckets, nextView, outliving, rangeIds, thinkingPhase, tokenText } from "./session.ts";

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
  // Projectless scheduled runs (no folder of the user's) share one group, with no folder to start a session in.
  const runs = folderBuckets([
    { rows: ["r1"], time: 3, folder: null },
    { rows: ["a"], time: 5, folder: "D:/work/api" },
    { rows: ["r2"], time: 8, folder: null },
    { rows: ["e"], time: 1, folder: "" },
  ]);
  assert.deepEqual(runs.map(({ key, label, rows, folder }) => [key, label, rows.join(), folder]), [
    ["projectless", "不在项目中工作", "r1,r2", undefined],
    ["folder:d:/work/api", "api", "a", "D:/work/api"],
    ["folder:", "无文件夹", "e", ""],
  ]);
});

test("shift-click selects the run between the anchor and the target", () => {
  assert.deepEqual(rangeIds(["a", "b", "c", "d"], "c", "a"), ["a", "b", "c"]);
  assert.deepEqual(rangeIds(["a", "b"], null, "b"), ["b"]);
  assert.deepEqual(rangeIds(["a", "b"], "gone", "a"), ["a"]);
});

test("only nested sessions the root did not spawn outlive it", () => {
  // r spawned s1, s1 spawned s2; f is a fork of r (no spawner) and f spawned g.
  const spawner = { s1: "r", s2: "s1", f: null, g: "f", loop: "loop" };
  assert.deepEqual(outliving("r", ["s1", "s2", "f", "g", "loop"], (id) => spawner[id]), ["f", "g", "loop"]);
});

test("a cycle in the parent links still lists every session once", () => {
  const loop = [
    { id: "x", title: "x", recency: 2, created: 1, parent: "y" },
    { id: "y", title: "y", recency: 1, created: 2, parent: "x" },
  ];
  assert.deepEqual(familyOrder(loop, "recency").map((entry) => entry.row.id).sort(), ["x", "y"]);
});

test("the status line reads Claude's clock and token count", () => {
  assert.equal(clockText(65), "1m 5s");
  assert.equal(elapsedText(2), "2秒");
  assert.equal(elapsedText(23 * 60 + 5), "23分钟 5秒");
  assert.equal(elapsedText(3605), "1小时 0分钟 5秒");
  assert.equal(elapsedText(9 * 86400 + 7), "1周 2天 0小时");
  assert.equal(tokenText(1), "1 个 token");
  assert.equal(tokenText(950), "950 个 token");
  assert.equal(tokenText(6000), "6.0k 个 token");
  assert.equal(tokenText(6234), "6.2k 个 token");
  assert.equal(tokenText(999_960), "1.0M 个 token");
  assert.equal(tokenText(1_250_000), "1.3M 个 token");
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

test("a sub-agent's parent and nickname fall back to its spawn record", () => {
  const source = { subAgent: { thread_spawn: { parent_thread_id: "p", depth: 1, agent_path: "/root/worker", agent_nickname: "Fermat", agent_role: null } } };
  // thread/list mixing sources: parentThreadId null, the source still names the parent.
  assert.deepEqual(withLineage({ id: "c", parentThreadId: null, agentNickname: null, source }), { id: "c", parentThreadId: "p", agentNickname: "Fermat", source });
  assert.equal(withLineage({ id: "c", parentThreadId: "q", agentNickname: "Kepler", source }).agentNickname, "Kepler");
  const plain = { id: "t", parentThreadId: null, agentNickname: null, source: "vscode" };
  assert.equal(withLineage(plain), plain);
  assert.equal(spawnOf({ source: { subAgent: "review" } }), null);
  assert.equal(spawnOf({ source: { subAgent: { other: "guardian" } } }), null);
});

test("a sub-agent belongs to the session at the top of its spawn links, its path starting under it", async () => {
  const { spawnPath, spawnRoot } = await import("./session.ts");
  const parents = { root: null, child: "root", grandchild: "child", loop: "loop" };
  const spawner = (id) => parents[id];
  assert.equal(spawnRoot("grandchild", spawner), "root");
  assert.equal(spawnRoot("root", spawner), "root");
  assert.deepEqual(spawnPath("grandchild", spawner), ["child", "grandchild"]);
  assert.deepEqual(spawnPath("root", spawner), []);
  // A self-spawned record cannot hang the walk.
  assert.equal(spawnRoot("loop", spawner), "loop");
});
