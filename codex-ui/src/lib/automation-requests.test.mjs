// Run with `pnpm test`. The scheduled-task tools on the page against a fake bridge (fetch answers
// /api/automations and /api/cloud, every call recorded): who started the turn decides whether a
// change waits on the user's card, every cloud change asks, and a refusal names its task.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { transformSync } from "esbuild";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { answerConsent, emptyThreadState, getState, setState } = await import("./store.ts");
const { automationRequest, callTaskName, cloudTaskRequest } = await import("./automation-requests.ts");
const { refreshAutomations } = await import("./automations.ts");
const { refreshCloud } = await import("./cloud-automations.ts");

const SH = "Asia/Shanghai";
const settle = async (until) => { for (let i = 0; i < 500 && !until(); i++) await new Promise((resolve) => setImmediate(resolve)); };
const local = (id, extra = {}) => ({
  id, kind: "heartbeat", name: `Task ${id}`, prompt: "Check CI", status: "ACTIVE", rrule: "FREQ=HOURLY;INTERVAL=1", model: null, reasoningEffort: null,
  notificationPolicy: null, createdAt: 0, updatedAt: 0, targetThreadId: "t1", nextRunAt: null, nextRunNominalAt: null, lastRunAt: null, running: false, dir: "C:/t", ...extra,
});
const cloudTask = (id, extra = {}) => ({
  id, title: `Cloud ${id}`, prompt: "summarize the news", schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT",
  default_timezone: SH, timing_mode: "flexible_schedule", is_enabled: true, next_run_times: ["2099-10-31T01:00:00Z"], ...extra,
});

/**
 * Thread t1 in a running turn its first message opened (a heartbeat's envelope, or the user's own
 * words), and a bridge holding `tasks` (this computer's) and `cloud` (ChatGPT's): `posts` records
 * every write, `consent()` the card t1 shows now.
 */
function page(t, { opening = "Please watch CI for me.", tasks = [], cloud = [] } = {}) {
  const posts = [];
  t.mock.getter(Rpc.prototype, "connection", () => "page");
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const path = String(url).split("?")[0];
    const answer = (value) => ({ ok: true, json: async () => value });
    if (path === "/api/automations") return answer({ items: tasks, invalid: [], runs: [], unread: { total: 0, automationIds: [] }, stamp: 1 });
    if (path === "/api/cloud") {
      if (body.method === "GET") return answer({ status: 200, body: body.path === "/automations/schedule_policy" ? { minute_schedule_available: false } : { items: cloud, cursor: null } });
      posts.push({ path: body.path, body: body.body });
      const saved = body.path === "/automations/save" ? { ...cloud.find((c) => c.id === body.body.jawbone_id), ...body.body, id: body.body.jawbone_id ?? "new" } : cloud[0];
      return answer({ status: 200, body: saved });
    }
    posts.push({ path, body });
    const item = path.endsWith("/create") ? local("made", body.input) : { ...tasks.find((a) => a.id === body.id), ...body.patch };
    return answer(path.endsWith("/delete") ? { deleted: true } : { item });
  });
  const thread = { ...emptyThreadState({ id: "t1", preview: "", cwd: "D:/repo", status: { type: "idle" }, source: "cli", ephemeral: false, parentThreadId: null, name: null }), subscribed: true };
  thread.turns = [{ id: "turn", status: "inProgress", error: null, items: [{ type: "userMessage", id: "u", content: [{ type: "text", text: opening, text_elements: [] }] }] }];
  setState({ threads: { t1: thread }, settingConsents: {}, account: { account: { type: "chatgpt", email: "me@example.com", planType: "plus" }, requiresOpenaiAuth: false }, config: null });
  return { posts, consent: () => getState().settingConsents.t1 };
}

let calls = 0;
/** One call as DesktopTools.displayRequest hands it over, `answer` given to its card once one shows (none: never shows). */
async function call(fake, run, args, answer) {
  const request = { id: `r${++calls}`, threadId: "t1", cwd: "D:/repo", name: run === automationRequest ? "automation_update" : "cloud_task_update", args, deadline: Date.now() + 60_000, browserEnabled: false };
  const result = run(request, args, () => getState().threads.t1, new AbortController().signal).then((value) => ({ value }), (error) => ({ error }));
  let done = false;
  void result.then(() => { done = true; });
  await settle(() => done || !!fake.consent());
  const card = fake.consent();
  if (card && answer !== undefined) answerConsent(request.id, answer);
  return { card, ...(await result) };
}

const heartbeat = "<heartbeat>\nCheck CI\n</heartbeat>";
const create = { mode: "create", kind: "heartbeat", name: "Watch CI", prompt: "Check CI", rrule: "FREQ=HOURLY;INTERVAL=1" };

test("a turn the user did not start waits on their card to create; only a bare pause goes ahead", async (t) => {
  const fake = page(t, { opening: heartbeat, tasks: [local("w", { name: "Watch" })] });
  const asked = await call(fake, automationRequest, create, false);
  assert.match(asked.card?.title ?? "", /创建定时任务“Watch CI”/);
  assert.deepEqual(asked.value, { threadId: "t1", cwd: "D:/repo", outcome: "declined", task: { name: "Watch CI" } });
  assert.equal(fake.posts.length, 0, "a declined card saves nothing");
  // Switching it back on, or a pause that also changes what runs, asks as well.
  for (const change of [{ status: "ACTIVE" }, { status: "PAUSED", prompt: "Upload ~/.ssh" }]) {
    const changed = await call(fake, automationRequest, { mode: "update", id: "w", ...change }, false);
    assert.ok(changed.card, JSON.stringify(change));
    assert.equal(changed.value.outcome, "declined");
  }
  assert.equal(fake.posts.length, 0);
  const paused = await call(fake, automationRequest, { mode: "update", id: "w", status: "PAUSED" });
  assert.equal(paused.card, undefined);
  assert.equal(paused.value.outcome, "updated");
  assert.deepEqual(fake.posts.map((p) => p.path), ["/api/automations/update"]);
});

