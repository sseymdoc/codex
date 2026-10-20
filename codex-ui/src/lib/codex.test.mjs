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
const { connect, isArchivedThread, refreshThreads, unarchiveThread, sendMessage, retryPendingMessage, refreshThreadGit, createProject, chooseProject, refreshProjects, startThread,
  refreshBackground,
  stopAgentTask,
  cleanBackground,
  openThread, } = await import("./codex.ts");

test("named environments use desktop projects and remain unique when the change notification arrives first", async (t) => {
  const project = { id: "project-new", name: "中文环境", roots: [{ path: "D:/source" }, { path: "D:/shared" }] };
  let submitted;
  t.mock.method(Rpc.prototype, "request", async (method, params) => {
    assert.equal(method, "project/create");
    submitted = params;
    setState({ projects: [project] }); // project/changed can refresh the list before the response.
    return { project };
  });
  setState({ projects: [] });
  const key = crypto.randomUUID();
  assert.equal(await createProject("  中文环境  ", ["D:/source", "D:/shared"], key), project);
  assert.equal(submitted.name, "中文环境");
  assert.deepEqual(submitted.roots, project.roots);
  assert.equal(submitted.idempotencyKey, key);
  assert.deepEqual(getState().projects, [project]);
});

test("empty environments do not reach project/create and failed creation preserves the workspace", async (t) => {
  const before = getState().prefs;
  t.mock.method(Rpc.prototype, "request", async () => { throw new Error("server failed"); });
  await assert.rejects(createProject(" ", ["D:/source"]), /名称/);
  await assert.rejects(createProject("环境", []), /文件夹/);
  await assert.rejects(createProject("环境", ["D:/source"]), /server failed/);
  assert.equal(getState().prefs, before);
});

test("choosing an environment refreshes folder settings and assigns its ID to the next session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const project = { id: "desktop-project", name: "桌面项目", roots: [{ path: "D:/environment" }] };
  const calls = [];
  t.mock.method(Rpc.prototype, "request", async (method, params) => {
    calls.push({ method, params });
    if (method === "config/read") return { config: {} };
    if (method === "permissionProfile/list") return { data: [] };
    if (method === "thread/start") return { thread: meta("environment-chat") };
    if (method === "command/exec") return { exitCode: 128, stdout: "", stderr: "not a git repository" };
    return {};
  });
  setState({ projects: [project] });
  chooseProject(project.id);
  await settle();
  assert.equal(getState().prefs.cwd, "D:/environment");
  assert.equal(getState().prefs.projectId, project.id);
  assert.ok(calls.some(({ method, params }) => method === "config/read" && params.cwd === "D:/environment"));
  assert.ok(calls.some(({ method, params }) => method === "permissionProfile/list" && params.cwd === "D:/environment"));
  await startThread();
  assert.equal(calls.find(({ method }) => method === "thread/start").params.projectId, project.id);
  setState((s) => ({ projects: [], prefs: { ...s.prefs, projectId: null } }));
});

test("servers without projects leave the environment uncreated", async (t) => {
  const { RpcError } = await import("./rpc.ts");
  const before = getState().projects;
  t.mock.method(Rpc.prototype, "request", async () => { throw new RpcError("method not found", -32601); });
  assert.equal(await createProject("环境", ["D:/source"]), null);
  assert.equal(getState().projects, before);
});

test("failed project refresh keeps the selection; external deletion clears only its ID", async (t) => {
  let failed = true;
  t.mock.method(Rpc.prototype, "request", async () => {
    if (failed) throw new Error("temporarily unavailable");
    return { data: [] };
  });
  setState((s) => ({ prefs: { ...s.prefs, projectId: "removed-in-desktop", cwd: "D:/kept" } }));
  await refreshProjects();
  assert.equal(getState().prefs.projectId, "removed-in-desktop");
  failed = false;
  await refreshProjects();
  assert.equal(getState().prefs.projectId, null);
  assert.equal(getState().prefs.cwd, "D:/kept");
});

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

test("background discovery pages lineage without spawn items and polls even when no terminal runs", async (t) => {
  let visible = false;
  const cursors = [];
  sendingFixture(t, async (method, params) => {
    if (method === "thread/list") {
      assert.equal(params.ancestorThreadId, "poll-parent");
      assert.equal(params.useStateDbOnly, true);
      cursors.push(params.cursor);
      return visible
        ? {
            data: [
              {
                ...meta(params.cursor ? "nested" : "child"),
                parentThreadId: params.cursor ? "child" : "poll-parent",
                status: { type: "active", activeFlags: [] },
              },
            ],
            nextCursor: params.cursor ? null : "page2",
          }
        : { data: [], nextCursor: null };
    }
    if (method === "thread/backgroundTerminals/list") return { data: [] };
    return {};
  });
  setState((s) => ({
    threads: {
      "poll-parent": { ...s.threads.chat, meta: meta("poll-parent") },
    },
    activeId: "poll-parent",
  }));
  await refreshBackground("poll-parent");
  assert.equal(getState().threads.child, undefined);
  const intervals = t.mock.method(globalThis, "setInterval");
  await openThread("poll-parent");
  assert.equal(getState().activeId, "poll-parent");
  assert.equal(getState().threads["poll-parent"].subscribed, true);
  assert.equal(intervals.mock.callCount(), 1);
  visible = true;
  const [poll, delay] = intervals.mock.calls[0].arguments;
  assert.equal(delay, 5000);
  poll();
  await settle();
  assert.deepEqual(cursors, [null, null, "page2"]);
  assert.equal(getState().threads.child.meta.parentThreadId, "poll-parent");
  assert.equal(getState().threads.nested.meta.parentThreadId, "child");
});

