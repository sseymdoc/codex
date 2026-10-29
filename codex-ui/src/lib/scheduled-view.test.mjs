// Run with `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VIEW, cloudCard, cloudMark, dayTime, defaultName, filterCount, localCard, navMark, runRows, statusOf, viewCards, zoneLabel } from "./scheduled-view.ts";

const task = (over = {}) => ({
  id: "nightly", kind: "cron", name: "Nightly", prompt: "Check the build", status: "ACTIVE", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA",
  model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 1, updatedAt: 1, cwds: [], target: { type: "projectless" },
  nextRunAt: 1000, nextRunNominalAt: 1000, lastRunAt: null, running: false, dir: "C:/home/automations/nightly", ...over,
});
const run = (over = {}) => ({ threadId: "t1", automationId: "nightly", status: "PENDING_REVIEW", readAt: null, threadTitle: null, sourceCwd: null, inboxTitle: null, inboxSummary: null, archivedUserMessage: null, archivedAssistantMessage: null, archivedReason: null, createdAt: 1, updatedAt: 1, ...over });
const thread = (id, status = { type: "idle" }, last = "completed") => ({ meta: { id, name: `Session ${id}`, preview: "", status }, turns: [{ id: "x", status: last, items: [] }] });
const project = { id: "p1", name: "Repo", roots: [{ path: "D:\\repo" }], metadata: {} };

test("localCard: status, schedule, place and the run-now gate", () => {
  const card = localCard(task(), [], {}, []);
  assert.equal(card.key, "local:nightly");
  assert.equal(card.status, "active");
  assert.equal(card.scheduleText, "每天 9:00 运行");
  assert.deepEqual(card.place, { icon: "Laptop", label: "不在项目中工作" });
  assert.equal(card.cwd, null);
  assert.equal(card.canRunNow, true);
  assert.equal(card.oneTime, false);
  assert.equal(localCard(task({ status: "PAUSED" }), [], {}, []).status, "paused");
  // A one-time task that ran has no next run: completed.
  const once = localCard(task({ rrule: "DTSTART:20261101T090000\nRRULE:FREQ=DAILY;COUNT=1", nextRunAt: null, lastRunAt: 5 }), [], {}, []);
  assert.equal(once.status, "completed");
  assert.equal(once.oneTime, true);
  // Not run yet, or paused: not completed.
  assert.equal(localCard(task({ nextRunAt: null, lastRunAt: null }), [], {}, []).status, "active");
  assert.equal(localCard(task({ status: "PAUSED", nextRunAt: null, lastRunAt: 5 }), [], {}, []).status, "paused");
  assert.equal(localCard(task({ running: true }), [], {}, []).canRunNow, false);
  assert.equal(localCard(task({ prompt: "  " }), [], {}, []).canRunNow, false);
  // An unnamed task goes by its prompt's start.
  assert.equal(localCard(task({ name: "" }), [], {}, []).name, "Check the build");
});

test("localCard: a folder in a project names the project, else the folder; a heartbeat names its session", () => {
  assert.deepEqual([localCard(task({ cwds: ["D:/repo/sub"], target: null }), [], {}, [project])].map((c) => [c.place.label, c.cwd]), [["Repo", "D:/repo/sub"]]);
  assert.deepEqual([localCard(task({ cwds: ["D:/other/tool"], target: null }), [], {}, [project])].map((c) => [c.place.label, c.cwd]), [["tool", "D:/other/tool"]]);
  assert.deepEqual([localCard(task({ target: { type: "project", projectId: "p1" } }), [], {}, [project])].map((c) => [c.place.label, c.cwd]), [["Repo", "D:\\repo"]]);
  const beat = task({ kind: "heartbeat", targetThreadId: "t9", cwds: undefined, target: undefined });
  assert.equal(localCard(beat, [], { t9: thread("t9") }, []).place.label, "心跳 • Session t9");
  assert.equal(localCard(beat, [], {}, []).place.label, "心跳 • 会话不可用");
  assert.equal(localCard(beat, [], {}, []).heartbeatThread, "t9");
  assert.equal(localCard(beat, [], {}, []).cwd, null);
});

