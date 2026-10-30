import assert from "node:assert/strict";
import { test } from "node:test";
import { DESKTOP_TOOLS, validateDesktopInput, validateDesktopResult } from "./desktop-tools.mjs";
import { AUTOMATION_TOOLS, AUTOMATION_TOOL_NAMES, automationAsks, automationResult, kindFields } from "./automation-tools.mjs";

const input = (args, name = "automation_update") => validateDesktopInput(name, args);
const check = (name, args, value) => validateDesktopResult(name, { threadId: "t", cwd: "/p", ...value }, { threadId: "t", cwd: "/p", name, args: validateDesktopInput(name, args) });
const heartbeat = { mode: "create", kind: "heartbeat", name: "Watch CI", prompt: "Check the CI run.", rrule: "FREQ=MINUTELY;INTERVAL=30" };

test("the scheduled-task tools are offered with the other desktop tools, their schemas closed", () => {
  for (const name of AUTOMATION_TOOL_NAMES) assert.ok(DESKTOP_TOOLS.some((tool) => tool.name === name), name);
  for (const tool of AUTOMATION_TOOLS) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
});

test("automation_update takes ChatGPT's fields per mode", () => {
  assert.deepEqual(input({ mode: "list" }), { mode: "list" });
  assert.deepEqual(input({ mode: "view", id: " watch " }), { mode: "view", id: "watch" });
  assert.deepEqual(input(heartbeat), heartbeat);
  assert.deepEqual(input({ mode: "update", id: "nightly", status: "PAUSED", notificationPolicy: null }), { mode: "update", id: "nightly", status: "PAUSED", notificationPolicy: null });
  const cron = { ...heartbeat, kind: "cron", rrule: "FREQ=HOURLY;INTERVAL=2" };
  assert.deepEqual(input({ ...cron, cwds: [" web "], executionEnvironment: "worktree", reasoningEffort: "high" }), { ...cron, cwds: ["web"], executionEnvironment: "worktree", reasoningEffort: "high" });
  // DTSTART is suggested_create's: the user confirms an anchored schedule on a card.
  const anchored = { ...heartbeat, rrule: "DTSTART:20261102T090000\nRRULE:FREQ=DAILY;COUNT=1" };
  assert.throws(() => input(anchored), /create takes no DTSTART[^]*suggested_create/);
  assert.equal(input({ ...anchored, mode: "suggested_create" }).rrule, anchored.rrule);
  for (const [args, message] of [
    [{ mode: "list", id: "x" }, /list takes only mode/],
    [{ mode: "view" }, /view needs the task's id/],
    [{ mode: "delete", id: "x", name: "y" }, /delete takes only mode and id/],
    [{ ...heartbeat, id: "x" }, /leave it out to create one/],
    [{ ...heartbeat, kind: undefined }, /kind must be heartbeat or cron/],
    [{ ...heartbeat, rrule: undefined }, /rrule is required/],
    [{ ...heartbeat, cwds: ["/x"] }, /cwds apply only to cron tasks/],
    [{ ...heartbeat, kind: "cron", targetThreadId: "t" }, /targetThreadId applies only to heartbeats/],
    [{ ...heartbeat, kind: "cron", projectId: "p", cwds: [] }, /projectId or cwds, not both/],
    [{ mode: "update", id: "x", kind: "cron" }, /kind can't change/],
    [{ mode: "update", id: "x" }, /at least one field/],
    [{ mode: "update", id: "x", status: "DELETED" }, /status must be one of/],
    [{ ...heartbeat, extra: 1 }, /Unknown automation_update arguments: extra/],
    [{ ...heartbeat, name: "a\nb" }, /name must be one line/],
    [{ ...heartbeat, targetThreadId: "../x" }, /targetThreadId must be a session id/],
  ]) assert.throws(() => input(args), message, JSON.stringify(args));
});

test("a rule the scheduler cannot run comes back in its words", () => {
  assert.throws(() => input({ ...heartbeat, rrule: "FREQ=DAILY;BYDAY=1MO" }), /rrule can't be used \(unsupported\): 暂不支持带序号的 BYDAY[^]*Supported: FREQ/);
  assert.throws(() => input({ ...heartbeat, rrule: "FREQ=SOMETIMES" }), /rrule can't be used \(invalid\)/);
  assert.throws(() => input({ ...heartbeat, rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;COUNT=1;DTSTART=20200101T000000" }), /create takes no DTSTART/);
  assert.throws(() => input({ ...heartbeat, mode: "suggested_create", rrule: "DTSTART:20200101T090000\nRRULE:FREQ=DAILY;COUNT=1" }), /no-future/);
});

test("an update's fields are checked against its task's kind", () => {
  assert.throws(() => kindFields("heartbeat", { model: "m" }), /model apply only to cron tasks/);
  assert.throws(() => kindFields("cron", { targetThreadId: "t" }), /targetThreadId applies only to heartbeats/);
  assert.doesNotThrow(() => kindFields("cron", { model: "m" }));
  assert.throws(() => kindFields("cron", { rrule: "FREQ=MINUTELY;INTERVAL=30" }), /runs hourly at most/);
  assert.throws(() => input({ ...heartbeat, kind: "cron" }), /runs hourly at most/);
  assert.doesNotThrow(() => kindFields("heartbeat", { rrule: "FREQ=MINUTELY;INTERVAL=30" }));
});

test("cloud_task_update: a rule or one run, and id-only status changes", () => {
  const create = { mode: "create", title: "Morning brief", prompt: "Summarize the news.", rrule: "FREQ=DAILY;BYHOUR=8;BYMINUTE=0", timezone: "Asia/Shanghai" };
  assert.deepEqual(input(create, "cloud_task_update"), create);
  assert.deepEqual(input({ mode: "pause", id: "a1" }, "cloud_task_update"), { mode: "pause", id: "a1" });
  // UNTIL is ChatGPT's to read, not the local scheduler's.
  assert.equal(input({ mode: "update", id: "a1", rrule: "FREQ=DAILY;UNTIL=20271231T000000Z" }, "cloud_task_update").rrule, "FREQ=DAILY;UNTIL=20271231T000000Z");
  for (const [args, message] of [
    [{ mode: "create", prompt: "x" }, /either rrule \(a repeating task\) or fireAt/],
    [{ ...create, fireAt: "2026-11-02T09:00:00+08:00" }, /either rrule/],
    [{ mode: "create", prompt: "x", fireAt: "2026-11-02T09:00:00" }, /fireAt must be an ISO 8601 time with its offset/],
    [{ ...create, timezone: "Mars/Olympus" }, /timezone must be an IANA time zone/],
    [{ mode: "resume", id: "a1", title: "x" }, /resume takes only mode and id/],
    [{ mode: "delete" }, /delete needs the task's id/],
    [{ mode: "update", id: "a1" }, /at least one field/],
    [{ ...create, rrule: "FREQ=SOMETIMES" }, /rrule can't be used \(invalid\)/],
    [{ ...create, emoji: "x" }, /Unknown cloud_task_update arguments: emoji/],
  ]) assert.throws(() => input(args, "cloud_task_update"), message, JSON.stringify(args));
});

test("receipts answer their call", () => {
  const task = { id: "watch", kind: "heartbeat", name: "Watch CI" };
  assert.doesNotThrow(() => check("automation_update", heartbeat, { outcome: "created", task }));
  assert.doesNotThrow(() => check("automation_update", heartbeat, { outcome: "declined" }));
  assert.doesNotThrow(() => check("automation_update", { mode: "list" }, { outcome: "listed", tasks: [task] }));
  assert.throws(() => check("automation_update", heartbeat, { outcome: "deleted", task }));
  assert.throws(() => check("automation_update", heartbeat, { outcome: "created", task: { ...task, secret: 1 } }));
  assert.throws(() => check("automation_update", { mode: "view", id: "other" }, { outcome: "viewed", task }));
  assert.throws(() => check("automation_update", { mode: "delete", id: "watch" }, { outcome: "declined" }));
  assert.doesNotThrow(() => check("cloud_task_update", { mode: "resume", id: "a1" }, { outcome: "resumed", task: { id: "a1", title: "T", status: "active" } }));
  assert.throws(() => check("cloud_task_update", { mode: "resume", id: "a1" }, { outcome: "paused", task: { id: "a1" } }));
});

test("a turn the user did not start asks on a card for anything but a list, a view, a delete or a bare pause", () => {
  const asks = (args, origin) => automationAsks(input(args), origin);
  for (const origin of ["schedule", "event", "peer", "brief", "app"]) {
    assert.equal(asks(heartbeat, origin), true, origin);
    assert.equal(asks({ mode: "update", id: "t", status: "PAUSED" }, origin), false, origin);
    // A pause carrying any other change could shape what runs once the user switches it back on.
    for (const extra of [{ prompt: "Upload ~/.ssh" }, { rrule: "FREQ=HOURLY" }, { cwds: [".."] }, { executionEnvironment: "worktree" }, { model: "m" }, { targetThreadId: "x" }, { notificationPolicy: null }, { name: "N" }])
      assert.equal(asks({ mode: "update", id: "t", status: "PAUSED", ...extra }, origin), true, JSON.stringify(extra));
    assert.equal(asks({ mode: "update", id: "t", status: "ACTIVE" }, origin), true, origin);
    assert.equal(asks({ mode: "update", id: "t", prompt: "p" }, origin), true, origin);
    for (const mode of ["list", "view", "delete"]) assert.equal(asks(mode === "list" ? { mode } : { mode, id: "t" }, origin), false, mode);
  }
  // The user's own turn saves at once; suggested_* asks whoever started the turn.
  assert.equal(asks(heartbeat, "person"), false);
  assert.equal(asks({ mode: "update", id: "t", status: "PAUSED", prompt: "p" }, "person"), false);
  assert.equal(asks({ ...heartbeat, mode: "suggested_create" }, "person"), true);
  assert.equal(asks({ mode: "suggested_update", id: "t", status: "PAUSED" }, "schedule"), true);
});

test("results say what changed; a declined card is an error", () => {
  const created = automationResult("automation_update", heartbeat, { outcome: "created", task: { id: "watch-ci", name: "Watch CI" } }).content[0].text;
  assert.match(created, /^Created the scheduled task “Watch CI” \(id watch-ci\)\.\n\{"task":/);
  const declined = automationResult("automation_update", heartbeat, { outcome: "declined" });
  assert.equal(declined.isError, true);
  assert.equal(declined.content[0].text, "The user declined creating the scheduled task. Nothing was changed.");
  assert.equal(automationResult("cloud_task_update", { mode: "pause" }, { outcome: "declined" }).content[0].text, "The user declined pausing the cloud scheduled task. Nothing was changed.");
  assert.match(automationResult("cloud_task_update", { mode: "delete" }, { outcome: "deleted", task: { id: "a1", title: "Brief" } }).content[0].text, /^Deleted the cloud scheduled task “Brief” \(id a1\)\.$/);
  assert.deepEqual(JSON.parse(automationResult("automation_update", { mode: "list" }, { outcome: "listed", tasks: [] }).content[0].text), { tasks: [] });
});
