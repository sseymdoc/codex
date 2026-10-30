// Run with `pnpm test`. cloud-automations.ts against a fake ChatGPT behind a fake bridge: fetch
// answers /api/cloud as server/bridge.mjs does ({ status, body }), every call checked against the
// bridge's own allow list, and "./codex" is a stub, so no app-server, login or network is involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.__cloudAutomationsStub = {
  connectionId: () => "conn-1",
  callExperimental: async () => {},
  errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
};
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__cloudAutomationsStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|cloud-automations)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const cloud = await import("./cloud-automations.ts");
const { CloudError } = await import("./cloud.ts");
const { setState } = await import("./store.ts");

/**
 * A fake ChatGPT: `routes` maps "METHOD path" to a body or (body) => [status, body], or a promise of one (unknown
 * routes answer 404); every call is logged, and `log` gets "fetch <path>" in order.
 */
function chatgpt(t, routes, log = []) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    calls.push({ method, path, body });
    log.push(`fetch ${method} ${path}`);
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? await route(body) : [200, route];
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const login = (email = "me@example.com", provider = null) =>
  setState({ account: { account: { type: "chatgpt", email, planType: "plus" }, requiresOpenaiAuth: false }, config: provider ? { model_provider: provider } : null });

const SH = "Asia/Shanghai";
const task = (id, extra = {}) => ({
  id, title: `T ${id}`, prompt: "summarize the news", schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT",
  default_timezone: SH, timing_mode: "flexible_schedule", is_enabled: true, email_enabled: false, notifications_enabled: true,
  next_run_times: ["2026-10-31T01:00:00Z"], last_run_time: "2026-10-30T01:00:05Z", updated_at: "2026-10-30T01:00:06.000000Z",
  thread_mode: "existing_chat", model: null, reasoning_effort: null, display_emoji: "📰", executor: "chatgpt", schedule_components: { frequency: "daily" },
  ...extra,
});

test("VEVENT: a one-time run, a daily rule with its end date, and an end date over a DST change", () => {
  const draft = { ...cloud.cloudDraftOf(null), timezone: SH };
  assert.equal(cloud.cloudSchedule({ ...draft, repeat: false, date: "2026-10-30", time: "09:00" }), "BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261030T090000\nEND:VEVENT");
  assert.equal(cloud.cloudSchedule({ ...draft, until: "2026-11-30" }), "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;UNTIL=20261130T155959Z\nEND:VEVENT");
  // New York leaves daylight time on 2026-11-01: its last second is 04:59:59Z the next day.
  assert.equal(cloud.untilUtc("2026-11-01", "America/New_York"), "20261102T045959Z");
  assert.equal(cloud.zonedTime("2026-03-08", "03:30", "America/New_York"), Date.parse("2026-03-08T07:30:00Z"));
  assert.deepEqual(cloud.wallTime(Date.parse("2026-11-01T06:30:00Z"), "America/New_York"), { date: "2026-11-01", time: "01:30" });

  // Each editor as the desktop app writes it: hours and days by its builder, custom as typed.
  const rule = (mode, rrule, until = null) => cloud.cloudSchedule({ ...draft, mode, rrule, until }).split("\n").slice(1, -1).join("\n");
  assert.equal(rule("hourly", "RRULE:FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA"), "RRULE:FREQ=HOURLY;INTERVAL=2;BYMINUTE=0");
  assert.equal(rule("hourly", "RRULE:FREQ=MINUTELY;INTERVAL=30"), "RRULE:FREQ=MINUTELY;INTERVAL=30");
  assert.equal(rule("daily", "RRULE:FREQ=WEEKLY;BYHOUR=7;BYMINUTE=5;BYDAY=SU,MO,TU,WE,TH,FR,SA"), "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=7;BYMINUTE=5");
  assert.equal(rule("weekdays", "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR"), "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR");
  assert.equal(rule("monthly", "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=15"), "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=15");
  assert.equal(rule("custom", "DTSTART:20261101T070000Z\nFREQ=WEEKLY;BYDAY=MO;UNTIL=20270101T000000Z", "2026-12-31"), "DTSTART:20261101T070000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231T155959Z");
});

