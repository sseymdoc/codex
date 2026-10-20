import assert from "node:assert/strict";
import { test } from "node:test";
import { agentTasks } from "./background.ts";

const thread = (id, parent = null, status = "idle", items = []) => ({
  meta: {
    id,
    parentThreadId: parent,
    source: "cli",
    status: { type: status },
    model: null,
  },
  turns: [{ id: "turn", items }],
  timing: {},
});
const spawn = (id, child) => ({
  type: "collabAgentToolCall",
  id,
  tool: "spawnAgent",
  receiverThreadIds: [child],
  agentsStates: {},
  model: "test-model",
});
const activity = (kind, child) => ({
  type: "subAgentActivity",
  id: `${kind}-${child}`,
  kind,
  agentThreadId: child,
  agentPath: `/root/${child}`,
  model: null,
});

test("both collab and multi-agent v2 events identify tasks before metadata is readable, without duplicates", () => {
  const parent = thread("p", null, "active", [spawn("spawn", "a"), activity("started", "a"), activity("started", "b")]);
  parent.timing["started-a"] = [0];
  const tasks = agentTasks(parent, { p: parent });
  assert.deepEqual(
    tasks.map((t) => [t.threadId, t.status]),
    [
      ["a", "running"],
      ["b", "running"],
    ],
  );
  assert.equal(tasks[0].model, "test-model");
  assert.equal(tasks[0].startedAt, 0);
  assert.equal(tasks[0].title, "a");
});

test("lineage discovers children and grandchildren without spawn items, including source-only parentage", () => {
  const parent = thread("p"),
    child = thread("a", null, "active"),
    nested = thread("b", "a", "active");
  child.meta.source = {
    subAgent: {
      thread_spawn: {
        parent_thread_id: "p",
        agent_path: "/root/worker",
        agent_nickname: "Gauss",
      },
    },
  };
  const fork = thread("fork");
  fork.meta.forkedFromId = "p";
  const tasks = agentTasks(parent, {
    p: parent,
    a: child,
    b: nested,
    fork,
    unrelated: thread("unrelated", "other"),
  });
  assert.deepEqual(
    tasks.map((t) => t.threadId),
    ["a", "b"],
  );
  assert.equal(tasks[0].title, "worker");
});

test("agent lifecycle, errors and runtime refresh settle tasks without treating a returned spawn call as completion", () => {
  const parent = thread("p", null, "active", [spawn("spawn", "a"), activity("started", "b"), activity("completed", "b"), activity("started", "c"), activity("interrupted", "c")]);
  assert.deepEqual(
    agentTasks(parent, {}).map((t) => t.status),
    ["running", "completed", "stopped"],
  );
  parent.turns[0].items.push({
    ...spawn("wait", "a"),
    tool: "wait",
    agentsStates: { a: { status: "errored", message: "failed" } },
  });
  assert.equal(agentTasks(parent, {})[0].status, "failed");
  assert.equal(agentTasks(parent, { a: thread("a", "p", "active") })[0].status, "running");
  assert.equal(agentTasks(parent, { a: thread("a", "p", "notLoaded") })[0].status, "failed");
  assert.equal(
    agentTasks(thread("p", null, "idle", [spawn("s", "a")]), {
      a: thread("a", "p", "notLoaded"),
    })[0].status,
    "unknown",
  );
  const stopped = thread("a", "p");
  stopped.turns[0].status = "interrupted";
  assert.equal(agentTasks(parent, { a: stopped })[0].status, "stopped");
});

test("cyclic lineage terminates and never lists the current thread as its own task", () => {
  const parent = thread("p", "a"),
    child = thread("a", "p");
  assert.deepEqual(
    agentTasks(parent, { p: parent, a: child }).map((t) => t.threadId),
    ["a"],
  );
});