test("read-only agent inspection keeps discovering nested tasks without a subscription", async (t) => {
  let visible = false;
  sendingFixture(t, async (method) => {
    if (method === "thread/resume") throw new Error("direct app-server input is not allowed for multi-agent v2 sub-agents");
    if (method === "thread/backgroundTerminals/list") assert.fail("an inspected agent has no terminal subscription");
    if (method === "thread/list") return { data: visible ? [{ ...meta("nested-inspected"), parentThreadId: "inspected" }] : [], nextCursor: null };
    return { data: [], nextCursor: null };
  });
  const child = { ...meta("inspected"), parentThreadId: "chat", source: { subAgent: { thread_spawn: { parent_thread_id: "chat", depth: 1 } } } };
  setState((s) => ({ threads: { ...s.threads, inspected: emptyThreadState(child) } }));
  const intervals = t.mock.method(globalThis, "setInterval");
  await openThread("inspected");
  assert.equal(getState().threads.inspected.subscribed, false);
  assert.equal(getState().threads.inspected.loaded, true);
  visible = true;
  const [poll] = intervals.mock.calls.at(-1).arguments;
  poll();
  await settle();
  assert.equal(getState().threads["nested-inspected"].meta.parentThreadId, "inspected");
});

test("stopping an agent interrupts its own startup or turn, never resumes it or terminates a shell", async (t) => {
  const calls = [];
  sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { ...meta("child"), parentThreadId: "chat" } };
    if (method === "thread/turns/list")
      return {
        data: [{ ...turn("child-turn"), status: "interrupted" }],
        nextCursor: null,
      };
    return {};
  });
  setState((s) => ({
    threads: {
      ...s.threads,
      child: emptyThreadState({
        ...meta("child"),
        parentThreadId: "chat",
        status: { type: "active", activeFlags: [] },
      }),
    },
  }));
  await stopAgentTask("child");
  assert.deepEqual(
    calls.map((c) => c.method),
    ["turn/interrupt", "thread/read", "thread/turns/list"],
  );
  assert.deepEqual(calls[0].params, { threadId: "child", turnId: "" });
  assert.equal(getState().threads.child.meta.status.type, "idle");
  assert.equal(getState().threads.child.turns.at(-1).status, "interrupted");
  setState((s) => ({
    threads: {
      ...s.threads,
      child: { ...s.threads.child, turns: [turn("child-turn")] },
    },
  }));
  await stopAgentTask("child");
  assert.deepEqual(calls[3].params, {
    threadId: "child",
    turnId: "child-turn",
  });
});

test("stop all includes agents and shells, reports failures and still attempts every task", async (t) => {
  const calls = [];
  sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/backgroundTerminals/clean") throw new Error("shell failed");
    if (method === "thread/read") return { thread: { ...meta("child"), parentThreadId: "chat" } };
    return { data: [], nextCursor: null };
  });
  setState((s) => ({
    threads: {
      ...s.threads,
      chat: {
        ...s.threads.chat,
        background: [{ itemId: "cmd", processId: "123", command: "test" }],
      },
      child: emptyThreadState({
        ...meta("child"),
        parentThreadId: "chat",
        status: { type: "active", activeFlags: [] },
      }),
    },
  }));
  await assert.rejects(cleanBackground("chat"), /shell failed/);
  assert.ok(calls.some((c) => c.method === "turn/interrupt" && c.params.threadId === "child"));
  assert.ok(calls.some((c) => c.method === "thread/backgroundTerminals/clean" && c.params.threadId === "chat"));
});

