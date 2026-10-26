import assert from "node:assert/strict";
import { test } from "node:test";
import { agentTasks, agentThreadIds, backgroundTasks, taskFamilies, shellTasks } from "./background.ts";

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
  background: [],
});

const command = (id, status = "inProgress", extra = {}) => ({
  type: "commandExecution", id, processId: "process", backgrounded: true, command: "cargo check", source: "unifiedExecStartup",
  status, aggregatedOutput: null, exitCode: null, durationMs: null, ...extra,
});

test("foreground commands and legacy process IDs cannot claim confirmed background work", () => {
  const parent = thread("p", null, "active", [
    command("foreground", "completed", { backgrounded: false }),
    command("legacy", "completed", { backgrounded: null }),
    command("pending", "inProgress", { backgrounded: false }),
    command("background", "completed"),
  ]);
  assert.deepEqual(shellTasks(parent).map((task) => task.itemId), ["background"]);
  parent.background = [{ itemId: "legacy-live", processId: "old", command: "old command", cpuPercent: null }];
  assert.equal(shellTasks(parent).at(-1).status, "unknown");
});

test("task families sort running work oldest first, promote nested parents and finish newest first", () => {
  const parent = thread("p", null, "active", [command("shell", "completed")]);
  parent.timing.shell = [10, 60];
  const a = thread("a", "p", "idle"), b = thread("b", "a", "active"), c = thread("c", "b", "idle");
  for (const [child, createdAt, updatedAt] of [[a, 1, 5], [b, 2, 10], [c, 3, 4]]) {
    child.meta.createdAt = createdAt;
    child.meta.updatedAt = updatedAt;
    if (child !== b) child.turns[0].status = "completed";
  }
  const tasks = backgroundTasks(parent, { p: parent, a, b, c });
  const groups = taskFamilies(tasks);
  assert.deepEqual(groups.running.map((family) => family.task.key), ["agent:b"]);
  assert.deepEqual(groups.running[0].children.map((task) => task.key), ["agent:c"]);
  assert.deepEqual(groups.finished.map((family) => family.task.key), ["agent:a", "shell:p:shell"]);
  assert.equal(groups.finished[0].children.length, 0, "a nested parent is its own family");
  const cyclic = [{ ...tasks[0], key: "cycle-a", parentKey: "cycle-b" }, { ...tasks[0], key: "cycle-b", parentKey: "cycle-a" }];
  assert.equal(taskFamilies(cyclic).finished.length, 2, "broken ancestry cannot hide tasks");
});

test("shell titles prefer the model description and preserve the full command after history reloads", () => {
  const script = 'export PATH="/c/Users/test/.cargo/bin:$PATH" && cargo clippy --tests -p codex-core -- -D warnings';
  for (const status of ["inProgress", "completed", "failed"]) {
    const parent = thread("p", null, "active", [command("cmd", status, {
      command: script, description: "\u001b[32m运行 codex-core 的 clippy\u001b[0m\n包含\t测试\u202e",
    })]);
    parent.background = [{ itemId: "cmd", processId: "process", command: script, cpuPercent: null }];
    const [task] = shellTasks(parent);
    assert.equal(task.title, "运行 codex-core 的 clippy 包含 测试");
    assert.equal(task.command, script);
    const restored = thread("p", null, "notLoaded", JSON.parse(JSON.stringify(parent.turns[0].items)));
    assert.equal(shellTasks(restored)[0].title, task.title);
  }
});

test("shell titles fall back to the command or item ID, including polling before history arrives", () => {
  for (const description of [undefined, null, "", " \n\t", "\u001b[0m\u202e"]) {
    const parent = thread("p", null, "idle", [command("cmd", "completed", { description })]);
    assert.equal(shellTasks(parent)[0].title, "cargo check");
    parent.turns[0].items[0].command = "";
    assert.equal(shellTasks(parent)[0].title, "cmd");
  }
  const parent = thread("p");
  parent.background = [{ itemId: "cmd", processId: "process", command: "cargo check", cpuPercent: null }];
  assert.equal(shellTasks(parent)[0].title, "cargo check");
  parent.turns[0].items.push(command("cmd", "inProgress", { description: "检查类型" }));
  assert.deepEqual(shellTasks(parent).map((task) => task.title), ["检查类型"]);
  parent.turns[0].items = [];
  parent.background[0].command = "";
  assert.equal(shellTasks(parent)[0].title, "cmd");
});

