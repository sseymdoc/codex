// Run with `node --test server/automations.test.mjs`. The ChatGPT comparisons need ChatGPT 26.1023 installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { DEFAULT_RRULE } from "../context/rrule.mjs";
import { chatgptOracle } from "../context/fixtures/chatgpt-oracle.mjs";
import { automationToml, codexHome, computeNext, createAutomations, parseAutomationToml, parseToml } from "./automations.mjs";

process.env.TZ = "UTC";
const oracle = await chatgptOracle();
const skip = !oracle && "no ChatGPT 26.1023 here";
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 29, 8, 0); // a Thursday

function setup(t) {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-automations-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const clock = { now: T0 };
  const store = createAutomations({ home, now: () => clock.now });
  return { home, clock, store, toml: (id) => path.join(store.root, id, "automation.toml"), item: (id) => store.list().items.find((item) => item.id === id) };
}
const coded = (code, pattern = /./) => (error) => error.code === code && pattern.test(error.message);

// Runs `fn` with node:fs functions swapped, the store's named imports too: { name: (original) => replacement }.
function withFs(patches, fn) {
  const originals = Object.fromEntries(Object.keys(patches).map((name) => [name, fs[name]]));
  for (const [name, wrap] of Object.entries(patches)) fs[name] = wrap(originals[name]);
  syncBuiltinESMExports();
  try { return fn(); } finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
}
// The first read of a file named `name` runs `act` (another process, say) right after it.
const afterRead = (name, act) => ({ readFileSync: (original) => function (where, ...rest) {
  const text = original.call(this, where, ...rest);
  if (act && path.basename(String(where)) === name) { const run = act; act = null; run(); }
  return text;
} });

// MINSTD, exact in doubles.
let seed = 20261030;
const rand = (n) => (seed = (seed * 48271) % 2147483647) % n;
const pick = (list) => list[rand(list.length)];
const chance = (percent) => rand(100) < percent;

const CRON = {
  id: "daily-standup", kind: "cron", name: "Daily standup", prompt: "Line1\nC:\\x \"q\"\ttab", status: "ACTIVE",
  rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR", model: "gpt-5.3-codex", reasoningEffort: "medium", notificationPolicy: "failed_runs_only",
  createdAt: 1793339729000, updatedAt: 1793339729000, pluginTemplateId: null, autoArchive: true, target: { type: "projectless" }, cwds: ["D:\\work"],
  executionEnvironment: "local", localEnvironmentConfigPath: null,
};
const HEARTBEAT = {
  id: "watch-ci", kind: "heartbeat", name: "Watch CI", prompt: "Check CI on this PR; tell me only when it passes or fails.", status: "ACTIVE",
  rrule: "FREQ=MINUTELY;INTERVAL=30", model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 1793339729000, updatedAt: 1793339729000,
  targetThreadId: "019a3c1e-7d2f-7a40-9b1e-2f6c8d4e5a10",
};

test("automation.toml is written key for key as ChatGPT writes it", () => {
  assert.equal(automationToml(CRON), String.raw`version = 1
id = "daily-standup"
kind = "cron"
name = "Daily standup"
prompt = "Line1\nC:\\x \"q\"\ttab"
status = "ACTIVE"
rrule = "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR"
model = "gpt-5.3-codex"
reasoning_effort = "medium"
auto_archive = true
notification_policy = "failed_runs_only"
execution_environment = "local"
target = { type = "projectless" }
cwds = ["D:\\work"]
created_at = 1793339729000
updated_at = 1793339729000
`);
  assert.equal(automationToml(HEARTBEAT), `version = 1
id = "watch-ci"
kind = "heartbeat"
name = "Watch CI"
prompt = "Check CI on this PR; tell me only when it passes or fails."
status = "ACTIVE"
rrule = "FREQ=MINUTELY;INTERVAL=30"
target_thread_id = "019a3c1e-7d2f-7a40-9b1e-2f6c8d4e5a10"
created_at = 1793339729000
updated_at = 1793339729000
`);
  // Other control characters are escaped (ChatGPT writes them raw, which no TOML reader takes).
  const odd = { ...HEARTBEAT, prompt: `a${String.fromCharCode(1, 0x7f)}b` }, text = automationToml(odd), esc = (hex) => `\\${"u"}${hex}`;
  assert.ok(text.includes(`prompt = "a${esc("0001")}${esc("007F")}b"`), text);
  assert.deepEqual(parseAutomationToml(text, "watch-ci").automation, odd);
  assert.deepEqual(parseAutomationToml(automationToml(CRON), "daily-standup").automation, CRON);
});

