import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createOrchestrator } from "./orchestrator.mjs";

const HOST = "127.0.0.1:7478";
const legacyContext = JSON.parse(readFileSync(new URL("../context/fixtures/legacy.json", import.meta.url), "utf8"));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check) {
  const deadline = performance.now() + 5000;
  while (!check()) { assert.ok(performance.now() < deadline, "service did not settle"); await delay(10); }
}

function fixture(t, { failFirst = false, oversizeFirst = false, hangAuth = false, hostContextCapability = false, ...options } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "codex-orchestrator-"));
  const script = path.join(work, "codex.mjs"), log = path.join(work, "events.jsonl");
  const oldHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(work, "home");
  mkdirSync(process.env.CODEX_HOME);
  writeFileSync(script, `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const log = (event, data = {}) => appendFileSync(${JSON.stringify(log)}, JSON.stringify({ event, pid: process.pid, cwd: process.cwd(), ...data }) + "\\n");
log("boot");
if (${failFirst} && !existsSync(${JSON.stringify(log + ".failed")})) {
  writeFileSync(${JSON.stringify(log + ".failed")}, "failed"); process.exit(9);
}
if (${oversizeFirst} && !existsSync(${JSON.stringify(log + ".oversized")})) {
  writeFileSync(${JSON.stringify(log + ".oversized")}, "1");
  process.stderr.write(Buffer.alloc(2 * 1024 * 1024, "x"));
}
console.log(JSON.stringify({ method: "ready", params: { pid: process.pid } }));
createInterface({ input: process.stdin }).on("line", (request) => {
  const { id, method, params } = JSON.parse(request);
  log(method, { params });
  if (${hangAuth} && method === "getAuthStatus") return;
  if (method === "oversize") {
    const output = params.stream === "stderr" ? process.stderr : process.stdout;
    const chunk = Buffer.alloc(1024 * 1024, "x");
    for (let i = 0; i < 65; i++) output.write(chunk);
    return;
  }
  let result = { pid: process.pid, params, enabled: process.env.CODEX_UI_EXPERIMENTAL_BACKEND, token: process.env.CODEX_UI_BROWSER_TOKEN };
  if (method === "getAuthStatus") result = { authMethod: "apiKey", authToken: "private-test-credential" };
  if (method === "initialize" && ${hostContextCapability}) result = { codexUiHostContext: true };
  if (method === "config/read") result = { config: {} };
  if (method === "model/list") result = { data: [{ model: "test-model", id: "test-model", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
  if (method === "experimentalFeature/list") result = { data: [] };
  if (method === "thread/start") result = { ...result, thread: { id: "thread-" + process.pid, cwd: params.cwd || process.cwd(), ephemeral: params.ephemeral === true } };
  if (method === "turn/start") result = { turn: { id: "title-turn" } };
  if (id !== undefined) console.log(JSON.stringify({ id, result }));
}).on("close", () => process.exit(0));
`);
  const service = createOrchestrator({ codex: script, cwd: work, log: { error() {} }, ...options });
  const records = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [];
  t.after(async () => {
    service.close();
    await until(() => records().filter((r) => r.event === "boot").every((r) => !alive(r.pid)));
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
  });
  function connect() {
    const events = [], lines = [];
    let ended = false;
    const id = service.connect(HOST, {
      event: (event, data) => events.push({ event, data }),
      message: (line) => lines.push(line),
      end: () => { ended = true; },
    });
    let nextId = 0;
    return { id, events, lines, get ended() { return ended; },
      async call(method, params = {}) {
        const requestId = ++nextId;
        service.send(id, [{ id: requestId, method, params }]);
        await until(() => lines.some((line) => JSON.parse(line).id === requestId));
        return JSON.parse(lines.find((line) => JSON.parse(line).id === requestId)).result;
      } };
  }
  return { service, connect, records, work, script };
}

