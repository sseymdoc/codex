// Run with `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { changesOf, draftOf, folderChoices, inputOf, intervalOf, modeOf, placeFor, problemOf, sessionChoices, withDay, withDestination, withInterval, withMode, withModel, withTime } from "./scheduled-form.ts";

const project = { id: "p1", name: "Repo", roots: [{ path: "D:\\repo" }], metadata: {} };
const ssh = { id: "p2", name: "Host", roots: [{ path: "/srv/app" }], metadata: { "codexUi.environment": JSON.stringify({ version: 1, kind: "ssh", ssh: { connectionId: "c1", folders: ["/srv/app"] } }) } };
const task = (over = {}) => ({
  id: "nightly", kind: "cron", name: "Nightly", prompt: "Check the build", status: "ACTIVE", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA",
  model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 1, updatedAt: 1, cwds: ["D:\\repo"], target: null, executionEnvironment: "local", autoArchive: false,
  nextRunAt: 1000, nextRunNominalAt: 1000, lastRunAt: null, running: false, dir: "C:/home/automations/nightly", ...over,
});
const none = { kind: "projectless" };
const NOW = new Date(2026, 9, 30, 12, 0).getTime();
const at = (initial = null, folder = true) => ({ initial, now: NOW, folder });

test("draftOf: new cron, seeds, and a task's fields", () => {
  const fresh = draftOf(null, null, placeFor("D:\\repo", [project]), [project]);
  assert.deepEqual(fresh.place, { kind: "project", projectId: "p1", cwd: "D:\\repo" });
  assert.equal(fresh.destination, "cron");
  assert.equal(fresh.mode, "daily");
  assert.equal(fresh.rrule, "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA");
  // A session's 添加定时任务…: on that session, or (null) on one made for the task.
  assert.equal(draftOf(null, { kind: "heartbeat", targetThreadId: "t1" }, none, []).destination, "thread");
  assert.equal(draftOf(null, { kind: "heartbeat", targetThreadId: null }, none, []).destination, "dedicated");
  const seeded = draftOf(null, { name: "每日简报", prompt: "brief", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR" }, none, []);
  assert.equal(seeded.mode, "weekdays");
  assert.equal(seeded.name, "每日简报");
  const edit = draftOf(task({ executionEnvironment: "worktree", notificationPolicy: "failed_runs_only", model: "gpt-5", reasoningEffort: "high" }), null, none, [project]);
  assert.deepEqual([edit.worktree, edit.failedOnly, edit.model, edit.effort, edit.place.kind], [true, true, "gpt-5", "high", "project"]);
  assert.deepEqual(draftOf(task({ cwds: ["D:\\other"] }), null, none, [project]).place, { kind: "folder", cwd: "D:\\other" });
  assert.deepEqual(draftOf(task({ cwds: [], target: { type: "projectless" } }), null, none, [project]).place, none);
  // A project target from the ChatGPT app's file names that project's folder.
  assert.deepEqual(draftOf(task({ cwds: [], target: { type: "project", projectId: "p1" } }), null, none, [project]).place, { kind: "project", projectId: "p1", cwd: "D:\\repo" });
  const beat = draftOf(task({ kind: "heartbeat", targetThreadId: "t9", rrule: "RRULE:FREQ=MINUTELY;INTERVAL=30" }), null, none, []);
  assert.deepEqual([beat.destination, beat.targetThreadId, beat.mode], ["thread", "t9", "hourly"]);
  // Monthly has no local editor: custom.
  assert.equal(modeOf("RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=1"), "custom");
});

test("inputOf: project, folder, projectless and heartbeat outputs", () => {
  const base = draftOf(null, { prompt: "p" }, none, []);
  const project1 = inputOf({ ...base, place: { kind: "project", projectId: "p1", cwd: "D:\\repo" }, worktree: true, model: "gpt-5", effort: "low", autoArchive: true, failedOnly: true });
  assert.deepEqual(project1, { kind: "cron", name: "", prompt: "p", rrule: base.rrule, notificationPolicy: "failed_runs_only", model: "gpt-5", reasoningEffort: "low", autoArchive: true, cwds: ["D:\\repo"], executionEnvironment: "worktree" });
  // A folder saves the same way (the server derives no project target from it).
  assert.deepEqual(inputOf({ ...base, place: { kind: "folder", cwd: "D:\\x" } }).cwds, ["D:\\x"]);
  const loose = inputOf({ ...base, place: none, worktree: true });
  assert.deepEqual([loose.cwds, loose.executionEnvironment], [[], "local"]);
  assert.deepEqual(inputOf({ ...base, name: "  Watch  ", destination: "thread", targetThreadId: "t1", model: "gpt-5" }), { kind: "heartbeat", name: "Watch", prompt: "p", rrule: base.rrule, notificationPolicy: null, targetThreadId: "t1" });
  assert.equal("targetThreadId" in inputOf({ ...base, destination: "dedicated" }), false);
});

test("changesOf: only what changed, never the kind", () => {
  const initial = draftOf(task({ cwds: [], target: { type: "project", projectId: "p1" } }), null, none, [project]);
  assert.deepEqual(changesOf(inputOf(initial), inputOf(initial)), {});
  // Renaming leaves the folder (and so the project target) out of the patch.
  assert.deepEqual(changesOf(inputOf(initial), inputOf({ ...initial, name: "New" })), { name: "New" });
  assert.deepEqual(changesOf(inputOf(initial), inputOf({ ...initial, place: none })), { cwds: [] });
});

test("problemOf: Claude dn's order with the ChatGPT checks", () => {
  const initial = draftOf(task(), null, none, [project]);
  const fresh = draftOf(null, null, none, []);
  assert.equal(problemOf({ ...initial, name: " ", prompt: "" }, at(initial)), "请输入名称。");
  assert.equal(problemOf({ ...fresh, prompt: "" }, at()), "添加指令。");
  // A new task may go unnamed (the server names it after its prompt).
  assert.equal(problemOf({ ...fresh, prompt: "go" }, at()), null);
  assert.equal(problemOf({ ...fresh, prompt: "x".repeat(100_001) }, at()), "请使用不超过 100,000 个字符");
  assert.equal(problemOf({ ...fresh, prompt: "go", destination: "thread", targetThreadId: null }, at()), "请选择会话。");
  assert.equal(problemOf({ ...fresh, prompt: "go", destination: "dedicated" }, at(null, false)), "请先选择一个文件夹。");
  assert.equal(problemOf({ ...fresh, prompt: "go", mode: "custom", rrule: "FREQ=SOMETIMES" }, at()), "请输入有效的 RRULE（FREQ=SOMETIMES）");
  assert.equal(problemOf({ ...fresh, prompt: "go", mode: "custom", rrule: "  " }, at()), "请输入有效的 RRULE");
  assert.equal(problemOf({ ...fresh, prompt: "go", mode: "daily", rrule: "FREQ=SOMETIMES" }, at()), "请输入有效的日程安排。");
  assert.equal(problemOf(initial, at(initial)), "没有需要保存的更改。");
  assert.equal(problemOf({ ...initial, prompt: "Check again" }, at(initial)), null);
  // An edit leaves an unchanged schedule alone: a one-time task that ran still renames.
  const ran = draftOf(task({ rrule: "DTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=1" }), null, none, []);
  assert.equal(problemOf({ ...ran, name: "Renamed" }, at(ran)), null);
  assert.match(problemOf({ ...ran, rrule: "DTSTART:20260102T090000\nRRULE:FREQ=DAILY;COUNT=1" }, at(ran)), /不会再运行/);
});

test("schedule editor: modes, interval, time, weekdays", () => {
  const daily = draftOf(null, null, none, []);
  const hourly = withMode(daily, "hourly");
  assert.equal(hourly.rrule, "RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA");
  assert.deepEqual(intervalOf(withInterval(hourly, 3, "hour").rrule), { every: 3, unit: "hour" });
  assert.equal(withInterval(hourly, 15, "minute").rrule, "RRULE:FREQ=MINUTELY;INTERVAL=15");
  assert.deepEqual(intervalOf(withInterval(withInterval(hourly, 15, "minute"), 2, "hour").rrule), { every: 2, unit: "hour" });
  // Minutes picked for a heartbeat go to whole hours once it runs as a cron task again; a heartbeat keeps them.
  const beat = withInterval({ ...hourly, destination: "thread", targetThreadId: "t1" }, 150, "minute");
  assert.deepEqual(intervalOf(withDestination(beat, { destination: "cron" }).rrule), { every: 3, unit: "hour" });
  assert.deepEqual(intervalOf(withDestination(withInterval(beat, 5, "minute"), { destination: "cron" }).rrule), { every: 1, unit: "hour" });
  assert.equal(withDestination(beat, { destination: "dedicated" }).rrule, beat.rrule);
  assert.equal(withDestination(daily, { destination: "cron" }).rrule, daily.rrule);
  // By way of the custom editor: its text stays, and the hourly editor then shows whole hours.
  const typed = withDestination(withMode(withInterval(beat, 5, "minute"), "custom"), { destination: "cron" });
  assert.equal(typed.rrule, withInterval(beat, 5, "minute").rrule);
  assert.deepEqual(intervalOf(withMode(typed, "hourly").rrule), { every: 1, unit: "hour" });
  assert.deepEqual(intervalOf(withMode({ ...typed, destination: "thread" }, "hourly").rrule), { every: 5, unit: "minute" });
  // The time and the weekdays carry over between modes.
  const at10 = withTime(daily, "10:30");
  assert.equal(at10.rrule, "RRULE:FREQ=WEEKLY;BYHOUR=10;BYMINUTE=30;BYDAY=SU,MO,TU,WE,TH,FR,SA");
  assert.equal(withMode(at10, "weekdays").rrule, "RRULE:FREQ=WEEKLY;BYHOUR=10;BYMINUTE=30;BYDAY=MO,TU,WE,TH,FR");
  const weekly = withMode(at10, "weekly");
  assert.equal(weekly.mode, "weekly");
  const fewer = withDay(withDay(weekly, "SU"), "SA");
  assert.equal(fewer.rrule, "RRULE:FREQ=WEEKLY;BYHOUR=10;BYMINUTE=30;BYDAY=MO,TU,WE,TH,FR");
  const one = ["MO", "TU", "WE", "TH"].reduce(withDay, fewer);
  assert.equal(one.rrule, "RRULE:FREQ=WEEKLY;BYHOUR=10;BYMINUTE=30;BYDAY=FR");
  assert.equal(withDay(one, "FR"), one, "the last weekday stays");
  // Custom keeps the text; back to daily writes the daily rule at the rule's time.
  const custom = withMode({ ...weekly, rrule: "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=7;BYMINUTE=15;BYMONTHDAY=1" }, "custom");
  assert.equal(custom.rrule, "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=7;BYMINUTE=15;BYMONTHDAY=1");
  assert.equal(withMode(custom, "daily").rrule, "RRULE:FREQ=WEEKLY;BYHOUR=7;BYMINUTE=15;BYDAY=SU,MO,TU,WE,TH,FR,SA");
  assert.equal(withMode(withMode(daily, "hourly"), "hourly").rrule, hourly.rrule);
});

test("withModel: an effort the new model lacks goes back to the default", () => {
  const models = [
    { id: "a", model: "a", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }] },
    { id: "b", model: "b", supportedReasoningEfforts: [{ reasoningEffort: "low" }] },
  ];
  const d = { ...draftOf(null, null, none, []), model: "a", effort: "high" };
  assert.equal(withModel(d, "b", models, "a").effort, null);
  assert.equal(withModel({ ...d, effort: "low" }, "b", models, "a").effort, "low");
  // 默认 is the default model's efforts.
  assert.deepEqual([withModel(d, null, models, "a").model, withModel(d, null, models, "a").effort], [null, "high"]);
});

