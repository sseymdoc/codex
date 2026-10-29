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
const { PRESETS, applyNotification, connect, readsSettled, sendAutomationTurn, sendMessage, startSideThread } = await import("./codex.ts");
const { autoArchives, automationNotice, createHeartbeatSession, cronModel, cronPermissions, cronPlace, heartbeatBlocker, markRunsRead, noteUserTurn, onStartFailed, quietCompletion, refreshAutomations, runNow, startText, tick } = await import("./automations.ts");
const { CRON_GUIDANCE, HEARTBEAT_KEY, cronMessage, heartbeatEnvelope } = await import("../../context/automations.mjs");

const meta = (id) => ({ id, preview: "", cwd: "D:/test", status: { type: "idle" }, source: "cli", ephemeral: false, parentThreadId: null, name: null });
const text = (value) => ({ type: "userMessage", id: "u", content: [{ type: "text", text: value, text_elements: [] }] });
const reply = (value) => ({ type: "agentMessage", id: "a", text: value });
const threadWith = (id, opening, answer, status = "completed", error = null) =>
  ({ ...emptyThreadState({ ...meta(id), name: "Watched" }), turns: [{ id: "t1", items: [text(opening), reply(answer)], status, error }] });
const cron = (prompt = "Check the build") => cronMessage({ name: "Nightly", id: "nightly", memory: "C:/home/nightly/memory.md", lastRunAt: null, prompt });
const settle = async (until = () => false) => { for (let i = 0; i < 500 && !until(); i++) await new Promise((resolve) => setImmediate(resolve)); };
const started = (id, cwd = "D:/repo") => ({ thread: meta(id), model: "m", reasoningEffort: null, approvalPolicy: "never", sandbox: { type: "workspaceWrite" }, cwd });

/**
 * The page's bridge (`bridge(url, body)` answers fetch, which `posts` records) and app-server
 * (`rpc(method, params)`, undefined for an empty page); with `open`, a connection opened through
 * the page's own onOpen, `ready` once it initialized.
 */
function page(t, { rpc = () => undefined, bridge = () => ({}), open = false } = {}) {
  const posts = [], requests = [];
  t.mock.getter(Rpc.prototype, "connection", () => "page");
  t.mock.method(Rpc.prototype, "notify", () => {});
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (body) posts.push({ url: String(url), body });
    return { ok: true, json: async () => bridge(String(url), body) };
  });
  t.mock.method(Rpc.prototype, "request", function (method, params) {
    requests.push({ method, params: structuredClone(params) });
    if (method === "initialize") return Promise.resolve({ userAgent: "codex/0.163.0" });
    if (method === "command/exec") return Promise.resolve({ exitCode: 128, stdout: "", stderr: "not a git repository" });
    if (method === "codexUi/git/branches") return Promise.resolve({ root: null });
    return rpc(method, params) ?? Promise.resolve({ data: [], nextCursor: null });
  });
  if (open) {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    t.mock.method(Rpc.prototype, "connect", function () { void this.handlers.open({ cwd: "D:/test", command: "fake" }); return Promise.resolve(); });
    connect();
  }
  return { posts, requests, ready: settle(() => getState().conn.status === "ready") };
}
const claims = (posts) => posts.filter((p) => p.url.startsWith("/api/automations/claim")).length;

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
  const { id } = await startSideThread(null, { context: "fresh", cwd: "D:/repo", useWorktree: true, permission: "auto", approvalPolicy: "never", threadSource: "automation", instructions: CRON_GUIDANCE, roots: ["C:/home/nightly"], unloadAtOnce: true });
  const start = requests.find((r) => r.method === "thread/start").params;
  assert.equal(id, "run");
  assert.equal(start.threadSource, "automation");
  assert.equal(start.approvalPolicy, "never");
  assert.equal(start.sandbox, "workspace-write");
  assert.equal(start.config.developer_instructions, `Be terse.\n\n${CRON_GUIDANCE}`);
  assert.equal(start.config.thread_unload_delay_secs, 0);
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

