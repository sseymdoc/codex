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
const { shellTasks } = await import("./background.ts");
const { connect, isArchivedThread, refreshThreads, unarchiveThread, sendMessage, retryPendingMessage, refreshThreadGit, createProject, chooseProject, refreshProjects, startThread,
  refreshBackground,
  stopAgentTask,
  cleanBackground,
  terminateBackground,
  openThread, loadTurns, updateProject, } = await import("./codex.ts");

test("environment settings update native roots without changing the current workspace or selection", async (t) => {
  const original = { id: "settings-project", name: "before", roots: [{ path: "D:/source" }] };
  const project = { ...original, name: "环境", roots: [{ path: "D:/source" }, { path: "D:/shared" }] };
  const prefs = getState().prefs;
  setState({ projects: [original] });
  t.mock.method(Rpc.prototype, "request", async (method, params) => {
    assert.equal(method, "project/update");
    assert.deepEqual(params, { projectId: original.id, name: project.name, roots: project.roots });
    return { project };
  });
  await updateProject(original.id, "  环境  ", project.roots.map((root) => root.path));
  assert.deepEqual(getState().projects, [project]);
  assert.equal(getState().prefs, prefs);
});

test("invalid or failed environment updates preserve the project and workspace", async (t) => {
  const projects = getState().projects, prefs = getState().prefs;
  let calls = 0;
  t.mock.method(Rpc.prototype, "request", async () => { calls++; throw new Error("save failed"); });
  await assert.rejects(updateProject("settings-project", " ", ["D:/source"]), /名称/);
  await assert.rejects(updateProject("settings-project", "环境", []), /文件夹/);
  assert.equal(calls, 0);
  await assert.rejects(updateProject("settings-project", "环境", ["D:/source"]), /save failed/);
  assert.equal(getState().projects, projects);
  assert.equal(getState().prefs, prefs);
});

test("renaming a project leaves roots out of the native update", async (t) => {
  const project = { id: "settings-project", name: "renamed", roots: [{ path: "D:/kept" }] };
  t.mock.method(Rpc.prototype, "request", async (method, params) => {
    assert.equal(method, "project/update");
    assert.deepEqual(params, { projectId: project.id, name: project.name });
    return { project };
  });
  await updateProject(project.id, project.name);
  assert.deepEqual(getState().projects, [project]);
});

test("older servers reject environment settings without changing local projects", async (t) => {
  const { RpcError } = await import("./rpc.ts");
  const projects = getState().projects;
  t.mock.method(Rpc.prototype, "request", async () => { throw new RpcError("method not found", -32601); });
  await assert.rejects(updateProject("settings-project", "环境", ["D:/source"]), /不支持项目/);
  assert.equal(getState().projects, projects);
});

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
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ title: null }) }));
  const thread = { ...emptyThreadState(meta("chat")), subscribed: true, loaded: true };
  setState({ threads: { chat: thread }, activeId: "chat", pendingMessages: {}, modes: [], conn: { status: "ready" } });
  setState((s) => ({ list: { ...s.list, archived: false, status: "active", ids: ["chat"] } }));
  let rpc;
  t.mock.method(Rpc.prototype, "request", function (method, params) {
    rpc = this;
    if (method === "command/exec") return Promise.resolve(git ? git(params) : { exitCode: 128, stdout: "", stderr: "not a git repository" });
    return handler(method, params);
  });
  const notify = (method, params) => rpc.dispatch({ method, params });
  notify.close = () => rpc.handlers.close("closed", undefined, "exited");
  return notify;
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