test("short title generation stays out of the conversation and saves only a validated title", async (t) => {
  const calls = [];
  const notify = sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { ...meta("title-job"), ephemeral: true } };
    if (method === "turn/start") return { turn: turn(params.threadId === "chat" ? "main-turn" : "title-turn") };
    return {};
  });
  setState({ config: { mcp_servers: { external: { command: "fixture" } } }, mcp: [{ name: "codex_ui_browser" }] });
  await sendMessage("chat", input);
  await settle();
  const start = calls.find((c) => c.method === "thread/start");
  assert.equal(start?.params.ephemeral, true);
  assert.equal(start.params.sandbox, "read-only");
  assert.equal(start.params.approvalPolicy, "never");
  assert.equal(start.params.config.mcp_servers, undefined, "do not replace MCP transport configuration");
  assert.equal(start.params.config["mcp_servers.codex_ui_browser.enabled"], false);
  assert.equal(start.params.config["mcp_servers.external.enabled"], false);
  const naming = calls.find((c) => c.method === "turn/start" && c.params.threadId === "title-job");
  assert.equal(JSON.parse(naming.params.input[0].text), "首条消息");
  assert.deepEqual(getState().list.ids, ["chat"]);
  notify("thread/started", { thread: { ...meta("title-job"), ephemeral: true } });
  notify("item/completed", {
    threadId: "title-job",
    turnId: "title-turn",
    item: { type: "agentMessage", id: "title-answer", text: "<title>消息发送</title>", phase: "final_answer" },
  });
  notify("turn/completed", { threadId: "title-job", turn: { ...turn("title-turn"), status: "completed" } });
  await settle();
  assert.equal(getState().threads.chat.meta.name, "消息发送");
  assert.equal(getState().threads["title-job"], undefined);
  assert.ok(calls.some((c) => c.method === "thread/name/set" && c.params.threadId === "chat" && c.params.name === "消息发送"));
  assert.ok(calls.some((c) => c.method === "thread/unsubscribe" && c.params.threadId === "title-job"));
});

test("late automatic titles cannot replace manual names and timeouts stop the hidden turn", async (t) => {
  const calls = [];
  const notify = sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { ...meta("title-race-job"), ephemeral: true } };
    if (method === "turn/start") return { turn: turn() };
    return {};
  });
  setState((s) => ({ threads: { "title-race": { ...s.threads.chat, meta: meta("title-race") } }, activeId: "title-race" }));
  await sendMessage("title-race", input);
  await settle();
  assert.ok(calls.some((c) => c.method === "thread/start"));
  notify("thread/name/updated", { threadId: "title-race", threadName: "我的手动标题" });
  notify("item/completed", { threadId: "title-race-job", turnId: "turn-1", item: { type: "agentMessage", id: "answer", text: "<title>自动标题</title>" } });
  notify("turn/completed", { threadId: "title-race-job", turn: { ...turn(), status: "completed" } });
  await settle();
  assert.equal(getState().threads["title-race"].meta.name, "我的手动标题");
  assert.equal(
    calls.some((c) => c.method === "thread/name/set"),
    false,
  );
  setState((s) => ({ threads: { timeout: { ...s.threads["title-race"], meta: meta("timeout"), turns: [] } }, activeId: "timeout" }));
  await sendMessage("timeout", input);
  await settle();
  t.mock.timers.tick(30_000);
  await settle();
  assert.ok(calls.some((c) => c.method === "turn/interrupt" && c.params.threadId === "title-race-job"));
  assert.equal(getState().threads.timeout.meta.name, undefined);
  assert.equal(
    calls.some((c) => c.method === "thread/name/set"),
    false,
  );
});


test("naming respects existing titles, rejects invalid answers and never sends input to a non-ephemeral thread", async (t) => {
  const calls = [];
  let ephemeral = false;
  const notify = sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { ...meta("validated-title-job"), ephemeral } };
    if (method === "turn/start") return { turn: turn() };
    return {};
  });
  setState((s) => ({ threads: { saved: { ...s.threads.chat, meta: { ...meta("saved"), name: "已有标题" } } }, activeId: "saved" }));
  await sendMessage("saved", input);
  assert.equal(calls.some((c) => c.method === "thread/start"), false);
  setState((s) => ({ threads: { legacy: { ...s.threads.saved, meta: meta("legacy"), turns: [] } }, activeId: "legacy" }));
  await sendMessage("legacy", input);
  await settle();
  assert.equal(calls.some((c) => c.method === "turn/start" && c.params.threadId === "validated-title-job"), false);
  assert.equal(calls.some((c) => c.method === "turn/interrupt"), false);
  ephemeral = true;
  setState((s) => ({ threads: { invalid: { ...s.threads.legacy, meta: meta("invalid"), turns: [] } }, activeId: "invalid" }));
  await sendMessage("invalid", input);
  await settle();
  notify("item/completed", { threadId: "validated-title-job", turnId: "turn-1", item: { type: "agentMessage", id: "answer", text: `<title>${"字".repeat(201)}</title>` } });
  notify("turn/completed", { threadId: "validated-title-job", turn: { ...turn(), status: "completed" } });
  await settle();
  assert.equal(calls.some((c) => c.method === "thread/name/set"), false);
  assert.equal(getState().threads.invalid.meta.preview, "首条消息");
});
