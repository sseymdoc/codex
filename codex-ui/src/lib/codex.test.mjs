// Run with `pnpm test`. codex.ts imports its siblings without an extension and rpc.ts has parameter
// properties, which Node's type stripping alone cannot load: these hooks add ".ts" and transform.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }) } : next(url, context),
});
// setState notifies subscribers once per frame.
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { emptyThreadState, getState, setState } = await import("./store.ts");
const { connect, isArchivedThread, refreshThreads, unarchiveThread, sendMessage, retryPendingMessage, refreshThreadGit } = await import("./codex.ts");

test("取消归档 brings back the sub-agents archived with a session; only one that fails stays in 已归档", async () => {
  // p spawned c1, c1 spawned c2, and thread/archive took all three; c2 fails to come back.
  const parents = { p: null, c1: "p", c2: "c1" };
  const archived = new Set(Object.keys(parents));
  const unarchived = [];
  const under = (id, ancestor) => {
    for (let at = parents[id]; at; at = parents[at]) if (at === ancestor) return true;
    return false;
  };
  const thread = (id) => ({
    id,
    preview: id,
    ephemeral: false,
    parentThreadId: parents[id],
    source: parents[id] ? { subAgent: { thread_spawn: { parent_thread_id: parents[id], depth: 1, agent_nickname: id } } } : "cli",
  });
  Rpc.prototype.request = async (method, params) => {
    if (method === "thread/list") {
      const ids = Object.keys(parents).filter((id) => archived.has(id) === params.archived && (!params.ancestorThreadId || under(id, params.ancestorThreadId)));
      return { data: ids.map(thread), nextCursor: null };
    }
    if (method === "thread/unarchive" && params.threadId !== "c2") {
      archived.delete(params.threadId);
      unarchived.push(params.threadId);
      return {};
    }
    throw new Error(`${method} ${params.threadId} failed`);
  };
  setState((s) => ({ list: { ...s.list, status: "archived", archived: true } }));
  await refreshThreads();
  assert.deepEqual(getState().list.ids, ["p", "c1", "c2"]);

  await unarchiveThread("p");
  assert.deepEqual(unarchived, ["p", "c1"]);
  assert.deepEqual(getState().list.ids, ["c2"]);
  assert.deepEqual(["p", "c1", "c2"].map(isArchivedThread), [false, false, true]);
});

const deferred = () => Promise.withResolvers();
const settle = () => new Promise((resolve) => setImmediate(resolve));
const input = [{ type: "text", text: "首条消息", text_elements: [] }, { type: "image", url: "data:image/png;base64,AAAA" }];
const meta = (id) => ({ id, preview: "", cwd: "D:/test", status: { type: "idle" }, source: "cli", ephemeral: false, parentThreadId: null });
const turn = (id = "turn-1", items = []) => ({ id, items, status: "inProgress", error: null });

test("restoring a conversation does not wait for the account refresh", async (t) => {
  const account = deferred();
  let resumed = false;
  let opened;
  sendingFixture(t, async (method) => {
    if (method === "initialize") return { userAgent: "codex/0.163.0" };
    if (method === "account/read") return account.promise;
    if (method === "thread/list") return { data: [meta("chat")], nextCursor: null };
    if (method === "thread/resume") { resumed = true; return { thread: meta("chat") }; }
    if (method === "config/read") return { config: {} };
    return { data: [], nextCursor: null };
  });
  t.mock.method(Rpc.prototype, "notify", () => {});
  t.mock.method(Rpc.prototype, "connect", function () {
    opened = this.handlers.open({ cwd: "D:/test", command: "fake" });
    return Promise.resolve();
  });
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ providers: [] }) }));
  connect();
  await settle();
  assert.equal(resumed, true);
  account.resolve({ account: null, requiresOpenaiAuth: false });
  await opened;
});

function sendingFixture(t, handler, git) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const thread = { ...emptyThreadState(meta("chat")), subscribed: true, loaded: true };
  setState({ threads: { chat: thread }, activeId: "chat", pendingMessages: {}, modes: [], conn: { status: "ready" } });
  setState((s) => ({ list: { ...s.list, archived: false, status: "active", ids: ["chat"] } }));
  let rpc;
  t.mock.method(Rpc.prototype, "request", function (method, params) {
    rpc = this;
    if (method === "command/exec") return Promise.resolve(git ? git(params) : { exitCode: 128, stdout: "", stderr: "not a git repository" });
    return handler(method, params);
  });
  return (method, params) => rpc.dispatch({ method, params });
}