test("turns ask for detailed reasoning summaries unless config.toml picks a level", async (t) => {
  const asked = [];
  sendingFixture(t, async (method, params) => {
    if (method === "turn/start") { asked.push(params.summary); return { turn: { ...turn(`turn-${asked.length}`), status: "completed" } }; }
    return {};
  });
  for (const [config, view] of [[{}, "normal"], [{ model_reasoning_summary: null }, "normal"], [{ model_reasoning_summary: "none" }, "normal"], [{ model_reasoning_summary: "none" }, "thinking"], [{ model_reasoning_summary: "concise" }, "thinking"]]) {
    setState((s) => ({ config, pendingMessages: {}, threads: { ...s.threads, chat: { ...s.threads.chat, view } } }));
    await sendMessage("chat", input);
  }
  assert.deepEqual(asked, ["detailed", "detailed", undefined, "auto", undefined]);
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

test("model output clears retry notices while background activity and other turns preserve them", async (t) => {
  const notify = sendingFixture(t, async () => ({ turn: turn() }));
  await sendMessage("chat", input);
  const error = { message: "Reconnecting... 1/5", codexErrorInfo: "rateLimitExceeded", additionalDetails: "HTTP 429" };
  const items = [
    { type: "agentMessage", id: "agent", text: "", phase: null },
    { type: "plan", id: "plan", text: "" },
    { type: "reasoning", id: "reasoning", summary: [], content: [] },
    { type: "commandExecution", id: "shell", aggregatedOutput: "", processId: null },
  ];
  setState((s) => ({ threads: { ...s.threads, chat: { ...s.threads.chat, turns: [turn("turn-1", items), { ...turn("other", items), retrying: error }] } } }));
  const live = () => getState().threads.chat.turns.find((x) => x.id === "turn-1");
  const retry = () => notify("error", { threadId: "chat", turnId: "turn-1", error, willRetry: true });
  retry();
  for (const [method, params] of [
    ["item/started", { item: { type: "userMessage", id: "echo", clientId: null, content: input }, startedAtMs: 1 }],
    ["item/commandExecution/outputDelta", { itemId: "shell", delta: "background output" }],
    ["item/mcpToolCall/progress", { itemId: "tool", message: "background progress" }],
    ["item/agentMessage/delta", { turnId: "other", itemId: "agent", delta: "other turn" }],
    ["item/agentMessage/delta", { threadId: "other-thread", itemId: "agent", delta: "other thread" }],
  ]) {
    notify(method, { threadId: "chat", turnId: "turn-1", ...params });
    assert.deepEqual(live().retrying, error, method);
  }
  const recovered = [
    ["item/agentMessage/delta", { itemId: "agent", delta: "recovered output" }],
    ["item/plan/delta", { itemId: "plan", delta: "recovered plan" }],
    ["item/reasoning/summaryPartAdded", { itemId: "reasoning", summaryIndex: 0 }],
    ["item/reasoning/summaryTextDelta", { itemId: "reasoning", summaryIndex: 0, delta: "recovered summary" }],
    ["item/reasoning/textDelta", { itemId: "reasoning", contentIndex: 0, delta: "recovered reasoning" }],
    ["item/fileChange/patchUpdated", { itemId: "patch", changes: [] }],
  ];
  for (const item of items.slice(0, 3)) {
    recovered.push(["item/started", { item, startedAtMs: 2 }], ["item/completed", { item, completedAtMs: 3 }]);
  }
  for (const [method, params] of recovered) {
    retry();
    assert.equal(live().status, "inProgress");
    notify(method, { threadId: "chat", turnId: "turn-1", ...params });
    assert.equal(live().retrying, null, `${method} ${params.item?.type ?? ""}`);
    assert.equal(live().error, null);
  }
  retry();
  notify("error", { threadId: "chat", turnId: "turn-1", error, willRetry: false });
  assert.equal(live().retrying, null);
  assert.deepEqual(live().error, error);
  retry();
  setState((s) => ({ threads: { chat: { ...s.threads.chat, turns: [live()] } } }));
  notify("turn/completed", { threadId: "chat", turn: { ...turn(), status: "completed" } });
  assert.equal(live().retrying, null);
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

test("background discovery backs off only while work runs, pages nested agents, and stops when they finish", async (t) => {
  let visible = false;
  let running = true;
  const cursors = [];
  const notify = sendingFixture(t, async (method, params) => {
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
                status: { type: running ? "active" : "idle", activeFlags: [] },
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
  const intervals = t.mock.method(globalThis, "setInterval");
  await refreshBackground("poll-parent");
  assert.equal(getState().threads.child, undefined);
  await openThread("poll-parent");
  await settle();
  assert.equal(getState().activeId, "poll-parent");
  assert.equal(getState().threads["poll-parent"].subscribed, true);
  t.mock.timers.tick(60_000);
  await settle();
  assert.deepEqual(cursors, [null, null], "an idle conversation needs no recurring discovery");
  notify("turn/started", { threadId: "poll-parent", turn: turn("live-parent") });
  await settle();
  const afterEvent = cursors.length;
  t.mock.timers.tick(999);
  await settle();
  assert.equal(cursors.length, afterEvent);
  visible = true;
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(cursors.slice(afterEvent), [null, "page2"]);
  assert.equal(getState().threads.child.meta.parentThreadId, "poll-parent");
  assert.equal(getState().threads.nested.meta.parentThreadId, "child");
  const afterFirst = cursors.length;
  t.mock.timers.tick(1999);
  await settle();
  assert.equal(cursors.length, afterFirst, "the next read backs off to two seconds");
  t.mock.timers.tick(1);
  await settle();
  assert.equal(cursors.length, afterFirst + 2);
  running = false;
  notify("turn/completed", { threadId: "poll-parent", turn: { ...turn("live-parent"), status: "completed" } });
  await settle();
  const afterCompletion = cursors.length;
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(cursors.length, afterCompletion);
  assert.equal(intervals.mock.callCount(), 0, "background reads never install a fixed interval");
});

test("read-only agent inspection keeps discovering nested tasks without a subscription", async (t) => {
  let visible = false;
  const notify = sendingFixture(t, async (method) => {
    if (method === "thread/resume") throw new Error("direct app-server input is not allowed for multi-agent v2 sub-agents");
    if (method === "thread/backgroundTerminals/list") assert.fail("an inspected agent has no terminal subscription");
    if (method === "thread/list") return { data: visible ? [{ ...meta("nested-inspected"), parentThreadId: "inspected" }] : [], nextCursor: null };
    return { data: [], nextCursor: null };
  });
  const child = { ...meta("inspected"), status: { type: "active", activeFlags: [] }, parentThreadId: "chat", source: { subAgent: { thread_spawn: { parent_thread_id: "chat", depth: 1 } } } };
  setState((s) => ({ threads: { ...s.threads, inspected: emptyThreadState(child) } }));
  await openThread("inspected");
  await settle();
  assert.equal(getState().threads.inspected.subscribed, false);
  assert.equal(getState().threads.inspected.loaded, true);
  visible = true;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(getState().threads["nested-inspected"].meta.parentThreadId, "inspected");
  notify("thread/closed", { threadId: "inspected" });
});

test("background refreshes merge slow reads, retain events during a read, and ignore unrelated sessions", async (t) => {
  const pending = deferred();
  let lists = 0;
  let terminals = 0;
  const notify = sendingFixture(t, async (method) => {
    if (method === "thread/list") {
      if (++lists === 1) return pending.promise;
      return { data: [{ ...meta("event-child"), parentThreadId: "chat", status: { type: "active", activeFlags: [] } }], nextCursor: null };
    }
    if (method === "thread/backgroundTerminals/list") { terminals++; return { data: [] }; }
    return { data: [], nextCursor: null };
  });
  const first = refreshBackground("chat");
  assert.equal(refreshBackground("chat"), first, "simultaneous reads share their result");
  notify("turn/started", { threadId: "chat", turn: turn("event-turn") });
  notify("turn/started", { threadId: "elsewhere", turn: turn() });
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, 1, "a slow read cannot overlap another read");
  assert.equal(terminals, 1);
  pending.resolve({ data: [], nextCursor: null });
  await first;
  await settle();
  assert.equal(lists, 2, "events during a read request one follow-up");
  assert.ok(getState().threads["event-child"]);
  setState({ activeId: null });
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, 2, "leaving the conversation cancels its pending read");
  notify("thread/closed", { threadId: "chat" });
});

test("a running child or terminal keeps discovery alive after its parent finishes", async (t) => {
  let childRuns = true;
  let shellRuns = false;
  let lists = 0;
  const notify = sendingFixture(t, async (method) => {
    if (method === "thread/list") {
      lists++;
      return { data: [{ ...meta("remaining-child"), parentThreadId: "chat", status: { type: childRuns ? "active" : "idle", activeFlags: [] } }], nextCursor: null };
    }
    if (method === "thread/backgroundTerminals/list") return { data: shellRuns ? [{ itemId: "cmd", processId: "shell", command: "long process" }] : [] };
    return { data: [], nextCursor: null };
  });
  await refreshBackground("chat");
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(lists, 2);
  childRuns = false;
  shellRuns = true;
  notify("thread/status/changed", { threadId: "remaining-child", status: { type: "idle" } });
  await settle();
  const shellOnly = lists;
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(lists, shellOnly + 1, "a shell alone also keeps checks running");
  shellRuns = false;
  setState((s) => ({ threads: { ...s.threads, chat: { ...s.threads.chat, turns: [{ ...turn("shell-turn"), status: "completed" }] } } }));
  const completed = { type: "commandExecution", id: "cmd", processId: "shell", command: "long process", source: "unifiedExecStartup", status: "completed", aggregatedOutput: "shell finished", exitCode: 0, durationMs: 2000 };
  notify("item/completed", { threadId: "chat", turnId: "shell-turn", completedAtMs: 2, item: completed });
  await settle();
  const ended = lists;
  assert.equal(getState().threads.chat.background.length, 0);
  assert.equal(shellTasks(getState().threads.chat)[0].status, "completed");
  assert.equal(shellTasks(getState().threads.chat)[0].output, "shell finished");
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, ended, "finished descendants and shells no longer cause reads");
});

test("shell history is recovered from persisted turns without a live terminal subscription", async (t) => {
  const completed = { type: "commandExecution", id: "historical-shell", processId: "old-process", command: "cargo check", source: "unifiedExecStartup", status: "failed", aggregatedOutput: "build error", exitCode: 1, durationMs: 3210 };
  sendingFixture(t, async (method) => {
    if (method === "thread/turns/list") return { data: [{ ...turn("old-turn", [completed]), status: "completed" }], nextCursor: null };
    return { data: [], nextCursor: null };
  });
  setState((s) => ({ threads: { chat: { ...s.threads.chat, subscribed: false, turns: [], timing: {}, background: [] } } }));
  await loadTurns("chat", false);
  await refreshBackground("chat");
  const [task] = shellTasks(getState().threads.chat);
  assert.equal(task.status, "failed");
  assert.equal(task.command, "cargo check");
  assert.equal(task.output, "build error");
  assert.equal(task.durationMs, 3210);
  assert.equal(task.exitCode, 1);
});

test("hidden pages and disconnected clients stop background reads until a new refresh", async (t) => {
  let lists = 0;
  sendingFixture(t, async (method) => {
    if (method === "thread/list") { lists++; return { data: [], nextCursor: null }; }
    return { data: [] };
  });
  globalThis.document = { visibilityState: "visible" };
  t.after(() => { delete globalThis.document; });
  setState((s) => ({ threads: { chat: { ...s.threads.chat, turns: [turn()] } } }));
  await refreshBackground("chat");
  document.visibilityState = "hidden";
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, 1);
  document.visibilityState = "visible";
  await refreshBackground("chat");
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(lists, 3, "a visible running conversation can resume demand checks");
  t.mock.method(Rpc.prototype, "connect", function () { this.handlers.close("fixture ended", undefined, "fatal"); return Promise.resolve(); });
  connect();
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, 3);
});

test("shell read failures retain running tasks and a stop during a read waits for fresh state", async (t) => {
  const pending = deferred();
  let reads = 0;
  let fail = true;
  sendingFixture(t, async (method) => {
    if (method === "thread/list") return { data: [], nextCursor: null };
    if (method === "thread/backgroundTerminals/list") {
      reads++;
      if (fail) throw new Error("temporary read failure");
      return reads === 2 ? pending.promise : { data: [] };
    }
    return {};
  });
  const shell = { itemId: "cmd", processId: "shell", command: "long process" };
  setState((s) => ({ threads: { chat: { ...s.threads.chat, background: [shell] } } }));
  await refreshBackground("chat");
  assert.equal(getState().threads.chat.background.length, 1);
  fail = false;
  t.mock.timers.tick(1000);
  await settle();
  const stopping = terminateBackground("chat", "shell");
  await settle();
  pending.resolve({ data: [shell] });
  await stopping;
  assert.equal(getState().threads.chat.background.length, 0, "an earlier snapshot cannot undo stopping a shell");
  assert.equal(reads, 3);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(reads, 3);
});

test("closing a thread during a read cannot restore its shells or restart background checks", async (t) => {
  const pending = deferred();
  let lists = 0;
  const notify = sendingFixture(t, async (method) => {
    if (method === "thread/list") { lists++; return { data: [], nextCursor: null }; }
    if (method === "thread/backgroundTerminals/list") return pending.promise;
    return {};
  });
  setState((s) => ({ threads: { chat: { ...s.threads.chat, meta: { ...meta("chat"), status: { type: "active", activeFlags: [] } } } } }));
  const reading = refreshBackground("chat");
  notify("thread/closed", { threadId: "chat" });
  pending.resolve({ data: [{ itemId: "cmd", processId: "shell", command: "long process" }] });
  await reading;
  assert.deepEqual(getState().threads.chat.background, []);
  t.mock.timers.tick(60_000);
  await settle();
  assert.equal(lists, 1);
});

test("old descendants read only their latest turn status, cache it by update time, and leave transcripts unloaded", async (t) => {
  const history = [];
  let updatedAt = 1;
  let fail = true;
  sendingFixture(t, async (method, params) => {
    if (method === "thread/list") return { data: ["done", "stopped", "failed", "unreadable", "active"].map((id) => ({ ...meta(id), parentThreadId: "chat", updatedAt, status: { type: id === "active" ? "active" : "notLoaded" } })), nextCursor: null };
    if (method === "thread/turns/list") {
      history.push(params.threadId);
      assert.equal(params.limit, 1);
      assert.equal(params.itemsView, "notLoaded");
      assert.equal(params.sortDirection, "desc");
      if (params.threadId === "unreadable" && fail) throw new Error("rollout unavailable");
      return { data: [{ ...turn(), status: params.threadId === "stopped" ? "interrupted" : params.threadId === "failed" ? "failed" : "completed" }], nextCursor: null };
    }
    assert.notEqual(method, "thread/resume");
    return { data: [] };
  });
  await refreshBackground("chat");
  assert.deepEqual(history, ["done", "stopped", "failed", "unreadable"]);
  assert.equal(getState().threads.done.agentTurn.status, "completed");
  assert.equal(getState().threads.stopped.agentTurn.status, "interrupted");
  assert.equal(getState().threads.failed.agentTurn.status, "failed");
  assert.equal(getState().threads.unreadable.agentTurn, undefined);
  assert.deepEqual(getState().threads.done.turns, []);
  assert.equal(getState().threads.done.loaded, false);
  assert.equal(getState().threads.done.subscribed, false);
  fail = false;
  await refreshBackground("chat");
  assert.deepEqual(history.slice(4), ["unreadable"], "failed reads can retry without refetching settled agents");
  updatedAt = 2;
  await refreshBackground("chat");
  assert.equal(history.length, 9);
  assert.equal(getState().threads.done.agentTurn.updatedAt, 2);
});

test("loading an old history page discovers wait-only agents by id without replaying live notifications", async (t) => {
  const calls = [];
  const child = { ...meta("historic-child"), parentThreadId: null, updatedAt: 7, status: { type: "notLoaded" }, source: { subAgent: { thread_spawn: { parent_thread_id: "chat", agent_nickname: "Gauss", depth: 1 } } } };
  sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: child };
    if (method === "thread/turns/list") return { data: params.threadId === "chat" ? [{ ...turn(), status: "completed", items: [{ type: "collabAgentToolCall", id: "wait", tool: "wait", receiverThreadIds: ["historic-child"], agentsStates: { "historic-child": { status: "completed", message: null } } }] }] : [{ ...turn(), status: "completed" }], nextCursor: null };
    assert.fail(`unexpected ${method}`);
  });
  await loadTurns("chat", false);
  await settle();
  assert.equal(getState().threads["historic-child"].meta.parentThreadId, "chat");
  assert.equal(getState().threads["historic-child"].meta.agentNickname, "Gauss");
  assert.equal(getState().threads["historic-child"].agentTurn.status, "completed");
  assert.ok(getState().list.ids.includes("historic-child"));
  assert.deepEqual(calls.map((c) => c.method), ["thread/turns/list", "thread/read", "thread/turns/list"]);
});

