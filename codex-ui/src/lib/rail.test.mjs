// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of rail.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { moveItem, railOrder, sameOrder } from "./rail.ts";

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