test("a session with a parent starts as before: no source, workspace roots or instructions of its own", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const { requests } = page(t, { rpc: (method) => (method === "thread/start" ? Promise.resolve(started("child")) : undefined) });
  const parent = { ...emptyThreadState({ ...meta("parent"), cwd: "D:/repo" }), subscribed: true, loaded: true };
  setState({ threads: { parent }, pendingMessages: {}, projects: [], planCard: false, modes: [], conn: { status: "ready" }, config: { developer_instructions: "Be terse." }, server: { ...before.server, info: { codexUiHostContext: true } } });
  await startSideThread("parent", { context: "fresh", permission: "auto" });
  const start = requests.find((r) => r.method === "thread/start").params;
  assert.equal("threadSource" in start, false);
  assert.equal("runtimeWorkspaceRoots" in start, false);
  assert.equal(start.config.developer_instructions, "Be terse.");
  assert.equal(start.approvalPolicy, PRESETS.auto.approval);
});

test("scheduled runs wait for the reads they need (not the rest), and read a config that failed again, quietly", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const config = Promise.withResolvers();
  let readConfig = () => config.promise;
  const hangs = ["threadSection/list", "permissionProfile/list"];
  const { posts, ready } = page(t, { open: true, rpc: (method) => (method === "config/read" ? readConfig() : hangs.includes(method) ? new Promise(() => {}) : undefined), bridge: () => ({ claims: [], stamp: 0 }) });
  await ready;
  assert.equal(getState().conn.status, "ready");
  await tick();
  assert.equal(claims(posts), 0);
  config.resolve({ config: { developer_instructions: "Be terse." }, origins: {} });
  await settle(readsSettled);
  assert.equal(readsSettled(), true);
  await tick();
  assert.equal(claims(posts), 1);
  setState({ config: null, toasts: [] });
  readConfig = () => Promise.reject(new Error("config.toml is broken"));
  await tick();
  assert.equal(claims(posts), 1);
  assert.deepEqual(getState().toasts, []);
  readConfig = () => Promise.resolve({ config: {}, origins: {} });
  await tick();
  assert.equal(claims(posts), 2);
});

test("a run left IN_PROGRESS by a page that closed ends as its turn did, and its session goes back; a session another app-server holds is left alone", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const run = { threadId: "orphan", automationId: "nightly", status: "IN_PROGRESS", readAt: null };
  let writer = true, resumes = 0;
  const { posts, requests, ready } = page(t, {
    open: true,
    rpc: (method) => {
      if (method === "config/read") return Promise.resolve({ config: {}, origins: {} });
      if (method === "thread/read") return Promise.resolve({ thread: { ...meta("orphan"), status: { type: "notLoaded" } } });
      if (method === "thread/resume") return ++resumes && writer ? Promise.reject(new Error("thread orphan already has an active writer")) : Promise.resolve(started("orphan"));
      if (method === "thread/turns/list") return Promise.resolve({ data: [{ id: "t1", items: [text(cron()), reply("Half way")], status: "interrupted", error: null }], nextCursor: null });
    },
    bridge: (url, body) =>
      url.startsWith("/api/automations/claim") ? { claims: [], stamp: 7 }
        : url.startsWith("/api/automations/runs") ? { run: { ...run, status: "PENDING_REVIEW", failed: body.failed } }
          : { items: [], invalid: [], runs: [run], unread: { total: 0, automationIds: [] }, stamp: 7 },
  });
  await ready;
  await settle(readsSettled);
  setState({ threads: {}, activeId: null, splitId: null });
  await tick();
  assert.equal(resumes, 1);
  assert.equal(posts.some((p) => p.url.startsWith("/api/automations/runs")), false);
  // Within two minutes of a refusal the session is not tried again.
  writer = false;
  await tick();
  assert.equal(resumes, 1);
  await tick(Date.now() + 3 * 60_000);
  assert.equal(resumes, 2);
  assert.deepEqual(posts.find((p) => p.url.startsWith("/api/automations/runs")).body, { threadId: "orphan", event: "completed", failed: true });
  assert.equal(getState().threads.orphan.unread, true);
  // Loaded only to finish it: it unloads as soon as this page lets go, which it does.
  assert.ok(requests.filter((r) => r.method === "thread/resume").every((r) => r.params.config.thread_unload_delay_secs === 0));
  await settle(() => requests.some((r) => r.method === "thread/unsubscribe"));
  assert.deepEqual(requests.find((r) => r.method === "thread/unsubscribe").params, { threadId: "orphan" });
  assert.equal(getState().threads.orphan.subscribed, false);
});

