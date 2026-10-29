// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of rail.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { heartbeatOn, moveItem, nextRunOf, railOrder, sameOrder, sessionTasks } from "./rail.ts";

const CARDS = ["environment", "goal", "context", "connectors", "outputs", "pullRequests", "backgroundTasks"];

test("no saved order keeps the default one", () => {
  assert.deepEqual(railOrder(CARDS, []), CARDS);
});

test("saved cards fill their own slots in the saved sequence, the rest stay put", () => {
  assert.deepEqual(railOrder(CARDS, ["backgroundTasks", "goal"]), ["environment", "backgroundTasks", "context", "connectors", "outputs", "pullRequests", "goal"]);
  assert.deepEqual(railOrder(CARDS, ["outputs", "environment", "outputs", "flask", 3]), ["outputs", "goal", "context", "connectors", "environment", "pullRequests", "backgroundTasks"]);
});

test("a full saved order is taken as it is", () => {
  const saved = [...CARDS].reverse();
  assert.deepEqual(railOrder(CARDS, saved), saved);
});

test("moveItem moves one entry and leaves the list it was given alone", () => {
  const list = ["a", "b", "c", "d"];
  assert.deepEqual(moveItem(list, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(list, 3, 1), ["a", "d", "b", "c"]);
  assert.deepEqual(moveItem(list, 1, 1), list);
  assert.deepEqual(list, ["a", "b", "c", "d"]);
});

test("sameOrder compares ids in order", () => {
  assert.equal(sameOrder(["a", "b"], ["a", "b"]), true);
  assert.equal(sameOrder(["a", "b"], ["b", "a"]), false);
  assert.equal(sameOrder(["a"], ["a", "b"]), false);
});

const task = (id, kind, extra = {}) => ({ id, kind, name: id, status: "ACTIVE", ...extra });

test("heartbeatOn finds the heartbeat watching a session", () => {
  const items = [task("c", "cron"), task("h1", "heartbeat", { targetThreadId: "t1" }), task("h2", "heartbeat", { targetThreadId: "t2" })];
  assert.equal(heartbeatOn(items, "t2")?.id, "h2");
  assert.equal(heartbeatOn(items, "t3"), undefined);
  assert.equal(heartbeatOn(null, "t1"), undefined);
});

test("sessionTasks lists the heartbeats on a session, then the cron task it is a run of", () => {
  const items = [task("c1", "cron"), task("h1", "heartbeat", { targetThreadId: "t1" }), task("c2", "cron"), task("h2", "heartbeat", { targetThreadId: "t9" })];
  const runs = [{ threadId: "t1", automationId: "c2" }];
  assert.deepEqual(sessionTasks("t1", items, runs).map((t) => t.id), ["h1", "c2"]);
  // No run record (pruned): the task its opening message names.
  assert.deepEqual(sessionTasks("t5", items, runs, "c1").map((t) => t.id), ["c1"]);
  // A cron id never picks a heartbeat, and a task that is gone lists nothing.
  assert.deepEqual(sessionTasks("t5", items, runs, "h2").map((t) => t.id), []);
  assert.deepEqual(sessionTasks("t5", items, runs, "gone"), []);
});

test("nextRunOf shows the time on the schedule, none once there is no next run", () => {
  assert.equal(nextRunOf({ nextRunAt: 1_000, nextRunNominalAt: 1_120 }), 1_120);
  assert.equal(nextRunOf({ nextRunAt: 1_000, nextRunNominalAt: null }), 1_000);
  assert.equal(nextRunOf({ nextRunAt: null, nextRunNominalAt: 1_120 }), null);
});