test("a saved schedule reads back: its rule without UNTIL or BYSECOND=0, the end date and a one-time run on the task's clock", () => {
  assert.deepEqual(cloud.scheduleParts("BEGIN:VEVENT\r\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYSECOND=0;UNTIL=20261130T155959Z\r\nEND:VEVENT", SH),
    { rrule: "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0", until: "2026-11-30", once: null });
  assert.deepEqual(cloud.scheduleParts("RRULE:UNTIL=20261201;FREQ=WEEKLY;BYDAY=MO", SH), { rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO", until: "2026-12-01", once: null });
  assert.deepEqual(cloud.scheduleParts("BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261030T090000\nEND:VEVENT", SH), { rrule: null, until: null, once: { date: "2026-10-30", time: "09:00" } });
  assert.deepEqual(cloud.scheduleParts("BEGIN:VEVENT\nDTSTART:20261030T010000Z\nEND:VEVENT", SH).once, { date: "2026-10-30", time: "09:00" });
  assert.deepEqual(cloud.scheduleParts("BEGIN:VEVENT\nX-UNSCHEDULED:1\nEND:VEVENT", SH), { rrule: null, until: null, once: null });

  const draft = cloud.cloudDraftOf(cloud.parseCloudAutomation(task("a1", { schedule: "BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=30;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231T155959Z\nEND:VEVENT", thread_mode: "new_chat", model: "gpt-5", reasoning_effort: "high" })));
  assert.deepEqual(draft, {
    id: "a1", name: "T a1", prompt: "summarize the news", emoji: "📰", repeat: true, rrule: "RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=30;BYDAY=MO,TU,WE,TH,FR", mode: "weekdays",
    until: "2026-12-31", date: draft.date, time: "08:30", timezone: SH, newChat: true, model: "gpt-5", effort: "high",
  });
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(cloud.cloudDraftOf(null, now).date, cloud.wallTime(now + 86_400_000, cloud.cloudDraftOf(null, now).timezone).date);
  assert.equal(cloud.cloudDraftOf(null).newChat, false);
});

test("timing_mode: a string in answers, a number in a save", () => {
  assert.deepEqual(["exact_schedule", "flexible_schedule", "condition_watch", 0, 1, 2, "x", undefined].map(cloud.timingModeOf),
    ["exact_schedule", "flexible_schedule", "condition_watch", "exact_schedule", "flexible_schedule", "condition_watch", "flexible_schedule", "flexible_schedule"]);
  assert.deepEqual(cloud.TIMING, { exact_schedule: 0, flexible_schedule: 1, condition_watch: 2 });
});

test("save bodies: a new task as tEt sends it, an edit as eEt (no thread_mode, an unchanged model left out)", () => {
  const fresh = { ...cloud.cloudDraftOf(null), name: " ", prompt: "  check   the\nweather  ", timezone: SH };
  assert.deepEqual(cloud.saveBody(fresh), {
    default_timezone: SH, email_enabled: false, is_enabled: true, jawbone_id: null, model: null, reasoning_effort: null, notifications_enabled: true,
    prompt: "check   the\nweather", emoji: null, thread_mode: "existing_chat", schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT",
    timing_mode: 1, title: "check the weather",
  });
  assert.equal(cloud.saveBody({ ...fresh, repeat: false, newChat: true }).timing_mode, 0);
  assert.equal(cloud.saveBody({ ...fresh, newChat: true }).thread_mode, "new_chat");

  // The server writes the saved text its own way; an edit that leaves the schedule keeps it as it is.
  const saved = cloud.parseCloudAutomation(task("a1", { schedule: "BEGIN:VEVENT\nRRULE:BYHOUR=9;BYMINUTE=0;FREQ=DAILY;INTERVAL=1\nEND:VEVENT", timing_mode: "exact_schedule", is_enabled: false, email_enabled: true, notifications_enabled: false, model: "gpt-5", reasoning_effort: "low" }));
  const draft = cloud.cloudDraftOf(saved);
  const edit = cloud.saveBody({ ...draft, name: "Renamed" }, saved);
  assert.deepEqual(JSON.parse(JSON.stringify(edit)), {
    default_timezone: SH, email_enabled: true, is_enabled: false, jawbone_id: "a1", notifications_enabled: false, prompt: "summarize the news", emoji: "📰",
    schedule: saved.schedule, timing_mode: 0, title: "Renamed",
  });
  assert.equal("thread_mode" in edit, false);
  assert.deepEqual([edit.model, edit.reasoning_effort], [undefined, undefined]);
  const remodel = cloud.saveBody({ ...draft, model: "gpt-5-mini", effort: null }, saved);
  assert.deepEqual([remodel.model, remodel.reasoning_effort], ["gpt-5-mini", null]);

  // A changed schedule is written anew: hourly and custom rules exact, the rest flexible, a condition watch kept.
  const hourly = cloud.saveBody({ ...draft, mode: "hourly", rrule: "RRULE:FREQ=HOURLY;INTERVAL=3;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA" }, saved);
  assert.deepEqual([hourly.schedule, hourly.timing_mode], ["BEGIN:VEVENT\nRRULE:FREQ=HOURLY;INTERVAL=3;BYMINUTE=0\nEND:VEVENT", 0]);
  assert.equal(cloud.saveBody({ ...draft, mode: "weekly", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO" }, saved).timing_mode, 1);
  assert.equal(cloud.saveBody({ ...draft, mode: "weekly", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO" }, { ...saved, timingMode: "condition_watch" }).timing_mode, 2);
  const moved = cloud.saveBody({ ...draft, timezone: "Europe/London" }, saved);
  assert.deepEqual([moved.default_timezone, moved.schedule, moved.timing_mode], ["Europe/London", "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT", 1]);
  const ending = cloud.saveBody({ ...draft, until: "2026-11-30" }, saved);
  assert.equal(ending.schedule, "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;UNTIL=20261130T155959Z\nEND:VEVENT");
  // A one-time task moved stays as exact or flexible as it was.
  const once = cloud.parseCloudAutomation(task("o1", { schedule: "BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261101T090000\nEND:VEVENT", timing_mode: "flexible_schedule" }));
  assert.deepEqual(cloud.saveBody({ ...cloud.cloudDraftOf(once), time: "10:00" }, once).timing_mode, 1);
  assert.deepEqual(cloud.saveBody({ ...cloud.cloudDraftOf(once), time: "10:00" }, { ...once, timingMode: "exact_schedule" }).timing_mode, 0);
});

test("a task as the page shows it: state by mb, a team's and a local one left out, roles and a one-time run's time", () => {
  login();
  const a = cloud.parseCloudAutomation(task("a1"));
  assert.deepEqual(a, {
    id: "a1", title: "T a1", prompt: "summarize the news", schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT", timezone: SH,
    timingMode: "flexible_schedule", enabled: true, emailEnabled: false, notificationsEnabled: true, nextRunAt: Date.parse("2026-10-31T01:00:00Z"),
    lastRunAt: Date.parse("2026-10-30T01:00:05Z"), updatedAt: "2026-10-30T01:00:06.000000Z", threadMode: "existing_chat", model: null, effort: null, emoji: "📰",
    status: "active", triggered: false, onceAt: null, canManage: true, canDelete: true, canShare: true,
  });
  assert.equal(cloud.parseCloudAutomation(task("a", { is_enabled: false })).status, "paused");
  assert.equal(cloud.parseCloudAutomation(task("a", { next_run_times: [] })).status, "completed");
  assert.equal(cloud.parseCloudAutomation(task("a", { next_run_times: [], timing_mode: "condition_watch", is_enabled: false })).status, "paused");
  assert.equal(cloud.parseCloudAutomation(task("a", { display_title: " Daily news " })).title, "Daily news");
  assert.equal(cloud.parseCloudAutomation(task("a", { team_id: "team-1" })), null);
  assert.equal(cloud.parseCloudAutomation(task("a", { executor: "local" })), null);
  assert.equal(cloud.parseCloudAutomation({ title: "no id" }), null);
  assert.deepEqual((({ canManage, canDelete, canShare }) => [canManage, canDelete, canShare])(cloud.parseCloudAutomation(task("a", { current_user_role: "reader" }))), [false, false, false]);
  assert.deepEqual((({ canManage, canDelete }) => [canManage, canDelete])(cloud.parseCloudAutomation(task("a", { current_user_role: "editor", can_delete: true }))), [true, true]);
  assert.equal(cloud.parseCloudAutomation(task("a", { next_run_times: [] })).canShare, false);
  // Sharing is the account's (share-dialog reads its plan and structure), not the task's plan_type.
  assert.equal(cloud.parseCloudAutomation(task("a", { plan_type: "quorum" })).canShare, true);
  const plan = (planType) => cloud.shareable({ account: { type: "chatgpt", email: "me@example.com", planType }, requiresOpenaiAuth: false });
  assert.deepEqual(["free", "plus", "pro", "prolite", "team", "business", "enterprise", "edu", "unknown"].map(plan), [true, true, true, true, false, false, false, false, false]);
  assert.equal(cloud.shareable({ account: { type: "apiKey" }, requiresOpenaiAuth: true }), false);
  assert.equal(cloud.shareable(null), false);
  setState({ account: { account: { type: "chatgpt", email: "me@example.com", planType: "business" }, requiresOpenaiAuth: false } });
  assert.equal(cloud.parseCloudAutomation(task("a")).canShare, false);
  login();
  assert.equal(cloud.parseCloudAutomation(task("a", { webhook_triggers: [{ id: "w" }] })).triggered, true);
  assert.equal(cloud.parseCloudAutomation(task("a", { schedule: "BEGIN:VEVENT\nX-UNSCHEDULED:1\nEND:VEVENT", timing_mode: "condition_watch" })).triggered, true);
  assert.equal(cloud.parseCloudAutomation(task("a", { schedule_components: { frequency: "once", start_time: "2026-11-01T09:00:00" } })).onceAt, Date.parse("2026-11-01T01:00:00Z"));
  assert.equal(cloud.parseCloudAutomation(task("a", { schedule_components: { frequency: "once", start_time: "2026-11-01T09:00:00+00:00" } })).onceAt, Date.parse("2026-11-01T09:00:00Z"));
});

test("share links: an id as it is, a link's shared_task or post_id, else its path's last part", () => {
  assert.equal(cloud.sharePostId("  post_AbC-1 "), "post_AbC-1");
  assert.equal(cloud.sharePostId("https://chatgpt.com/scheduled?shared_task=post_9"), "post_9");
  assert.equal(cloud.sharePostId("https://chatgpt.com/share?post_id=p-2&x=1"), "p-2");
  assert.equal(cloud.sharePostId("https://chatgpt.com/s/t_123/"), "t_123");
  assert.equal(cloud.sharePostId("not a link"), null);
  assert.equal(cloud.sharePostId("https://chatgpt.com/s/a.b"), null);
  assert.equal(cloud.sharePostId(""), null);
});

test("access: what a failed list means, and what needs no request at all", () => {
  const upstream = (status, body) => new CloudError(status, "x", undefined, true, body);
  assert.equal(cloud.accessOf(upstream(404, { detail: "Not Found" })), "unavailable");
  assert.equal(cloud.accessOf(new CloudError(401, "需要使用 ChatGPT 账户登录 Codex。")), "signin");
  assert.equal(cloud.accessOf(upstream(403, { detail: "\n<!DOCTYPE html><html>Just a moment...</html>" })), "blocked");
  assert.equal(cloud.accessOf(upstream(403, { detail: { message: "forbidden" } })), "error");
  assert.equal(cloud.accessOf(new CloudError(403, "This Codex Cloud request is not allowed.")), "error");
  assert.equal(cloud.accessOf(upstream(500, null)), "error");
  assert.equal(cloud.accessOf(new Error("offline")), "error");
  assert.equal(cloud.gateOf({ account: null, config: null }), "unknown");
  assert.equal(cloud.gateOf({ account: { account: { type: "apiKey" }, requiresOpenaiAuth: true }, config: null }), "signin");
  assert.equal(cloud.gateOf({ account: { account: null, requiresOpenaiAuth: true }, config: null }), "signin");
  assert.equal(cloud.gateOf({ account: { account: { type: "chatgpt" } }, config: { model_provider: "opencodex" } }), "unavailable");
  // Another provider hides cloud tasks whatever the login: no 登录 banner without a ChatGPT login either.
  assert.equal(cloud.gateOf({ account: { account: { type: "apiKey" }, requiresOpenaiAuth: true }, config: { model_provider: "mock_provider" } }), "unavailable");
  assert.equal(cloud.gateOf({ account: { account: null, requiresOpenaiAuth: true }, config: { model_provider: "mock_provider" } }), "unavailable");
  assert.equal(cloud.gateOf({ account: { account: { type: "chatgpt" } }, config: { model_provider: "openai" } }), null);
  assert.equal(cloud.gateOf({ account: { account: { type: "chatgpt" } }, config: { model_provider: null } }), null);
});

test("the list: no request without a ChatGPT login or with another provider; asked once, then every page", async (t) => {
  let calls = chatgpt(t, {});
  setState({ account: { account: { type: "apiKey" }, requiresOpenaiAuth: true }, config: null });
  await cloud.refreshCloud();
  assert.equal(cloud.cloudAutomationsState().access, "signin");
  login("me@example.com", "opencodex");
  await cloud.refreshCloud();
  assert.equal(cloud.cloudAutomationsState().access, "unavailable");
  assert.equal(calls.length, 0);

  t.mock.restoreAll();
  login();
  calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": { items: [task("a1")], cursor: null },
    "GET /automations?limit=100": { items: [task("a1"), task("team", { team_id: "t" }), task("local", { executor: "local" })], cursor: "c2==" },
    "GET /automations?cursor=c2%3D%3D&limit=100": { items: [task("a2", { is_enabled: false })], cursor: null },
  });
  await cloud.refreshCloud();
  assert.deepEqual(calls.map((call) => call.path), ["/automations?filter=scheduled&limit=25", "/automations?limit=100", "/automations?cursor=c2%3D%3D&limit=100"]);
  assert.equal(cloud.cloudAutomationsState().access, "ok");
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => [a.id, a.status]), [["a1", "active"], ["a2", "paused"]]);
  await cloud.refreshCloud();
  assert.equal(calls.filter((call) => call.path.includes("filter=scheduled")).length, 1);

  // Another account starts afresh; a 404 means it has none, and holds without asking again.
  t.mock.restoreAll();
  login("other@example.com");
  calls = chatgpt(t, {});
  await cloud.refreshCloud();
  assert.deepEqual([cloud.cloudAutomationsState().access, cloud.cloudAutomationsState().items], ["unavailable", null]);
  await cloud.refreshCloud();
  assert.equal(calls.length, 1);
});

test("the list: Cloudflare's page in a browser-mode page is blocked; another failure is offered again", async (t) => {
  login("cf@example.com");
  let calls = chatgpt(t, { "GET /automations?filter=scheduled&limit=25": () => [403, { detail: "<!DOCTYPE html><title>Just a moment...</title>" }] });
  await cloud.refreshCloud();
  await cloud.refreshCloud();
  assert.equal(cloud.cloudAutomationsState().access, "blocked");
  assert.equal(calls.length, 1);

  t.mock.restoreAll();
  login("flaky@example.com");
  let fail = true;
  calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": () => (fail ? [500, { detail: "boom" }] : [200, { items: [] }]),
    "GET /automations?limit=100": { items: [task("a1")] },
  });
  await cloud.refreshCloud();
  assert.equal(cloud.cloudAutomationsState().access, "error");
  assert.match(cloud.cloudAutomationsState().error, /ChatGPT 返回错误（500）：boom/);
  fail = false;
  await cloud.refreshCloud();
  assert.deepEqual([cloud.cloudAutomationsState().access, cloud.cloudAutomationsState().error, cloud.cloudAutomationsState().items.length], ["ok", null, 1]);
});

test("pause, resume and delete show at once, survive a list read meanwhile, and go back when they fail", async (t) => {
  login("edit@example.com");
  let answer = [200, null];
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": { items: [] },
    "GET /automations?limit=100": { items: [task("a1"), task("a2")] },
    "POST /automations/set_status": (body) => (answer[0] === 200 ? [200, task(body.jawbone_id, { is_enabled: body.is_enabled, updated_at: "later" })] : answer),
    "POST /automations/remove": () => answer,
  });
  await cloud.refreshCloud();
  const ids = () => cloud.cloudAutomationsState().items.map((a) => `${a.id}:${a.status}`);

  const pausing = cloud.setCloudStatus("a1", false);
  assert.deepEqual(ids(), ["a1:paused", "a2:active"]);
  const paused = await pausing;
  assert.deepEqual([paused.updatedAt, ids()], ["later", ["a1:paused", "a2:active"]]);
  assert.deepEqual(calls.at(-1), { method: "POST", path: "/automations/set_status", body: { jawbone_id: "a1", is_enabled: false } });

  answer = [500, { detail: "nope" }];
  await assert.rejects(cloud.setCloudStatus("a2", false), /500/);
  assert.deepEqual(ids(), ["a1:paused", "a2:active"]);
  await assert.rejects(cloud.removeCloudAutomation("a2"), /500/);
  assert.deepEqual(ids(), ["a1:paused", "a2:active"]);
  await assert.rejects(cloud.setCloudStatus("gone", true), /找不到此定时任务/);

  // A list read while a delete is on its way does not bring the task back.
  t.mock.restoreAll();
  chatgpt(t, {
    "GET /automations?limit=100": { items: [task("a1", { is_enabled: false }), task("a2")] },
    "POST /automations/remove": () => held.then(() => [200, null]),
  });
  const removing = cloud.removeCloudAutomation("a2");
  assert.deepEqual(ids(), ["a1:paused"]);
  await cloud.refreshCloud();
  assert.deepEqual(ids(), ["a1:paused"]);
  release();
  await removing;
  assert.deepEqual(ids(), ["a1:paused"]);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a list read under way when a save, a pause or a delete lands is read again over it", async (t) => {
  login("race@example.com");
  const server = new Map([["a1", task("a1")], ["a2", task("a2")]]);
  let gate = null;
  chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": { items: [] },
    // What the server held as the read began, landing once `gate` opens.
    "GET /automations?limit=100": () => {
      const answer = [200, { items: [...server.values()] }];
      return gate ? gate.then(() => answer) : answer;
    },
    "POST /automations/save": (body) => (server.set("new", task("new", { title: body.title })), [200, server.get("new")]),
    "POST /automations/set_status": (body) => (server.set(body.jawbone_id, { ...server.get(body.jawbone_id), is_enabled: body.is_enabled }), [200, server.get(body.jawbone_id)]),
    "POST /automations/remove": (body) => (server.delete(body.automation_id), [200, null]),
  });
  await cloud.refreshCloud();
  let open;
  gate = new Promise((resolve) => (open = resolve));
  const poll = cloud.refreshCloud(); // the minute's poll
  await tick();
  await cloud.saveCloudAutomation({ ...cloud.cloudDraftOf(null), prompt: "water the plants", timezone: SH });
  await cloud.setCloudStatus("a1", false);
  await cloud.removeCloudAutomation("a2");
  gate = null;
  open();
  await poll;
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => `${a.id}:${a.status}`), ["a1:paused", "new:active"]);
});