test("a heartbeat borrows a session this page does not hold and gives it back; one held elsewhere is retried, then skipped", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const hb = { id: "watch", kind: "heartbeat", name: "Watch", prompt: "Watch CI", targetThreadId: "w", notificationPolicy: null };
  let writer = false, queue = [];
  const { posts, requests, ready } = page(t, {
    open: true,
    rpc: (method) => {
      if (method === "config/read") return Promise.resolve({ config: {}, origins: {} });
      if (method === "thread/resume") return writer ? Promise.reject(new Error("thread w already has an active writer")) : Promise.resolve(started("w"));
      if (method === "turn/start") return Promise.resolve({ turn: { id: "hb1", items: [], status: "inProgress", error: null } });
    },
    bridge: (url) =>
      url.startsWith("/api/automations/claim") ? { claims: queue.splice(0), stamp: 5 }
        : url.startsWith("/api/automations/run-now") ? { claim: { token: "watch/now-1/", trigger: "run_now", automation: hb, lastRunAt: null, nominalAt: null } }
          : url.startsWith("/api/automations/report") ? { ok: true }
            : { items: [hb], invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 5 },
  });
  await ready;
  await settle(readsSettled);
  setState({ threads: { w: emptyThreadState({ ...meta("w"), name: "Watched", status: { type: "notLoaded" } }) }, activeId: null, splitId: null, pendingMessages: {}, toasts: [] });
  const claim = (nominalAt) => ({ token: `watch/${nominalAt}/${nominalAt}`, trigger: "scheduled", automation: hb, lastRunAt: null, nominalAt });
  const reports = () => posts.filter((p) => p.url.startsWith("/api/automations/report")).map((p) => p.body.outcome);
  queue = [claim(1000)];
  await tick();
  await settle(() => reports().length === 1);
  assert.deepEqual(reports(), ["started"]);
  assert.equal(requests.find((r) => r.method === "thread/resume").params.config.thread_unload_delay_secs, 0);
  const envelope = requests.find((r) => r.method === "turn/start").params.input[0].text;
  applyNotification({ method: "turn/completed", params: { threadId: "w", turn: { id: "hb1", items: [text(envelope), reply("Still green.")], status: "completed", error: null } } });
  await settle(() => requests.some((r) => r.method === "thread/unsubscribe"));
  assert.equal(getState().threads.w.subscribed, false);

  // Held by another app-server: a minute on, until ten minutes past the first refusal; then skipped.
  writer = true;
  const at = Date.now();
  for (const [minutes, outcome] of [[0, "retry"], [5, "retry"], [10, "failed"]]) {
    const count = reports().length + 1;
    queue = [claim(2000)];
    await tick(at + minutes * 60_000);
    await settle(() => reports().length === count);
    assert.equal(reports().at(-1), outcome, `${minutes} minutes on`);
  }
  await runNow("watch");
  assert.equal(reports().at(-1), "retry");
  assert.equal(getState().toasts.at(-1).title, "无法启动“Watch”。此会话已在其他窗口中打开。");

  // Every five minutes: skipped a period past the first refusal, not ten minutes.
  hb.rrule = "FREQ=MINUTELY;INTERVAL=5";
  for (const [minutes, outcome] of [[0, "retry"], [4, "retry"], [5, "failed"]]) {
    const count = reports().length + 1;
    queue = [claim(3000)];
    await tick(at + minutes * 60_000);
    await settle(() => reports().length === count);
    assert.equal(reports().at(-1), outcome, `${minutes} minutes on, every five`);
  }
});