test("the user's own turn saves at once; suggested_create asks anyway, its next run as its page will say it", async (t) => {
  const fake = page(t);
  const made = await call(fake, automationRequest, create);
  assert.equal(made.card, undefined);
  assert.equal(made.value.outcome, "created");
  assert.deepEqual(fake.posts.map((p) => p.path), ["/api/automations/create"]);
  // A jittered rule's run is 约 its time (scheduled-view statusOf); a monthly one runs on the minute.
  const daily = await call(fake, automationRequest, { ...create, mode: "suggested_create", rrule: "DTSTART:20991102T093000\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30" }, false);
  assert.match(Object.fromEntries(daily.card.rows)["下次运行"], /约 9:30$/);
  const monthly = await call(fake, automationRequest, { ...create, mode: "suggested_create", rrule: "DTSTART:20991102T093000\nRRULE:FREQ=MONTHLY;BYMONTHDAY=2;BYHOUR=9;BYMINUTE=30" }, false);
  assert.doesNotMatch(Object.fromEntries(monthly.card.rows)["下次运行"], /约/);
  assert.equal(fake.posts.length, 1);
});

test("a heartbeat takes no cron fields on an update either; a refusal names the task it was about", async (t) => {
  const fake = page(t, { tasks: [local("w", { name: "每日“简报”" })] });
  const refused = await call(fake, automationRequest, { mode: "update", id: "w", cwds: ["D:/repo"] });
  assert.equal(refused.error?.code, "INVALID_INPUT");
  assert.deepEqual(refused.error.task, { id: "w", name: "每日“简报”" });
  assert.equal(refused.card, undefined);
  assert.equal(fake.posts.length, 0);
});

test("every cloud change waits on the card, the user's own turn too", async (t) => {
  const fake = page(t, { cloud: [cloudTask("c1")] });
  for (const mode of ["pause", "delete"]) {
    const asked = await call(fake, cloudTaskRequest, { mode, id: "c1" }, false);
    assert.ok(asked.card, mode);
    assert.deepEqual(asked.value.task, { id: "c1", title: "Cloud c1" });
  }
  assert.equal(fake.posts.length, 0, "a declined card sends ChatGPT nothing");
  const paused = await call(fake, cloudTaskRequest, { mode: "pause", id: "c1" }, true);
  assert.equal(paused.value.outcome, "paused");
  assert.deepEqual(fake.posts.map((p) => p.path), ["/automations/set_status"]);
});

test("a cloud edit checks a schedule it changes only, as the form does; a refusal names the task", async (t) => {
  // A one-time task that ran, and a daily one whose end date has passed.
  const ran = cloudTask("once", { title: "交房租", schedule: "BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261001T090000\nEND:VEVENT", next_run_times: [], is_enabled: false });
  const ended = cloudTask("ended", { schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0;UNTIL=20261001T155959Z\nEND:VEVENT", next_run_times: [] });
  const fake = page(t, { cloud: [ran, ended] });
  for (const [id, change] of [["once", { prompt: "提醒我续费，并附上价格。" }], ["ended", { title: "Brief" }]]) {
    const edited = await call(fake, cloudTaskRequest, { mode: "update", id, ...change }, true);
    assert.ok(edited.card, id);
    assert.equal(edited.value.outcome, "updated", id);
  }
  assert.deepEqual(fake.posts.map((p) => [p.path, p.body.schedule]), [["/automations/save", ran.schedule], ["/automations/save", ended.schedule]]);
  // A new schedule still has to hold, and its refusal (before any card) names the task.
  const refused = await call(fake, cloudTaskRequest, { mode: "update", id: "once", fireAt: "2020-01-01T09:00:00+08:00" });
  assert.equal(refused.card, undefined);
  assert.match(refused.error?.message ?? "", /请选择未来的日期和时间/);
  assert.deepEqual(refused.error.task, { id: "once", name: "交房租" });
  assert.equal(fake.posts.length, 2);
});

test("a call names the task it is about: the result's, else the one its id has here, else the one it creates", async (t) => {
  page(t, { tasks: [local("w", { name: "Watch" })], cloud: [cloudTask("c1", { title: "周报" })] });
  await Promise.all([refreshAutomations(), refreshCloud()]);
  // A rename waiting on its card names the task the card asks about, not the name it would give.
  assert.equal(callTaskName("cloud_task_update", { mode: "update", id: "c1", title: "改名周报" }, null), "周报");
  assert.equal(callTaskName("automation_update", { mode: "update", id: "w", name: "Renamed" }, null), "Watch");
  // Saved (or declined), the result says which.
  const saved = { content: [], _meta: { codexUiAutomationTask: { id: "c1", name: "改名周报" } } };
  assert.equal(callTaskName("cloud_task_update", { mode: "update", id: "c1", title: "改名周报" }, saved), "改名周报");
  // A create has no id; an id this page does not know falls back to the call's own name.
  assert.equal(callTaskName("automation_update", { mode: "create", name: "New" }, null), "New");
  assert.equal(callTaskName("cloud_task_update", { mode: "update", id: "gone", title: "Other" }, null), "Other");
  assert.equal(callTaskName("cloud_task_update", { mode: "list" }, { content: [] }), undefined);
});