test("a change that lands after another login took the list stays out of it", async (t) => {
  login("old@example.com");
  let gate = null, listed = "a1";
  const hold = (answer) => () => (gate ? gate.then(() => answer) : answer);
  const calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": { items: [] },
    "GET /automations?limit=100": () => [200, { items: [task(listed)] }],
    "POST /automations/save": hold([200, task("oldtask")]),
    "POST /automations/set_status": hold([500, { detail: "down" }]),
    "POST /automations/remove": hold([200, null]),
    "GET /automation/a1": hold([200, task("a1")]),
  });
  await cloud.refreshCloud();
  let open;
  gate = new Promise((resolve) => (open = resolve));
  const saving = cloud.saveCloudAutomation({ ...cloud.cloudDraftOf(null), prompt: "old", timezone: SH });
  const pausing = cloud.setCloudStatus("a1", false).catch(() => "failed");
  const removing = cloud.removeCloudAutomation("a1");
  const reading = cloud.readCloudAutomation("a1");
  await tick();
  listed = "b1";
  login("new@example.com");
  await cloud.refreshCloud();
  gate = null;
  open();
  assert.equal((await saving).id, "oldtask");
  assert.equal(await pausing, "failed");
  await removing;
  assert.equal((await reading).id, "a1");
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => `${a.id}:${a.status}`), ["b1:active"]);
  // The same email under another plan (another workspace) is asked afresh.
  const probes = () => calls.filter((call) => call.path === "/automations?filter=scheduled&limit=25").length;
  const asked = probes();
  await cloud.refreshCloud();
  assert.equal(probes(), asked);
  setState({ account: { account: { type: "chatgpt", email: "new@example.com", planType: "team" }, requiresOpenaiAuth: false }, config: null });
  await cloud.refreshCloud();
  assert.equal(probes(), asked + 1);
});