test("a message in a cron run's session reaches the bridge before this page read the run; 全部标记为已读 clears the sessions", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  let readAt = null;
  const runs = () => [{ threadId: "auto", automationId: "nightly", status: "PENDING_REVIEW", readAt }];
  const { posts } = page(t, { bridge: (url) => (url.includes("read-all") ? { count: 1 } : { items: [], invalid: [], runs: runs(), unread: { total: 1, automationIds: ["nightly"] }, stamp: 3 }) });
  setState({ threads: { auto: { ...emptyThreadState({ ...meta("auto"), threadSource: "automation" }) }, plain: emptyThreadState(meta("plain")) }, activeId: null, splitId: null });
  noteUserTurn("plain");
  noteUserTurn("auto");
  assert.deepEqual(posts.map((p) => p.body), [{ threadId: "auto", event: "accepted" }]);
  await refreshAutomations();
  assert.equal(getState().threads.auto.unread, true);
  readAt = Date.now();
  assert.equal(await markRunsRead(), 1);
  assert.equal(getState().threads.auto.unread, false);
});

test("此任务的新会话: the session starts with its setup instructions, the task is saved on it, then the setup message", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const { posts, requests } = page(t, {
    rpc: (method) => (method === "thread/start" ? Promise.resolve(started("setup")) : method === "turn/start" ? Promise.resolve({ turn: { id: "t1", items: [], status: "inProgress", error: null } }) : undefined),
    bridge: (url, body) => (url.startsWith("/api/automations/create") ? { item: { ...body.input, id: "watch", name: "Watch" } } : { items: [], invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 1 }),
  });
  setState((s) => ({ threads: {}, pendingMessages: {}, projects: [], planCard: false, modes: [], conn: { status: "ready" }, config: { developer_instructions: "Be terse." }, prefs: { ...s.prefs, cwd: "D:/repo", projectId: null }, activeId: null, splitId: null, requests: [] }));
  const item = await createHeartbeatSession({ prompt: "Watch CI", rrule: "FREQ=HOURLY;INTERVAL=1" });
  const start = requests.find((r) => r.method === "thread/start").params;
  assert.equal("threadSource" in start, false);
  assert.match(start.config.developer_instructions, /^Be terse\.\n\nThis session was made for a scheduled task/);
  assert.deepEqual(posts.find((p) => p.url.startsWith("/api/automations/create")).body, { input: { prompt: "Watch CI", rrule: "FREQ=HOURLY;INTERVAL=1", kind: "heartbeat", targetThreadId: "setup" } });
  assert.equal(item.targetThreadId, "setup");
  assert.ok(requests.findIndex((r) => r.method === "thread/name/set") < requests.findIndex((r) => r.method === "turn/start"));
  const turn = requests.find((r) => r.method === "turn/start").params;
  assert.equal(turn.turnTrigger, "scheduled_task_setup");
  assert.match(turn.input[0].text, /^Watch CI\n\n日程安排：.+/);
  // Made in the background, it unloads as soon as its setup turn is done.
  assert.equal(start.config.thread_unload_delay_secs, 0);
  assert.equal(requests.some((r) => r.method === "thread/unsubscribe"), false);
  applyNotification({ method: "turn/completed", params: { threadId: "setup", turn: { id: "t1", items: [text(turn.input[0].text), reply("I'll watch CI every hour.")], status: "completed", error: null } } });
  await settle(() => requests.some((r) => r.method === "thread/unsubscribe"));
  assert.deepEqual(requests.find((r) => r.method === "thread/unsubscribe").params, { threadId: "setup" });
  assert.equal(getState().threads.setup.subscribed, false);
});

