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

test("mark_chapter is gated like the display tools and answers marked or refuses the first message", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 1000 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const mark = (id, args) => call(id, "a", "mark_chapter", args);
  const answer = async (id, args, outcome) => {
    const pending = send(mark(id, args));
    await new Promise(resolve => setTimeout(resolve, 30));
    const request = events.at(-1);
    host.respond({ id: request.id, result: { threadId: "a", cwd: request.cwd, outcome } });
    return { request, result: (await pending).result };
  };
  assert.ok((await send({ id: 1, method: "tools/list" })).result.tools.some(tool => tool.name === "mark_chapter"));
  for (const [id, args] of [[2, { title: " " }], [3, { title: "x".repeat(81) }], [4, { title: "ok", summary: "s".repeat(301) }], [5, { title: "ok", extra: 1 }]]) assert.equal((await send(mark(id, args))).result.isError, true);
  assert.equal(events.length, 0, "invalid chapters never reach the renderer");
  const marked = await answer(6, { title: " Test verification ", summary: " Running the suites " }, "marked");
  assert.deepEqual(marked.request.args, { title: "Test verification", summary: "Running the suites" });
  assert.deepEqual(marked.result, { content: [{ type: "text", text: "Marked a new chapter: \u201cTest verification\u201d." }] });
  assert.equal((await answer(7, { title: "Start" }, "first_message")).result.isError, true);
  enabled = false;
  assert.deepEqual((await send({ id: 8, method: "tools/list" })).result.tools, []);
  assert.equal((await send(mark(9, { title: "Late" }))).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 2, "a disabled chapter never reaches the renderer");
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

test("session tools are gated like the display tools, wait past the display timeout and answer in Claude's words", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 10, consentMs: 1000, startMs: 200, offerMs: 1000 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const requests = () => events.filter(event => event.event === "desktop-request");
  const start = (id, args) => call(id, "a", "start_session", args);
  const background = "B".repeat(80);
  const names = (await send({ id: 1, method: "tools/list" })).result.tools.map(tool => tool.name);
  assert.ok(names.includes("start_session") && names.includes("dismiss_task"));
  // Refusals that need no app state never reach the renderer, and read as plain sentences.
  for (const [id, args, words] of [[2, { title: "x" }, /^initiation is required/], [3, { initiation: "own_initiative", title: "x", prompt: "p" }, /background of at least 80 characters/], [4, { proposal_id: "task_123" }, /format: task_xxxxxxxx/], [5, { proposal_id: "task_aaaaaaaa", title: "x" }, /drop title/], [6, { initiation: "own_initiative", title: "x", prompt: "p", background, cwd: "C:/x" }, /cannot carry a folder/]]) {
    const refused = (await send(start(id, args))).result;
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, words);
  }
  assert.equal(requests().length, 0);
  // A proposal: past the 10ms display timeout, its task id in the text and _meta.
  const proposing = send(start(7, { initiation: "own_initiative", title: " Fix the docs ", prompt: "Update `README.md`.", background }));
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(requests()[0].args, { initiation: "own_initiative", title: "Fix the docs", context: "fresh", target: "local", prompt: "Update `README.md`.", background });
  assert.ok(requests()[0].deadline - Date.now() > 100, "a start may take its worktree's time");
  host.respond({ id: requests()[0].id, result: { threadId: "a", cwd: requests()[0].cwd, outcome: "proposed", taskId: "task_aaaaaaaa", title: "Fix the docs" } });
  const proposed = (await proposing).result;
  assert.equal(proposed.isError, undefined);
  assert.match(proposed.content[0].text, /^Proposed "Fix the docs" \(task_id: task_aaaaaaaa\)\. The user sees a card and nothing runs until they start it/);
  assert.deepEqual(proposed._meta, { codexUiSession: { outcome: "proposed", taskId: "task_aaaaaaaa", title: "Fix the docs" } });
  // An offer waits past the start timeout for its card's answer.
  const offering = send(start(8, { initiation: "offer", title: "New feature" }));
  await new Promise(resolve => setTimeout(resolve, 300));
  const offer = requests()[1];
  host.respond({ id: offer.id, result: { threadId: "a", cwd: offer.cwd, outcome: "kept", taskId: "task_bbbbbbbb" } });
  assert.match((await offering).result.content[0].text, /^The user chose "Do it here" \(task_id: task_bbbbbbbb\): do the task in this session now/);
  // A renderer refusal comes back as its own sentence; a malformed receipt is refused.
  const refusing = send(start(9, { proposal_id: "task_cccccccc" }));
  await new Promise(resolve => setTimeout(resolve, 20));
  host.respond({ id: requests()[2].id, error: { code: "PROPOSAL_EXPIRED", message: "Proposal task_cccccccc expired unstarted; if the user still wants it, call start_session with initiation \"user_asked\"." } });
  assert.equal((await refusing).result.content[0].text, 'Proposal task_cccccccc expired unstarted; if the user still wants it, call start_session with initiation "user_asked".');
  const forged = send(call(10, "a", "dismiss_task", { task_id: "task_dddddddd" }));
  await new Promise(resolve => setTimeout(resolve, 20));
  host.respond({ id: requests()[3].id, result: { threadId: "a", cwd: requests()[3].cwd, outcome: "dismissed", taskId: "task_eeeeeeee" } });
  assert.equal((await forged).result.isError, true, "a receipt for another task is refused");
  const dismissing = send(call(11, "a", "dismiss_task", { task_id: "task_dddddddd", reason: "done here" }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(requests()[4].args, { task_id: "task_dddddddd" });
  host.respond({ id: requests()[4].id, result: { threadId: "a", cwd: requests()[4].cwd, outcome: "already_started", taskId: "task_dddddddd" } });
  assert.match((await dismissing).result.content[0].text, /^Task task_dddddddd is no longer pending, so there is nothing to withdraw/);
  // With the experimental backend off nothing is listed, and a direct call never reaches the renderer.
  enabled = false;
  assert.deepEqual((await send({ id: 12, method: "tools/list" })).result.tools, []);
  for (const [id, name, args] of [[13, "start_session", { initiation: "user_asked", title: "x", prompt: "p", background }], [14, "dismiss_task", { task_id: "task_aaaaaaaa" }]]) assert.equal((await send(call(id, "a", name, args))).result.isError, true);
  assert.equal(requests().length, 5);
});

test("send_message is a session tool: plain refusals, Claude-like receipts, gated", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 10, consentMs: 1000, startMs: 200 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const message = (id, args) => call(id, "a", "send_message", args);
  assert.ok((await send({ id: 1, method: "tools/list" })).result.tools.some(tool => tool.name === "send_message"));
  assert.match((await send(message(2, { to: "child" }))).result.content[0].text, /^message is required/);
  assert.match((await send(message(3, { to: "a\nb", message: "hi" }))).result.content[0].text, /^to must be a session id/);
  const sending = send(message(4, { to: " child ", message: " Please also update the docs. " }));
  await new Promise(resolve => setTimeout(resolve, 30));
  const request = events.at(-1);
  assert.deepEqual(request.args, { to: "child", message: "Please also update the docs." });
  host.respond({ id: request.id, result: { threadId: "a", cwd: request.cwd, outcome: "sent", sessionId: "child", title: "Docs", busy: true } });
  const sent = (await sending).result;
  assert.equal(sent.content[0].text, 'Sent to "Docs" (child). It is working: it reads the message in its running turn. Its next report reaches you when that turn ends; don\'t wait for it.');
  const forged = send(message(5, { to: "child", message: "x" }));
  await new Promise(resolve => setTimeout(resolve, 30));
  host.respond({ id: events.at(-1).id, result: { threadId: "a", cwd: events.at(-1).cwd, outcome: "sent", sessionId: "other", title: "X", busy: false } });
  assert.equal((await forged).result.isError, true, "a receipt for another session is refused");
  enabled = false;
  assert.equal((await send(message(6, { to: "child", message: "x" }))).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 2);
});

