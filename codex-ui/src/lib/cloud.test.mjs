// Run with `pnpm test`. cloud.ts against a fake /wham behind a fake bridge: fetch answers
// /api/cloud as server/bridge.mjs does ({ status, body }), and "./codex" is a stub, so no
// app-server, login or network is involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

const applied = [];
globalThis.__cloudCodexStub = {
  connectionId: () => "conn-1",
  callExperimental: async (method, params) => void applied.push({ method, params }),
  errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
};
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__cloudCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && context.parentURL?.endsWith("/cloud.ts")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const cloud = await import("./cloud.ts");

/** A fake /wham: `routes` maps "METHOD path" to a body or (body) => [status, body]; every call is logged. */
function wham(t, routes) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    calls.push({ method, path, body });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not found" }] : typeof route === "function" ? route(body) : [200, route];
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const ENV = {
  id: "env-1",
  label: "web",
  repos: ["github-7"],
  repo_map: { "github-7": { repository_full_name: "me/web", default_branch: "trunk" } },
};

test("environments read their repository and default branch; a failure is kept, not thrown", async (t) => {
  wham(t, { "GET /wham/environments": [ENV, { id: "env-2" }, { label: "no id" }] });
  await cloud.refreshCloudEnvironments();
  assert.deepEqual(cloud.cloudState().environments, [
    { id: "env-1", label: "web", repo: "github-7", repoName: "me/web", defaultBranch: "trunk" },
    { id: "env-2", label: "env-2", repo: null, repoName: null, defaultBranch: null },
  ]);
  t.mock.restoreAll();
  wham(t, { "GET /wham/environments": () => [403, { detail: { message: "forbidden" } }] });
  await cloud.refreshCloudEnvironments();
  assert.match(cloud.cloudState().environmentsError, /403.*forbidden/);
  assert.equal(cloud.cloudState().environments.length, 2);
});

test("network levels map both ways onto agent_network_access", async (t) => {
  assert.deepEqual(cloud.networkOf(undefined), { network: "none", domains: [], packages: false });
  assert.deepEqual(cloud.networkOf({ mode: "off", preset_allowlist: "all" }), { network: "none", domains: [], packages: false });
  assert.deepEqual(cloud.networkOf({ mode: "on" }), { network: "full", domains: [], packages: false });
  assert.deepEqual(cloud.networkOf({ mode: "on", preset_allowlist: "all" }), { network: "full", domains: [], packages: false });
  assert.deepEqual(cloud.networkOf({ mode: "on", preset_allowlist: "codex" }), { network: "trusted", domains: [], packages: false });
  assert.deepEqual(cloud.networkOf({ mode: "on", preset_allowlist: "codex", allowlist_domains: "a.com, b.org" }), { network: "custom", domains: ["a.com", "b.org"], packages: true });
  assert.deepEqual(cloud.networkOf({ mode: "custom", preset_allowlist: "none", allowlist_domains: ["x.io"] }), { network: "custom", domains: ["x.io"], packages: false });

  const bodies = [];
  wham(t, {
    "POST /wham/environments": (body) => (bodies.push(body), [200, { ...ENV, id: "env-new", label: body.label }]),
    "GET /wham/environments": [ENV],
  });
  const form = { name: " api ", network: "custom", domains: ["a.com", "*.b.org"], packages: false, setup: "npm ci", env: { A: "1" } };
  const made = await cloud.createCloudEnvironment(form, "github-7");
  assert.equal(made.id, "env-new");
  assert.deepEqual(bodies[0], {
    label: "api", description: "", machine_id: "wham-public/wham-universal", repos: ["github-7"],
    github_connector_id: "connector_76869538009648d5b282a4bb21c3d157", workspace_dir: "/workspace",
    agent_network_access: { mode: "on", preset_allowlist: "none", allowlist_domains: "a.com, *.b.org" },
    setup: "npm ci", maintenance_setup: "", env_vars: { A: "1" }, secrets_with_domains: [], share_settings: "private", share_targets: [],
    auto_setup_settings: { use_auto_setup: false }, cache_settings: { post_setup_cache_enabled: true }, enable_authtranslator: false,
  });
});