test("navMark: error > waiting > new run > running, from this task's runs only", () => {
  const items = [task()];
  assert.equal(navMark(items, [], {}), null);
  assert.equal(navMark([task({ running: true })], [], {}), "running");
  assert.equal(navMark(items, [run({ status: "IN_PROGRESS" })], {}), "running");
  assert.equal(navMark(items, [run(), run({ threadId: "t2", status: "IN_PROGRESS" })], {}), "unread");
  // Read or archived runs are not news.
  assert.equal(navMark(items, [run({ readAt: 3 }), run({ threadId: "t2", status: "ARCHIVED" })], {}), null);
  const waiting = { t2: thread("t2", { type: "active", activeFlags: ["waitingOnApproval"] }) };
  assert.equal(navMark(items, [run(), run({ threadId: "t2", status: "IN_PROGRESS" })], waiting), "blocked");
  // A run read, taken over or archived is the user's: their own turn waiting there is not the task's.
  for (const over of [{ readAt: 3 }, { status: "ACCEPTED", readAt: 3 }, { status: "ARCHIVED" }]) assert.equal(navMark(items, [run({ threadId: "t2", ...over })], waiting), null);
  const failed = { ...waiting, t3: thread("t3", { type: "idle" }, "failed") };
  assert.equal(navMark(items, [run(), run({ threadId: "t2", status: "IN_PROGRESS" }), run({ threadId: "t3" })], failed), "error");
  // A failed run already read is not an error any more.
  assert.equal(navMark(items, [run({ threadId: "t3", readAt: 9 })], failed), null);
  assert.equal(navMark(items, [run({ threadId: "t4", status: "IN_PROGRESS" })], { t4: thread("t4", { type: "systemError" }) }), "error");
  // A card counts its own task's runs.
  assert.equal(localCard(task({ id: "other" }), [run()], {}, []).mark, null);
  assert.equal(localCard(task(), [run()], {}, []).mark, "unread");
});

test("viewCards: filters, search, sort and the hidden completed count", () => {
  const cards = [
    localCard(task({ id: "b", name: "Beta", nextRunAt: 300 }), [], {}, []),
    localCard(task({ id: "a", name: "Alpha", nextRunAt: 200, prompt: "Summarize the INBOX" }), [], {}, []),
    localCard(task({ id: "p", name: "Paused", status: "PAUSED", nextRunAt: 100 }), [], {}, []),
    localCard(task({ id: "o", name: "Once", rrule: "DTSTART:20261101T090000\nRRULE:FREQ=DAILY;COUNT=1", nextRunAt: 150 }), [], {}, []),
    localCard(task({ id: "c", name: "Done", rrule: "DTSTART:20261001T090000\nRRULE:FREQ=DAILY;COUNT=1", nextRunAt: null, lastRunAt: 5 }), [], {}, []),
    localCard(task({ id: "z", name: "周报", nextRunAt: 350 }), [], {}, []),
    localCard(task({ id: "y", name: "测试", nextRunAt: 350 }), [], {}, []),
  ];
  const ids = (v) => viewCards(cards, { ...DEFAULT_VIEW, ...v }).shown.map((c) => c.id);
  // By next run, ties by name (测试 before 周报 in pinyin), paused (and completed) last; completed hidden by default.
  assert.deepEqual(ids({}), ["o", "a", "b", "y", "z", "p"]);
  assert.equal(viewCards(cards, DEFAULT_VIEW).hiddenCompleted, 1);
  assert.deepEqual(ids({ showCompleted: true }), ["o", "a", "b", "y", "z", "c", "p"]);
  // Chinese names in pinyin order (测试 before 周报), ahead of Latin ones as zh-CN collates.
  assert.deepEqual(ids({ sort: "name" }), ["y", "z", "a", "b", "o", "p"]);
  assert.deepEqual(ids({ status: "paused" }), ["p"]);
  // Filtering for completed shows them whatever 包含已完成 says.
  assert.deepEqual(ids({ status: "completed" }), ["c"]);
  assert.equal(viewCards(cards, { ...DEFAULT_VIEW, status: "completed" }).hiddenCompleted, 0);
  assert.deepEqual(ids({ schedule: "once", showCompleted: true }), ["o", "c"]);
  assert.deepEqual(ids({ schedule: "recurring" }), ["a", "b", "y", "z", "p"]);
  assert.deepEqual(ids({ runsOn: "cloud" }), []);
  assert.deepEqual(ids({ runsOn: "local", status: "active" }), ["o", "a", "b", "y", "z"]);
  // Names and prompts, any case.
  assert.deepEqual(ids({ query: "inbox" }), ["a"]);
  assert.deepEqual(ids({ query: " BET " }), ["b"]);
  assert.deepEqual(ids({ query: "done" }), []);
  assert.equal(viewCards(cards, { ...DEFAULT_VIEW, query: "done" }).hiddenCompleted, 1);
  assert.equal(filterCount(DEFAULT_VIEW), 0);
  assert.equal(filterCount({ ...DEFAULT_VIEW, schedule: "once", status: "paused", query: "x", sort: "name" }), 2);
});