test("hand_off_to_session and list_start_targets are session tools with Claude's answers, gated", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 10, consentMs: 1000, startMs: 200 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const names = (await send({ id: 1, method: "tools/list" })).result.tools.map(tool => tool.name);
  assert.ok(names.includes("hand_off_to_session") && names.includes("list_start_targets"));
  assert.match((await send(call(2, "a", "hand_off_to_session", { title: "Move" }))).result.content[0].text, /^remaining_plan is required/);
  const handing = send(call(3, "a", "hand_off_to_session", { title: " Finish the parser ", remaining_plan: "1. tests\n2. docs" }));
  await new Promise(resolve => setTimeout(resolve, 30));
  const request = events.at(-1);
  assert.deepEqual(request.args, { title: "Finish the parser", remaining_plan: "1. tests\n2. docs" });
  host.respond({ id: request.id, result: { threadId: "a", cwd: request.cwd, outcome: "handed_off", sessionId: "fork-1", title: "Finish the parser", worktree: "own" } });
  const handed = (await handing).result;
  assert.equal(handed.content[0].text, 'Handed off "Finish the parser" to its own session (session_id: fork-1); it continues from this conversation and the remaining plan. Its worktree has every commit on your HEAD; uncommitted edits stay here. Stop working on that task in this session. Don\'t repeat the introduction; answer their latest message now.');
  assert.deepEqual(handed._meta, { codexUiSession: { outcome: "handed_off", sessionId: "fork-1", title: "Finish the parser" } });
  const listing = send(call(4, "a", "list_start_targets", {}));
  await new Promise(resolve => setTimeout(resolve, 30));
  const targets = { folders: [{ name: "demo", folder: "C:/demo" }], cloudEnvironments: [{ name: "demo-cloud", id: "env_1", repository: "acme/demo", forThisRepository: true }] };
  host.respond({ id: events.at(-1).id, result: { threadId: "a", cwd: events.at(-1).cwd, ...targets } });
  assert.deepEqual(JSON.parse((await listing).result.content[0].text), { thisSession: { folder: path.resolve("one") }, ...targets });
  assert.equal((await send(call(5, "a", "list_start_targets", { all: true }))).result.isError, true);
  enabled = false;
  for (const [id, name, args] of [[6, "hand_off_to_session", { title: "x", remaining_plan: "y" }], [7, "list_start_targets", {}]]) assert.equal((await send(call(id, "a", name, args))).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 2);
});