test("editing an environment sends the record back with its etag, secrets and sharing untouched", async (t) => {
  const record = {
    ...ENV, description: "d", machine_id: "m", workspace_dir: "/w", agent_network_access: { mode: "on", preset_allowlist: "codex", safe_methods_only: true },
    setup: ["a", "b"], maintenance_setup: ["m1"], env_vars: { K: "v", N: 1 }, share_settings: "public", share_targets: [{ email: "x@y.z" }],
    auto_setup_settings: { use_auto_setup: false }, cache_settings: { post_setup_cache_enabled: false }, enable_authtranslator: true, etag: "e7",
  };
  const sent = [];
  wham(t, {
    "GET /wham/environments/env-1/with-creator-and-machine": record,
    "PATCH /wham/environments/env-1": (body) => (sent.push(body), [200, record]),
    "GET /wham/environments": [ENV],
  });
  const { form, raw } = await cloud.readCloudEnvironment("env-1");
  assert.deepEqual(form, { name: "web", network: "trusted", domains: [], packages: false, setup: "a\nb", env: { K: "v" } });
  await cloud.updateCloudEnvironment("env-1", { ...form, network: "full" }, raw);
  assert.deepEqual(sent[0], {
    label: "web", description: "d", machine_id: "m", workspace_dir: "/w",
    agent_network_access: { safe_methods_only: true, mode: "on", preset_allowlist: "all" },
    setup: "a\nb", maintenance_setup: "m1", env_vars: { K: "v" }, secrets_with_domains: [], share_settings: "workspace",
    share_targets: [{ email: "x@y.z" }], auto_setup_settings: { use_auto_setup: false }, cache_settings: { post_setup_cache_enabled: false },
    enable_authtranslator: true, etag: "e7",
  });
  await cloud.updateCloudEnvironment("env-1", { ...form, setup: "" }, raw);
  assert.deepEqual(sent[1].auto_setup_settings, { use_auto_setup: true });
});

test("repositories: a list, a search, and the GitHub link ChatGPT is missing", async (t) => {
  const calls = wham(t, {
    "GET /wham/github/list-repositories?page=1&per_page=20&connector_id=connector_76869538009648d5b282a4bb21c3d157": { repositories: [{ id: "github-7", repository_full_name: "me/web" }, { id: 9 }] },
  });
  assert.deepEqual(await cloud.cloudRepositories(""), { repositories: [{ id: "github-7", name: "me/web" }, { id: "github-9", name: "github-9" }], needsConnect: false });
  // A query with characters a plain encodeURIComponent would leave bare still passes the bridge.
  await assert.rejects(cloud.cloudRepositories("it's (web)*"), /404/);
  assert.match(calls[1].path, /query=it%27s%20%28web%29%2A&/);
  t.mock.restoreAll();
  wham(t, { "GET /wham/github/list-repositories?page=1&per_page=20&connector_id=connector_76869538009648d5b282a4bb21c3d157": () => [400, { detail: { type: "missing_github_connector_link", message: "link GitHub" } }] });
  assert.deepEqual(await cloud.cloudRepositories(" "), { repositories: [], needsConnect: true });
});