test("automation.toml matches ChatGPT 26.1023's writer byte for byte, and reads back", { skip }, () => {
  const PIECES = ["a", "Z", " ", "定时", "😀", "\"", "\\", "\n", "\r", "\t", "'", "#", "=", "[", "}", ",", "\\n", "\"\"\"", "'''", "é"];
  const words = (max) => Array.from({ length: rand(max + 1) }, () => pick(PIECES)).join("");
  for (let round = 0; round < 300; round += 1) {
    const createdAt = 1_700_000_000_000 + rand(100_000_000), kind = pick(["cron", "heartbeat"]);
    const base = { id: pick(["daily-standup", "a", "watch-ci-2"]), kind, name: words(6), prompt: words(12), status: pick(["ACTIVE", "PAUSED"]),
      rrule: pick([DEFAULT_RRULE, "FREQ=MINUTELY;INTERVAL=30", "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO"]), model: chance(50) ? null : pick(["gpt-5.3-codex", "o3"]),
      reasoningEffort: chance(50) ? null : pick(["low", "xhigh"]), notificationPolicy: chance(50) ? null : "failed_runs_only", createdAt, updatedAt: createdAt + rand(1000) };
    const automation = kind === "heartbeat" ? { ...base, targetThreadId: pick(["019a3c1e-7d2f-7a40-9b1e-2f6c8d4e5a10", "t_1"]) } : { ...base,
      pluginTemplateId: chance(80) ? null : "template", autoArchive: chance(50), target: pick([null, { type: "projectless" }, { type: "project", projectId: `p${words(3)}` }]),
      cwds: Array.from({ length: rand(3) }, () => pick(["D:\\work", "C:\\Users\\me\\x y", "/home/me"])), executionEnvironment: pick(["local", "worktree"]),
      localEnvironmentConfigPath: chance(80) ? null : "D:\\env.toml" };
    const text = automationToml(automation);
    assert.equal(text, oracle.tl(automation), JSON.stringify(automation));
    assert.deepEqual(parseAutomationToml(text, automation.id).automation, automation, text);
  }
});

test("the TOML reader takes what automation.toml files may hold and refuses the rest", () => {
  const text = String.fromCharCode(0xfeff) + String.raw`# made by hand
version = 1 # trailing comment

"id" = 'x'
name = """
two
lines \
    joined"""
prompt = '''C:\raw ""'''
cwds = [
  "C:\\a", # first
  'D:\b',
]
target = { type = "projectless", "spaced key" = [1, 2.5e3, -1_000] }
on = true
off = false
quote = """a "b" ""c"""""
` + `accent = "caf${"\\"}u00E9${"\\"}U0001F600"\n`;
  assert.deepEqual(parseToml(text.replace(/\n/g, "\r\n")), { version: 1, id: "x", name: "two\r\nlines joined", prompt: "C:\\raw \"\"", cwds: ["C:\\a", "D:\\b"],
    target: { type: "projectless", "spaced key": [1, 2500, -1000] }, on: true, off: false, quote: "a \"b\" \"\"c\"\"", accent: "café😀" });
  for (const bad of ["[automation]\nid = \"x\"", "a.b = 1", "a = 1\na = 2", "d = 1979-05-27", "t = 07:32:00", "s = \"\\q\"", "s = \"open", "s = '''open", "l = [1, 2",
    "t = { a = 1", "x = 1 y = 2", "n = 0x1F", "n = 01", "n = inf", "a = 1,", "= 1", "__proto__ = 1", "s = \"a\nb\""]) assert.throws(() => parseToml(bad), SyntaxError, bad);
});

test("automation.toml is checked as ChatGPT checks it", () => {
  const head = "version = 1\nid = \"x\"\nname = \"n\"\nprompt = \"p\"\ncreated_at = 1\nupdated_at = 2\n";
  const read = (extra, id = "x") => parseAutomationToml(head + extra, id);
  assert.deepEqual(read("status = \"DISABLED\"\nrrule = \"  \"\ncwds = []\nunknown = { deep = [1] }\n").automation, { id: "x", kind: "cron", name: "n", prompt: "p",
    status: "PAUSED", rrule: DEFAULT_RRULE, model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 1, updatedAt: 2, pluginTemplateId: null, autoArchive: false,
    target: null, cwds: [], executionEnvironment: "worktree", localEnvironmentConfigPath: null });
  assert.deepEqual(read("status = \"ACTIVE\"\nkind = \"heartbeat\"\ntarget_thread_id = \"t\"\nmodel = \" \"\n").automation, { id: "x", kind: "heartbeat", name: "n", prompt: "p",
    status: "ACTIVE", rrule: DEFAULT_RRULE, model: null, reasoningEffort: null, notificationPolicy: null, createdAt: 1, updatedAt: 2, targetThreadId: "t" });
  assert.equal(read("status = \"DELETED\"\ncwds = []\n").automation.status, "DELETED");
  for (const [extra, error, id] of [
    ["status = \"ACTIVE\"\n", "missing_cron_cwds"],
    ["status = \"ACTIVE\"\nkind = \"heartbeat\"\ntarget_thread_id = \" \"\n", "missing_heartbeat_target"],
    ["status = \"ACTIVE\"\ncwds = []\n", "id_mismatch", "y"],
    ["status = \"RUNNING\"\ncwds = []\n", "invalid_schema"],
    ["status = \"ACTIVE\"\ncwds = []\nreasoning_effort = \"huge\"\n", "invalid_schema"],
    ["status = \"ACTIVE\"\ncwds = [1]\n", "invalid_schema"],
    ["status = \"ACTIVE\"\ncwds = []\ntarget = { type = \"project\" }\n", "invalid_schema"],
    ["status = \"ACTIVE\"\ncwds = []\nauto_archive = 1\n", "invalid_schema"],
    ["status = \"ACTIVE\"\n[x]\n", "invalid_toml"],
  ]) assert.deepEqual(read(extra, id), { error }, extra);
  assert.deepEqual(parseAutomationToml(head.replace("version = 1", "version = 2") + "status = \"ACTIVE\"\ncwds = []\n", "x"), { error: "unsupported_version" });
});