test("historical discoveries stay archived with their parent", async (t) => {
  const parent = { ...meta("archived-parent"), status: { type: "notLoaded" } };
  const child = { ...meta("archived-child"), updatedAt: 1, source: { subAgent: { thread_spawn: { parent_thread_id: parent.id, depth: 1 } } }, status: { type: "notLoaded" } };
  sendingFixture(t, async (method, params) => {
    if (method === "thread/list") return { data: [parent], nextCursor: null };
    if (method === "thread/read") return { thread: child };
    if (method === "thread/turns/list") return { data: [{ ...turn(), status: "completed", items: params.threadId === parent.id ? [{ type: "subAgentActivity", id: "old-report", kind: "completed", agentThreadId: child.id, agentPath: "/root/old" }] : [] }], nextCursor: null };
    assert.fail(`unexpected ${method}`);
  });
  setState((s) => ({ list: { ...s.list, status: "archived", archived: true } }));
  await refreshThreads();
  await loadTurns(parent.id, false);
  await settle();
  assert.equal(isArchivedThread(child.id), true);
  assert.ok(getState().list.ids.includes(child.id));
  assert.equal(getState().threads[child.id].agentTurn.status, "completed");
});

test("a late history read cannot classify an agent that became active or changed while reading", async (t) => {
  const pending = deferred();
  const notify = sendingFixture(t, async (method) => {
    if (method === "thread/list") return { data: [{ ...meta("racing-child"), parentThreadId: "chat", updatedAt: 1, status: { type: "notLoaded" } }], nextCursor: null };
    if (method === "thread/turns/list") return pending.promise;
    return { data: [] };
  });
  const refresh = refreshBackground("chat");
  await settle();
  notify("thread/status/changed", { threadId: "racing-child", status: { type: "active", activeFlags: [] } });
  pending.resolve({ data: [{ ...turn(), status: "completed" }], nextCursor: null });
  await refresh;
  assert.equal(getState().threads["racing-child"].agentTurn, undefined);
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

test("stop all on a child only interrupts its descendants despite messages and inherited history", async (t) => {
  const calls = [];
  const parents = { chat: null, child: "chat", sibling: "chat", nested: "child", unrelated: "sibling" };
  const threads = Object.fromEntries(Object.entries(parents).map(([id, parentThreadId]) => [id, emptyThreadState({
    ...meta(id), parentThreadId, status: { type: "active", activeFlags: [] },
  })]));
  sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/read") return { thread: { ...threads[params.threadId].meta, status: { type: "idle" } } };
    if (method === "thread/turns/list") return { data: [{ ...turn("stopped"), status: "interrupted" }], nextCursor: null };
    return { data: [], nextCursor: null };
  });
  const call = (id, tool, senderThreadId, receiver) => ({ type: "collabAgentToolCall", id, tool, senderThreadId, receiverThreadIds: [receiver], agentsStates: {} });
  threads.child.turns = [turn("child-turn", [
    call("reply", "sendMessage", "child", "chat"),
    call("peer", "wait", "child", "sibling"),
    call("inherited", "spawnAgent", "chat", "sibling"),
  ])];
  setState({ threads });
  await cleanBackground("child");
  assert.deepEqual(calls.filter((call) => call.method === "turn/interrupt").map((call) => call.params.threadId), ["nested"]);
  assert.equal(calls.some((call) => call.method === "thread/backgroundTerminals/clean"), false);
});