test("direct connections isolate RPC ids and credentials, and disconnect only their own worker", async (t) => {
  const f = fixture(t), a = f.connect(), b = f.connect();
  const one = await a.call("echo", { value: "one" }), two = await b.call("echo", { value: "two" });
  assert.notEqual(one.pid, two.pid);
  assert.equal(one.params.value, "one");
  assert.equal(two.params.value, "two");
  assert.equal(f.service.backend, null);
  assert.deepEqual(await f.service.accountProfile(a.id), { profile: null });
  assert.ok(a.lines.every((line) => !line.includes("private-test-credential") && !line.includes("codex-ui-bridge:")));
  f.service.disconnect(a.id);
  assert.equal(f.service.hasConnection(a.id), false);
  assert.throws(() => f.service.send(a.id, []), { code: "CONNECTION_CLOSED" });
  await until(() => !alive(one.pid));
  assert.equal((await b.call("echo")).pid, two.pid);
});

test("Git previews keep large untracked binaries out of app-server and leave RPC usable", async (t) => {
  const f = fixture(t), a = f.connect();
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: f.work, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(f.work, "tracked.txt"), "base\n");
  git("add", "tracked.txt");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
  git("remote", "add", "origin", f.work);
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const binary = randomBytes(52 * 1024 * 1024);
  binary[0] = 0;
  writeFileSync(path.join(f.work, "installer.bin"), binary);
  writeFileSync(path.join(f.work, "新文件.txt"), "第一行\n");
  const result = await a.call("gitDiffToRemote", { cwd: f.work });
  assert.ok(result, a.lines.find((line) => JSON.parse(line).error));
  assert.equal(result.sha, git("rev-parse", "HEAD"));
  assert.match(result.diff, /Binary files .*installer\.bin differ/);
  assert.match(result.diff, /\+第一行/);
  assert.doesNotMatch(result.diff, /GIT binary patch/);
  assert.ok(Buffer.byteLength(result.diff) < 32 * 1024);
  assert.ok(!f.records().some((r) => r.event === "gitDiffToRemote"));
  assert.ok((await a.call("echo")).pid);
  assert.equal(a.ended, false);
  writeFileSync(path.join(f.work, "tracked.txt"), "x".repeat(9 * 1024 * 1024));
  await a.call("gitDiffToRemote", { cwd: f.work });
  assert.match(a.lines.map(JSON.parse).find((line) => line.error)?.error.message, /8 MiB/);
  assert.ok((await a.call("echo")).pid);
  assert.equal(a.ended, false);
  f.service.send(a.id, [{ id: "invalid", method: "gitDiffToRemote", params: { cwd: 42 } }]);
  assert.equal(a.lines.map(JSON.parse).find((line) => line.id === "invalid").error.code, -32602);
  f.service.send(a.id, [{ id: "cancelled", method: "gitDiffToRemote", params: { cwd: f.work } }]);
  f.service.disconnect(a.id);
  await delay(100);
  assert.ok(!a.lines.some((line) => JSON.parse(line).id === "cancelled"));
});

test("direct prewarm is claimed once with early output; repeated close cannot restart workers", async (t) => {
  const f = fixture(t, { experimentalBackend: true });
  assert.equal(f.service.prewarm(HOST), true);
  await until(() => f.records().some((r) => r.event === "boot"));
  const warmPid = f.records()[0].pid;
  const a = f.connect(), b = f.connect();
  assert.equal(a.events[0].data.prewarmed, true);
  assert.equal(b.events[0].data.prewarmed, false);
  assert.equal((await a.call("echo")).pid, warmPid);
  const other = await b.call("echo");
  assert.ok(a.lines.some((line) => JSON.parse(line).method === "ready"));
  f.service.close();
  f.service.close();
  assert.equal(f.service.closed, true);
  assert.equal(f.service.prewarm(HOST), false);
  assert.throws(() => f.connect(), { code: "CLOSED" });
  await until(() => !alive(warmPid) && !alive(other.pid));
  assert.equal(f.records().filter((r) => r.event === "boot").length, 2);
});