test("wrap_up is gated like the display tools and answers as Claude's ccd_turn wrap_up does", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 200 });
  t.after(host.close);
  const session = host.openSession();
  const send = request => host.message(request, undefined, session);
  const wrap = async (id, args, receipt) => {
    const pending = send(call(id, "a", "wrap_up", args));
    await new Promise(resolve => setTimeout(resolve, 20));
    const request = events.at(-1);
    host.respond({ id: request.id, result: { threadId: "a", cwd: request.cwd, ...receipt } });
    return (await pending).result;
  };
  assert.ok((await send({ id: 1, method: "tools/list" })).result.tools.some(tool => tool.name === "wrap_up"));
  const shown = await wrap(2, { recap: "Fixed the parser. Tests pass; nothing committed.", ask: "Commit it?", actions: [{ action: "commit" }, { label: "Not now" }] }, { enabled: true, available: ["commit"] });
  assert.equal(shown.isError, undefined);
  assert.equal(shown.content[0].text, "Shown in the next-step box. Your closing message is your answer to the user: write it now, in full, as the last thing you say this turn. The box asks your question, so do not ask it again.");
  const refused = await wrap(3, { recap: "Done.", ask: "Open a PR?", actions: [{ action: "create_pr" }] }, { enabled: true, available: ["commit"] });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /^Not shown: create_pr does not hold right now \(app actions available: commit\)/);
  const off = await wrap(4, { recap: "Done." }, { enabled: false, available: [] });
  assert.deepEqual(off, { isError: true, content: [{ type: "text", text: "wrap_up is turned off right now; write it as text instead." }] });
  assert.equal((await send(call(5, "a", "wrap_up", { recap: "x", extra: 1 }))).result.content[0].text, "Invalid wrap_up arguments.");
  enabled = false;
  assert.equal((await send({ id: 6, method: "tools/list" })).result.tools.length, 0);
  const gated = (await send(call(7, "a", "wrap_up", { recap: "Done." }))).result;
  assert.equal(gated.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, 3);
});