test("title generation uses a dedicated endpoint without naming turns on the main connection", async (t) => {
  const calls = [], requests = [];
  sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: meta("fresh"), model: "test-model" };
    return method === "turn/start" ? { turn: turn() } : {};
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ title: "消息发送" }) };
  });
  await sendMessage(null, input);
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/title");
  assert.equal(JSON.parse(requests[0].options.body).description, "首条消息");
  assert.equal(calls.filter((c) => c.method === "thread/start").length, 1, "only the new conversation starts on the main connection");
  assert.equal(calls.filter((c) => c.method === "turn/start").length, 1);
  assert.equal(getState().threads.fresh.meta.name, "消息发送");
  assert.deepEqual(getState().list.ids, ["fresh", "chat"]);
  assert.ok(calls.some((c) => c.method === "thread/name/set" && c.params.threadId === "fresh" && c.params.name === "消息发送"));
});

test("late title responses preserve manual names and disconnect cancels pending naming", async (t) => {
  const calls = [];
  let starts = 0;
  const notify = sendingFixture(t, async (method, params) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: meta(starts++ === 0 ? "new" : "cancel"), model: "test-model" };
    return method === "turn/start" ? { turn: turn() } : {};
  });
  const pending = deferred();
  t.mock.method(globalThis, "fetch", () => pending.promise);
  await sendMessage(null, input);
  notify("thread/name/updated", { threadId: "new", threadName: "手动标题" });
  pending.resolve({ ok: true, json: async () => ({ title: "自动标题" }) });
  await settle();
  assert.equal(getState().threads.new.meta.name, "手动标题");
  assert.equal(calls.some((c) => c.method === "thread/name/set"), false);
  let signal;
  t.mock.method(globalThis, "fetch", (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
  }));
  await sendMessage(null, input);
  await settle();
  assert.equal(signal.aborted, false);
  notify.close();
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(calls.some((c) => c.method === "thread/name/set"), false);
});