test("folderChoices and sessionChoices", () => {
  const recent = ["D:\\repo\\sub", "D:\\a", "D:\\b", "D:\\c", "D:\\d", "D:\\e", "D:\\f", "D:\\g", "D:\\h", "D:\\i"];
  const choices = folderChoices([project, ssh], recent);
  assert.deepEqual(choices.projects, [{ kind: "project", projectId: "p1", cwd: "D:\\repo" }]);
  assert.deepEqual(choices.folders, ["D:\\a", "D:\\b", "D:\\c", "D:\\d", "D:\\e", "D:\\f", "D:\\g", "D:\\h"]);
  assert.deepEqual(folderChoices([project], recent, "\\i").folders, ["D:\\i"]);
  assert.deepEqual(folderChoices([project], recent, "rep").projects.length, 1);

  const meta = (id, over = {}) => ({ meta: { id, name: `S ${id}`, preview: "", parentThreadId: null, source: "vscode", ...over } });
  const threads = { t1: meta("t1"), t2: meta("t2"), kid: meta("kid", { parentThreadId: "t1" }), old: meta("old"), w: meta("w") };
  const items = [task({ id: "hb", kind: "heartbeat", targetThreadId: "w" }), task({ id: "off", kind: "heartbeat", status: "PAUSED", targetThreadId: "t2" })];
  const ids = ["t1", "t2", "kid", "old", "w", "gone"];
  const archived = (id) => id === "old";
  assert.deepEqual(sessionChoices(ids, threads, items, null, archived).map((s) => s.id), ["t1", "t2"]);
  // The heartbeat being edited keeps its own session.
  assert.deepEqual(sessionChoices(ids, threads, items, "hb", archived).map((s) => s.id), ["t1", "t2", "w"]);
  assert.deepEqual(sessionChoices(ids, threads, items, null, archived, "s t2"), [{ id: "t2", title: "S t2" }]);
});