test("shell completion retains output and fixed duration after the live process disappears and history reloads", () => {
  const parent = thread("p", null, "active", [command("cmd")]);
  parent.background = [{ itemId: "cmd", processId: "process", command: "cargo check", cpuPercent: 5 }];
  parent.timing.cmd = [0];
  assert.equal(shellTasks(parent)[0].status, "running");
  parent.turns[0].items[0] = command("cmd", "completed", { aggregatedOutput: "Finished", exitCode: 0, durationMs: 2000 });
  parent.timing.cmd = [0, 2000];
  assert.equal(shellTasks(parent)[0].status, "completed", "a stale live list cannot revive a finished command");
  parent.background = [];
  const [task] = shellTasks(parent);
  assert.equal(task.output, "Finished");
  assert.equal(task.exitCode, 0);
  assert.equal(task.durationMs, 2000);
  const restored = thread("p", null, "notLoaded", JSON.parse(JSON.stringify(parent.turns[0].items)));
  assert.deepEqual(shellTasks(restored), [{ ...task, startedAt: undefined, completedAt: undefined, cpuPercent: null }]);
});

test("shell history separates process ID reuse, ignores input calls and does not infer completion from absence", () => {
  const parent = thread("p", null, "idle", [
    command("old", "failed", { exitCode: 7, aggregatedOutput: "error" }),
    command("new"),
    command("wait", "completed", { source: "unifiedExecInteraction" }),
    command("user", "completed", { source: "userShell" }),
    command("no-process", "completed", { processId: null }),
  ]);
  assert.deepEqual(shellTasks(parent).map((task) => [task.itemId, task.status]), [["old", "failed"], ["new", "unknown"]]);
  parent.background = [{ itemId: "new", processId: "process", command: "cargo check", cpuPercent: null }];
  assert.deepEqual(shellTasks(parent).map((task) => task.status), ["failed", "running"]);
  assert.equal(shellTasks(parent)[0].exitCode, 7);
});