const DAILY = "BEGIN:VEVENT\nRRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0\nEND:VEVENT";
const cloud = (over = {}) => ({
  id: "c1", title: "News", prompt: "Summarize the news", schedule: DAILY, timezone: "Asia/Shanghai", timingMode: "flexible_schedule", enabled: true,
  emailEnabled: false, notificationsEnabled: true, nextRunAt: 250, lastRunAt: null, updatedAt: "", threadMode: "existing_chat", model: null,
  effort: null, emoji: null, status: "active", triggered: false, onceAt: null, canManage: true, canDelete: true, canShare: true, ...over,
});
const cloudRun = (over = {}) => ({ id: "r1", status: "completed", chatId: "chat-1", unread: false, summary: "", startedAt: 1, updatedAt: "", ...over });

test("cloudCard: the schedule on its own time zone, an end date left out, one run, an event; what managing allows", () => {
  const card = cloudCard(cloud(), undefined, 0);
  assert.deepEqual([card.key, card.source, card.status, card.oneTime, card.nextRunAt], ["cloud:c1", "cloud", "active", false, 250]);
  assert.equal(card.scheduleText, "每天 9:00 GMT+8 运行");
  assert.deepEqual(card.place, { icon: "Cloud", label: "云端" });
  assert.deepEqual([card.canRunNow, card.canPause, card.canEdit, card.canShare, card.canDelete, card.expired], [true, true, true, true, true, false]);
  // UNTIL is the page's to say (重复结束于), wherever the rule holds it.
  assert.equal(cloudCard(cloud({ schedule: "BEGIN:VEVENT\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0;UNTIL=20261130T155959Z\nEND:VEVENT" }), undefined, 0).scheduleText, "每天 9:00 GMT+8 运行");
  assert.equal(cloudCard(cloud({ schedule: "RRULE:UNTIL=20261130T155959Z;FREQ=DAILY;BYHOUR=9;BYMINUTE=0", timezone: "UTC" }), undefined, 0).scheduleText, "每天 9:00 UTC 运行");
  // One run, on the task's clock, not this machine's.
  const once = cloud({ schedule: "BEGIN:VEVENT\nDTSTART;TZID=Asia/Shanghai:20261030T090000\nEND:VEVENT", onceAt: Date.UTC(2026, 9, 30, 1) });
  assert.equal(cloudCard(once, undefined, 0).scheduleText, "于 2026年10月30日 09:00 GMT+8 运行一次");
  assert.equal(cloudCard(once, undefined, 0).oneTime, true);
  assert.equal(cloudCard(cloud({ schedule: "", onceAt: null }), undefined, 0).scheduleText, "运行一次");
  // An event-triggered task runs on its events: no run now, no schedule to edit; still paused and deleted.
  const event = cloudCard(cloud({ triggered: true, schedule: "X-UNSCHEDULED:1" }), undefined, 0);
  assert.deepEqual([event.scheduleText, event.oneTime, event.canRunNow, event.canEdit, event.canPause], ["由事件触发", false, false, false, true]);
  // A reader only looks; a completed task does not pause.
  const reader = cloudCard(cloud({ canManage: false, canDelete: false, canShare: false }), undefined, 0);
  assert.deepEqual([reader.canRunNow, reader.canPause, reader.canEdit, reader.canShare, reader.canDelete], [false, false, false, false, false]);
  assert.equal(cloudCard(cloud({ status: "completed" }), undefined, 0).canPause, false);
  assert.equal(cloudCard(cloud({ title: "", prompt: "  Look at\nthe news " }), undefined, 0).name, "Look at the news");
  // A paused one-time task past its time cannot resume.
  assert.equal(cloudCard(cloud({ ...once, status: "paused" }), undefined, Date.UTC(2026, 9, 30, 2)).expired, true);
  assert.equal(cloudCard(cloud({ ...once, status: "paused" }), undefined, Date.UTC(2026, 9, 30, 0)).expired, false);
  assert.equal(cloudCard(cloud({ ...once, status: "active" }), undefined, Date.UTC(2026, 9, 30, 2)).expired, false);
});