for (const prewarm of [false, true]) test(`browser context preserves RPC envelopes and folder isolation (prewarm=${prewarm})`, async (t) => {
  const folders = [];
  const f = fixture(t, { experimentalBackend: true, browser: {
    verificationInstructions(cwd) { folders.push(cwd); return cwd.endsWith("project-a") ? legacyContext.browser : ""; },
  } });
  const aCwd = path.join(f.work, "project-a"), bCwd = path.join(f.work, "project-b");
  if (prewarm) assert.equal(f.service.prewarm(HOST), true);
  const a = f.connect(), b = f.connect();
  assert.equal(a.events[0].data.prewarmed, prewarm);
  const config = { developer_instructions: ` \nUser rules\n\n${legacyContext.planning}\n `, "tools.update_plan.enabled": true, other: 7 };
  const verified = { ...config, developer_instructions: `${config.developer_instructions}\n\n${legacyContext.browser}` };
  const started = await a.call("thread/start", { cwd: aCwd, config: { ...config } });
  assert.deepEqual(started.params, { cwd: aCwd, config: verified });
  assert.deepEqual((await b.call("thread/start", { cwd: bCwd, config: { ...config } })).params, { cwd: bCwd, config });
  const threadId = started.thread.id;
  assert.deepEqual((await a.call("thread/resume", { threadId, config: { ...config } })).params, { threadId, config: verified });
  const unchanged = [
    ["thread/resume", { threadId, config: null }],
    ["thread/resume", { threadId }],
    ["thread/fork", { threadId, config: { ...config } }],
    ["turn/start", { threadId, input: [], additionalContext: { "codex-ui.git": { kind: "untrusted", value: "{}" } } }],
    ["turn/steer", { threadId, input: [], expectedTurnId: "turn-1" }],
  ];
  for (const [method, params] of unchanged) {
    await a.call(method, structuredClone(params));
    assert.equal(JSON.stringify(f.records().findLast((r) => r.event === method).params), JSON.stringify(params));
  }
  assert.deepEqual(folders, [aCwd, bCwd, aCwd]);
  assert.deepEqual((await a.call("thread/start", { cwd: aCwd })).params, { cwd: aCwd, config: { developer_instructions: legacyContext.browser } });
});

test("oversized stdout or stderr ends only the offending connection with one fatal event", async (t) => {
  const f = fixture(t, { hangAuth: true }), healthy = f.connect();
  const healthyPid = (await healthy.call("echo")).pid;
  for (const stream of ["stdout", "stderr"]) {
    const broken = f.connect(), pid = (await broken.call("echo")).pid;
    let settled = false;
    const profile = f.service.accountProfile(broken.id).then((value) => { settled = true; return value; });
    await until(() => f.records().some((record) => record.pid === pid && record.event === "getAuthStatus"));
    f.service.send(broken.id, [{ id: 99, method: "oversize", params: { stream } }]);
    await until(() => broken.ended);
    await until(() => !alive(pid));
    await until(() => settled);
    assert.deepEqual(await profile, { profile: null });
    assert.equal(f.service.hasConnection(broken.id), false);
    assert.deepEqual(broken.events.map((entry) => entry.event), ["hello", "fatal"]);
    assert.match(broken.events[1].data.message, new RegExp(stream));
    assert.equal(broken.events[1].data.code, "OUTPUT_TOO_LARGE");
    assert.ok(broken.lines.every((line) => line.length < 1024));
    assert.equal((await healthy.call("echo")).pid, healthyPid);
  }
});

test("oversized prewarm diagnostics discard the worker and the next connection launches normally", async (t) => {
  const f = fixture(t, { oversizeFirst: true, experimentalBackend: true });
  assert.equal(f.service.prewarm(HOST), true);
  await until(() => f.records().some((record) => record.event === "boot"));
  const pid = f.records()[0].pid;
  await until(() => !alive(pid));
  const connection = f.connect();
  assert.equal(connection.events[0].data.prewarmed, false);
  assert.notEqual((await connection.call("echo")).pid, pid);
});