test("terminal tools are gated like the display tools, resolve folders, wait for the card and refuse in plain words", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "codex-terminal-tools-"));
  await mkdir(path.join(root, "web"));
  await writeFile(path.join(root, "file.txt"), "");
  const threads = new Map([["a", { cwd: root, enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 50, consentMs: 400 });
  t.after(host.close);
  const session = host.openSession();
  const send = (id, name, args) => host.message({ id, method: "tools/call", params: { name, arguments: args, _meta: { threadId: "a", codexUiDesktopCwd: root } } }, undefined, session);
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const tab = { tab_id: "ab12cd34", label: "终端 1", state: "running", folder: path.join(root, "web"), selected: true, codex: true };
  // A run waits past the five-second display timeout (here 50 ms) for its card.
  const running = send(1, "run_in_terminal", { command: "npm run dev", cwd: "web" });
  await settle();
  const asked = events.at(-1);
  assert.equal(asked.event, "desktop-request");
  assert.equal(asked.args.cwd, path.join(root, "web"), "the folder arrives resolved");
  assert.ok(asked.deadline - Date.now() > 300);
  await new Promise(resolve => setTimeout(resolve, 80));
  host.respond({ id: asked.id, result: { threadId: "a", cwd: root, outcome: "ran", tab } });
  assert.match((await running).result.content[0].text, /^Typed the command into 终端 1 \(tab_id ab12cd34\)/);
  // A folder that isn't one never reaches the renderer, and the refusal is plain words.
  for (const [id, cwd] of [[2, "missing"], [3, "file.txt"], [4, "https://example.test/x"]]) {
    const refused = (await send(id, "open_terminal_tab", { cwd })).result;
    assert.equal(refused.isError, true);
    assert.doesNotMatch(refused.content[0].text, /^\{/);
  }
  assert.equal((await send(5, "run_in_terminal", { command: "a\nb" })).result.isError, true);
  const declined = send(6, "run_in_terminal", { command: "rm -rf build" });
  await settle();
  host.respond({ id: events.at(-1).id, result: { threadId: "a", cwd: root, outcome: "declined" } });
  assert.match((await declined).result.content[0].text, /declined running this command; nothing was typed/);
  const gone = send(7, "read_terminal", { tab_id: "00000000" });
  await settle();
  host.respond({ id: events.at(-1).id, error: { code: "TARGET_NOT_FOUND", message: "No terminal tab with that tab_id in this chat; list_terminal_tabs lists them." } });
  assert.equal((await gone).result.content[0].text, "No terminal tab with that tab_id in this chat; list_terminal_tabs lists them.");
  const sent = events.filter(event => event.event === "desktop-request").length;
  enabled = false;
  assert.equal((await host.message({ id: 8, method: "tools/list" }, undefined, session)).result.tools.length, 0);
  assert.equal((await send(9, "run_in_terminal", { command: "whoami" })).result.isError, true);
  assert.equal((await send(10, "list_terminal_tabs", {})).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, sent, "a disabled host asks the renderer nothing");
});

test("pull request tools are gated like the display tools, may wait on gh and refuse in plain words", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 50, startMs: 400 });
  t.after(host.close);
  const session = host.openSession();
  const send = (id, name, args) => host.message(call(id, "a", name, args), undefined, session);
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const url = "https://github.com/o/r/pull/7";
  const reading = send(1, "set_pr_monitor", { pr: "7", enabled: true });
  await settle();
  const asked = events.at(-1);
  assert.equal(asked.name, "set_pr_monitor");
  assert.ok(asked.deadline - Date.now() > 300, "gh may take longer than a display");
  await new Promise(resolve => setTimeout(resolve, 80));
  host.respond({ id: asked.id, result: { threadId: "a", cwd: asked.cwd, outcome: "on", url } });
  assert.match((await reading).result.content[0].text, /^Auto-fix is now on for https:\/\/github.com\/o\/r\/pull\/7\./);
  const refused = send(2, "set_auto_merge", { enabled: true });
  await settle();
  host.respond({ id: events.at(-1).id, error: { code: "NOT_ASKED", message: "Only the user turns this on, and this turn did not come from them. Ask them in your reply." } });
  assert.equal((await refused).result.content[0].text, "Only the user turns this on, and this turn did not come from them. Ask them in your reply.");
  assert.equal((await send(3, "bind_pr", { pr: "https://github.com/o/r/issues/7" })).result.isError, true);
  const sent = events.filter(event => event.event === "desktop-request").length;
  enabled = false;
  assert.equal((await host.message({ id: 4, method: "tools/list" }, undefined, session)).result.tools.length, 0);
  assert.equal((await send(5, "get_pr_status", {})).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, sent, "a disabled host asks the renderer nothing");
});