test("cloudMark: nothing before the runs are read, then a failed unread run > an unread run > one under way", () => {
  assert.equal(cloudMark(undefined), null);
  assert.equal(cloudMark([cloudRun()]), null);
  assert.equal(cloudMark([cloudRun({ status: "in_progress" })]), "running");
  assert.equal(cloudMark([cloudRun({ status: "in_progress" }), cloudRun({ unread: true })]), "unread");
  assert.equal(cloudMark([cloudRun({ unread: true }), cloudRun({ status: "failed", unread: true })]), "error");
  // A failed run already read is not news.
  assert.equal(cloudMark([cloudRun({ status: "failed" })]), null);
  assert.equal(cloudCard(cloud(), [cloudRun({ unread: true })], 0).mark, "unread");
});

test("viewCards: cloud cards beside local ones, by 运行于 and next run", () => {
  const cards = [localCard(task({ id: "l", name: "Local", nextRunAt: 300 }), [], {}, []), cloudCard(cloud(), undefined, 0), cloudCard(cloud({ id: "c2", title: "Paused", status: "paused", nextRunAt: 10 }), undefined, 0)];
  const ids = (v) => viewCards(cards, { ...DEFAULT_VIEW, ...v }).shown.map((c) => c.id);
  assert.deepEqual(ids({}), ["c1", "l", "c2"]);
  assert.deepEqual(ids({ runsOn: "cloud" }), ["c1", "c2"]);
  assert.deepEqual(ids({ runsOn: "local" }), ["l"]);
  assert.deepEqual(ids({ runsOn: "cloud", status: "active" }), ["c1"]);
  assert.deepEqual(ids({ query: "news" }), ["c1", "c2"]);
});

test("zoneLabel: a zone's short name, else the zone as given", () => {
  assert.equal(zoneLabel("Asia/Shanghai"), "GMT+8");
  assert.equal(zoneLabel("UTC"), "UTC");
  assert.equal(zoneLabel("Not/AZone"), "Not/AZone");
});

test("defaultName takes the name, else the prompt's first 80 characters on one line", () => {
  assert.equal(defaultName(" Daily ", "x"), "Daily");
  assert.equal(defaultName("", "  Look at\n\nthe   commits "), "Look at the commits");
  assert.equal(defaultName("", "字".repeat(100)), "字".repeat(80));
});

