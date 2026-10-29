// Run with `node --test context/rrule.test.mjs`. The ChatGPT comparisons need ChatGPT 26.1023 installed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chatgptOracle } from "./fixtures/chatgpt-oracle.mjs";
import { builderOf, builderRrule, DEFAULT_RRULE, DEFAULT_SCHEDULE, describeRrule, heartbeatInterval, jitterSpan, nextRun, oneShot, parseRrule, rruleOf, rruleProblem, scheduleOf } from "./rrule.mjs";

const oracle = await chatgptOracle();
const skip = !oracle && "no ChatGPT 26.1023 here";
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const pad = (n) => String(n).padStart(2, "0");
// Time zones are set while the process runs (Node reads TZ on every Date call).
const at = (zone, ...parts) => { process.env.TZ = zone; return new Date(...parts).getTime(); };
const wall = (ms) => {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}${d.getSeconds() ? `:${pad(d.getSeconds())}` : ""}`;
};
const next = (text, now) => wall(nextRun(parseRrule(text), now));

test("next runs: intervals count real time, clock rules use the wall clock", () => {
  let now = at("Asia/Shanghai", 2026, 9, 29, 14, 37, 12);
  assert.equal(next("FREQ=MINUTELY;INTERVAL=30", now), "2026-10-29 15:07");
  assert.equal(next("FREQ=HOURLY;INTERVAL=2", now), "2026-10-29 16:37");
  assert.equal(next("FREQ=MINUTELY;INTERVAL=7;BYMINUTE=0", now), "2026-10-29 18:00");
  assert.equal(next("FREQ=HOURLY;INTERVAL=24;BYHOUR=3", now), "2026-10-30 03:37");
  assert.equal(next("RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO", now), "2026-11-02 09:00");
  assert.equal(next("FREQ=DAILY;BYHOUR=9,15;BYMINUTE=0", now), "2026-10-29 15:00");
  assert.equal(next("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", now), null);
  assert.equal(next("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29;BYHOUR=9;BYMINUTE=0", now), "2028-02-29 09:00");
  // Asia/Kolkata is UTC+5:30: an hourly BYMINUTE=0 lands on the UTC hour, as ChatGPT runs it.
  now = at("Asia/Kolkata", 2026, 9, 29, 14, 37, 12);
  assert.equal(next("FREQ=HOURLY;BYMINUTE=0", now), "2026-10-29 15:30");
  // New York springs forward at 02:00 on 2027-03-14: 02:30 does not exist that day.
  now = at("America/New_York", 2027, 2, 14, 0, 30);
  assert.equal(next("FREQ=DAILY;BYHOUR=2;BYMINUTE=30", now), "2027-03-14 03:30");
  assert.equal(next("FREQ=HOURLY;INTERVAL=24;BYMINUTE=0", now), "2027-03-15 01:00");
  assert.equal(next("FREQ=HOURLY;BYHOUR=2,3;BYMINUTE=30", now), "2027-03-14 03:30");
});

test("monthly, yearly and anchored rules stay on local time (ChatGPT runs them in UTC)", () => {
  const now = at("Asia/Shanghai", 2026, 9, 29, 14, 37, 12);
  assert.equal(next("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0", now), "2026-11-01 09:00");
  assert.equal(next("FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0", now), "2026-10-31 09:00");
  assert.equal(next("DTSTART:20200101T090000\nRRULE:FREQ=DAILY;INTERVAL=3", now), "2026-11-01 09:00");
  assert.equal(next("DTSTART:20261030T010000Z\nRRULE:FREQ=DAILY;COUNT=1", now), "2026-10-30 09:00");
  assert.equal(next("FREQ=DAILY;COUNT=1;DTSTART=20261029T143000", now), null);
  assert.equal(next("FREQ=DAILY;COUNT=1", now), null);
  assert.equal(next("FREQ=WEEKLY;COUNT=1;BYDAY=FR;BYHOUR=8;BYMINUTE=0", now), "2026-10-30 08:00");
  // Every 90 minutes from 14:37 is 16:07, 17:37, 19:07, 20:37, 22:07, 23:37, 01:07: hour 21 is skipped.
  assert.equal(next("FREQ=MINUTELY;INTERVAL=90;BYHOUR=1,21", now), "2026-10-30 01:07");
  // A Monday February 29 comes every 28 years, and 40 across 2100.
  for (const freq of ["DAILY", "WEEKLY", "MONTHLY"]) {
    const text = `FREQ=${freq};BYDAY=MO;BYMONTH=2;BYMONTHDAY=29;BYHOUR=9;BYMINUTE=0`;
    assert.equal(next(text, now), "2044-02-29 09:00", text);
    assert.equal(next(text, at("Asia/Shanghai", 2072, 2, 1)), "2112-02-29 09:00", text);
  }
});

test("the parser takes the subset and says why it refuses the rest", () => {
  at("Asia/Shanghai");
  assert.deepEqual(parseRrule(""), parseRrule(DEFAULT_RRULE));
  const weekly = parseRrule("freq=weekly;byday=fr,mo,mo;byhour=9;byminute=0");
  assert.deepEqual({ ...weekly, keys: [...weekly.keys] }, { freq: "WEEKLY", interval: 1, byday: [1, 5], byhour: [9], byminute: [0], bymonthday: null, bymonth: null, count: null, dtstart: null, keys: ["FREQ", "BYDAY", "BYHOUR", "BYMINUTE"] });
  assert.equal(parseRrule("BEGIN:VEVENT\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0\r\nEND:VEVENT").freq, "WEEKLY");
  assert.deepEqual(parseRrule("DTSTART:20261030T010000Z\nRRULE:FREQ=DAILY;COUNT=1").dtstart, { year: 2026, month: 10, day: 30, hour: 9, minute: 0, second: 0 });
  assert.deepEqual(parseRrule("FREQ=DAILY;COUNT=1;DTSTART=20261030T090000").dtstart, { year: 2026, month: 10, day: 30, hour: 9, minute: 0, second: 0 });
  assert.ok(parseRrule("FREQ=MINUTELY;INTERVAL=30;BYSECOND=0;"));
  const code = (text) => rruleProblem(text, Date.UTC(2026, 9, 29))?.code ?? null;
  for (const text of ["FREQ=DAILY;UNTIL=20270101T000000Z", "DTSTART;TZID=Asia/Shanghai:20261030T090000\nRRULE:FREQ=DAILY", "FREQ=MONTHLY;BYDAY=1MO", "FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1",
    "FREQ=DAILY;COUNT=3", "FREQ=SECONDLY", "FREQ=HOURLY;BYMONTHDAY=1", "RRULE:FREQ=DAILY\nRRULE:FREQ=WEEKLY", "RRULE:FREQ=DAILY\nEXDATE:20261030T090000Z", "FREQ=DAILY;WKST=SU",
    "FREQ=DAILY;BYSECOND=30", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=DAILY;TZID=UTC"]) assert.equal(code(text), "unsupported", text);
  for (const text of ["FREQ=FORTNIGHTLY", "FREQ=DAILY;BYHOUR=24", "FREQ=DAILY;INTERVAL=0", "BYHOUR=9", "FREQ=DAILY;BYDAY=MON", "FREQ=DAILY;FREQ=DAILY", "FREQ=DAILY;COLOR=RED",
    "hello", "DTSTART:2026103\nFREQ=DAILY", "FREQ=DAILY;DTSTART=20260230T090000", "FREQ=DAILY;COUNT=0", "SUMMARY:x\nFREQ=DAILY"]) assert.equal(code(text), "invalid", text);
  assert.match(rruleProblem("FREQ=DAILY;BYHOUR=24", 0).message, /^请输入有效的 RRULE（BYHOUR=24）$/);
  assert.match(rruleProblem("FREQ=DAILY;UNTIL=20270101T000000Z", 0).message, /UNTIL/);
});

test("rules with nothing ahead are flagged", () => {
  const now = at("UTC", 2026, 9, 29, 14, 0);
  assert.equal(rruleProblem("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30;BYHOUR=9;BYMINUTE=0", now)?.code, "no-future");
  assert.equal(rruleProblem("FREQ=MINUTELY;INTERVAL=2;BYMINUTE=1", now)?.code, "no-future"); // even minutes only
  assert.equal(rruleProblem("FREQ=HOURLY;INTERVAL=24;BYHOUR=3;COUNT=1", now)?.code, "no-future"); // no BYMINUTE
  assert.equal(rruleProblem("DTSTART:20200101T090000\nRRULE:FREQ=DAILY;COUNT=1", now)?.code, "no-future");
  assert.equal(rruleProblem("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", now), null);
  assert.equal(rruleProblem("", now), null);
});

test("heartbeat intervals, jitter spans and one-shots read like ChatGPT's", () => {
  const rule = (text) => parseRrule(text);
  assert.equal(heartbeatInterval(rule("FREQ=MINUTELY;INTERVAL=30")), 30 * 60_000);
  assert.equal(heartbeatInterval(rule("FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA")), 2 * 3_600_000);
  assert.equal(heartbeatInterval(rule("FREQ=HOURLY;INTERVAL=2")), 2 * 3_600_000);
  assert.equal(heartbeatInterval(rule("FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=MO")), null);
  assert.equal(heartbeatInterval(rule("FREQ=HOURLY;BYMINUTE=15")), null);
  assert.equal(heartbeatInterval(rule("FREQ=MINUTELY;INTERVAL=30;BYMINUTE=0")), null);
  assert.equal(heartbeatInterval(rule("DTSTART:20261030T090000\nRRULE:FREQ=MINUTELY;INTERVAL=30")), null);
  assert.equal(heartbeatInterval(rule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0")), null);
  assert.equal(jitterSpan(rule("FREQ=MINUTELY;INTERVAL=30")), 0);
  assert.equal(jitterSpan(rule("FREQ=MINUTELY;INTERVAL=60")), 300);
  assert.equal(jitterSpan(rule("FREQ=HOURLY;BYMINUTE=0,30")), 119);
  assert.equal(jitterSpan(rule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0")), 300);
  assert.equal(jitterSpan(rule("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0")), 0);
  assert.equal(jitterSpan(rule("FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0")), 0);
  assert.equal(oneShot(rule("FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0")), true);
  assert.equal(oneShot(rule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0")), false);
});

test("descriptions use Claude's wording and fall back to 自定义日程", () => {
  at("Asia/Shanghai");
  const cases = {
    "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0": "每小时运行一次",
    "FREQ=MINUTELY;INTERVAL=1": "每分钟运行一次",
    "FREQ=MINUTELY;INTERVAL=30": "每 30 分钟运行一次",
    "FREQ=HOURLY;INTERVAL=2;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR": "工作日每 2 小时运行一次",
    "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA": "每天 9:00 运行",
    "FREQ=DAILY;BYHOUR=18;BYMINUTE=30": "每天 18:30 运行",
    "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,TU,WE,TH,FR": "每个工作日 9:00 运行",
    "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=5": "每星期一 9:05 运行",
    "FREQ=WEEKLY;BYDAY=SA,SU;BYHOUR=10;BYMINUTE=0": "周末 10:00 运行",
    "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0": "每星期一、星期三和星期五 9:00 运行",
    "FREQ=WEEKLY;BYDAY=FR,SA,SU,MO;BYHOUR=9;BYMINUTE=0": "于 星期五 至 星期一 的 9:00 运行",
    "FREQ=DAILY;INTERVAL=2;BYHOUR=9;BYMINUTE=0": "每 2 天 9:00 运行",
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0": "每 2 周的星期一 9:00 运行",
    "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=1": "每月 1 日 9:00 运行",
    "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15;BYHOUR=9;BYMINUTE=0": "每年 3 月 15 日 9:00 运行",
    "DTSTART:20261030T090000\nRRULE:FREQ=DAILY;COUNT=1": "于 2026年10月30日 09:00 运行一次",
    "DTSTART:20261030T090000\nRRULE:FREQ=DAILY;COUNT=1;BYHOUR=15;BYMINUTE=0": "于 2026年10月30日 15:00 运行一次",
    "DTSTART:20261030T090000\nRRULE:FREQ=DAILY;COUNT=1;BYHOUR=8;BYMINUTE=0": "于 2026年10月31日 08:00 运行一次",
    "FREQ=DAILY;COUNT=1;BYHOUR=9;BYMINUTE=0": "运行一次",
    "FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0": "自定义日程",
    "FREQ=HOURLY;BYHOUR=9": "自定义日程",
    "FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0": "自定义日程",
    "FREQ=DAILY;UNTIL=20270101T000000Z": "自定义日程",
    "garbage": "自定义日程",
  };
  for (const [text, words] of Object.entries(cases)) assert.equal(describeRrule(text), words, text);
  assert.equal(describeRrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", { tz: "GMT+8" }), "每天 9:00 GMT+8 运行");
});

test("the form's schedule and the custom builder map to RRULEs and back", () => {
  at("Asia/Shanghai");
  assert.deepEqual(scheduleOf(rruleOf(DEFAULT_SCHEDULE)), { ...DEFAULT_SCHEDULE, intervalHours: 1, intervalMinutes: 30 });
  assert.equal(rruleOf(DEFAULT_SCHEDULE), "RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA");
  const back = (schedule) => { const again = scheduleOf(rruleOf(schedule)); return [again.mode, again.time, again.weekdays.join(","), again.intervalMinutes]; };
  assert.deepEqual(back({ ...DEFAULT_SCHEDULE, mode: "weekdays", time: "07:45" }), ["weekdays", "07:45", "MO,TU,WE,TH,FR", 30]);
  assert.deepEqual(back({ ...DEFAULT_SCHEDULE, mode: "weekly", weekdays: ["FR", "MO"], time: "18:00" }), ["weekly", "18:00", "MO,FR", 30]);
  assert.deepEqual(back({ ...DEFAULT_SCHEDULE, mode: "weekly", weekdays: [] }), ["weekly", "09:00", "SU", 30]);
  assert.deepEqual(back({ ...DEFAULT_SCHEDULE, mode: "hourly", intervalHours: 3, intervalMinutes: null }), ["hourly", "09:00", DAYS.join(","), null]);
  assert.deepEqual(back({ ...DEFAULT_SCHEDULE, mode: "hourly", intervalMinutes: 45 }), ["hourly", "09:00", DAYS.join(","), 45]);
  // Every rule the form writes reads back to itself; hours stay HOURLY (on the UTC hour), not MINUTELY.
  for (const schedule of [{ mode: "hourly", intervalHours: 3, intervalMinutes: null }, { mode: "hourly", intervalMinutes: 45 }, { mode: "daily", time: "18:30" },
    { mode: "weekdays" }, { mode: "weekly", weekdays: ["MO", "FR"] }, { mode: "monthly", monthDay: 15 }]) {
    const text = rruleOf({ ...DEFAULT_SCHEDULE, ...schedule });
    assert.equal(rruleOf(scheduleOf(text)), text);
  }
  assert.equal(scheduleOf("RRULE:FREQ=HOURLY;INTERVAL=3;BYMINUTE=0;BYDAY=SU,MO,TU,WE,TH,FR,SA").intervalHours, 3);
  assert.equal(rruleOf({ ...DEFAULT_SCHEDULE, mode: "monthly", monthDay: 15, time: "08:30" }), "RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=8;BYMINUTE=30;BYMONTHDAY=15");
  assert.equal(scheduleOf("RRULE:FREQ=MONTHLY;INTERVAL=1;BYHOUR=8;BYMINUTE=30;BYMONTHDAY=15").monthDay, 15);
  assert.equal(rruleOf({ ...DEFAULT_SCHEDULE, mode: "custom", customRrule: " FREQ=DAILY " }), "FREQ=DAILY");
  assert.deepEqual([scheduleOf("FREQ=DAILY;BYHOUR=9,17;BYMINUTE=0").mode, scheduleOf("FREQ=DAILY;UNTIL=20270101T000000Z").customRrule], ["custom", "FREQ=DAILY;UNTIL=20270101T000000Z"]);
  const fallback = scheduleOf("");
  assert.deepEqual([fallback.mode, fallback.intervalHours, fallback.intervalMinutes], ["hourly", 24, null]);
  assert.deepEqual(builderOf("RRULE:FREQ=YEARLY;INTERVAL=1;BYHOUR=9;BYMINUTE=0;BYMONTH=3;BYMONTHDAY=15"), { frequency: "yearly", interval: 1, weekdays: DAYS, month: 3, monthDays: [15], time: "09:00", minute: 0 });
  assert.equal(builderOf("FREQ=HOURLY;INTERVAL=4;BYMINUTE=20").minute, 20);
  assert.equal(builderOf("FREQ=MINUTELY;INTERVAL=4"), null);
  assert.equal(builderOf("FREQ=DAILY;BYHOUR=9"), null);
  assert.equal(builderRrule({ frequency: "weekly", interval: 2, weekdays: ["WE", "MO"], month: 1, monthDays: [1], time: "09:00", minute: 0 }), "RRULE:FREQ=WEEKLY;INTERVAL=2;BYHOUR=9;BYMINUTE=0;BYDAY=MO,WE");
  for (const text of ["RRULE:FREQ=DAILY;INTERVAL=3;BYHOUR=7;BYMINUTE=15", "RRULE:FREQ=MONTHLY;INTERVAL=2;BYHOUR=9;BYMINUTE=0;BYMONTHDAY=1,15", "RRULE:FREQ=HOURLY;INTERVAL=6;BYMINUTE=30"]) assert.equal(builderRrule(builderOf(text)), text);
});

// MINSTD, exact in doubles.
let seed = 20261029;
const rand = (n) => (seed = (seed * 48271) % 2147483647) % n;
const pick = (list) => list[rand(list.length)];
const chance = (percent) => rand(100) < percent;
const distinct = (low, high, max) => { const set = new Set(), n = 1 + rand(max); while (set.size < n) set.add(low + rand(high - low + 1)); return [...set].sort((a, b) => a - b); }; // rrule.js walks unsorted BY lists as written
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");

function randomRule() {
  const freq = pick(["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
  const interval = pick({ MINUTELY: [1, 5, 7, 15, 30, 45, 60, 90, 120, 1440], HOURLY: [1, 1, 2, 3, 5, 7, 12, 24, 25], DAILY: [1, 1, 1, 2, 3], WEEKLY: [1, 1, 1, 2], MONTHLY: [1, 1, 2, 3], YEARLY: [1, 1, 2] }[freq]);
  const sub = freq === "MINUTELY" || freq === "HOURLY", start = chance(10);
  // ChatGPT's fast path reads an unwritten time or weekday off the real clock: pin them there.
  const pinned = !start && interval === 1 && (freq === "DAILY" || freq === "WEEKLY");
  const parts = [`FREQ=${freq}`];
  if (interval !== 1 || chance(50)) parts.push(`INTERVAL=${interval}`);
  // No MINUTELY+BYHOUR: rrule.js drifts off the step there (INTERVAL=90 from 17:37 "runs" at 21:07)
  // and never returns once BYDAY is added too (ChatGPT hangs on those).
  if (pinned || (freq !== "MINUTELY" && chance(sub ? 25 : 60))) parts.push(`BYHOUR=${distinct(0, 23, chance(80) ? 1 : 2)}`);
  if (pinned || chance(sub ? 50 : 60)) parts.push(`BYMINUTE=${distinct(0, 59, chance(80) ? 1 : 2)}`);
  const filter = sub ? pick(["none", "none", "day"]) : freq === "WEEKLY" && pinned ? "day" : pick(["none", "none", "day", "monthday", interval === 1 || freq === "YEARLY" ? "month" : "none"]);
  if (filter === "day" || (!sub && filter !== "none" && chance(25))) parts.push(`BYDAY=${(chance(20) ? DAYS : distinct(0, 6, 6).map((day) => DAYS[day])).join(",")}`);
  if (filter === "monthday" || (filter === "month" && chance(50))) parts.push(`BYMONTHDAY=${distinct(1, chance(85) ? 28 : 31, 2)}`);
  if (filter === "month") parts.push(`BYMONTH=${distinct(1, 12, 2)}`);
  if (chance(10)) parts.push("COUNT=1");
  if (chance(10)) parts.push("BYSECOND=0");
  if (chance(20)) parts.push(parts.shift());
  let text = (chance(50) ? "RRULE:" : "") + parts.join(";");
  if (!start) return chance(10) && !text.includes("BYDAY") ? text.toLowerCase() : text; // rrule.js reads lower-case weekdays as invalid
  const date = stamp(Date.UTC(2026, 9, 29) + (rand(800) - 400) * 86_400_000 + rand(1440) * 60_000).slice(0, 15) + (chance(50) ? "Z" : "");
  return chance(50) ? `DTSTART:${date}\n${text}` : `${text};DTSTART=${date}`;
}

// Where codex-ui and ChatGPT should agree in every time zone; the rest only match in UTC.
const anyZone = (rule) => !rule.dtstart && (
  (rule.count && !(rule.byhour && rule.byminute))
  || (rule.interval === 1 && (rule.freq === "DAILY" || rule.freq === "WEEKLY") && rule.byhour && rule.byminute && [...rule.keys].every((key) => ["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND", "COUNT"].includes(key)))
  || ((rule.freq === "MINUTELY" || rule.freq === "HOURLY") && !rule.byhour && (!rule.byday || rule.byday.length === 7))
  || (rule.freq === "HOURLY" && rule.byhour && !rule.count));

test("next runs, heartbeat intervals, jitter and one-shots match ChatGPT 26.1023", { skip }, () => {
  const zones = ["UTC", "Asia/Shanghai", "Asia/Kolkata", "America/New_York"];
  let compared = 0, everywhere = 0;
  for (let round = 0; round < 500; round += 1) {
    const text = randomRule(), rule = parseRrule(text);
    assert.ok(rule, text);
    assert.equal(oneShot(rule), oracle.hl(text), text);
    assert.equal(jitterSpan(rule), oracle._l(text), text);
    if (rule.freq !== "HOURLY" || rule.byminute) assert.equal(heartbeatInterval(rule), oracle.gl(text), text); // ChatGPT reads an unwritten one off the clock
    for (const zone of anyZone(rule) ? zones : ["UTC"]) {
      process.env.TZ = zone;
      const local = parseRrule(text); // a UTC DTSTART reads as this zone's wall clock
      for (let i = 0; i < 2; i += 1) {
        let now = Date.UTC(2026, 0, 1) + rand(1095) * 86_400_000 + rand(86_400) * 1000 + rand(1000);
        if (chance(25)) now -= now % 60_000;
        // ponytail: skips the hours around a DST change, where the wall clock repeats or jumps.
        if (new Date(now - 3 * 3_600_000).getTimezoneOffset() !== new Date(now + 3 * 3_600_000).getTimezoneOffset()) continue;
        assert.equal(wall(nextRun(local, now)), wall(oracle.pl({ rrule: text, now })), JSON.stringify({ zone, text, now: new Date(now).toISOString() }));
        compared += 1;
        if (zone !== "UTC") everywhere += 1;
      }
    }
  }
  assert.ok(compared > 1000 && everywhere > 300, `${compared} / ${everywhere}`);
});

test("rruleOf and builderRrule write what rrule.js writes", { skip }, () => {
  const { K } = oracle, day = (list) => DAYS.filter((name) => list.includes(name)).map((name) => K[name]);
  const time = () => `${pad(rand(24))}:${pad(rand(60))}`;
  for (let round = 0; round < 300; round += 1) {
    const weekdays = chance(15) ? [] : distinct(0, 6, 7).map((index) => DAYS[index]);
    const schedule = { ...DEFAULT_SCHEDULE, mode: pick(["hourly", "daily", "weekdays", "weekly", "monthly"]), intervalHours: 1 + rand(30), intervalMinutes: chance(50) ? null : 1 + rand(1500), weekdays, time: time(), monthDay: 1 + rand(31) };
    const [hour, minute] = schedule.time.split(":").map(Number);
    const options = {
      hourly: schedule.intervalMinutes == null ? { freq: K.HOURLY, interval: schedule.intervalHours, byminute: 0, byweekday: day(DAYS) } : { freq: K.MINUTELY, interval: schedule.intervalMinutes },
      daily: { freq: K.WEEKLY, byhour: hour, byminute: minute, byweekday: day(DAYS) },
      weekdays: { freq: K.WEEKLY, byhour: hour, byminute: minute, byweekday: day(["MO", "TU", "WE", "TH", "FR"]) },
      weekly: { freq: K.WEEKLY, byhour: hour, byminute: minute, byweekday: day(weekdays.length ? weekdays : ["SU"]) },
      monthly: { freq: K.MONTHLY, interval: 1, byhour: hour, byminute: minute, bymonthday: [schedule.monthDay] },
    }[schedule.mode];
    assert.equal(rruleOf(schedule), new K(options).toString(), JSON.stringify(schedule));
    const builder = { frequency: pick(["hourly", "daily", "weekly", "monthly", "yearly"]), interval: 1 + rand(12), weekdays, month: 1 + rand(12), monthDays: chance(10) ? [] : distinct(1, 31, 3), time: time(), minute: rand(60) };
    const [bh, bm] = builder.time.split(":").map(Number), days = [...builder.monthDays].sort((a, b) => a - b);
    const expected = builder.frequency === "hourly" ? { freq: K.HOURLY, interval: builder.interval, byminute: builder.minute }
      : { freq: K[builder.frequency.toUpperCase()], interval: builder.interval, byhour: bh, byminute: bm,
        ...(builder.frequency === "weekly" ? { byweekday: day(weekdays) } : {}), ...(builder.frequency === "yearly" ? { bymonth: builder.month } : {}),
        ...(builder.frequency === "monthly" || builder.frequency === "yearly" ? { bymonthday: days } : {}) };
    assert.equal(builderRrule(builder), new K(expected).toString(), JSON.stringify(builder));
  }
});