test("new sessions discover Git without thread metadata and send a separate untrusted context", async (t) => {
  const cwd = "D:/git-new";
  let submitted;
  let probes = 0;
  const notify = sendingFixture(t, async (method, params) => {
    if (method === "thread/start") return { thread: { ...meta("git-new"), cwd, gitInfo: null } };
    if (method === "turn/start") { submitted = params; return { turn: turn() }; }
    return {};
  }, ({ command }) => {
    probes++;
    return { exitCode: 0, stdout: command.includes("status") ? `# branch.oid ${"a".repeat(40)}\0# branch.head feature\0? untracked\0` : "", stderr: "" };
  });
  setState((s) => ({ prefs: { ...s.prefs, cwd }, activeId: null }));
  await sendMessage(null, input);
  assert.equal(getState().threads["git-new"].meta.gitInfo.branch, "feature");
  assert.deepEqual(submitted.input, input);
  assert.equal(submitted.additionalContext["codex-ui.git"].kind, "untrusted");
  assert.equal(JSON.parse(submitted.additionalContext["codex-ui.git"].value).files, 1);
  assert.equal(probes, 3, "start and send share the same folder query");
  notify("thread/started", { thread: { ...meta("git-new"), cwd, gitInfo: null } });
  assert.equal(getState().threads["git-new"].meta.gitInfo.branch, "feature", "late metadata cannot clear live Git");
});

test("live Git replaces old session metadata and refreshes after a completed turn", async (t) => {
  const cwd = "D:/git-existing";
  let branch = "checked-out";
  const notify = sendingFixture(t, async () => ({}), ({ command }) => ({ exitCode: 0, stdout: command.includes("status") ? `# branch.oid ${"b".repeat(40)}\0# branch.head ${branch}\0` : "", stderr: "" }));
  setState({ threads: { chat: { ...emptyThreadState({ ...meta("chat"), cwd, gitInfo: { sha: null, branch: "old", originUrl: null } }), subscribed: true, loaded: true } } });
  await refreshThreadGit("chat");
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "checked-out");
  branch = "switched";
  notify("turn/completed", { threadId: "chat", turn: { ...turn(), status: "completed" } });
  await settle();
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "switched");
});

test("a late Git result is applied only to threads still using that working directory", async (t) => {
  const status = deferred();
  sendingFixture(t, async () => ({}), ({ cwd }) => cwd === "D:/git-before" ? status.promise : { exitCode: 0, stdout: "# branch.oid (initial)\0# branch.head right-folder\0", stderr: "" });
  setState({ threads: { chat: { ...emptyThreadState({ ...meta("chat"), cwd: "D:/git-before" }), subscribed: true, loaded: true } } });
  const reading = refreshThreadGit("chat");
  setState({ threads: { chat: { ...emptyThreadState({ ...meta("chat"), cwd: "D:/git-after" }), subscribed: true, loaded: true } } });
  status.resolve({ exitCode: 0, stdout: "# branch.oid (initial)\0# branch.head wrong-folder\0", stderr: "" });
  assert.equal((await reading).cwd, "D:/git-after");
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "right-folder");
});

test("temporary probe failure does not let stored metadata replace the last live branch", async (t) => {
  const cwd = "D:/git-failed-refresh";
  let failed = false;
  const old = { ...meta("chat"), cwd, gitInfo: { sha: null, branch: "historical", originUrl: null } };
  sendingFixture(t, async () => ({ data: [old], nextCursor: null }), ({ command }) => failed
    ? { exitCode: 128, stdout: "", stderr: "access denied" }
    : { exitCode: 0, stdout: command.includes("status") ? "# branch.oid (initial)\0# branch.head current\0" : "", stderr: "" });
  setState({ threads: { chat: emptyThreadState(old) } });
  await refreshThreadGit("chat");
  failed = true;
  assert.equal((await refreshThreadGit("chat", true)).state, "unavailable");
  await refreshThreads();
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "current");
});