test("a CODEX_HOME through a junction keeps the task folders under the path the app-server reports (find_codex_home canonicalizes it)", (t) => {
  const base = mkdtempSync(path.join(tmpdir(), "codex-ui-home-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const real = path.join(base, "real"), link = path.join(base, "link");
  mkdirSync(real);
  fs.symlinkSync(real, link, "junction");
  const store = createAutomations({ home: codexHome(link), now: () => T0 });
  assert.equal(store.root, path.join(fs.realpathSync.native(real), "codex-ui", "automations"));
  assert.equal(codexHome(path.join(base, "missing")), path.join(base, "missing"));
  assert.equal(codexHome(""), path.join(homedir(), ".codex")); // codex leaves its default as is
});

test("new tasks get ChatGPT's ids, a name from their prompt, and checked fields", (t) => {
  const { store, toml } = setup(t);
  const ids = Array.from({ length: 21 }, () => store.create({ name: " Daily standup ", prompt: "p", cwds: ["D:\\work"] }).id);
  assert.deepEqual(ids.slice(0, 20), ["daily-standup", ...Array.from({ length: 19 }, (_, n) => `daily-standup-${n + 2}`)]);
  assert.match(ids[20], /^daily-standup-[0-9a-f]{8}$/);
  assert.equal(store.create({ name: "每日站会", prompt: "p" }).id, "automation");
  const unnamed = store.create({ prompt: "  Check   the\nbuild  ", kind: "heartbeat", targetThreadId: "thread-1", model: "x", reasoningEffort: "high" });
  assert.deepEqual([unnamed.id, unnamed.name, unnamed.model, unnamed.reasoningEffort, unnamed.kind], ["check-the-build", "Check the build", null, null, "heartbeat"]);
  const cron = store.create({ name: "Local", prompt: "go", cwds: [], executionEnvironment: "local", model: " gpt-5.3-codex ", reasoningEffort: "high", autoArchive: true,
    notificationPolicy: "failed_runs_only", rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR" });
  assert.deepEqual(parseAutomationToml(readFileSync(toml("local"), "utf8"), "local").automation, { id: "local", kind: "cron", name: "Local", prompt: "go", status: "ACTIVE",
    rrule: "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR", model: "gpt-5.3-codex", reasoningEffort: "high", notificationPolicy: "failed_runs_only", createdAt: T0,
    updatedAt: T0, pluginTemplateId: null, autoArchive: true, target: { type: "projectless" }, cwds: [], executionEnvironment: "local", localEnvironmentConfigPath: null });
  // Weekdays at 09:00 give or take five minutes: Thursday's run is an hour away.
  assert.equal(cron.nextRunNominalAt, T0 + HOUR);
  assert.ok(Math.abs(cron.nextRunAt - cron.nextRunNominalAt) <= 300_000);
  assert.deepEqual([cron.dir, cron.running, cron.lastRunAt], [path.join(store.root, "local"), false, null]);
  assert.deepEqual([store.create({ name: "d", prompt: "p", cwds: ["D:\\x"] }).target, store.create({ name: "e", prompt: "p" }).executionEnvironment], [null, "worktree"]);
  for (const [input, error] of [
    [{ prompt: " " }, /请输入指令/],
    [{ prompt: "p", rrule: "FREQ=DAILY;UNTIL=20270101T000000Z" }, /UNTIL/],
    [{ prompt: "p", rrule: "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", status: "PAUSED" }, /不会再运行/],
    [{ prompt: "p", cwds: ["relative"] }, /绝对路径/],
    [{ prompt: "p", kind: "heartbeat" }, /会话/],
    [{ prompt: "p", kind: "heartbeat", targetThreadId: "a/b" }, /会话/],
    [{ prompt: "p", reasoningEffort: "huge" }, /推理强度/],
    [{ prompt: "p", status: "DELETED" }, /状态/],
    [{ prompt: "p", kind: "goal" }, /类型/],
    [{ prompt: "p", name: 3 }, /名称/],
    [null, /内容/],
  ]) assert.throws(() => store.create(input), coded("INVALID", error), JSON.stringify(input));
});

test("edits keep what they leave out, and removing takes the whole folder", (t) => {
  const { clock, store } = setup(t);
  const made = store.create({ name: "Report", prompt: "write it", cwds: ["D:\\work"], model: "m", reasoningEffort: "low", autoArchive: true });
  clock.now += MIN;
  const edited = store.update("report", { prompt: "write it again", model: null });
  assert.deepEqual([edited.prompt, edited.model, edited.reasoningEffort, edited.cwds, edited.autoArchive, edited.createdAt, edited.updatedAt, edited.nextRunAt],
    ["write it again", null, "low", ["D:\\work"], true, T0, T0 + MIN, made.nextRunAt]);
  assert.equal(store.update("report", { status: "PAUSED" }).nextRunAt, null);
  const resumed = store.update("report", { status: "ACTIVE", rrule: "FREQ=MINUTELY;INTERVAL=30", cwds: [] });
  assert.deepEqual([resumed.nextRunAt, resumed.target], [T0 + 31 * MIN, { type: "projectless" }]);
  // A schedule that never runs again may only be kept paused.
  assert.throws(() => store.update("report", { rrule: "FREQ=DAILY;COUNT=1;DTSTART=20200101T090000" }), coded("INVALID", /不会再运行/));
  assert.equal(store.update("report", { rrule: "FREQ=DAILY;COUNT=1;DTSTART=20200101T090000", status: "PAUSED" }).status, "PAUSED");
  assert.throws(() => store.update("report", { kind: "heartbeat" }), coded("INVALID", /类型/));
  assert.throws(() => store.update("nope", { prompt: "p" }), coded("NOT_FOUND"));
  assert.throws(() => store.update("../report", { prompt: "p" }), coded("NOT_FOUND"));
  writeFileSync(path.join(store.root, "report", "memory.md"), "notes");
  assert.deepEqual([store.remove("report"), existsSync(path.join(store.root, "report")), store.remove("report")], [true, false, false]);
  assert.deepEqual([store.remove(".."), store.remove(".stamp"), existsSync(path.join(store.root, ".stamp"))], [false, false, true]);
});

test("an edit checks only what it sets, so a task a hand edit put out of bounds still pauses and resumes", (t) => {
  const { store, toml, item } = setup(t);
  store.create({ name: "rel", prompt: "p", cwds: [store.root] });
  store.create({ name: "beat", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1" });
  const edit = (id, pattern, line) => writeFileSync(toml(id), readFileSync(toml(id), "utf8").replace(pattern, line));
  edit("rel", /^cwds = .*$/m, "cwds = [\"work\"]");
  edit("beat", /^name = .*$/m, `name = "${"n".repeat(300)}"`);
  assert.deepEqual([store.update("rel", { status: "PAUSED" }).status, store.update("rel", { status: "ACTIVE" }).cwds], ["PAUSED", ["work"]]);
  assert.deepEqual(store.threadEvent("thread-1", "archived"), { automations: ["beat"], runs: 0 });
  assert.deepEqual([item("beat").status, item("beat").name.length], ["PAUSED", 300]);
  // What an edit sets is checked as before.
  assert.throws(() => store.update("rel", { cwds: ["elsewhere"] }), coded("INVALID", /绝对路径/));
  assert.throws(() => store.update("beat", { name: "n".repeat(251) }), coded("INVALID", /名称/));
  assert.throws(() => store.update("rel", { status: "ACTIVE", rrule: "FREQ=DAILY;COUNT=1;DTSTART=20200101T090000" }), coded("INVALID", /不会再运行/));
});

test("the schedule follows hand edits and pauses; broken files are listed apart", (t) => {
  const { clock, store, toml, item } = setup(t);
  store.create({ name: "hand", prompt: "p", rrule: "FREQ=MINUTELY;INTERVAL=30" });
  assert.equal(item("hand").nextRunAt, T0 + 30 * MIN);
  const edit = (from, to) => writeFileSync(toml("hand"), readFileSync(toml("hand"), "utf8").replace(from, to));
  clock.now += 5 * MIN;
  assert.equal(item("hand").nextRunAt, T0 + 30 * MIN);
  edit("INTERVAL=30", "INTERVAL=10");
  assert.equal(item("hand").nextRunAt, T0 + 15 * MIN);
  edit("status = \"ACTIVE\"", "status = \"DISABLED\"");
  assert.deepEqual([item("hand").status, item("hand").nextRunAt], ["PAUSED", null]);
  edit("status = \"DISABLED\"", "status = \"ACTIVE\"");
  assert.equal(item("hand").nextRunAt, T0 + 15 * MIN);
  edit("kind", "kind = 1\nkind");
  mkdirSync(path.join(store.root, "half-made"));
  const { items, invalid } = store.list();
  assert.deepEqual([items, invalid], [[], [{ id: "hand", reason: "invalid_toml" }]]);
});

test("claims start each due cron run once, three at a time, and a missed run once", (t) => {
  const { clock, store, item } = setup(t);
  for (const name of ["a", "b", "c", "d"]) store.create({ name, prompt: "p", rrule: "FREQ=HOURLY;BYMINUTE=0" });
  assert.deepEqual(store.claim().claims, []);
  clock.now = T0 + HOUR + 6 * MIN; // past 09:00 and its jitter
  const first = store.claim(), second = store.claim();
  assert.deepEqual([first.claims.length, second.claims.length, store.claim().claims.length], [3, 1, 0]);
  assert.ok(first.stamp > 0 && second.stamp > first.stamp);
  const claims = [...first.claims, ...second.claims];
  assert.deepEqual(claims.map((claim) => claim.automation.id).sort(), ["a", "b", "c", "d"]);
  for (const claim of claims) {
    assert.match(claim.token, new RegExp(`^${claim.automation.id}/\\d+/${T0 + HOUR}$`));
    assert.deepEqual([claim.trigger, claim.lastRunAt, claim.nominalAt, claim.automation.lastRunAt, claim.automation.nextRunNominalAt], ["scheduled", null, T0 + HOUR, clock.now, T0 + 2 * HOUR]);
  }
  // Asleep from 10:00 to 14:30: each task runs once, then waits for 15:00.
  clock.now = T0 + 6 * HOUR + 30 * MIN;
  assert.equal(store.claim().claims.length + store.claim().claims.length, 4);
  assert.deepEqual(store.claim().claims, []);
  assert.equal(item("a").nextRunNominalAt, T0 + 7 * HOUR);
  // A cron run reported as started is recorded; one reported as failed waits for its next time.
  assert.deepEqual(store.report(claims[0].token, "started", { threadId: "thread-1" }), { ok: true });
  assert.deepEqual(store.report(claims[1].token, "failed"), { ok: true });
  assert.deepEqual(store.list().runs.map((run) => [run.threadId, run.status]), [["thread-1", "IN_PROGRESS"]]);
  assert.deepEqual(store.report("gone/1/", "started"), { ok: false, stale: true });
});

test("a one-shot task ends after its run, cron or heartbeat", (t) => {
  const { clock, store, item } = setup(t);
  store.create({ name: "once", prompt: "p", rrule: "FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0" });
  store.create({ name: "ping", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1", rrule: "FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0" });
  assert.deepEqual([item("once").nextRunAt, item("ping").nextRunAt], [T0 + HOUR, T0 + HOUR]);
  clock.now = T0 + HOUR;
  const claims = store.claim().claims;
  assert.equal(claims.length, 2);
  assert.deepEqual(store.report(claims.find((claim) => claim.automation.kind === "heartbeat").token, "started"), { ok: true });
  clock.now += 2 * DAY;
  assert.deepEqual(store.claim().claims, []);
  assert.deepEqual([item("once").nextRunAt, item("ping").nextRunAt, item("once").lastRunAt, item("ping").lastRunAt], [null, null, T0 + HOUR, T0 + HOUR]);
});

test("a heartbeat is leased until its page reports, one per thread at a time", (t) => {
  const { clock, store, toml, item } = setup(t);
  store.create({ name: "watch", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1", rrule: "FREQ=MINUTELY;INTERVAL=30" });
  assert.equal(item("watch").nextRunAt, T0 + 30 * MIN); // an interval counts from now
  clock.now = T0 + 30 * MIN;
  const [claim] = store.claim().claims;
  assert.deepEqual([claim.automation.nextRunAt, claim.automation.running, claim.automation.lastRunAt], [clock.now + 2 * MIN, true, null]);
  assert.deepEqual(store.claim().claims, []);
  clock.now += 10_000;
  assert.deepEqual(store.report(claim.token, "started"), { ok: true });
  assert.deepEqual([item("watch").nextRunAt, item("watch").lastRunAt, item("watch").running], [clock.now + 30 * MIN, clock.now, false]);
  assert.deepEqual(store.report(claim.token, "started"), { ok: false, stale: true });
  // A lease nobody reports runs out and the run is claimed again; the old token is stale by then.
  clock.now = item("watch").nextRunAt;
  const [lost] = store.claim().claims;
  clock.now += 2 * MIN + 1;
  const [again] = store.claim().claims;
  assert.notEqual(again.token, lost.token);
  assert.deepEqual(store.report(lost.token, "started"), { ok: false, stale: true });
  assert.deepEqual(store.report(again.token, "retry"), { ok: true });
  assert.deepEqual([item("watch").nextRunAt, item("watch").running], [clock.now + MIN, false]);
  // Two heartbeats due on one thread: one runs, the other waits a minute.
  store.create({ name: "watch 2", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1", rrule: "FREQ=MINUTELY;INTERVAL=1" });
  clock.now += MIN;
  const { claims } = store.claim();
  assert.equal(claims.length, 1);
  const [ran, other] = claims[0].automation.id === "watch" ? ["watch", "watch-2"] : ["watch-2", "watch"];
  assert.equal(item(other).nextRunAt, clock.now + MIN);
  // Its thread was archived: the heartbeat pauses.
  assert.deepEqual(store.report(claims[0].token, "paused"), { ok: true });
  assert.deepEqual([item(ran).status, item(ran).nextRunAt], ["PAUSED", null]);
  assert.match(readFileSync(toml(ran), "utf8"), /^status = "PAUSED"$/m);
});

test("a heartbeat waits for the page whose app-server holds its session, in either process, a minute and a half at most", (t) => {
  const { home, clock, store, item } = setup(t);
  store.create({ name: "watch", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1", rrule: "FREQ=MINUTELY;INTERVAL=30" });
  // The other bridge process, on the same folder.
  const other = createAutomations({ home, now: () => clock.now });
  clock.now = T0 + 30 * MIN - 20_000;
  assert.deepEqual(store.claim({ held: ["thread-1", "../x", 7] }).claims, []); // not due yet: the hold is noted
  clock.now = T0 + 30 * MIN;
  assert.deepEqual(other.claim({ held: ["thread-2"] }).claims, []);
  assert.deepEqual(store.claim().claims, []); // the same process, a page that does not hold it
  assert.equal(item("watch").nextRunAt, T0 + 30 * MIN); // left due, not deferred
  const [claim] = store.claim({ held: ["thread-1"] }).claims;
  assert.equal(claim.automation.id, "watch");
  assert.deepEqual(store.report(claim.token, "started"), { ok: true });
  // The holder closed: its last word is 90 seconds old, and anyone runs it.
  clock.now = item("watch").nextRunAt;
  assert.equal(other.claim().claims.length, 1);
  // A cron task never waits.
  store.create({ name: "often", prompt: "p", kind: "cron", cwds: [home], rrule: "FREQ=MINUTELY;INTERVAL=1" });
  assert.deepEqual(store.claim({ held: ["thread-1"] }).claims, []);
  clock.now = item("often").nextRunAt;
  assert.deepEqual(other.claim().claims.map((c) => c.automation.id), ["often"]);
});

test("run now moves a cron schedule on at once and a heartbeat's when it starts; runs stay a minute apart", (t) => {
  const { clock, store, item } = setup(t);
  store.create({ name: "tick", prompt: "p", rrule: "FREQ=MINUTELY;INTERVAL=1" });
  clock.now = T0 + 30_000;
  const manual = store.runNow("tick");
  assert.deepEqual([manual.trigger, manual.token, manual.lastRunAt, manual.nominalAt, manual.automation.nextRunAt, manual.automation.lastRunAt],
    ["run_now", `tick/now-${clock.now}/`, null, null, T0 + MIN, clock.now]);
  clock.now = T0 + MIN;
  assert.deepEqual(store.claim().claims, []);
  assert.equal(item("tick").nextRunAt, T0 + 90_000);
  clock.now = T0 + 90_000;
  const [claim] = store.claim().claims;
  assert.deepEqual([claim.lastRunAt, claim.nominalAt], [T0 + 30_000, T0 + MIN]);
  // A failed run that may retry comes back a minute later, still counted as the 08:01 run.
  assert.deepEqual(store.report(claim.token, "failed", { retry: true }), { ok: true });
  assert.deepEqual([item("tick").nextRunAt, item("tick").nextRunNominalAt], [clock.now + MIN, T0 + MIN]);
  clock.now += MIN;
  assert.equal(store.claim().claims[0].automation.nextRunNominalAt, T0 + 3 * MIN);

  store.create({ name: "beat", prompt: "p", kind: "heartbeat", targetThreadId: "thread-2", rrule: "FREQ=MINUTELY;INTERVAL=30" });
  const before = item("beat"), beat = store.runNow("beat");
  assert.deepEqual([beat.automation.nextRunAt, beat.automation.lastRunAt], [before.nextRunAt, null]);
  clock.now += 5_000;
  assert.deepEqual(store.report(beat.token, "started"), { ok: true });
  assert.deepEqual([item("beat").nextRunAt, item("beat").lastRunAt], [clock.now + 30 * MIN, clock.now]);
  assert.throws(() => store.runNow("gone"), coded("NOT_FOUND"));
  assert.throws(() => store.report(beat.token, "exploded"), coded("INVALID"));
});

test("run records move through ChatGPT's states, and unread ones are counted", (t) => {
  const { clock, store } = setup(t);
  store.create({ name: "quiet", prompt: "p", notificationPolicy: "failed_runs_only" });
  store.create({ name: "loud", prompt: "p" });
  const start = (id, threadId) => store.report(store.runNow(id).token, "started", { threadId, threadTitle: id, sourceCwd: "D:\\work" });
  start("quiet", "t-quiet");
  start("loud", "t-loud");
  const runs = () => Object.fromEntries(store.list().runs.map((run) => [run.threadId, run]));
  assert.deepEqual(runs()["t-loud"], { threadId: "t-loud", automationId: "loud", status: "IN_PROGRESS", readAt: null, threadTitle: "loud", sourceCwd: "D:\\work",
    inboxTitle: null, inboxSummary: null, archivedUserMessage: null, archivedAssistantMessage: null, archivedReason: null, createdAt: T0, updatedAt: T0 });
  assert.deepEqual([store.list().unread.total, store.list().items.find((item) => item.id === "loud").running], [0, true]);
  clock.now += MIN;
  // failed_runs_only: a success is read at once.
  assert.deepEqual([store.runEvent({ threadId: "t-quiet", event: "completed" }).readAt, runs()["t-quiet"].status], [clock.now, "PENDING_REVIEW"]);
  const done = store.runEvent({ threadId: "t-loud", event: "completed", inboxTitle: "已完成", inboxSummary: "摘要" });
  assert.deepEqual([done.status, done.readAt, done.inboxTitle, done.inboxSummary], ["PENDING_REVIEW", null, "已完成", "摘要"]);
  assert.deepEqual(store.list().unread, { total: 1, automationIds: ["loud"], unreadRuns: [{ automationId: "loud", threadId: "t-loud" }] });
  assert.equal(store.runEvent({ threadId: "t-loud", event: "accepted" }).status, "ACCEPTED");
  assert.equal(store.list().unread.total, 1);
  assert.equal(store.runEvent({ threadId: "t-loud", event: "read" }).readAt, clock.now);
  assert.equal(store.runEvent({ threadId: "t-loud", event: "unread" }).readAt, null);
  const archived = store.runEvent({ threadId: "t-loud", event: "archived", archivedReason: "auto", archivedAssistantMessage: "done" });
  assert.deepEqual([archived.status, archived.archivedReason, archived.archivedAssistantMessage, store.list().unread.total], ["ARCHIVED", "auto", "done", 0]);
  assert.equal(store.runEvent({ threadId: "t-loud", event: "accepted" }).status, "ARCHIVED");
  const back = store.runEvent({ threadId: "t-loud", event: "unarchived" });
  assert.deepEqual([back.status, back.readAt, back.archivedReason], ["ACCEPTED", clock.now, null]);
  store.runEvent({ threadId: "t-loud", event: "unread" });
  store.runEvent({ threadId: "t-quiet", event: "unread" });
  assert.deepEqual([store.readAll(), store.list().unread.total, store.readAll()], [2, 0, 0]);
  // DM: archived runs are read too, but only those last changed by the read time, and their updated_at stays.
  store.runEvent({ threadId: "t-loud", event: "unread" });
  store.runEvent({ threadId: "t-loud", event: "archived" });
  const archivedAt = clock.now;
  clock.now += MIN;
  store.runEvent({ threadId: "t-quiet", event: "unread" });
  assert.equal(store.readAll(archivedAt + 30_000), 1);
  assert.deepEqual([runs()["t-loud"].readAt, runs()["t-loud"].updatedAt, runs()["t-quiet"].readAt], [archivedAt + 30_000, archivedAt, null]);
  assert.equal(store.runEvent({ threadId: "nobody", event: "read" }), null);
  // An unknown event or outcome is refused whether or not anything has the thread or token.
  for (const threadId of ["t-loud", "nobody"]) assert.throws(() => store.runEvent({ threadId, event: "exploded" }), coded("INVALID"));
  assert.throws(() => store.report("gone/1/", "exploded"), coded("INVALID"));
  assert.throws(() => start("loud", undefined), coded("INVALID", /会话/));
  // The newest 200 runs are kept, the newest 50 listed.
  for (let n = 0; n < 201; n += 1) { clock.now += 1; start("loud", `t-${n}`); }
  assert.equal(JSON.parse(readFileSync(path.join(store.root, "loud", "runs.json"), "utf8")).length, 200);
  const listed = store.list().runs.filter((run) => run.automationId === "loud");
  assert.deepEqual([listed.length, listed[0].threadId], [50, "t-200"]);
  // An unread run sorted past them is listed too.
  store.runEvent({ threadId: "t-5", event: "accepted" });
  const more = store.list().runs.filter((run) => run.automationId === "loud");
  assert.deepEqual([more.length, more.at(-1).threadId, more.at(-1).status, more.at(-1).readAt], [51, "t-5", "ACCEPTED", null]);
});

test("archiving a thread pauses its heartbeats and archives its run; deleting it removes both", (t) => {
  const { store, item } = setup(t);
  store.create({ name: "beat", prompt: "p", kind: "heartbeat", targetThreadId: "thread-1" });
  store.create({ name: "job", prompt: "p" });
  store.report(store.runNow("job").token, "started", { threadId: "thread-1" });
  assert.deepEqual(store.threadEvent("thread-1", "archived"), { automations: ["beat"], runs: 1 });
  assert.deepEqual([item("beat").status, store.list().runs[0].status], ["PAUSED", "ARCHIVED"]);
  assert.deepEqual(store.threadEvent("thread-1", "unarchived"), { automations: [], runs: 1 });
  assert.deepEqual([item("beat").status, store.list().runs[0].status, store.list().runs[0].readAt != null], ["PAUSED", "ACCEPTED", true]);
  assert.deepEqual(store.threadEvent("thread-1", "deleted"), { automations: ["beat"], runs: 1 });
  assert.deepEqual([item("beat"), store.list().runs, item("job").status], [undefined, [], "ACTIVE"]);
  assert.deepEqual(store.threadEvent("thread-9", "deleted"), { automations: [], runs: 0 });
  assert.throws(() => store.threadEvent("thread-1", "renamed"), coded("INVALID"));
});

test("a damaged runs.json is kept aside, not written over", (t) => {
  const { store } = setup(t);
  store.create({ name: "job", prompt: "p" });
  for (const threadId of ["t-1", "t-2", "t-3"]) store.report(store.runNow("job").token, "started", { threadId });
  const where = path.join(store.root, "job", "runs.json"), damaged = readFileSync(where, "utf8").slice(0, -5);
  writeFileSync(where, damaged);
  store.report(store.runNow("job").token, "started", { threadId: "t-new" });
  assert.deepEqual(store.list().runs.map((run) => run.threadId), ["t-new"]);
  const aside = readdirSync(path.dirname(where)).filter((name) => /^runs\.json\.bad-\d+$/.test(name));
  assert.deepEqual(aside.map((name) => readFileSync(path.join(path.dirname(where), name), "utf8")), [damaged]);
});

test("run records two processes change at once both hold", (t) => {
  const { home, clock, store } = setup(t);
  const other = createAutomations({ home, now: () => clock.now });
  store.create({ name: "job", prompt: "p" });
  for (const threadId of ["t-a", "t-b"]) store.report(store.runNow("job").token, "started", { threadId });
  // The other process completes t-b between this one's read of the runs and its write.
  withFs(afterRead("runs.json", () => other.runEvent({ threadId: "t-b", event: "completed" })), () => store.runEvent({ threadId: "t-a", event: "completed" }));
  assert.deepEqual(Object.fromEntries(store.list().runs.map((run) => [run.threadId, run.status])), { "t-a": "PENDING_REVIEW", "t-b": "PENDING_REVIEW" });
});

test("a list taken while another process changes a task reports the stamp from before the change", (t) => {
  const { home, clock, store } = setup(t);
  const other = createAutomations({ home, now: () => clock.now });
  store.create({ name: "job", prompt: "p" });
  const listed = withFs(afterRead("automation.toml", () => other.update("job", { name: "renamed" })), () => store.list());
  assert.equal(listed.items[0].name, "job");
  assert.ok(listed.stamp < store.stamp(), `${listed.stamp} < ${store.stamp()}`);
});

test("a claim file that cannot be removed does not lose the claims already made", (t) => {
  const { clock, store } = setup(t);
  for (const name of ["a", "b"]) store.create({ name, prompt: "p", rrule: "FREQ=HOURLY;BYMINUTE=0" });
  clock.now = T0 + HOUR + 6 * MIN;
  // The second task moves on in another process the moment its claim file is made, and that file stays busy.
  let made = 0;
  const { claims } = withFs({
    writeFileSync: (original) => function (where, ...rest) {
      original.call(this, where, ...rest);
      if (!path.basename(String(where)).startsWith(".claim-") || ++made !== 2) return;
      const state = path.join(path.dirname(where), "state.json");
      original(state, JSON.stringify({ ...JSON.parse(readFileSync(state, "utf8")), next_run_at: clock.now + HOUR }));
    },
    rmSync: (original) => function (where, ...rest) {
      if (path.basename(String(where)).startsWith(".claim-")) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return original.call(this, where, ...rest);
    },
  }, () => store.claim());
  assert.equal(claims.length, 1);
});

test("next runs and their jitter match ChatGPT 26.1023's ml", { skip }, () => {
  // In UTC, where codex-ui's wall-clock rules and ChatGPT's UTC ones agree.
  const RULES = [DEFAULT_RRULE, "FREQ=MINUTELY;INTERVAL=30", "FREQ=MINUTELY;INTERVAL=90", "FREQ=MINUTELY;INTERVAL=7;BYMINUTE=0", "FREQ=HOURLY;INTERVAL=2;BYMINUTE=15",
    "RRULE:FREQ=HOURLY;INTERVAL=3;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA", "FREQ=HOURLY;BYMINUTE=0,30", "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR",
    "FREQ=DAILY;BYHOUR=9,15;BYMINUTE=0", "FREQ=DAILY;BYHOUR=9;BYMINUTE=0,30", "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=1",
    "FREQ=WEEKLY;COUNT=1;BYDAY=FR;BYHOUR=8;BYMINUTE=0", "FREQ=DAILY;INTERVAL=2;BYHOUR=7;BYMINUTE=45"];
  let jittered = 0;
  for (let round = 0; round < 500; round += 1) {
    const automation = { id: pick(["a", "daily-standup", "watch-ci"]), kind: pick(["cron", "heartbeat"]), rrule: pick(RULES) };
    const now = Date.UTC(2026, 0, 1) + rand(1095) * DAY + rand(86_400) * 1000 + rand(1000);
    const afterNominalRunAt = chance(50) ? undefined : now - DAY + rand(2 * DAY);
    const salt = pick(["salt", "8b0f0d4e-2a51-4f57-9f39-6d1c3c4d2b10"]), mine = computeNext({ automation, salt, now, afterNominalRunAt });
    assert.deepEqual(mine, oracle.ml({ automation, jitterSalt: salt, now, afterNominalRunAt }), JSON.stringify({ automation, now, afterNominalRunAt }));
    if (mine && mine.nextRunAt !== mine.nextRunNominalAt) jittered += 1;
  }
  assert.ok(jittered > 100, String(jittered));
});

test("four processes claiming at once start each of 20 due tasks once", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-automations-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const past = createAutomations({ home, now: () => Date.now() - 2 * DAY }); // made two days ago: all due
  for (let n = 0; n < 20; n += 1) past.create({ name: `task ${n}`, prompt: "p" });
  const url = pathToFileURL(path.join(import.meta.dirname, "automations.mjs")).href, start = Date.now() + 1500;
  const code = `const { createAutomations } = await import(${JSON.stringify(url)});
const store = createAutomations({ home: process.argv[1] }), ids = [];
await new Promise((resolve) => setTimeout(resolve, ${start} - Date.now()));
for (let idle = 0; idle < 20; ) { const { claims } = store.claim(); ids.push(...claims.map((claim) => claim.automation.id)); idle = claims.length ? 0 : idle + 1; }
process.stdout.write(JSON.stringify(ids));`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, home], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (status) => (status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))));
  });
  const claimed = await Promise.all([run(), run(), run(), run()]);
  assert.deepEqual(claimed.flat().sort(), Array.from({ length: 20 }, (_, n) => `task-${n}`).sort(), JSON.stringify(claimed));
});