test("a failed prewarm falls back and a spawn error is reported without a transport", async (t) => {
  const f = fixture(t, { experimentalBackend: true, failFirst: true });
  assert.equal(f.service.prewarm(HOST), true);
  await until(() => f.records().some((r) => r.event === "boot"));
  const failedPid = f.records()[0].pid;
  await until(() => !alive(failedPid));
  const a = f.connect();
  assert.notEqual((await a.call("echo")).pid, failedPid);
  assert.equal(a.events[0].data.prewarmed, false);
  const broken = createOrchestrator({ codex: f.script, cwd: path.join(f.work, "missing"), log: { error() {} } });
  t.after(broken.close);
  const events = [];
  let ended = false;
  const failed = broken.connect(HOST, { event: (event) => events.push(event), message() {}, end() { ended = true; } });
  await until(() => ended);
  assert.ok(events.includes("fatal"));
  assert.equal(broken.hasConnection(failed), false);
});

test("direct browser requests retain the experimental gate and per-connection binding", async (t) => {
  const browser = { tool: async ({ cwd }) => ({ content: [{ type: "text", text: cwd }] }) };
  const f = fixture(t, { browser });
  assert.equal(f.service.prewarm(HOST), false);
  const a = f.connect(), off = await a.call("thread/start");
  assert.equal(off.enabled, "0");
  assert.equal(off.token, undefined);
  await assert.rejects(f.service.browserMessage(a.id, "", { method: "tools/list" }), { code: "BROWSER_UNAUTHORIZED" });
  const enabled = createOrchestrator({ codex: f.script, cwd: f.work, browser, experimentalBackend: true });
  t.after(enabled.close);
  const messages = [];
  const id = enabled.connect(HOST, { event() {}, message: (line) => messages.push(JSON.parse(line)), end() {} });
  enabled.send(id, [{ id: 1, method: "thread/start", params: {} }]);
  await until(() => messages.some((message) => message.id === 1));
  const on = messages.find((message) => message.id === 1).result;
  assert.equal(enabled.authorizeBrowser(a.id, on.token), false);
  const request = { id: 2, method: "tools/call", params: { name: "tabs_context", arguments: {}, _meta: { threadId: on.thread.id } } };
  const result = await enabled.browserMessage(id, on.token, request);
  assert.equal(result.result.content[0].text, f.work);
  enabled.disconnect(id);
  await assert.rejects(enabled.browserMessage(id, on.token, request), { code: "BROWSER_UNAUTHORIZED" });
});

test("title workers cancel separately and service shutdown cancels all remaining workers", async (t) => {
  const f = fixture(t), main = f.connect();
  const pid = (await main.call("echo")).pid;
  const abort = new AbortController();
  const title = f.service.title("测试标题", "test-model", abort.signal);
  const rejected = assert.rejects(title);
  await until(() => f.records().some((r) => r.event === "turn/start"));
  const titleThread = f.records().find((r) => r.event === "thread/start");
  assert.notEqual(titleThread.pid, pid);
  assert.notEqual(titleThread.cwd, f.work);
  assert.equal(titleThread.params.ephemeral, true);
  assert.equal(titleThread.params.sandbox, "read-only");
  abort.abort();
  await rejected;
  await until(() => !alive(titleThread.pid));
  assert.equal((await main.call("echo")).pid, pid);
  const remaining = assert.rejects(f.service.title("另一个标题", "test-model"));
  await until(() => f.records().filter((r) => r.event === "turn/start").length === 2);
  f.service.close();
  await remaining;
  await assert.rejects(f.service.title("已关闭", "test-model"), { code: "CLOSED" });
});