test("a task saved while the list could not be read is held; a 401 holds until signing in anew", async (t) => {
  login("down@example.com");
  let expired = true;
  const calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": () => (expired ? [401, { detail: "token expired" }] : [500, { detail: "down" }]),
    "POST /automations/save": () => [200, task("new2")],
  });
  await cloud.refreshCloud();
  assert.equal(cloud.cloudAutomationsState().access, "signin");
  // The minute's polls under that login ask no more (each 401 refreshes the login's token).
  await cloud.refreshCloud();
  await cloud.refreshCloud();
  assert.equal(calls.length, 1);
  // Signed in again: a new account object, the same email.
  expired = false;
  login("down@example.com");
  await cloud.refreshCloud();
  assert.equal(calls.length, 2);
  assert.deepEqual([cloud.cloudAutomationsState().access, cloud.cloudAutomationsState().items], ["error", null]);
  // Its page finds it (no 找不到此定时任务 until a list reads).
  await cloud.saveCloudAutomation({ ...cloud.cloudDraftOf(null), prompt: "hi", timezone: SH });
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => a.id), ["new2"]);
});

test("saving puts the saved task in the list; one task read anew, and dropped once the server has none", async (t) => {
  login("save@example.com");
  const calls = chatgpt(t, {
    "GET /automations?filter=scheduled&limit=25": { items: [] },
    "GET /automations?limit=100": { items: [task("a1")] },
    "POST /automations/save": (body) => [200, task(body.jawbone_id ?? "new", { title: body.title, schedule: body.schedule })],
    "GET /automation/a1": () => [410, { detail: "Gone" }],
  });
  await cloud.refreshCloud();
  const made = await cloud.saveCloudAutomation({ ...cloud.cloudDraftOf(null), prompt: "water the plants", timezone: SH });
  assert.equal(made.id, "new");
  assert.equal(calls.at(-1).body.jawbone_id, null);
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => a.id), ["new", "a1"]);
  const existing = cloud.cloudAutomationsState().items[1];
  await cloud.saveCloudAutomation({ ...cloud.cloudDraftOf(existing), name: "Renamed" }, existing);
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => a.title), ["water the plants", "Renamed"]);
  assert.equal(await cloud.readCloudAutomation("a1"), null);
  assert.deepEqual(cloud.cloudAutomationsState().items.map((a) => a.id), ["new"]);
});