test("a change during a pending probe forces a new read before publishing its result", async (t) => {
  const pending = deferred();
  let probes = 0;
  sendingFixture(t, async () => ({}), ({ command }) => {
    if (!command.includes("status")) return { exitCode: 1, stdout: "", stderr: "" };
    if (++probes === 1) return pending.promise;
    return { exitCode: 0, stdout: "# branch.oid (initial)\0# branch.head after-checkout\0", stderr: "" };
  });
  setState({ threads: { chat: emptyThreadState({ ...meta("chat"), cwd: "D:/git-pending-change" }) } });
  const first = refreshThreadGit("chat");
  const changed = refreshThreadGit("chat", true);
  pending.resolve({ exitCode: 0, stdout: "# branch.oid (initial)\0# branch.head before-checkout\0", stderr: "" });
  await Promise.all([first, changed]);
  assert.equal(probes, 2);
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "after-checkout");
});

test("a settings cwd change refreshes Git and late creation metadata cannot restore the old folder", async (t) => {
  const original = { ...meta("chat"), cwd: "D:/git-settings-A", gitInfo: null };
  const notify = sendingFixture(t, async () => ({}), ({ command, cwd }) => ({
    exitCode: 0, stdout: command.includes("status") ? `# branch.oid (initial)\0# branch.head ${cwd.endsWith("-A") ? "branch-A" : "branch-B"}\0` : "", stderr: "",
  }));
  setState({ threads: { chat: emptyThreadState(original) } });
  await refreshThreadGit("chat");
  notify("thread/settings/updated", { threadId: "chat", threadSettings: { cwd: "D:/git-settings-B" } });
  await settle();
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "branch-B");
  notify("thread/started", { thread: original });
  assert.equal(getState().threads.chat.meta.gitInfo.branch, "branch-B");
  assert.equal((await refreshThreadGit("chat")).cwd, "D:/git-settings-B");
});

test("first send is visible before thread/start or turn/start returns, then server echo replaces it", async (t) => {
  const starting = deferred();
  const submitting = deferred();
  let params;
  const notify = sendingFixture(t, async (method, value) => {
    if (method === "thread/start") return starting.promise;
    if (method === "turn/start") { params = value; return submitting.promise; }
    return {};
  });
  setState({ activeId: null });
  const sent = sendMessage(null, input);
  const pending = getState().pendingMessages[""];
  assert.deepEqual(pending.item.content, input);
  await assert.rejects(sendMessage(null, input), /上一条/);
  starting.resolve({ thread: meta("new-chat") });
  await settle();
  assert.equal(getState().pendingMessages[""], undefined);
  assert.equal(getState().pendingMessages["new-chat"].item.id, pending.item.id);
  assert.equal(params.clientUserMessageId, pending.item.id);
  submitting.resolve({ turn: turn() });
  await sent;
  assert.equal(getState().pendingMessages["new-chat"].accepted, true);
  const item = { ...pending.item, id: "server-item" };
  notify("item/completed", { threadId: "new-chat", turnId: "turn-1", completedAtMs: 1, item });
  notify("item/completed", { threadId: "new-chat", turnId: "turn-1", completedAtMs: 1, item });
  assert.equal(getState().pendingMessages["new-chat"], undefined);
  assert.equal(getState().threads["new-chat"].turns[0].items.length, 1);
});

test("an early server echo is not resurrected by the later turn/start response", async (t) => {
  const submitting = deferred();
  const notify = sendingFixture(t, () => submitting.promise);
  const sent = sendMessage("chat", input);
  const pending = getState().pendingMessages.chat;
  await settle();
  notify("item/started", { threadId: "chat", turnId: "turn-1", startedAtMs: 1, item: { ...pending.item, id: "server-item" } });
  assert.equal(getState().pendingMessages.chat, undefined);
  submitting.resolve({ turn: turn() });
  await sent;
  assert.equal(getState().pendingMessages.chat, undefined);
});

test("thread creation failure keeps the new-session input and retry moves it into the new thread", async (t) => {
  let attempts = 0;
  sendingFixture(t, async (method) => {
    if (method === "thread/start") {
      if (++attempts === 1) throw new Error("启动失败");
      return { thread: meta("retried-chat") };
    }
    if (method === "turn/start") return { turn: turn() };
    return {};
  });
  await assert.rejects(sendMessage(null, input), /启动失败/);
  assert.deepEqual(getState().pendingMessages[""].item.content, input);
  await retryPendingMessage(null);
  assert.equal(getState().pendingMessages[""], undefined);
  assert.deepEqual(getState().pendingMessages["retried-chat"].item.content, input);
});