test("dayTime: today, tomorrow or yesterday by direction, else the date (and another year's), 约 / ~ when jittered", () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime();
  const at = (month, day, hour, minute, year = 2026) => new Date(year, month, day, hour, minute).getTime();
  assert.equal(dayTime(at(9, 30, 9, 5), now, true), "今天 9:05");
  assert.equal(dayTime(at(9, 30, 18, 0), now, true, true), "今天 ~18:00");
  assert.equal(dayTime(at(9, 31, 9, 0), now, true), "明天 9:00");
  assert.equal(dayTime(at(9, 31, 9, 0), now, true, true), "明天 约 9:00");
  assert.equal(dayTime(at(9, 29, 9, 0), now, false, true), "昨天 ~9:00");
  // Yesterday only looking back, tomorrow only ahead.
  assert.equal(dayTime(at(9, 29, 9, 0), now, true), "10月29日 9:00");
  assert.equal(dayTime(at(9, 31, 9, 0), now, false), "10月31日 9:00");
  assert.equal(dayTime(at(10, 5, 16, 30), now, true, true), "11月5日 约 16:30");
  assert.equal(dayTime(at(0, 4, 8, 0, 2027), now, true), "2027年1月4日 8:00");
});

test("statusOf: the chip, the next run at its nominal time, a missed one, a one-time task that ran", () => {
  const now = new Date(2026, 9, 30, 12, 0).getTime();
  const nine = new Date(2026, 9, 31, 9, 0).getTime();
  assert.deepEqual(statusOf(task({ nextRunAt: nine, nextRunNominalAt: nine }), now), { chip: "active", note: "下次运行：明天 9:00" });
  // A jittered run says its nominal time, roughly.
  assert.deepEqual(statusOf(task({ nextRunAt: nine + 90_000, nextRunNominalAt: nine }), now), { chip: "active", note: "下次运行：明天 约 9:00" });
  assert.deepEqual(statusOf(task({ status: "PAUSED", nextRunAt: nine }), now), { chip: "paused", note: null });
  // Due a minute ago is still about to run; three minutes ago no page ran it.
  assert.equal(statusOf(task({ nextRunAt: now - 60_000, nextRunNominalAt: now - 60_000 }), now).note, "下次运行：今天 11:59");
  assert.equal(statusOf(task({ nextRunAt: now - 180_000, nextRunNominalAt: now - 180_000 }), now).note, "原定于 今天 11:57 运行");
  // A one-time task says when it runs (Claude's Runs at).
  const once = new Date(2026, 10, 2, 9, 0).getTime();
  assert.equal(statusOf(task({ rrule: "DTSTART:20261102T090000\nRRULE:FREQ=DAILY;COUNT=1", nextRunAt: once, nextRunNominalAt: once }), now).note, "运行时间：11月2日 9:00");
  assert.deepEqual(statusOf(task({ nextRunAt: null, lastRunAt: 5 }), now), { chip: "completed", note: "此一次性任务已运行。如需再次运行，请设置新的计划。" });
  assert.deepEqual(statusOf(task({ nextRunAt: null, lastRunAt: null }), now), { chip: "active", note: null });
});

test("runRows: this task's runs newest first, running, failed by its session, unread and archived", () => {
  const runs = [
    run({ threadId: "old", createdAt: 1, readAt: 2 }),
    run({ threadId: "new", createdAt: 3, status: "IN_PROGRESS" }),
    run({ threadId: "mid", createdAt: 2, inboxTitle: "Build is red", inboxSummary: "Two tests fail" }),
    run({ threadId: "gone", createdAt: 4, status: "ARCHIVED" }),
    run({ threadId: "else", automationId: "other", createdAt: 5 }),
  ];
  const rows = runRows(runs, "nightly", { mid: thread("mid", { type: "idle" }, "failed"), old: thread("old", { type: "systemError" }) });
  assert.deepEqual(rows.map((r) => [r.threadId, r.state, r.unread, r.archived]), [
    ["gone", "done", false, true],
    ["new", "running", false, false],
    ["mid", "failed", true, false],
    ["old", "failed", false, false],
  ]);
  assert.deepEqual([rows[2].title, rows[2].summary, rows[2].at], ["Build is red", "Two tests fail", 2]);
  assert.deepEqual(runRows(runs, "nightly", {}).map((r) => r.state), ["done", "running", "done", "done"]);
});