test("managed backend selection keeps the startup snapshot until a new service is created", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-orchestrator-backend-"));
  const bin = path.join(root, "release-fixture", "bin"), suffix = process.platform === "win32" ? ".exe" : "";
  mkdirSync(bin, { recursive: true });
  for (const name of ["codex", "codex-code-mode-host"]) writeFileSync(path.join(bin, name + suffix), "fixture");
  writeFileSync(path.join(root, "release.json"), JSON.stringify({ directory: "release-fixture" }));
  const events = [];
  const service = createOrchestrator({ backend: { root, channel: "release", onChange: (state) => events.push(state) } });
  t.after(service.close);
  assert.equal(service.experimentalBackend, true);
  await service.backend.select("disabled");
  assert.equal(service.backend.status().channel, "disabled");
  assert.equal(service.backendStartup.channel, "release");
  assert.equal(service.experimentalBackend, true);
  assert.equal(events.at(-1).restartNeeded, true);
  const restarted = createOrchestrator({ backend: { root, channel: "disabled" }, experimentalBackend: true });
  t.after(restarted.close);
  assert.equal(restarted.experimentalBackend, false);
  service.stopMaintenance();
  await assert.rejects(service.backend.select("release"), /应用正在关闭/);
  assert.equal(service.closed, false, "browser disposal precedes runtime shutdown");
  service.close();
  assert.equal(service.closed, true);
});
for (const prewarm of [false, true]) test(`managed context updates use the owning cwd and discard disconnected watchers (prewarm=${prewarm})`, async (t) => {
  const { hostContext } = await import("../context/index.mjs");
  const watchers = new Map(), prefs = new Map();
  const browser = {
    verificationState: (cwd) => prefs.get(cwd) ?? { toolsEnabled: true, autoVerify: true },
    verificationInstructions: () => { throw new Error("managed threads must not append legacy instructions"); },
    watchVerification(cwd, changed) { watchers.set(cwd, changed); return () => watchers.delete(cwd); },
  };
  const f = fixture(t, { experimentalBackend: true, hostContextCapability: true, browser });
  if (prewarm) { f.service.prewarm(HOST); await until(() => f.records().some((r) => r.event === "boot")); }
  const a = f.connect(), b = f.connect();
  await Promise.all([a.call("initialize"), b.call("initialize")]);
  const roots = [path.join(f.work, "a"), path.join(f.work, "b")];
  const [ta, tb] = await Promise.all([a.call("thread/start", { cwd: roots[0] }), b.call("thread/start", { cwd: roots[1] })]);
  await Promise.all([
    a.call("thread/settings/update", { threadId: ta.thread.id, codexUiContext: hostContext(roots[0], true, { desktopContext: true }) }),
    b.call("thread/settings/update", { threadId: tb.thread.id, codexUiContext: hostContext(roots[1], false) }),
  ]);
  let updates = f.records().filter((r) => r.event === "thread/settings/update");
  assert.equal(updates.length, 2);
  assert.equal(updates.find((r) => r.params.threadId === ta.thread.id).params.codexUiContext.planning.enabled, true);
  assert.equal(updates.find((r) => r.params.threadId === tb.thread.id).params.codexUiContext.planning.enabled, false);
  prefs.set(roots[0], { toolsEnabled: false, autoVerify: false });
  watchers.get(roots[0])();
  await until(() => f.records().filter((r) => r.event === "thread/settings/update").length === 3);
  updates = f.records().filter((r) => r.event === "thread/settings/update");
  assert.equal(updates.length, 3);
  assert.equal(updates[2].params.codexUiContext.cwd, roots[0]);
  assert.equal(updates[2].params.codexUiContext.browserVerification.toolsEnabled, false);
  assert.deepEqual(updates[2].params.codexUiContext.desktop, hostContext(roots[0], true, { desktopContext: true }).desktop);
  assert.equal(Object.hasOwn(updates.find((r) => r.params.threadId === tb.thread.id).params.codexUiContext, "desktop"), false);
  const moved = path.join(f.work, "moved");
  await a.call("thread/settings/update", { threadId: ta.thread.id, cwd: moved, codexUiContext: hostContext(moved, false) });
  updates = f.records().filter((r) => r.event === "thread/settings/update");
  assert.equal(updates.at(-1).params.codexUiContext.cwd, moved);
  assert.equal(updates.at(-1).params.codexUiContext.browserVerification.toolsEnabled, true);
  assert.equal(watchers.has(roots[0]), false);
  const stale = watchers.get(moved);
  f.service.disconnect(a.id);
  stale();
  await delay(30);
  assert.equal(f.records().filter((r) => r.event === "thread/settings/update").length, 4);
  assert.equal(watchers.has(moved), false);
  assert.equal(watchers.has(roots[1]), true);
});