test("worktree tools are gated like the display tools, may wait on git and answer in plain words", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 50, startMs: 100 });
  t.after(host.close);
  const session = host.openSession();
  const send = (id, name, args) => host.message(call(id, "a", name, args), undefined, session);
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const entering = send(1, "enter_worktree", {});
  await settle();
  const asked = events.at(-1);
  assert.ok(asked.deadline - Date.now() > 200_000, "a fetch and merge may take minutes");
  host.respond({ id: asked.id, result: { threadId: "a", cwd: asked.cwd, outcome: "entered", worktree: "C:/w/ab12/repo", base: "main" } });
  const entered = (await entering).result;
  assert.match(entered.content[0].text, /^Created a git worktree at C:\/w\/ab12\/repo/);
  assert.deepEqual(entered._meta, { codexUiWorktree: "entered" });
  const syncing = send(2, "sync_with_base_branch", {});
  await settle();
  host.respond({ id: events.at(-1).id, error: { code: "NOT_WORKTREE", message: "This session works in the user's own checkout, not in a worktree Codex UI made, so sync_with_base_branch doesn't apply. Merge with git yourself only if the user asks." } });
  assert.match((await syncing).result.content[0].text, /^This session works in the user's own checkout/);
  assert.equal((await send(3, "sync_with_base_branch", { base: "--upload-pack=x" })).result.content[0].text, "base must be a branch name.");
  const sent = events.filter(event => event.event === "desktop-request").length;
  enabled = false;
  assert.equal((await send(4, "enter_worktree", {})).result.isError, true);
  assert.equal(events.filter(event => event.event === "desktop-request").length, sent, "a disabled host asks the renderer nothing");
});

test("set_setting waits for the user's card like a rename; refused keys never reach the renderer", async t => {
  const threads = new Map([["a", { cwd: path.resolve("one"), enabled: true }]]);
  let enabled = true;
  const events = [];
  const host = createDesktopTools({ enabled: () => enabled, context: id => threads.get(id), emit: (event, data) => events.push({ event, ...data }), timeoutMs: 50, consentMs: 400 });
  t.after(host.close);
  const session = host.openSession();
  const send = (id, name, args) => host.message(call(id, "a", name, args), undefined, session);
  const pending = send(1, "set_setting", { key: "theme", value: "dark" });
  await new Promise(resolve => setTimeout(resolve, 80));
  const asked = events.at(-1);
  assert.ok(asked.deadline - Date.now() > 250, "the card may take longer than a display");
  host.respond({ id: asked.id, result: { threadId: "a", cwd: asked.cwd, key: "theme", value: "dark", previous: "light", outcome: "changed" } });
  assert.equal((await pending).result.content[0].text, "Changed “主题” to “深色” (was “浅色”).");
  const before = events.length;
  const refused = (await send(2, "set_setting", { key: "tool_access_mode", value: "all" })).result;
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /^This setting is not one Codex may change/);
  assert.equal(events.length, before);
  const timedOut = (await send(3, "set_setting", { key: "motion", value: "reduce" })).result;
  assert.equal(timedOut.content[0].text, "The setting change was not approved in time; nothing was changed.");
  enabled = false;
  assert.equal((await send(4, "get_settings", {})).result.isError, true);
});