test("runs: a page, the next one, a fresh read that keeps what is below, read marks, and opening one in ChatGPT", async (t) => {
  const run = (id, extra = {}) => ({ id, status: "completed", chat_ref: { type: "chatgpt", id: `conv-${id}` }, is_unread: false, summary: `s ${id}`, started_at: "2026-10-30T01:00:00Z", updated_at: `u-${id}`, ...extra });
  let first = [run("r3", { status: "in_progress", is_unread: true }), run("r2", { chat_ref: { type: "codex", id: "t" } })];
  const log = [];
  const calls = chatgpt(t, {
    "GET /automation/a1/runs?limit=25&include_chat_ref=true": () => [200, { runs: first, cursor: "p2" }],
    "GET /automation/a1/runs?cursor=p2&limit=25&include_chat_ref=true": { runs: [run("r1", { status: "weird", chat_ref: null })], cursor: null },
    "POST /automation/a1/runs/r3/read": {},
  }, log);
  const page = await cloud.cloudRuns("a1");
  assert.deepEqual(page.items.map((r) => [r.id, r.status, r.chatId, r.unread]), [["r3", "in_progress", "conv-r3", true], ["r2", "completed", null, false]]);
  assert.equal(cloud.runsPollMs(page.items), 5_000);
  await cloud.cloudRuns("a1", true);
  assert.deepEqual(cloud.cloudAutomationsState().runs.a1.items.map((r) => [r.id, r.status, r.chatId]), [["r3", "in_progress", "conv-r3"], ["r2", "completed", null], ["r1", "completed", null]]);
  assert.equal(cloud.cloudAutomationsState().runs.a1.cursor, null);
  assert.equal(await cloud.cloudRuns("a1", true), cloud.cloudAutomationsState().runs.a1);
  first = [run("r4"), run("r3")];
  await cloud.cloudRuns("a1");
  const runs = cloud.cloudAutomationsState().runs.a1;
  assert.deepEqual([runs.items.map((r) => r.id), runs.cursor, runs.pages], [["r4", "r3", "r2", "r1"], null, 2]);
  assert.equal(cloud.runsPollMs(runs.items), 60_000);

  // Opening an unread run marks it first (its stamp sent back), then opens its conversation.
  const opened = [];
  globalThis.window = { open: (...args) => void (log.push(`open ${args[0]}`), opened.push(args)) };
  const unread = cloud.parseCloudRun(run("r3", { is_unread: true }));
  assert.equal(cloud.openCloudRun("a1", unread), true);
  assert.deepEqual(log.slice(-2), ["fetch POST /automation/a1/runs/r3/read", "open https://chatgpt.com/c/conv-r3"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1).body, { read_at: "u-r3" });
  assert.deepEqual(opened.at(-1), ["https://chatgpt.com/c/conv-r3", "_blank", "noopener"]);
  assert.equal(cloud.openCloudRun("a1", cloud.parseCloudRun(run("r2", { chat_ref: null }))), false);
  assert.equal(opened.length, 1);
  cloud.runCloudNow("Automation_1");
  assert.deepEqual(opened.at(-1), ["https://chatgpt.com/scheduled?automationId=Automation_1&automationSource=cloud", "_blank", "noopener"]);
  delete globalThis.window;
});

