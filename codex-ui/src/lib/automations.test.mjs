// Run with `pnpm test`. As codex.test.mjs: these hooks add ".ts" and transform with esbuild.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "esbuild";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { emptyThreadState, getState, setState } = await import("./store.ts");
const { applyNotification, sendAutomationTurn, sendMessage, startSideThread } = await import("./codex.ts");
const { autoArchives, automationNotice, cronModel, cronPermissions, cronPlace, heartbeatBlocker, quietCompletion, startText } = await import("./automations.ts");
const { CRON_GUIDANCE, HEARTBEAT_KEY, cronMessage, heartbeatEnvelope } = await import("../../context/automations.mjs");

const meta = (id) => ({ id, preview: "", cwd: "D:/test", status: { type: "idle" }, source: "cli", ephemeral: false, parentThreadId: null, name: null });
const text = (value) => ({ type: "userMessage", id: "u", content: [{ type: "text", text: value, text_elements: [] }] });
const reply = (value) => ({ type: "agentMessage", id: "a", text: value });
const threadWith = (id, opening, answer, status = "completed", error = null) =>
  ({ ...emptyThreadState({ ...meta(id), name: "Watched" }), turns: [{ id: "t1", items: [text(opening), reply(answer)], status, error }] });
const cron = (prompt = "Check the build") => cronMessage({ name: "Nightly", id: "nightly", memory: "C:/home/nightly/memory.md", lastRunAt: null, prompt });

test("a cron run works in its project, its folder or (projectless) the task's own folder", () => {
  const projects = [
    { id: "p1", roots: [{ path: "D:/repo" }, { path: "D:/other" }], metadata: {} },
    { id: "p2", roots: [{ path: "/srv" }], metadata: { "codexUi.environment": JSON.stringify({ version: 1, kind: "ssh", ssh: { connectionId: "c", folders: [] } }) } },
  ];
  assert.deepEqual(cronPlace({ target: { type: "project", projectId: "p1" }, cwds: [], dir: "C:/t" }, projects), { cwd: "D:/repo", projectId: "p1" });
  assert.throws(() => cronPlace({ target: { type: "project", projectId: "gone" }, cwds: [], dir: "C:/t" }, projects), /找不到此定时任务的项目/);
  assert.deepEqual(cronPlace({ target: null, cwds: ["D:/a", "D:/b"], dir: "C:/t" }, projects), { cwd: "D:/a", projectId: null });
  assert.deepEqual(cronPlace({ target: { type: "projectless" }, cwds: [], dir: "C:/t" }, projects), { cwd: "C:/t", projectId: null });
  assert.throws(() => cronPlace({ target: { type: "project", projectId: "p2" }, cwds: [], dir: "C:/t" }, projects), /此环境不支持定时任务/);
});

test("a cron run keeps the catalog's model and an effort that model offers, else the defaults", () => {
  const models = [
    { id: "big", model: "big-model", supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "low" }] },
    { id: "small", model: "small", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
  ];
  assert.deepEqual(cronModel({ model: "big-model", reasoningEffort: "high" }, models, "small"), { model: "big", effort: "high" });
  assert.deepEqual(cronModel({ model: "small", reasoningEffort: "high" }, models, "big"), { model: "small" });
  assert.deepEqual(cronModel({ model: "retired", reasoningEffort: "low" }, models, "small"), { effort: "low" });
  assert.deepEqual(cronModel({ model: null, reasoningEffort: "high" }, models, "big"), { effort: "high" });
  assert.deepEqual(cronModel({ model: null, reasoningEffort: "ultra" }, models, "big"), {});
});

test("an unattended run asks for no approvals where allowed, in the user's default sandbox (ChatGPT vse)", () => {
  const user = { permission: "read-only", permissionProfile: null, reviewer: "user" };
  assert.deepEqual(cronPermissions(user, null), { permission: "read-only", approvalPolicy: "never" });
  assert.deepEqual(cronPermissions({ ...user, permission: null }, ["on-request", "never"]), { permission: "auto", approvalPolicy: "never" });
  assert.deepEqual(cronPermissions(user, ["on-request"]), { permission: "read-only", approvalPolicy: "on-request" });
  assert.deepEqual(cronPermissions({ ...user, reviewer: "auto_review", permission: "auto" }, null), { permission: "auto", approvalPolicy: "on-request" });
  assert.deepEqual(cronPermissions({ ...user, permission: null, permissionProfile: "locked" }, null), { approvalPolicy: "never" });
  assert.deepEqual(cronPermissions({ ...user, permission: null, permissionProfile: "locked", reviewer: "auto_review" }, null), { approvalPolicy: null });
});