test("shells discovered by polling remain visible before their item arrives and merge by item ID", () => {
  const parent = thread("p");
  parent.background = [{ itemId: "cmd", processId: "process", backgrounded: true, command: "cargo check", cpuPercent: 1 }];
  assert.equal(shellTasks(parent)[0].status, "running");
  parent.turns[0].items.push(command("cmd", "failed", { processId: null, aggregatedOutput: "failure" }));
  const tasks = shellTasks(parent);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "failed");
  assert.equal(tasks[0].output, "failure");
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

test("cyclic lineage terminates and excludes the current thread and its ancestors", () => {
  const parent = thread("p", "a"),
    child = thread("a", "p");
  assert.deepEqual(
    agentTasks(parent, { p: parent, a: child }).map((t) => t.threadId),
    [],
  );
});

test("messages to parents and siblings do not turn them or their children into background tasks", () => {
  const parent = thread("p", null, "active");
  const child = thread("a", "p", "active", [
    { ...spawn("reply", "p"), tool: "sendMessage", senderThreadId: "a" },
    { ...spawn("peer", "b"), tool: "wait", senderThreadId: "a", agentsStates: { b: { status: "running" } } },
  ]);
  const threads = { p: parent, a: child, b: thread("b", "p", "active"), c: thread("c", "a", "active"), d: thread("d", "b", "active") };
  assert.deepEqual(agentTasks(child, threads).map((task) => task.threadId), ["c"]);
  assert.deepEqual(agentTasks(parent, threads).map((task) => task.threadId), ["a", "b", "c", "d"]);
});

test("inherited spawn history cannot reparent known siblings or discover another sender's unreadable agents", () => {
  const inherited = { ...spawn("old-spawn", "unreadable"), senderThreadId: "p" };
  const child = thread("a", "p", "active", [spawn("sibling-spawn", "b"), activity("started", "b"), inherited]);
  const sibling = thread("b", null, "active");
  sibling.meta.source = { subAgent: { thread_spawn: { parent_thread_id: "p" } } };
  assert.deepEqual(agentTasks(child, { a: child, b: sibling }), []);
});

test("communication alone cannot create a task before its target metadata is readable", () => {
  const child = thread("a", "p", "active", [
    { ...spawn("message", "unreadable"), tool: "sendMessage", senderThreadId: "a" },
    { ...spawn("list", "peer"), tool: "listAgents", senderThreadId: "a" },
    spawn("own-spawn", "own"),
  ]);
  assert.deepEqual(agentTasks(child, { a: child }).map((task) => task.threadId), ["own"]);
});

test("a wait cannot turn an unreadable parent into a child", () => {
  const child = thread("a", "p", "active", [{ ...spawn("wait", "p"), tool: "wait", senderThreadId: "a" }]);
  assert.deepEqual(agentTasks(child, { a: child }), []);
});

test("a restored page recognizes agents mentioned only in waits or reports and keeps their terminal classification", () => {
  const wait = { ...spawn("wait", "a"), tool: "wait", agentsStates: { a: { status: "completed", message: null }, b: { status: "interrupted", message: null } } };
  const parent = thread("p", null, "idle", [wait, activity("completed", "c")]);
  assert.deepEqual(agentThreadIds(parent.turns[0].items), ["a", "b", "c"]);
  const children = Object.fromEntries(["a", "b", "c"].map((id) => [id, thread(id, "p", "notLoaded")]));
  assert.deepEqual(agentTasks(parent, children).map((task) => task.status), ["completed", "stopped", "completed"]);
  assert.equal(agentTasks(parent, {})[2].title, "c", "an old report still names its agent when its metadata cannot be read");
});

test("unloaded historical agents use the latest persisted turn, while an active runtime wins over old history", () => {
  const parent = thread("p");
  const children = Object.fromEntries(["completed", "interrupted", "failed", "inProgress"].map((status) => {
    const child = thread(status, "p", "notLoaded");
    child.meta.updatedAt = 12;
    child.agentTurn = { updatedAt: 12, status };
    return [status, child];
  }));
  assert.deepEqual(agentTasks(parent, children).map((task) => task.status), ["completed", "stopped", "failed", "unknown"]);
  children.failed.turns[0].status = "completed";
  assert.equal(agentTasks(parent, children)[2].status, "failed", "fresh history takes precedence over an older opened transcript");
  children.failed.meta.status = { type: "active", activeFlags: [] };
  assert.equal(agentTasks(parent, children)[2].status, "running");
  children.inProgress.meta.status = { type: "idle" };
  assert.equal(agentTasks(parent, children)[3].status, "unknown", "an unfinished historical turn is not a completed task");
  children.completed.meta.updatedAt = 13;
  assert.equal(agentTasks(parent, children)[0].status, "unknown", "outdated history cannot classify a newer task");
});

test("a sub-agent's run reads from its thread, and its heartbeat counts the tools it called", async () => {
  const { agentActivity, agentRunStatus } = await import("./background.ts");
  const ended = (status) => ({ ...thread("agent", "root"), turns: [{ id: "t", status, items: [] }] });
  assert.equal(agentRunStatus(thread("agent", "root", "active")), "running");
  assert.equal(agentRunStatus(thread("agent", "root", "systemError")), "failed");
  assert.equal(agentRunStatus(ended("interrupted")), "stopped");
  assert.equal(agentRunStatus(ended("failed")), "failed");
  assert.equal(agentRunStatus(ended("completed")), "completed");
  assert.equal(agentRunStatus({ ...thread("agent", "root", "notLoaded"), turns: [] }, "running"), "unknown");

  assert.equal(agentActivity(undefined), null);
  assert.equal(agentActivity({ ...thread("agent", "root"), turns: [], loaded: false }), null);
  const busy = { ...thread("agent", "root", "active", [
    { type: "agentMessage", id: "say", text: "看一下" },
    command("run"),
    { type: "mcpToolCall", id: "mcp", server: "github_app", tool: "list_issues", status: "completed" },
    { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", receiverThreadIds: [] },
  ]), loaded: true };
  assert.deepEqual(agentActivity(busy), { toolCalls: 3, lastTool: "spawn_agent" });
  busy.turns[0].items.pop();
  assert.deepEqual(agentActivity(busy), { toolCalls: 2, lastTool: "github app: list issues" });
});
