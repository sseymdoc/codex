import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createBridge } from "./bridge.mjs";

async function waitFor(check, message = "condition did not settle") {
  const deadline = performance.now() + 5000;
  while (!check()) {
    assert.ok(performance.now() < deadline, message);
    await delay(10);
  }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function fixture(t, { experimentalBackend = true, bootDelay = 0, failFirst = false, browser } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "codex-prewarm-"));
  const fake = path.join(work, "codex.mjs"), record = path.join(work, "events.jsonl");
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = path.join(work, "home");
  mkdirSync(process.env.CODEX_HOME);
  writeFileSync(fake, `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
const record = ${JSON.stringify(record)};
const log = (event, data = {}) => appendFileSync(record, JSON.stringify({ event, pid: process.pid, ...data }) + "\\n");
log("boot");
if (${failFirst} && !existsSync(record + ".failed")) {
  writeFileSync(record + ".failed", "1");
  process.exit(7);
}
await delay(${bootDelay});
process.stdout.write(JSON.stringify({ method: "startupNotice", params: { pid: process.pid } }) + "\\n");
log("ready");
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log("request", { method: message.method });
  const result = { pid: process.pid, params: message.params, enabled: process.env.CODEX_UI_EXPERIMENTAL_BACKEND,
    token: process.env.CODEX_UI_BROWSER_TOKEN, args: process.argv,
    ...(message.method === "thread/start" ? { thread: { id: "thread-" + process.pid, cwd: process.cwd() } } : {}) };
  if (message.id !== undefined) process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
}).on("close", () => process.exit(0));
`);
  const bridge = createBridge({ codex: fake, cwd: work, token: "test", experimentalBackend, browser, log: { error() {} } });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const host = `127.0.0.1:${server.address().port}`, base = `http://${host}`;
  const headers = { Cookie: `codex_ui_${server.address().port}=test` }, clients = [];
  const records = () => {
    try { return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  async function connect() {
    const abort = new AbortController();
    const response = await fetch(base + "/api/events", { headers, signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "", sequence = 0;
    const seen = [];
    async function frame() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(line)?.[1];
          if (data) { const value = JSON.parse(data); seen.push(value); return value; }
        } else {
          const chunk = await reader.read();
          assert.equal(chunk.done, false, "SSE stream closed before response");
          buffer += chunk.value;
        }
      }
    }
    const client = {
      hello: await frame(), seen,
      async call(method, params = {}) {
        const id = ++sequence;
        const response = await fetch(`${base}/api/send?c=${client.hello.connectionId}`, {
          method: "POST", headers, body: JSON.stringify({ id, method, params }),
        });
        assert.equal(response.status, 204);
        for (;;) { const result = await frame(); if (result.id === id) return result.result; }
      },
      async close() { abort.abort(); await reader.cancel().catch(() => {}); },
    };
    clients.push(client);
    return client;
  }
  t.after(async () => {
    bridge.closeAll();
    await Promise.all(clients.map((client) => client.close()));
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    await waitFor(() => records().filter((r) => r.event === "boot").every((r) => !alive(r.pid)), "owned child survived bridge shutdown");
  });
  return { bridge, host, base, headers, connect, records, fake, work };
}

test("prewarm requires the explicit experimental switch, including direct calls", async (t) => {
  const f = await fixture(t, { experimentalBackend: false });
  assert.equal(f.bridge.prewarm(f.host), false);
  assert.equal(f.bridge.prewarm(f.host), false);
  assert.deepEqual(f.records(), []);
  const client = await f.connect();
  assert.equal(client.hello.prewarmed, undefined);
  assert.equal((await client.call("initialize")).enabled, "0");
  assert.equal(f.records().filter((r) => r.event === "boot").length, 1);
  for (const experimentalBackend of [undefined, "true"]) {
    const bridge = createBridge({ codex: f.fake, experimentalBackend });
    assert.equal(bridge.prewarm(f.host), false);
    bridge.closeAll();
  }
});

test("one warm process is claimed once with its original handshake and early output", async (t) => {
  const f = await fixture(t);
  assert.equal(f.bridge.prewarm("evil.example:7478"), false);
  assert.equal(f.bridge.prewarm(f.host), true);
  assert.equal(f.bridge.prewarm(f.host), true);
  await waitFor(() => f.records().some((r) => r.event === "ready"));
  const pid = f.records().find((r) => r.event === "boot").pid;
  assert.equal(f.records().some((r) => r.event === "request"), false, "prewarm must not initialize or create a thread");
  assert.equal((await fetch(f.base + "/api/events")).status, 401);
  const [a, b] = await Promise.all([f.connect(), f.connect()]);
  const params = { clientInfo: { name: "codex_ui", version: "test" }, capabilities: { experimentalApi: true } };
  const replies = await Promise.all([a.call("initialize", params), b.call("initialize", params)]);
  assert.equal(replies.filter((r) => r.pid === pid).length, 1);
  assert.notEqual(replies[0].pid, replies[1].pid);
  assert.equal([a, b].filter((client) => client.hello.prewarmed).length, 1);
  for (const reply of replies) assert.deepEqual(reply.params, params);
  assert.ok([...a.seen, ...b.seen].some((r) => r.method === "startupNotice" && r.params.pid === pid));
  assert.equal(f.records().filter((r) => r.event === "boot").length, 2);
  assert.equal(f.bridge.prewarm(f.host), false, "active connections do not get another idle process");
});

test("a connection can claim a process that is still booting", async (t) => {
  const f = await fixture(t, { bootDelay: 150 });
  assert.equal(f.bridge.prewarm(f.host), true);
  const client = await f.connect();
  const reply = await client.call("initialize");
  assert.equal(reply.pid, f.records().find((r) => r.event === "boot").pid);
  assert.equal(f.records().filter((r) => r.event === "boot").length, 1);
});