test("a heartbeat waits for a session that is busy, and names one that is gone or archived", (t) => {
  const before = getState();
  t.after(() => setState(before));
  const idle = { ...emptyThreadState(meta("idle")), subscribed: true };
  setState({ threads: { idle }, pendingMessages: {}, requests: [] });
  assert.equal(heartbeatBlocker(getState(), "idle"), null);
  assert.equal(heartbeatBlocker(getState(), "nobody"), "missing");
  const busy = [
    { turns: [{ id: "t", items: [], status: "inProgress" }] },
    { meta: { ...idle.meta, status: { type: "active", activeFlags: [] } } },
    { sending: true },
    { queue: [{ id: "q" }] },
  ];
  for (const patch of busy) {
    setState({ threads: { idle: { ...idle, ...patch } } });
    assert.equal(heartbeatBlocker(getState(), "idle"), "busy", JSON.stringify(patch));
  }
  setState({ threads: { idle }, pendingMessages: { idle: { item: text("x") } } });
  assert.equal(heartbeatBlocker(getState(), "idle"), "busy");
  setState({ pendingMessages: {}, planConsents: { idle: {} } });
  assert.equal(heartbeatBlocker(getState(), "idle"), "busy");
  setState({ planConsents: {} });
  applyNotification({ method: "thread/archived", params: { threadId: "idle" } });
  assert.equal(heartbeatBlocker(getState(), "idle"), "archived");
});

test("finished scheduled turns: quiet ones mark and tell nothing, the rest notify with what they found", (t) => {
  const before = getState();
  t.after(() => setState(before));
  const quiet = threadWith("h", heartbeatEnvelope("watch", "2026-10-30T00:00:00.000Z", "Watch CI"), "<heartbeat>\n  <automation_id>watch</automation_id>\n  <decision>DONT_NOTIFY</decision>\n  <message>Still green.</message>\n</heartbeat>");
  const loud = threadWith("h", heartbeatEnvelope("watch", "2026-10-30T00:00:00.000Z", "Watch CI"), "CI broke.\n<heartbeat>\n  <automation_id>watch</automation_id>\n  <decision>NOTIFY</decision>\n  <message>The nightly build fails on Windows.</message>\n</heartbeat>");
  const done = threadWith("c", cron(), "Fixed it.\n::inbox-item{title=\"Nightly build is green\" summary=\"Nothing to do\"}");
  const failed = threadWith("c", cron(), "", "failed", { message: "Model error" });
  const plain = threadWith("p", "hello", "hi");
  assert.equal(quietCompletion(quiet, "t1"), true);
  assert.equal(quietCompletion(loud, "t1"), false);
  assert.equal(quietCompletion(done, "t1"), false);
  assert.equal(quietCompletion(plain, "t1"), false);
  assert.deepEqual(automationNotice(loud, "t1", []), { title: "Watched", body: "The nightly build fails on Windows." });
  assert.deepEqual(automationNotice(done, "t1", []), { title: "Nightly", body: "Nightly build is green" });
  assert.deepEqual(automationNotice(threadWith("c", cron(), "Done."), "t1", [{ id: "nightly", name: "每晚构建" }]), { title: "每晚构建", body: "Codex 已完成一项任务" });
  assert.deepEqual(automationNotice(failed, "t1", []), { title: "定时任务“Nightly”失败", body: "Model error" });
  assert.equal(automationNotice(plain, "t1", []), null);
});