test("old unnamed conversations are never renamed when sent to or restored", async (t) => {
  const requests = [];
  sendingFixture(t, async (method, params) => {
    if (method === "turn/start") return { turn: turn() };
    if (method === "thread/resume") return { thread: { ...meta(params.threadId), preview: "首条消息" } };
    return { data: [] };
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ title: "不应调用" }) };
  });
  setState((s) => ({ threads: { chat: { ...s.threads.chat, meta: { ...meta("chat"), name: "已有标题" } } } }));
  await sendMessage("chat", input);
  assert.equal(requests.length, 0);
  setState((s) => ({ pendingMessages: {}, threads: { chat: { ...s.threads.chat, meta: meta("chat"), turns: [] } } }));
  await sendMessage("chat", input);
  await settle();
  assert.equal(getState().threads.chat.meta.name, undefined);
  assert.equal(getState().threads.chat.meta.preview, "首条消息");
  setState((s) => ({ threads: { chat: { ...s.threads.chat, subscribed: false, loaded: false } } }));
  await openThread("chat");
  await settle();
  assert.equal(getState().threads.chat.meta.name, undefined);
  assert.equal(requests.length, 0, "sending to or restoring an old unnamed conversation never triggers naming");
});

test("tool permissions write quoted config paths: blocked tools in disabled_tools, the rest an approval mode and the allow-list", async (t) => {
  const { setAppToolPermission, setMcpToolPermission } = await import("./codex.ts");
  const writes = [];
  t.mock.method(Rpc.prototype, "request", async (method, params) => {
    if (method === "config/batchWrite") writes.push(params.edits);
    if (method === "config/read") return { config: getState().config };
    return {};
  });
  setState({ mcp: null, config: { mcp_servers: { "my.server": { url: "https://mcp.example.com/mcp", disabled_tools: ["a"], enabled_tools: ["a", "b"] } } } });
  await setMcpToolPermission("my.server", null, ["a", "c"], "allow");
  await setMcpToolPermission("notes", "notes@market", ["x"], "blocked");
  await setAppToolPermission('git"hub', ["merge"], "ask");
  assert.deepEqual(writes, [
    [
      { keyPath: 'mcp_servers."my.server".disabled_tools', value: [], mergeStrategy: "replace" },
      { keyPath: 'mcp_servers."my.server".enabled_tools', value: ["a", "b", "c"], mergeStrategy: "replace" },
      { keyPath: 'mcp_servers."my.server".tools', value: { a: { approval_mode: "approve" }, c: { approval_mode: "approve" } }, mergeStrategy: "upsert" },
    ],
    [{ keyPath: 'plugins."notes@market".mcp_servers."notes".disabled_tools', value: ["x"], mergeStrategy: "replace" }],
    [{ keyPath: 'apps."git\\"hub".tools', value: { merge: { enabled: true, approval_mode: "prompt" } }, mergeStrategy: "upsert" }],
  ]);
});
