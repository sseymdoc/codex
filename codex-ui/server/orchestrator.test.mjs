import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createOrchestrator } from "./orchestrator.mjs";

const HOST = "127.0.0.1:7478";
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check) {
  const deadline = performance.now() + 5000;
  while (!check()) { assert.ok(performance.now() < deadline, "service did not settle"); await delay(10); }
}

function fixture(t, { failFirst = false, ...options } = {}) {
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
console.log(JSON.stringify({ method: "ready", params: { pid: process.pid } }));
createInterface({ input: process.stdin }).on("line", (request) => {
  const { id, method, params } = JSON.parse(request);
  log(method, { params });
  let result = { pid: process.pid, params, enabled: process.env.CODEX_UI_EXPERIMENTAL_BACKEND, token: process.env.CODEX_UI_BROWSER_TOKEN };
  if (method === "getAuthStatus") result = { authMethod: "apiKey", authToken: "private-test-credential" };
  if (method === "config/read") result = { config: {} };
  if (method === "model/list") result = { data: [{ model: "test-model", id: "test-model", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }] };
  if (method === "experimentalFeature/list") result = { data: [] };
  if (method === "thread/start") result = { ...result, thread: { id: "thread-" + process.pid, cwd: process.cwd(), ephemeral: params.ephemeral === true } };
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
