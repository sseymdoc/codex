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

test("set_session_title is gated like the display tools, may wait on consent and answers as Claude's tool does", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 10, consentMs: 1000 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const rename = (id, title) => call(id, "a", "set_session_title", { title });
  const receipt = (request, result) => ({ id: request.id, result: { threadId: "a", cwd: request.cwd, title: "新标题", ...result } });
  assert.ok((await send({ id: 1, method: "tools/list" })).result.tools.some(tool => tool.name === "set_session_title"));
  for (const [id, title] of [[2, " "], [3, "x".repeat(201)], [4, "a" + String.fromCharCode(0x202e) + "b"], [5, String.fromCharCode(0x200d)]]) assert.equal((await send(rename(id, title))).result.isError, true);
  assert.equal(events.length, 0, "invalid titles never reach the renderer");
  const pending = send(rename(6, " 新标题 "));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(events[0].args, { title: "新标题" });
  host.respond(receipt(events[0], { previousTitle: "旧标题", previousTitleSource: "user", outcome: "renamed" }));
  const renamed = (await pending).result;
  assert.equal(renamed.isError, undefined, "still waiting past the display timeout");
  assert.equal(renamed.content[0].text, "Renamed this session to “新标题” (was “旧标题”).");
  assert.deepEqual(renamed._meta, { codexUiSessionRenamed: { threadId: "a", title: "新标题", previousTitle: "旧标题", previousTitleSource: "user" } });
  const unchanged = send(rename(7, "新标题"));
  await tick();
  host.respond(receipt(events[1], { outcome: "unchanged" }));
  assert.deepEqual((await unchanged).result, { content: [{ type: "text", text: "This session is already named “新标题”." }] });
  const declined = send(rename(8, "新标题"));
  await tick();
  host.respond(receipt(events[2], { outcome: "declined" }));
  assert.equal((await declined).result.isError, true);
  const forged = send(rename(9, "新标题"));
  await tick();
  host.respond(receipt(events[3], { title: "别的标题", outcome: "renamed" }));
  assert.equal((await forged).result.isError, true, "a receipt for another title is refused");
  enabled = false;
  assert.deepEqual((await send({ id: 10, method: "tools/list" })).result.tools, []);
  assert.equal((await send(rename(11, "新标题"))).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 4, "a disabled rename never reaches the renderer");
});

test("enter_plan_mode is gated like the display tools, may wait on consent and answers as Claude's EnterPlanMode does", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 10, consentMs: 1000 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const enter = (id, args = {}) => call(id, "a", "enter_plan_mode", args);
  const answer = async (id, outcome) => {
    const pending = send(enter(id));
    await new Promise(resolve => setTimeout(resolve, 30));
    const request = events.at(-1);
    host.respond({ id: request.id, result: { threadId: "a", cwd: request.cwd, outcome } });
    return (await pending).result;
  };
  assert.ok((await send({ id: 1, method: "tools/list" })).result.tools.some(tool => tool.name === "enter_plan_mode"));
  assert.equal((await send(enter(2, { mode: "plan" }))).result.isError, true);
  assert.equal(events.length, 0, "arguments it does not take never reach the renderer");
  // Entered: past the display timeout, with the mark the plan-mode resume reads.
  const entered = await answer(3, "entered");
  assert.equal(entered.isError, undefined);
  assert.match(entered.content[0].text, /^Entered plan mode\. You should now focus on exploring the codebase/);
  assert.match(entered.content[0].text, /end this turn now/);
  assert.deepEqual(entered._meta, { codexUiPlanMode: "entered" });
  assert.deepEqual(await answer(4, "already"), { content: [{ type: "text", text: "This chat is already in plan mode." }] });
  const declined = await answer(5, "declined");
  assert.equal(declined.isError, true);
  assert.match(declined.content[0].text, /^User declined to enter plan mode/);
  assert.equal((await answer(6, "unavailable")).isError, true);
  assert.equal((await answer(7, "planned")).isError, true, "an unknown outcome is refused");
  enabled = false;
  assert.deepEqual((await send({ id: 8, method: "tools/list" })).result.tools, []);
  assert.equal((await send(enter(9))).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 5, "with the switch off a direct call never reaches the renderer");
});
