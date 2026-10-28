import assert from "node:assert/strict";
import { test } from "node:test";

const saved = new Map();
globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
globalThis.requestAnimationFrame = () => 1;
const { backgroundDismissalKey, backgroundOutputPosition, openBackgroundTask, openFinishedBackground, toggleBackgroundTask, updateBackgroundView } = await import("./background-view.ts");
const { getState } = await import("./store.ts");
const views = () => JSON.parse(saved.get("codex-ui:background-views"));

test("background folds, rows and finished sections remain per-session and clearing retains task records", () => {
  updateBackgroundView("a", { open: ["shell:a:one"], finished: true });
  updateBackgroundView("b", { dismissed: ["shell:b:old"] });
  assert.equal(views().b.finished, false);
  assert.deepEqual(views().a.open, ["shell:a:one"]);
  toggleBackgroundTask("a", "shell:a:one");
  assert.deepEqual(views().a.open, []);
  const root = { key: "agent:parent", status: "completed" };
  const task = { key: "shell:a:leaf", parentKey: root.key, status: "running" };
  openBackgroundTask("a", task, [root, task]);
  assert.deepEqual(views().a.open, [task.key, root.key]);
  assert.equal(views().a.focus, null, "focus requests are transient, not restored after reload");
  assert.deepEqual(getState().panes.a.open, ["background"]);
  openFinishedBackground("b");
  assert.equal(views().b.finished, true);
  assert.deepEqual(views().b.dismissed, ["shell:b:old"]);
});

test("background UI history bounds sessions and task keys without deleting backend data", () => {
  for (let i = 0; i < 101; i++) updateBackgroundView(`limit-${i}`, { open: Array.from({ length: 1001 }, (_, j) => `row-${j}`) });
  assert.equal(Object.keys(views()).length, 100);
  assert.equal(views()["limit-0"], undefined);
  assert.equal(views()["limit-100"].open.length, 1000);
});

test("output position survives regrouping until the reader closes its task, and dismissals bind to a run", () => {
  const position = backgroundOutputPosition("shell:a:output");
  position.following = false;
  position.top = 24;
  assert.equal(backgroundOutputPosition("shell:a:output"), position);
  updateBackgroundView("output-session", { open: ["shell:a:output"] });
  toggleBackgroundTask("output-session", "shell:a:output");
  assert.deepEqual(backgroundOutputPosition("shell:a:output"), { following: true, top: 0 });
  const task = { key: "agent:worker", itemId: "spawn", completedAt: 1000, runId: "turn-1" };
  assert.notEqual(backgroundDismissalKey(task), backgroundDismissalKey({ ...task, runId: "turn-2" }));
});

test("a sub-agent's record stacks over its session's task list, spawners first, and is never restored", async () => {
  const { backgroundView, popAgent, showAgent } = await import("./background-view.ts");
  const { setState } = await import("./store.ts");
  const meta = (id, parentThreadId) => ({ meta: { id, parentThreadId } });
  setState({ threads: { s: meta("s", null), a: meta("a", "s"), b: meta("b", "a") } });
  showAgent("s", "b");
  assert.deepEqual(backgroundView("s").agents, ["a", "b"]);
  assert.deepEqual(views().s.agents, [], "the stack is transient, not saved");
  assert.deepEqual(getState().panes.s.open, ["background"]);
  popAgent("s");
  assert.deepEqual(backgroundView("s").agents, ["a"]);
  popAgent("s");
  popAgent("s");
  assert.deepEqual(backgroundView("s").agents, []);
});