test("only a cron run nobody carried on in, watched by no heartbeat and off screen goes to the archive", (t) => {
  const before = getState();
  t.after(() => setState(before));
  setState({ threads: { c: { ...emptyThreadState(meta("c")) } }, pendingMessages: {}, activeId: null, splitId: null });
  const task = { id: "nightly", kind: "cron", autoArchive: true };
  const run = { threadId: "c", status: "PENDING_REVIEW" };
  const s = () => getState();
  assert.equal(autoArchives(s(), [], task, run, "completed"), true);
  assert.equal(autoArchives(s(), [], { ...task, autoArchive: false }, run, "completed"), false);
  assert.equal(autoArchives(s(), [], task, run, "failed"), false);
  assert.equal(autoArchives(s(), [], task, { ...run, status: "ACCEPTED" }, "completed"), false);
  assert.equal(autoArchives(s(), [{ kind: "heartbeat", status: "ACTIVE", targetThreadId: "c" }], task, run, "completed"), false);
  assert.equal(autoArchives(s(), [{ kind: "heartbeat", status: "PAUSED", targetThreadId: "c" }], task, run, "completed"), true);
  setState({ activeId: "c" });
  assert.equal(autoArchives(s(), [], task, run, "completed"), false);
});

test("start toasts read as Claude's", () => {
  assert.equal(startText("Nightly", "run_now", null), "“Nightly”已启动。");
  assert.equal(startText("Nightly", "scheduled", null), "定时任务“Nightly”已启动。");
  assert.match(startText("Nightly", "scheduled", Date.now() - 3_600_000), /^定时任务“Nightly”错过了 .+ 的运行。现在开始运行。$/);
});

test("a run's session starts with no parent, the user's instructions kept; its turns carry their trigger and never steer", async (t) => {
  const before = getState(), requests = [];
  t.after(() => setState(before));
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({}) }));
  t.mock.method(Rpc.prototype, "request", function (method, params) {
    requests.push({ method, params: structuredClone(params) });
    if (method === "command/exec") return Promise.resolve({ exitCode: 128, stdout: "", stderr: "not a git repository" });
    if (method === "codexUi/git/branches") return Promise.resolve({ root: null });
    if (method === "thread/start") return Promise.resolve({ thread: meta("run"), model: "m", reasoningEffort: null, approvalPolicy: "never", sandbox: { type: "workspaceWrite" }, cwd: "D:/repo" });
    if (method === "turn/start") return Promise.resolve({ turn: { id: "t1", items: [], status: "inProgress", error: null } });
    return Promise.resolve({});
  });
  setState({ threads: {}, pendingMessages: {}, projects: [], planCard: false, modes: [], conn: { status: "ready" }, config: { developer_instructions: "Be terse." }, server: { ...before.server, info: { codexUiHostContext: true } } });
  const { id } = await startSideThread(null, { context: "fresh", cwd: "D:/repo", useWorktree: true, permission: "auto", approvalPolicy: "never", threadSource: "automation", instructions: CRON_GUIDANCE, roots: ["C:/home/nightly"] });
  const start = requests.find((r) => r.method === "thread/start").params;
  assert.equal(id, "run");
  assert.equal(start.threadSource, "automation");
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.sandbox, "workspace-write");
  assert.equal(start.config.developer_instructions, `Be terse.\n\n${CRON_GUIDANCE}`);
  assert.equal("developerInstructions" in start, false);
  assert.deepEqual(start.runtimeWorkspaceRoots, ["D:/repo", "C:/home/nightly"]);

  const turnId = await sendAutomationTurn("run", cron(), { turnTrigger: "automation_heartbeat_scheduled", context: { [HEARTBEAT_KEY]: { kind: "application", value: "guide" } } });
  const turnStart = requests.findLast((r) => r.method === "turn/start").params;
  assert.equal(turnId, "t1");
  assert.equal(turnStart.turnTrigger, "automation_heartbeat_scheduled");
  assert.deepEqual(turnStart.additionalContext[HEARTBEAT_KEY], { kind: "application", value: "guide" });
  assert.equal(getState().pendingMessages.run, undefined);
  // turn/start resolved with a running turn: a second scheduled send refuses rather than steering.
  await assert.rejects(sendAutomationTurn("run", cron(), { turnTrigger: "automation_cron_scheduled" }), /会话仍在运行/);
  assert.equal(requests.some((r) => r.method === "turn/steer"), false);
  await sendMessage("run", [{ type: "text", text: "and then?", text_elements: [] }]);
  assert.equal(requests.some((r) => r.method === "turn/steer"), true);
});