for (const changed of ["configuration", "binary", "credentials", "environment"]) {
  test(`changed ${changed} rejects the spare before claim`, async (t) => {
    const f = await fixture(t);
    const previous = process.env.CODEX_UI_PREWARM_TEST;
    t.after(() => {
      if (previous === undefined) delete process.env.CODEX_UI_PREWARM_TEST;
      else process.env.CODEX_UI_PREWARM_TEST = previous;
    });
    assert.equal(f.bridge.prewarm(f.host), true);
    await waitFor(() => f.records().some((r) => r.event === "ready"));
    const old = f.records().find((r) => r.event === "boot").pid;
    if (changed === "configuration") {
      mkdirSync(path.join(f.work, ".codex"));
      writeFileSync(path.join(f.work, ".codex/config.toml"), "model = 'changed'\n");
    } else if (changed === "binary") {
      writeFileSync(f.fake, readFileSync(f.fake, "utf8") + "\n// new binary version\n");
    } else if (changed === "credentials") {
      writeFileSync(path.join(process.env.CODEX_HOME, "auth.json"), "{}");
    } else process.env.CODEX_UI_PREWARM_TEST = "changed";
    const client = await f.connect();
    assert.notEqual((await client.call("initialize")).pid, old);
    await waitFor(() => !alive(old), "invalidated spare was not stopped");
  });
}

test("a missing OS process is not claimed while its exit event is still pending", async (t) => {
  const f = await fixture(t);
  f.bridge.prewarm(f.host);
  await waitFor(() => f.records().some((r) => r.event === "ready"));
  const old = f.records()[0].pid;
  const kill = process.kill.bind(process);
  const probe = t.mock.method(process, "kill", (pid, signal) => {
    if (pid === old && signal === 0) throw Object.assign(new Error("process already exited"), { code: "ESRCH" });
    return kill(pid, signal);
  });
  t.after(() => probe.mock.restore());
  const client = await f.connect();
  probe.mock.restore();
  assert.equal(client.hello.prewarmed, false);
  assert.notEqual((await client.call("initialize")).pid, old);
  await waitFor(() => !alive(old), "unusable spare was not stopped");
});

test("a failed prewarm falls back to a fresh process without a restart loop", async (t) => {
  const f = await fixture(t, { failFirst: true });
  assert.equal(f.bridge.prewarm(f.host), true);
  await waitFor(() => f.records().some((r) => r.event === "boot"));
  const failed = f.records()[0].pid;
  await waitFor(() => !alive(failed));
  assert.equal(f.records().filter((r) => r.event === "boot").length, 1);
  const client = await f.connect();
  assert.notEqual((await client.call("initialize")).pid, failed);
  assert.equal(f.records().filter((r) => r.event === "boot").length, 2);
});

test("an unclaimed process expires and shutdown cannot schedule or accept another", async (t) => {
  const f = await fixture(t);
  let expire;
  const realTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    if (ms === 60_000) expire = fn;
    return realTimeout(fn, ms, ...args);
  });
  assert.equal(f.bridge.prewarm(f.host), true);
  await waitFor(() => f.records().some((r) => r.event === "ready"));
  const pid = f.records()[0].pid;
  assert.equal(typeof expire, "function");
  expire();
  await waitFor(() => !alive(pid));
  assert.equal(f.records().filter((r) => r.event === "boot").length, 1);
  assert.equal(f.bridge.prewarm(f.host), true);
  await waitFor(() => f.records().filter((r) => r.event === "ready").length === 2);
  f.bridge.closeAll();
  assert.equal(f.bridge.prewarm(f.host), false);
  assert.equal((await fetch(f.base + "/api/events", { headers: f.headers })).status, 503);
});

test("a disconnected last page prepares a replacement but shutdown stops it", async (t) => {
  const f = await fixture(t);
  f.bridge.prewarm(f.host);
  const a = await f.connect();
  const first = (await a.call("initialize")).pid;
  await a.close();
  await waitFor(() => f.records().filter((r) => r.event === "ready").length === 2);
  const b = await f.connect();
  const second = (await b.call("initialize")).pid;
  assert.notEqual(first, second);
  assert.equal(f.records().filter((r) => r.event === "boot").length, 2);
  f.bridge.closeAll();
  await b.close();
  await waitFor(() => !alive(first) && !alive(second));
  assert.equal(f.records().filter((r) => r.event === "boot").length, 2);
});

test("claimed browser credentials stay bound to their own connection", async (t) => {
  const f = await fixture(t, { browser: { tool() { return { content: [] }; } } });
  f.bridge.prewarm(f.host);
  const a = await f.connect(), b = await f.connect();
  const one = await a.call("thread/start"), two = await b.call("thread/start");
  assert.notEqual(one.token, two.token);
  const endpoint = `${f.base}/api/browser-mcp?c=${a.hello.connectionId}`;
  const post = (token) => fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, method: "tools/list" }) });
  assert.equal((await post(two.token)).status, 401);
  assert.equal((await post(one.token)).status, 200);
  assert.ok(one.args.some((arg) => arg.includes(`/api/browser-mcp?c=${a.hello.connectionId}`)));
});

test("shutdown during prewarm boot cancels the unclaimed child", async (t) => {
  const f = await fixture(t, { bootDelay: 1000 });
  f.bridge.prewarm(f.host);
  await waitFor(() => f.records().some((r) => r.event === "boot"));
  const pid = f.records()[0].pid;
  f.bridge.closeAll();
  assert.equal(f.bridge.prewarm(f.host), false);
  await waitFor(() => !alive(pid));
  assert.equal(f.records().some((r) => r.event === "ready"), false);
});