test("runs: a newest page read before 加载更多 or a read mark landed is read again over them", async (t) => {
  const run = (id, extra = {}) => ({ id, status: "completed", is_unread: false, summary: id, started_at: "2026-10-30T01:00:00Z", updated_at: `u-${id}`, ...extra });
  let gate = null, unread = true;
  chatgpt(t, {
    "GET /automation/c1/runs?limit=25&include_chat_ref=true": () => {
      const answer = [200, { runs: [run("new1", { is_unread: unread })], cursor: "p2" }];
      return gate ? gate.then(() => answer) : answer;
    },
    "GET /automation/c1/runs?cursor=p2&limit=25&include_chat_ref=true": { runs: [run("old1"), run("old2")], cursor: null },
    "POST /automation/c1/runs/new1/read": () => ((unread = false), [200, {}]),
  });
  await cloud.cloudRuns("c1");
  let open;
  gate = new Promise((resolve) => (open = resolve));
  const poll = cloud.cloudRuns("c1"); // watchCloudRuns' poll
  await tick();
  await cloud.cloudRuns("c1", true);
  await cloud.readCloudRun("c1", cloud.cloudAutomationsState().runs.c1.items[0]);
  gate = null;
  open();
  await poll;
  const page = cloud.cloudAutomationsState().runs.c1;
  assert.deepEqual([page.items.map((r) => `${r.id}:${r.unread}`), page.cursor, page.pages], [["new1:false", "old1:false", "old2:false"], null, 2]);
});

