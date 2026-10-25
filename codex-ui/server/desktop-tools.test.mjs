import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDesktopTools, desktopFilePath } from "./desktop-tools.mjs";
import { validateDesktopInput } from "../context/desktop-tools.mjs";

const call = (id, threadId, name = "show_pane", args = { pane: "plan" }) => ({ id, method: "tools/call", params: { name, arguments: args, _meta: { threadId, codexUiDesktopCwd: path.resolve(threadId === "a" ? "one" : "two") } } });
const body = (reply) => JSON.parse(reply.result.content[0].text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture(t, timeoutMs = 1000) {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true, browserEnabled: false }], ["b", { cwd: path.resolve("two"), enabled: true, browserEnabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs });
  const session = host.openSession(), message = host.message;
  host.message = (request, signal, client = session) => message(request, signal, client);
  t.after(host.close);
  const ack = (request, displayed = false) => host.respond({ id: request.id, result: { threadId: request.threadId, cwd: request.cwd, pane: request.args.pane, applied: true, displayed } });
  return { host, threads, events, ack, disable: () => { enabled = false; } };
}

test("desktop tools wait for the owning renderer and keep background display distinct", async t => {
  const f = fixture(t);
  const pending = f.host.message(call(1, "a"));
  let settled = false;
  pending.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(f.events[0].threadId, "a");
  assert.equal(f.events[0].cwd, f.threads.get("a").cwd);
  assert.equal(f.ack(f.events[0]), true);
  assert.deepEqual(body(await pending), { threadId: "a", cwd: f.threads.get("a").cwd, pane: "plan", applied: true, displayed: false });
});

test("invalid targets, disabled capabilities and unbound threads never reach the renderer", async t => {
  const f = fixture(t);
  assert.equal((await f.host.message(call(1, "other"))).result.isError, true);
  for (const args of [{ pane: "terminal", command: "whoami" }, { pane: "files", path: "a", targetId: "b" }, { pane: "browser", path: "https://example.test" }, { pane: "files", path: "x", line: 0 }]) {
    assert.throws(() => validateDesktopInput("show_pane", args));
  }
  f.disable();
  assert.deepEqual((await f.host.message({ id: 2, method: "tools/list" })).result.tools, []);
  assert.equal((await f.host.message(call(3, "a"))).result.isError, true);
  assert.equal(f.events.length, 0);
});

test("two threads proceed independently, one thread is serialized and duplicate requests reuse their result", async t => {
  const f = fixture(t);
  const a = f.host.message(call(1, "a")), again = f.host.message(call(1, "a"));
  const next = f.host.message(call(2, "a")), b = f.host.message(call(3, "b"));
  await tick();
  assert.deepEqual(f.events.map(e => e.threadId), ["a", "b"]);
  f.ack(f.events[1]);
  await b;
  f.ack(f.events[0]);
  assert.deepEqual(await a, await again);
  await tick();
  assert.equal(f.events.length, 3);
  f.ack(f.events[2]);
  await next;
  assert.deepEqual(await f.host.message(call(1, "a")), await a);
  assert.equal(f.events.length, 3);
  f.disable();
  assert.equal((await f.host.message(call(1, "a"))).result.isError, true);
});

test("timeout and disconnect report unknown outcomes, cancel old UI actions and reject late receipts", async t => {
  const f = fixture(t, 20);
  const pending = f.host.message(call(1, "a"));
  await tick();
  const request = f.events[0];
  const response = await pending;
  assert.equal(response.result.isError, true);
  assert.equal(body(response).code, "UI_TIMEOUT");
  assert.equal(f.events.at(-1).event, "desktop-cancel");
  assert.equal(f.ack(request), false);
  const closing = f.host.message(call(2, "a"));
  await tick();
  f.host.close();
  assert.equal(body(await closing).code, "UI_DISCONNECTED");
});

test("a moved directory or malformed receipt cannot acknowledge the old action", async t => {
  const f = fixture(t);
  const pending = f.host.message(call(1, "a"));
  await tick();
  const request = f.events[0];
  f.threads.get("a").cwd = path.resolve("moved");
  f.ack(request);
  assert.equal((await pending).result.isError, true);
});

test("MCP cancellation and HTTP abort remove queued actions without dispatch or replay", async t => {
  const f = fixture(t);
  const first = f.host.message(call(1, "a"));
  const queued = f.host.message(call(2, "a"));
  await tick();
  await f.host.message({ method: "notifications/cancelled", params: { requestId: 2 } });
  assert.equal(body(await queued).code, "CANCELLED");
  const abort = new AbortController();
  const active = f.host.message(call(3, "b"), abort.signal);
  await tick(); abort.abort();
  assert.equal(body(await active).code, "CANCELLED");
  f.ack(f.events[0]); await first; await tick();
  assert.equal(f.events.filter(event => event.event === "desktop-request").length, 2);
  assert.equal(body(await f.host.message(call(2, "a"))).code, "CANCELLED");
});

test("independent MCP clients and resumed turns may reuse numeric request ids", async t => {
  const f = fixture(t);
  const client = f.host.openSession();
  const a = f.host.message(call(1, "a")), b = f.host.message(call(1, "b"), undefined, client);
  await tick();
  await f.host.message({ method: "notifications/cancelled", params: { requestId: 1 } }, undefined, client);
  assert.equal(body(await b).code, "CANCELLED");
  assert.equal(f.events.at(-1).id, f.events[1].id);
  f.ack(f.events[0]); await a;
  f.host.closeSession(client);
  const resumedClient = f.host.openSession();
  const next = f.host.message(call(1, "a"), undefined, resumedClient); await tick();
  assert.equal(f.events.filter(event => event.event === "desktop-request").length, 3);
  f.ack(f.events.at(-1)); await next;
  assert.deepEqual(await f.host.message(call(1, "a"), undefined, resumedClient), await next);
  await assert.rejects(f.host.message(call(2, "b"), undefined, client), /session expired/);
});

test("new file targets resolve inside the real working directory, including junction boundaries", async () => {
  const work = await mkdtemp(path.join(tmpdir(), "desktop-path-"));
  const root = path.join(work, "root"), outside = path.join(work, "outside");
  await mkdir(root); await mkdir(outside);
  await writeFile(path.join(root, "a.md"), "ok");
  await writeFile(path.join(outside, "secret.md"), "private");
  assert.equal(await desktopFilePath(root, "a.md"), path.join(root, "a.md"));
  await assert.rejects(desktopFilePath(root, "../outside/secret.md"));
  await assert.rejects(desktopFilePath(root, "missing"));
  await assert.rejects(desktopFilePath(root, "."));
  await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(desktopFilePath(root, "escape/secret.md"));
  const absent = path.join(root, "does-not-exist");
  await assert.rejects(desktopFilePath(absent, "../outside.txt"), error => error.code === "PATH_OUTSIDE_CWD");
  await assert.rejects(desktopFilePath(absent, "//untrusted.invalid/share/file.txt"), error => error.code === "PATH_OUTSIDE_CWD");
});