test("retry never submits when history cannot be checked", async (t) => {
  let attempts = 0;
  sendingFixture(t, async (method) => {
    if (method === "turn/start") { attempts++; throw new Error("断线"); }
    if (method === "thread/resume") throw new Error("无法恢复会话");
    return {};
  });
  await assert.rejects(sendMessage("chat", input));
  await assert.rejects(retryPendingMessage("chat"), /无法恢复会话/);
  assert.equal(attempts, 1);
  assert.deepEqual(getState().pendingMessages.chat.item.content, input);
});

test("failure retains text and attachments; retry refreshes history and preserves client id", async (t) => {
  let attempts = 0;
  const clientIds = [];
  sendingFixture(t, async (method, params) => {
    if (method === "turn/start") {
      clientIds.push(params.clientUserMessageId);
      if (++attempts === 1) throw new Error("临时失败");
      return { turn: turn() };
    }
    if (method === "thread/resume") return { thread: meta("chat") };
    if (method === "thread/turns/list") return { data: [], nextCursor: null };
    return {};
  });
  await assert.rejects(sendMessage("chat", input), /临时失败/);
  assert.deepEqual(getState().pendingMessages.chat.item.content, input);
  assert.match(getState().pendingMessages.chat.error, /临时失败/);
  await Promise.all([retryPendingMessage("chat"), retryPendingMessage("chat")]);
  assert.equal(attempts, 2);
  assert.equal(clientIds[0], clientIds[1]);
  assert.equal(getState().pendingMessages.chat.error, undefined);
});

test("retry does not resend when reloaded history already contains the original message", async (t) => {
  let attempts = 0;
  let original;
  sendingFixture(t, async (method) => {
    if (method === "turn/start") { attempts++; throw new Error("断线"); }
    if (method === "thread/resume") return { thread: meta("chat") };
    if (method === "thread/turns/list") return { data: [{ ...turn("turn-1", [original]), status: "completed" }], nextCursor: null };
    return {};
  });
  await assert.rejects(sendMessage("chat", input));
  original = { ...getState().pendingMessages.chat.item, id: "server-item" };
  await retryPendingMessage("chat");
  assert.equal(attempts, 1);
  assert.equal(getState().pendingMessages.chat, undefined);
});

test("legacy echo matches only its returned turn, and an unaccepted ended turn retains input", async (t) => {
  const notify = sendingFixture(t, async () => ({ turn: turn() }));
  await sendMessage("chat", input);
  const item = { ...getState().pendingMessages.chat.item, id: "legacy", clientId: null };
  notify("item/completed", { threadId: "chat", turnId: "older", completedAtMs: 1, item });
  assert.ok(getState().pendingMessages.chat);
  notify("item/completed", { threadId: "chat", turnId: "turn-1", completedAtMs: 1, item });
  assert.equal(getState().pendingMessages.chat, undefined);
  setState({ threads: { chat: { ...emptyThreadState(meta("chat")), subscribed: true, loaded: true } } });
  await sendMessage("chat", input);
  notify("turn/completed", { threadId: "chat", turn: { ...turn(), status: "failed", error: { message: "Hook 拒绝" } } });
  assert.match(getState().pendingMessages.chat.error, /Hook 拒绝/);
  assert.deepEqual(getState().pendingMessages.chat.item.content, input);
});

test("a sub-agent its spawn cannot read yet (an empty rollout) joins the list on a later read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const parent = { id: "q", preview: "q", ephemeral: false, parentThreadId: null, source: "cli" };
  const child = { id: "s", preview: "", ephemeral: false, parentThreadId: null, source: { subAgent: { thread_spawn: { parent_thread_id: "q", depth: 1, agent_nickname: "Gauss" } } } };
  let rpc;
  let reads = 0;
  Rpc.prototype.request = async function (method) {
    rpc = this;
    if (method === "thread/list") return { data: [parent], nextCursor: null };
    if (method === "thread/read" && ++reads > 1) return { thread: child };
    throw new Error("failed to read session metadata: rollout at s.jsonl is empty");
  };
  setState((s) => ({ list: { ...s.list, status: "active", archived: false } }));
  await refreshThreads();

  rpc.dispatch({ method: "item/completed", params: { threadId: "q", turnId: "t", completedAtMs: 0, item: { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", receiverThreadIds: ["s"] } } });
  await settle();
  assert.equal(reads, 1);
  assert.deepEqual(getState().list.ids, ["q"]);

  t.mock.timers.tick(1000);
  await settle();
  assert.equal(reads, 2);
  assert.deepEqual(getState().list.ids, ["s", "q"]);
  assert.equal(getState().threads.s.meta.parentThreadId, "q");
});