test("a read mark that fails puts the unread dot back; a failed runs read keeps what was there", async (t) => {
  chatgpt(t, {
    "GET /automation/b1/runs?limit=25&include_chat_ref=true": { runs: [{ id: "x", status: "completed", is_unread: true, updated_at: "u" }] },
    "POST /automation/b1/runs/x/read": () => [503, { detail: "busy" }],
  });
  await cloud.cloudRuns("b1");
  await assert.rejects(cloud.readCloudRun("b1", cloud.cloudAutomationsState().runs.b1.items[0]), /503/);
  assert.equal(cloud.cloudAutomationsState().runs.b1.items[0].unread, true);
  t.mock.restoreAll();
  chatgpt(t, {});
  const failed = await cloud.cloudRuns("b1");
  assert.deepEqual([failed.items.length, failed.error], [1, "ChatGPT 返回错误（404）：Not Found"]);
});

test("the latest update, the schedule policy, suggestions, shares and a shared task", async (t) => {
  const calls = chatgpt(t, {
    "GET /automation/a1/latest_backing_run?include_snapshot=true": { latest_update: { id: "u1", content_text: "## 摘要", created_at: "2026-10-30T01:00:00Z", metadata: { automation_requires_user_action: true } }, last_backing_run: { status: "failed" } },
    "GET /automation/a2/latest_backing_run?include_snapshot=true": { id: "u2", content_text: "ok", metadata: {} },
    "GET /automation/a3/latest_backing_run?include_snapshot=true": { latest_update: null, last_backing_run: null },
    "GET /automations/schedule_policy": { minute_schedule_available: true, max_iterations_per_hour: 4 },
    "GET /suggested_automations": [{ announcement_id: "s1", emoji: "🍽️", title: "Meals", description: "Plan", user_message: "Plan my meals" }, { announcement_id: "s2", title: "Locked", user_message: "x", locked: { is_locked: true } }],
    "GET /share/automation/a1/current": { automation_id: "a1", current_share: null },
    "GET /share/automation/a2/current": { automation_id: "a2", current_share: { post_id: "p2", permalink: "https://chatgpt.com/s/t_p2" } },
    "POST /share/automation": { post_id: "p1", permalink: "https://chatgpt.com/s/t_p1" },
    "POST /share/automation/a2/refresh": { post_id: "p2", permalink: "https://chatgpt.com/s/t_p2b" },
    "DELETE /share/automation/a2": null,
    "GET /share/post/p9/automation": { post: { id: "p9", is_owner: false }, automation: { source_automation_id: "Automation_9", title: "Weekly", prompt: "review", schedule: "BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYHOUR=16;BYMINUTE=0;BYDAY=FR\nEND:VEVENT", source_timezone: "Europe/Berlin", timing_mode: "flexible_schedule", model_selection: { model_slug: "gpt-5", thinking_effort: "medium" }, importable: false } },
  });
  assert.deepEqual(await cloud.latestBackingRun("a1"), { markdown: "## 摘要", at: Date.parse("2026-10-30T01:00:00Z"), requiresAction: true, failed: true });
  assert.deepEqual(await cloud.latestBackingRun("a2"), { markdown: "ok", at: null, requiresAction: false, failed: false });
  assert.deepEqual(await cloud.latestBackingRun("a3"), { markdown: "", at: null, requiresAction: false, failed: false });

  const policy = await cloud.schedulePolicy();
  assert.deepEqual(policy, { minutes: true, maxPerHour: 4 });
  assert.deepEqual(cloud.minuteOptions(policy), [15, 30, 45]);
  assert.deepEqual(cloud.minuteOptions({ minutes: true, maxPerHour: -1 }).slice(0, 3), [1, 2, 3]);
  assert.equal(cloud.minuteOptions({ minutes: true, maxPerHour: -1 }).length, 59);
  assert.deepEqual(cloud.minuteOptions({ minutes: true, maxPerHour: 1 }), []);
  assert.deepEqual(cloud.minuteOptions({ minutes: false, maxPerHour: -1 }), []);

  assert.deepEqual(await cloud.cloudSuggestions(), [{ id: "s1", emoji: "🍽️", title: "Meals", description: "Plan", prompt: "Plan my meals" }]);

  assert.equal(await cloud.shareCurrent("a1"), null);
  assert.deepEqual(await cloud.shareCurrent("a2"), { postId: "p2", permalink: "https://chatgpt.com/s/t_p2" });
  assert.deepEqual(await cloud.createShare("a1"), { postId: "p1", permalink: "https://chatgpt.com/s/t_p1" });
  assert.deepEqual(calls.at(-1), { method: "POST", path: "/share/automation", body: { automation_id: "a1" } });
  assert.deepEqual(await cloud.refreshShare("a2"), { postId: "p2", permalink: "https://chatgpt.com/s/t_p2b" });
  assert.equal(calls.at(-1).body, undefined);
  await cloud.removeShare("a2");
  assert.deepEqual(calls.at(-1), { method: "DELETE", path: "/share/automation/a2", body: undefined });
  await assert.rejects(cloud.refreshShare("a1"), /404/);

  const shared = await cloud.readSharedPost("p9");
  assert.deepEqual(shared, {
    postId: "p9", isOwner: false, sourceId: "Automation_9", title: "Weekly", prompt: "review", schedule: "BEGIN:VEVENT\nRRULE:FREQ=WEEKLY;BYHOUR=16;BYMINUTE=0;BYDAY=FR\nEND:VEVENT",
    timezone: "Europe/Berlin", timingMode: "flexible_schedule", model: "gpt-5", effort: "medium", importable: false,
  });
  const draft = cloud.cloudDraftOf(shared);
  assert.deepEqual([draft.id, draft.name, draft.mode, draft.time, draft.timezone, draft.model, draft.effort, draft.newChat, draft.emoji], [null, "Weekly", "weekly", "16:00", "Europe/Berlin", "gpt-5", "medium", false, null]);
});

