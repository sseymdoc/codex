import test from "node:test";
import assert from "node:assert/strict";
import { agentCells, cellState, compressedCells, elapsed, gridSummary, progress, runStatus, settledRun, STALL_MS, summaryText, UNPHASED } from "./workflow.ts";

const agent = (index, extra = {}) => ({ index, label: `a${index}`, state: "start", ...extra });

test("cells follow Claude's agent states, stalling after 90 seconds without progress", () => {
  const now = 1_000_000;
  assert.equal(cellState(agent(1)), "pending");
  assert.equal(cellState(agent(1, { startedAtMs: 1 }), { now }), "running");
  assert.equal(cellState(agent(1, { state: "progress", lastProgressAtMs: now - STALL_MS - 1 }), { now }), "stalled");
  assert.equal(cellState(agent(1, { state: "progress", lastProgressAtMs: now - STALL_MS }), { now }), "running");
  assert.equal(cellState(agent(1, { state: "done" }), { taskStopped: true }), "done");
  assert.equal(cellState(agent(1, { state: "progress" }), { taskStopped: true }), "stopped");
  assert.equal(cellState(agent(1, { state: "error", error: "x" }), { taskStopped: true }), "error");
  assert.deepEqual(agentCells([agent(1, { state: "done" }), agent(2)]), [{ label: "a1", state: "done" }, { label: "a2", state: "pending" }]);
});

test("progress groups agents by phase and names the unphased group", () => {
  const now = 10_000_000;
  const item = {
    phases: [{ index: 0, title: "Find" }, { index: 1, title: "Verify" }],
    agents: [
      agent(1, { state: "done", phaseIndex: 0, tokens: 100, durationMs: 5 }),
      agent(2, { state: "progress", phaseIndex: 0, lastProgressAtMs: now - STALL_MS - 5, tokens: 50 }),
      agent(3, { phaseIndex: 1 }),
      agent(4, { state: "error", error: "boom" }),
    ],
  };
  const result = progress(item, { now });
  assert.deepEqual(result.counts, { done: 1, running: 1, stalled: 1, error: 1, stopped: 0, pending: 1, total: 4 });
  assert.deepEqual(result.phases.map((phase) => [phase.index, phase.title, phase.status, phase.counts.total]), [
    [0, "Find", "running", 2],
    [1, "Verify", "pending", 1],
    [UNPHASED, "其他智能体", "error", 1],
  ]);
  assert.equal(result.totalTokens, 150);
  assert.equal(result.phases[0].maxDurationMs, 5);
  assert.equal(progress({ phases: [], agents: [agent(1)] }).phases[0].title, "智能体");
  assert.equal(progress({ phases: [], agents: [] }), undefined);
  assert.deepEqual(progress(item, { now, settled: true }).phases.map((phase) => phase.status), ["done", "notRun", "error"]);
});

test("a run the server no longer runs ends as stopped and settles its agents", () => {
  assert.equal(runStatus("pending"), "running");
  assert.equal(runStatus("running", false), "stopped");
  assert.equal(runStatus("declined"), "failed");
  const run = { status: "running", agents: [agent(1, { state: "progress" }), agent(2, { state: "done" }), agent(3)], phases: [] };
  const stopped = settledRun(run, false);
  assert.equal(stopped.run, "stopped");
  assert.deepEqual(stopped.agents.map((a) => [a.state, a.error]), [["error", undefined], ["done", undefined], ["start", undefined]]);
  assert.equal(settledRun({ ...run, status: "completed" }).agents, run.agents);
});

test("compressed cells keep every present state and draw stalled only one-to-one", () => {
  const counts = { done: 30, running: 5, stalled: 2, error: 1, stopped: 0, pending: 64, total: 100 };
  const cells = compressedCells(counts, 36);
  assert.equal(cells.length, 36);
  for (const state of ["done", "running", "error", "pending"]) assert.ok(cells.includes(state), state);
  assert.ok(!cells.includes("stalled"));
  assert.deepEqual(compressedCells({ done: 1, running: 2, stalled: 1, error: 0, stopped: 0, pending: 1, total: 4 }, 36), ["done", "running", "stalled", "pending"]);
});

test("grid summary, summary text and clock read as Claude's", () => {
  assert.equal(gridSummary({ done: 0, running: 0, stalled: 0, error: 0, stopped: 0, pending: 0, total: 0 }), "正在等待智能体启动");
  assert.equal(gridSummary({ done: 2, running: 3, stalled: 1, error: 1, stopped: 0, pending: 0, total: 6 }), "6 个智能体中已完成 2 个，运行中 2 个，已停滞 1 个，失败 1 个");
  assert.equal(gridSummary({ done: 2, running: 0, stalled: 0, error: 1, stopped: 3, pending: 0, total: 6 }), "6 个智能体中已完成 2 个，已停止 3 个，失败 1 个");
  assert.equal(summaryText('Dynamic workflow "Probe" failed: script threw', "Probe"), "Script threw");
  assert.equal(summaryText('Dynamic workflow "Probe" completed', "Probe"), undefined);
  assert.equal(summaryText("Probe", "Probe"), undefined);
  assert.equal(elapsed(12_000), "12秒");
  assert.equal(elapsed(185_000), "3分钟 05秒");
  assert.equal(elapsed(3_723_000), "1小时 02分钟 03秒");
});

test("the ultracode keyword counts only as a plain word of a typed message", async () => {
  const { hasUltracodeKeyword } = await import("./ultracode.ts");
  assert.equal(hasUltracodeKeyword("ultracode: review the auth module"), true);
  assert.equal(hasUltracodeKeyword("Please UltraCode this refactor."), true);
  for (const text of ["/effort ultracode on", "what is ultracode?", "open ultracode.js", "the `ultracode` flag", 'say "ultracode" twice', "(ultracode)", "<note>ultracode</note>", "ultracode-mode", "x/ultracode", "ultracodes"]) {
    assert.equal(hasUltracodeKeyword(text), false, text);
  }
});

test("workflow runs join the background tasks once launched", async () => {
  const { backgroundTasks } = await import("./background.ts");
  const run = (runId, status, extra = {}) => ({ type: "workflow", id: `call-${runId}`, runId, name: runId, description: "d", status, phases: [], agents: [], startedAtMs: 1000, totalTokens: 0, totalToolCalls: 0, ...extra });
  const thread = {
    meta: { id: "t1", parentThreadId: null, status: { type: "idle" } },
    turns: [{ id: "u1", items: [run("wf_a", "pending"), run("wf_b", "running"), run("wf_c", "completed", { completedAtMs: 5000 }), run("wf_d", "declined")] }],
    timing: {},
    background: [],
  };
  const tasks = backgroundTasks(thread, { t1: thread }).filter((task) => task.kind === "workflow");
  assert.deepEqual(tasks.map((task) => [task.key, task.status, task.title, task.ownerId]), [["workflow:wf_b", "running", "wf_b", "t1"], ["workflow:wf_c", "completed", "wf_c", "t1"]]);
});