test("a task reads as its prompts and the shown attempt of each reply, the diff turn filling the latest", async (t) => {
  const user = (id, at, text, previous) => ({ id, created_at: at, turn_status: "completed", previous_turn_id: previous, input_items: [{ type: "message", role: "user", content: [{ content_type: "text", text }] }] });
  const reply = (id, at, previous, extra) => ({ id, created_at: at, turn_status: "completed", previous_turn_id: previous, output_items: [], ...extra });
  const turns = {
    u1: user("u1", 1, "fix it"),
    a1: reply("a1", 2, "u1", { attempt_placement: 0, output_items: [{ type: "message", content: [{ content_type: "text", text: "done" }, "and more"] }, { type: "pr", output_diff: { diff: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n" } }] }),
    a1b: reply("a1b", 2, "u1", { attempt_placement: 1, output_items: [{ type: "message", content: [{ content_type: "text", text: "other attempt" }] }] }),
    u2: user("u2", 3, "and the test", "a1"),
    a2: reply("a2", 4, "u2", { turn_status: "in_progress", cancellation_requested_at: 5, worklog: { messages: [{ author: { role: "assistant" }, content: { parts: ["working"] } }, { author: { role: "tool" }, content: { parts: ["ls"] } }] } }),
  };
  wham(t, {
    "GET /wham/tasks/task-1": {
      task: { id: "task-1", title: "Fix", environment_id: "env-1", updated_at: 10, has_unread_turn: true, task_status_display: { environment_label: "web", latest_turn_status_display: { turn_status: "in_progress", diff_stats: { files_modified: 1, lines_added: 1, lines_removed: 1 } } } },
      current_user_turn: turns.u2,
      current_assistant_turn: turns.a2,
      current_diff_task_turn: { output_items: [{ type: "output_diff", diff: "diff --git a/y b/y\n" }] },
    },
    "GET /wham/tasks/task-1/turns": { turn_mapping: Object.fromEntries(Object.entries(turns).map(([id, turn]) => [id, { turn }])) },
  });
  await cloud.readCloudTask("task-1");
  const detail = cloud.cloudState().details["task-1"];
  assert.deepEqual(detail.task, { id: "task-1", title: "Fix", status: "in_progress", updatedAt: 10_000, environmentLabel: "web", files: 1, added: 1, removed: 1, unread: true, environmentId: "env-1" });
  assert.deepEqual(detail.turns.map((turn) => [turn.id, turn.role, turn.text, turn.diff?.slice(0, 18) ?? null, turn.cancelling]), [
    ["u1", "user", "fix it", null, false],
    ["a1", "assistant", "done\n\nand more", "diff --git a/x b/x", false],
    ["u2", "user", "and the test", null, false],
    ["a2", "assistant", "working", "diff --git a/y b/y", true],
  ]);
});

test("without /turns a task shows its current prompt and reply, and a failed reply its error", async (t) => {
  wham(t, {
    "GET /wham/tasks/task-2": {
      task: { id: "task-2", title: "" },
      current_user_turn: { id: "u", created_at: 1, input_items: [{ type: "message", content: [{ content_type: "text", text: "go" }] }] },
      current_assistant_turn: { id: "a", created_at: 2, turn_status: "failed", output_items: [], error: { code: "startup_script_failed", message: "exit 1" } },
    },
  });
  await cloud.readCloudTask("task-2");
  const detail = cloud.cloudState().details["task-2"];
  assert.equal(detail.task.title, "云端任务");
  assert.equal(detail.task.status, "failed");
  assert.deepEqual(detail.turns.map((turn) => [turn.role, turn.text, turn.error]), [["user", "go", null], ["assistant", "", "startup_script_failed: exit 1"]]);
});

test("tasks start on the environment's branch or its repository's default, and follow up from the latest reply", async (t) => {
  const posts = [];
  wham(t, {
    "GET /wham/environments": [ENV],
    "POST /wham/tasks": (body) => (posts.push(body), [200, posts.length === 1 ? { task: { id: "task-3" } } : { id: "task-4" }]),
    "GET /wham/tasks/list?task_filter=current&limit=50": { items: [{ id: "task-3", title: "T", archived: false, has_unread_turn: false, task_status_display: { latest_turn_status_display: { turn_status: "pending" } } }] },
    "GET /wham/tasks/task-1": { task: { id: "task-1" } },
  });
  const metadata = (cloudConfig) => ({ metadata: { "codexUi.environment": JSON.stringify({ version: 1, kind: "cloud", settings: {}, folderSettings: {}, env: {}, cloud: cloudConfig }) } });
  assert.equal(await cloud.startCloudTask(metadata({ environmentId: "env-1" }), "hello"), "task-3");
  assert.equal(await cloud.startCloudTask(metadata({ environmentId: "env-1", branch: "feature" }), "again"), "task-4");
  assert.deepEqual(posts.map((body) => body.new_task), [
    { environment_id: "env-1", branch: "trunk", run_environment_in_qa_mode: false },
    { environment_id: "env-1", branch: "feature", run_environment_in_qa_mode: false },
  ]);
  assert.deepEqual(posts[0].input_items, [{ type: "message", role: "user", content: [{ content_type: "text", text: "hello" }] }]);
  await assert.rejects(cloud.startCloudTask(metadata({ environmentId: "env-gone" }), "x"), /已被删除/);
  await assert.rejects(cloud.startCloudTask({ metadata: {} }, "x"), /尚未选择云环境/);

  // task-1 was read above: its latest reply is a2.
  posts.length = 0;
  await cloud.followUpCloudTask("task-1", "more");
  assert.deepEqual(posts[0], { follow_up: { task_id: "task-1", turn_id: "a2", environment_mode: "code" }, input_items: [{ type: "message", role: "user", content: [{ content_type: "text", text: "more" }] }] });
  await assert.rejects(cloud.followUpCloudTask("task-unknown", "x"), /还没有回复/);
});

test("the task list, read marks, archive and the local apply", async (t) => {
  const calls = wham(t, {
    "GET /wham/tasks/list?task_filter=current&limit=50": { items: [
      { id: "t1", title: "One", updated_at: 5, has_unread_turn: true, task_status_display: { latest_turn_status_display: { turn_status: "completed", diff_stats: { files_modified: 2, lines_added: 3, lines_removed: 4 } } } },
      { id: "t2", title: "Two", created_at: 6, task_status_display: { state: "error" } },
    ] },
    "POST /wham/tasks/t1/mark_read": {},
    "POST /wham/tasks/t2/archive": {},
  });
  await cloud.refreshCloudTasks();
  assert.deepEqual(cloud.cloudState().tasks.map((task) => [task.id, task.status, task.updatedAt, task.files, task.added, task.removed, task.unread]), [
    ["t1", "completed", 5000, 2, 3, 4, true],
    ["t2", "failed", 6000, 0, 0, 0, false],
  ]);
  cloud.markCloudTaskRead("t1");
  cloud.markCloudTaskRead("t1");
  cloud.markCloudTaskRead("t2");
  await cloud.archiveCloudTask("t2");
  assert.deepEqual(calls.slice(1).map((call) => `${call.method} ${call.path}`), ["POST /wham/tasks/t1/mark_read", "POST /wham/tasks/t2/archive"]);
  assert.deepEqual(cloud.cloudState().tasks.map((task) => [task.id, task.unread]), [["t1", false]]);
  await cloud.applyCloudDiff("D:/repo", "diff --git a/x b/x\n");
  assert.deepEqual(applied, [{ method: "codexUi/git/apply", params: { cwd: "D:/repo", diff: "diff --git a/x b/x\n" } }]);
  cloud.resetCloud();
  assert.deepEqual(cloud.cloudState(), { environments: null, environmentsError: null, tasks: null, tasksError: null, details: {}, detailErrors: {} });
});