test("what keeps a cloud draft from saving, the first reason only", () => {
  const now = Date.parse("2026-10-30T04:00:00Z"); // 12:00 in Shanghai
  const d = { ...cloud.cloudDraftOf(null, now), prompt: "go", timezone: SH };
  const policy = { minutes: true, maxPerHour: 4 };
  assert.equal(cloud.cloudProblem(d, policy, now), null);
  assert.equal(cloud.cloudProblem({ ...d, prompt: " " }, policy, now), "添加指令。");
  assert.equal(cloud.cloudProblem({ ...d, prompt: "x".repeat(100_001) }, policy, now), "请使用不超过 100,000 个字符");
  const once = { ...d, repeat: false };
  assert.equal(cloud.cloudProblem({ ...once, date: "2026-10-30", time: "11:59" }, policy, now), "请选择未来的日期和时间");
  assert.equal(cloud.cloudProblem({ ...once, date: "2026-10-30", time: "12:01" }, policy, now), null);
  assert.equal(cloud.cloudProblem({ ...once, date: "2028-10-31", time: "09:00" }, policy, now), "请选择未来两年内的日期");
  assert.equal(cloud.cloudProblem({ ...once, date: "" }, policy, now), "请选择未来的日期和时间");
  assert.equal(cloud.cloudProblem({ ...d, until: "2026-10-29" }, policy, now), "请选择今天或之后的日期作为结束日期");
  assert.equal(cloud.cloudProblem({ ...d, until: "2026-10-30" }, policy, now), null);
  const minutes = { ...d, mode: "hourly", rrule: "RRULE:FREQ=MINUTELY;INTERVAL=10" };
  assert.equal(cloud.cloudProblem(minutes, policy, now), "请选择 15 分钟或更长的时间间隔");
  assert.equal(cloud.cloudProblem({ ...minutes, rrule: "RRULE:FREQ=MINUTELY;INTERVAL=15" }, policy, now), null);
  assert.equal(cloud.cloudProblem(minutes, { minutes: false, maxPerHour: 0 }, now), "请选择 60 分钟或更长的时间间隔");
  assert.equal(cloud.cloudProblem(minutes, null, now), null);
  const custom = { ...d, mode: "custom" };
  assert.equal(cloud.cloudProblem({ ...custom, rrule: "FREQ=SOMETIMES" }, policy, now), "请输入有效的 RRULE");
  assert.equal(cloud.cloudProblem({ ...custom, rrule: "" }, policy, now), "请输入有效的 RRULE");
  // The server reads what context/rrule.mjs does not run (UNTIL, a time zone, BYSETPOS).
  assert.equal(cloud.cloudProblem({ ...custom, rrule: "DTSTART;TZID=Europe/Berlin:20261101T090000\nRRULE:FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1" }, policy, now), null);
});