test("a borrowed session whose run left a background shell running is given back once the shell ends", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  const { requests } = page(t, {
    rpc: (method) => (method === "thread/start" ? Promise.resolve(started("setup")) : method === "turn/start" ? Promise.resolve({ turn: { id: "t1", items: [], status: "inProgress", error: null } }) : undefined),
    bridge: (url, body) => (url.startsWith("/api/automations/create") ? { item: { ...body.input, id: "watch", name: "Watch" } } : url.startsWith("/api/automations/claim") ? { claims: [], stamp: 1 } : { items: [], invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 1 }),
  });
  setState((s) => ({ threads: {}, pendingMessages: {}, projects: [], planCard: false, modes: [], conn: { status: "ready" }, config: {}, prefs: { ...s.prefs, cwd: "D:/repo", projectId: null }, activeId: null, splitId: null, requests: [] }));
  await createHeartbeatSession({ prompt: "Watch CI", rrule: "FREQ=HOURLY;INTERVAL=1" });
  const shell = (status) => ({ type: "commandExecution", id: "sh", command: "npm run dev", cwd: "D:/repo", processId: "p1", backgrounded: true, source: "agent", status, commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null });
  applyNotification({ method: "item/started", params: { threadId: "setup", turnId: "t1", item: shell("inProgress"), startedAtMs: 1 } });
  applyNotification({ method: "turn/completed", params: { threadId: "setup", turn: { id: "t1", items: [], status: "completed", error: null } } });
  const unsubscribed = () => requests.some((r) => r.method === "thread/unsubscribe");
  await settle(unsubscribed);
  await tick();
  await settle(unsubscribed);
  assert.equal(unsubscribed(), false);
  assert.equal(getState().threads.setup.subscribed, true);
  applyNotification({ method: "item/completed", params: { threadId: "setup", turnId: "t1", item: shell("completed"), completedAtMs: 2 } });
  await tick();
  await settle(unsubscribed);
  assert.deepEqual(requests.find((r) => r.method === "thread/unsubscribe").params, { threadId: "setup" });
});

test("立即运行 and 此任务的新会话 read a config that failed again and start nothing without one; a run that cannot start is told", async (t) => {
  const before = getState();
  t.after(() => setState(before));
  let readConfig = () => Promise.reject(new Error("config.toml is broken"));
  const cron = { id: "nightly", kind: "cron", name: "Nightly", prompt: "Build", target: { type: "project", projectId: "gone" }, cwds: [], dir: "C:/t" };
  const { posts, requests, ready } = page(t, {
    open: true,
    rpc: (method) => (method === "config/read" ? readConfig() : method === "thread/start" ? Promise.resolve(started("setup")) : method === "turn/start" ? Promise.resolve({ turn: { id: "t1", items: [], status: "inProgress", error: null } }) : undefined),
    bridge: (url, body) =>
      url.startsWith("/api/automations/create") ? { item: { ...body.input, id: "watch", name: "Watch" } }
        : url.startsWith("/api/automations/run-now") ? { claim: { token: "nightly/now-1/", trigger: "run_now", automation: cron, lastRunAt: null, nominalAt: null } }
          : url.startsWith("/api/automations/claim") ? { claims: [], stamp: 1 }
            : { items: [cron], invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 1 },
  });
  await ready;
  await settle(readsSettled);
  setState((s) => ({ config: null, toasts: [], projects: [], prefs: { ...s.prefs, cwd: "D:/repo", projectId: null }, activeId: null, splitId: null }));
  await assert.rejects(runNow("nightly"), /读取配置失败/);
  await assert.rejects(createHeartbeatSession({ prompt: "Watch CI", rrule: "FREQ=HOURLY;INTERVAL=1" }), /读取配置失败/);
  assert.equal(posts.some((p) => p.url.startsWith("/api/automations/run-now") || p.url.startsWith("/api/automations/create")), false);
  assert.equal(requests.some((r) => r.method === "thread/start"), false);
  assert.deepEqual(getState().toasts, []);

  readConfig = () => Promise.resolve({ config: { developer_instructions: "Be terse." }, origins: {} });
  await createHeartbeatSession({ prompt: "Watch CI", rrule: "FREQ=HOURLY;INTERVAL=1" });
  assert.match(requests.find((r) => r.method === "thread/start").params.config.developer_instructions, /^Be terse\.\n\n/);

  const failures = [];
  const unsubscribe = onStartFailed((failure) => failures.push(failure));
  await runNow("nightly");
  unsubscribe();
  await runNow("nightly");
  assert.deepEqual(failures, [{ automationId: "nightly", name: "Nightly", trigger: "run_now", message: "找不到此定时任务的项目。" }]);
  assert.equal(getState().toasts.at(-1).title, "定时任务“Nightly”无法启动。您可以尝试手动运行。");
});
