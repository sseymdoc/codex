// The RRULE subset scheduled tasks use: parsing, the next run, ChatGPT's heartbeat-interval,
// jitter and one-shot checks (src-tOjGKoT3.js pl/gl/_l/hl), Chinese descriptions, and the form's
// schedule <-> RRULE mapping (app-initial JCt/vwt/fwt/sb, nwt/rwt). No I/O.

export const DEFAULT_RRULE = "FREQ=HOURLY;INTERVAL=24;BYMINUTE=0";

const FREQS = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]; // Date#getDay order, as rrule.js writes them
const WORKDAYS = ["MO", "TU", "WE", "TH", "FR"];
const RANGES = { BYHOUR: [0, 23], BYMINUTE: [0, 59], BYMONTHDAY: [1, 31], BYMONTH: [1, 12] };
const UNSUPPORTED = ["UNTIL", "TZID", "BYSETPOS", "WKST", "BYYEARDAY", "BYWEEKNO", "BYEASTER"];
// pl's fast path takes only these keys; anything else goes through the general search.
const FAST = ["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND", "COUNT"];
// Periods searched before a rule counts as never running again (MINUTELY and HOURLY: one weekly cycle, as uc;
// DAILY to MONTHLY: a century of periods, since a weekday on February 29 can be 40 years apart).
const LIMITS = { MINUTELY: 10080, HOURLY: 168, DAILY: 36525, WEEKLY: 5218, MONTHLY: 1200, YEARLY: 400 };
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const CUSTOM = "自定义日程";
const NAMES = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const invalid = (part) => ({ code: "invalid", message: part ? `请输入有效的 RRULE（${part}）` : "请输入有效的 RRULE" });
const unsupported = (what) => ({ code: "unsupported", message: `暂不支持${what}` });

function parseDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z?)$/i.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map((part) => Number(part ?? 0));
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  if (!m[7]) return { year, month, day, hour, minute, second };
  // A UTC start reads as this machine's wall clock.
  return { year: at.getFullYear(), month: at.getMonth() + 1, day: at.getDate(), hour: at.getHours(), minute: at.getMinutes(), second: at.getSeconds() };
}

function read(text) {
  const source = String(text ?? "").trim() || DEFAULT_RRULE; // Pr
  let body = null, start = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(BEGIN|END):VEVENT$/i.test(line)) continue;
    const head = /^([A-Za-z-]+)([:;])(.*)$/.exec(line);
    const name = head?.[1].toUpperCase();
    if (!head) {
      if (body !== null) return unsupported("多条规则");
      body = line;
    } else if (name === "DTSTART") {
      if (head[2] === ";") return unsupported("带参数的 DTSTART（如 TZID）");
      if (start !== null) return invalid(line);
      start = head[3];
    } else if (name === "RRULE" && head[2] === ":") {
      if (body !== null) return unsupported("多条规则");
      body = head[3];
    } else if (name === "EXRULE" || name === "RDATE" || name === "EXDATE") return unsupported(` ${name}`);
    else return invalid(line);
  }
  if (body === null) return invalid("缺少 FREQ");
  const rule = { freq: null, interval: 1, byday: null, byhour: null, byminute: null, bymonthday: null, bymonth: null, count: null, dtstart: null, keys: new Set() };
  for (const part of body.split(";")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    const key = part.slice(0, eq).trim().toUpperCase(), value = part.slice(eq + 1).trim().toUpperCase();
    if (eq < 0 || !value || rule.keys.has(key)) return invalid(part);
    rule.keys.add(key);
    const numbers = () => value.split(",").map((item) => (/^[+-]?\d+$/.test(item) ? Number(item) : NaN));
    if (UNSUPPORTED.includes(key)) return unsupported(` ${key}`);
    if (key === "DTSTART") {
      if (start !== null) return invalid(part);
      start = value;
    } else if (key === "FREQ") {
      if (value === "SECONDLY") return unsupported(" SECONDLY");
      if (!FREQS.includes(value)) return invalid(part);
      rule.freq = value;
    } else if (key === "INTERVAL") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) return invalid(part);
      rule.interval = Number(value);
    } else if (key === "COUNT") {
      if (!/^\d+$/.test(value) || Number(value) < 1) return invalid(part);
      if (Number(value) !== 1) return unsupported("大于 1 的 COUNT");
      rule.count = 1;
    } else if (key === "BYSECOND") {
      const list = numbers();
      if (list.some((n) => !(n >= 0 && n <= 60))) return invalid(part);
      if (list.some((n) => n !== 0)) return unsupported("非 0 的 BYSECOND");
    } else if (key === "BYDAY") {
      const items = value.split(",");
      if (items.some((item) => /^[+-]?\d+(SU|MO|TU|WE|TH|FR|SA)$/.test(item))) return unsupported("带序号的 BYDAY");
      if (items.some((item) => !DAYS.includes(item))) return invalid(part);
      rule.byday = [...new Set(items.map((item) => DAYS.indexOf(item)))].sort((a, b) => a - b);
    } else if (RANGES[key]) {
      const list = numbers(), [low, high] = RANGES[key];
      if (key === "BYMONTHDAY" && list.some((n) => n < 0)) return unsupported("负数 BYMONTHDAY");
      if (list.some((n) => !(n >= low && n <= high))) return invalid(part);
      rule[key.toLowerCase()] = [...new Set(list)].sort((a, b) => a - b);
    } else return invalid(part);
  }
  if (!rule.freq) return invalid("缺少 FREQ");
  if ((rule.freq === "MINUTELY" || rule.freq === "HOURLY") && (rule.bymonth || rule.bymonthday)) return unsupported("在按分钟或按小时的规则里使用 BYMONTH / BYMONTHDAY");
  if (start !== null) {
    rule.dtstart = parseDate(start);
    if (!rule.dtstart) return invalid(`DTSTART:${start}`);
    rule.keys.add("DTSTART");
  }
  return { rule };
}

/** The rule, or null when it is invalid or outside the subset. Empty text is the default rule. */
export function parseRrule(text) {
  return read(text).rule ?? null;
}

// no-future is ChatGPT's "Automation schedule has no future runs. Check that its start time, interval,
// and BYHOUR/BYMINUTE/BYSECOND values can reach a future occurrence." in Chinese.
export function rruleProblem(text, now) {
  const parsed = read(text);
  if (!parsed.rule) return parsed;
  return nextRun(parsed.rule, now) == null ? { code: "no-future", message: "此日程之后不会再运行。请检查开始时间、间隔以及 BYHOUR / BYMINUTE / BYSECOND 的取值。" } : null;
}

/** The next nominal run after `now` (no jitter), or null when the rule never runs again. */
export function nextRun(rule, now) {
  const { freq, interval, byday, byhour, byminute, bymonth, bymonthday, count, dtstart, keys } = rule;
  if (count && !dtstart && !(byhour && byminute)) return null; // pl: a one-shot needs its time of day
  // cc: no BYMONTH month has any BYMONTHDAY (February counts 29 days).
  if (bymonth && bymonthday && !bymonthday.some((day) => bymonth.some((month) => day <= new Date(Date.UTC(2000, month, 0)).getUTCDate()))) return null;
  if (!dtstart && interval === 1 && (freq === "DAILY" || freq === "WEEKLY") && byhour && byminute && [...keys].every((key) => FAST.includes(key))) {
    // Pl/Fl: the wall-clock time today, or on the next allowed day.
    // ponytail: ChatGPT reads an unwritten WEEKLY weekday (and, on the other paths, an unwritten time)
    // off the real clock, rrule.js's dtstart = new Date(); codex-ui reads `now`, the same when now is Date.now().
    const days = byday ?? (freq === "WEEKLY" ? [new Date(now).getDay()] : null);
    return Math.min(...byhour.flatMap((hour) => byminute.map((minute) => (days ? onDays(now, hour, minute, days) : daily(now, hour, minute)))));
  }
  if (!dtstart && !byhour && (freq === "MINUTELY" || freq === "HOURLY") && (!byday || byday.length === 7)) return absolute(rule, now);
  return floating(rule, now);
}

function daily(now, hour, minute) {
  const today = new Date(now);
  const at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

function onDays(now, hour, minute, days) {
  const today = new Date(now);
  for (let n = 0; n <= 7; n += 1) {
    if (!days.includes((today.getDay() + n) % 7)) continue;
    const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, hour, minute, 0, 0).getTime();
    if (at > now) return at;
  }
  return now;
}

// Interval rules count real time from the current minute, as ChatGPT does: MINUTELY steps from it,
// HOURLY from its UTC hour, and BYMINUTE reads UTC minutes (Asia/Kolkata's BYMINUTE=0 is :30).
function absolute({ freq, interval, byminute }, now) {
  const start = Math.floor(now / MIN) * MIN;
  if (freq === "MINUTELY") {
    for (let step = 0, at = start; step <= LIMITS.MINUTELY; step += 1, at += interval * MIN) if (at > now && (!byminute || byminute.includes(new Date(at).getUTCMinutes()))) return at;
    return null;
  }
  const hour = Math.floor(start / HOUR) * HOUR;
  for (let step = 0; step <= LIMITS.HOURLY; step += 1) for (const minute of byminute ?? [new Date(start).getUTCMinutes()]) {
    const at = hour + step * interval * HOUR + minute * MIN;
    if (at > now) return at;
  }
  return null;
}

// Nl: a wall-clock time held in UTC fields back to real time, moved by the offset change when
// a DST jump puts it at or before now.
function unfloat(at, now) {
  const f = new Date(at);
  const local = new Date(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate(), f.getUTCHours(), f.getUTCMinutes(), f.getUTCSeconds(), f.getUTCMilliseconds());
  if (local.getTime() <= now) local.setTime(local.getTime() + (new Date(now).getTimezoneOffset() - local.getTimezoneOffset()) * MIN);
  return local.getTime();
}

// ponytail: rrule.js semantics on the local wall clock for everything else. ChatGPT runs MONTHLY,
// YEARLY, DAILY/WEEKLY with INTERVAL>1, MINUTELY+BYHOUR, partial BYDAY and DTSTART rules in UTC
// (Asia/Shanghai's BYHOUR=9 monthly runs at 17:00); codex-ui keeps them on local time on purpose.
function floating(rule, now) {
  const { freq, interval, byday, byhour, byminute, bymonth, bymonthday, count, dtstart, keys } = rule;
  const flat = now - new Date(now).getTimezoneOffset() * MIN; // now's wall clock, read as UTC
  let anchor = dtstart ? Date.UTC(dtstart.year, dtstart.month - 1, dtstart.day, dtstart.hour, dtstart.minute, dtstart.second) : Math.floor(flat / MIN) * MIN;
  if (!dtstart && !count && freq === "HOURLY" && byhour) {
    // pl: when stepping from this hour never reaches a BYHOUR, start from the first BYHOUR today.
    const at = new Date(anchor), reach = Array.from({ length: 24 }, (_, step) => (at.getUTCHours() + step * interval) % 24);
    if (!byhour.some((hour) => reach.includes(hour))) anchor = at.setUTCHours(byhour[0], byminute ? byminute[0] : at.getUTCMinutes(), 0, 0);
  }
  // rrule.js fills the unwritten BY fields from the start (`now` without a DTSTART, see nextRun).
  const a = new Date(anchor), plain = !bymonthday && !byday;
  const second = keys.has("BYSECOND") ? 0 : a.getUTCSeconds();
  const hours = byhour ?? (freq === "MINUTELY" || freq === "HOURLY" ? null : [a.getUTCHours()]);
  const minutes = byminute ?? (freq === "MINUTELY" ? null : [a.getUTCMinutes()]);
  const days = byday ?? (plain && freq === "WEEKLY" ? [a.getUTCDay()] : null);
  const monthdays = bymonthday ?? (plain && (freq === "MONTHLY" || freq === "YEARLY") ? [a.getUTCDate()] : null);
  const months = bymonth ?? (plain && freq === "YEARLY" ? [a.getUTCMonth() + 1] : null);
  const dayOk = (at) => {
    const d = new Date(at);
    return (!months || months.includes(d.getUTCMonth() + 1)) && (!monthdays || monthdays.includes(d.getUTCDate())) && (!days || days.includes(d.getUTCDay()));
  };
  const times = (day) => (dayOk(day) ? hours.flatMap((hour) => minutes.map((minute) => day + hour * HOUR + minute * MIN + second * 1000)) : []);
  const span = (from, to) => { const out = []; for (let day = from; day < to; day += DAY) out.push(...times(day)); return out; };
  const today = Math.floor(anchor / DAY) * DAY, f = new Date(flat);
  const unit = { MINUTELY: MIN, HOURLY: HOUR, DAILY: DAY, WEEKLY: 7 * DAY }[freq], step = unit && unit * interval;
  const base = { MINUTELY: Math.floor(anchor / MIN) * MIN, HOURLY: Math.floor(anchor / HOUR) * HOUR, DAILY: today, WEEKLY: today - ((a.getUTCDay() + 6) % 7) * DAY }[freq];
  const period = (k) => {
    if (freq === "MINUTELY") {
      const at = base + k * step, d = new Date(at);
      return dayOk(at) && (!hours || hours.includes(d.getUTCHours())) && (!minutes || minutes.includes(d.getUTCMinutes())) ? [at + second * 1000] : [];
    }
    if (freq === "HOURLY") {
      const at = base + k * step;
      return dayOk(at) && (!hours || hours.includes(new Date(at).getUTCHours())) ? minutes.map((minute) => at + minute * MIN + second * 1000) : [];
    }
    if (freq === "DAILY") return times(base + k * step);
    if (freq === "WEEKLY") return span(base + k * step, base + k * step + 7 * DAY);
    if (freq === "MONTHLY") { const month = a.getUTCMonth() + k * interval; return span(Date.UTC(a.getUTCFullYear(), month, 1), Date.UTC(a.getUTCFullYear(), month + 1, 1)); }
    const year = a.getUTCFullYear() + k * interval;
    return span(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
  };
  // Skip the periods wholly before now (a DTSTART may be long past); a one-shot counts from its start.
  const first = count ? 0 : Math.max(0, Math.floor(unit ? (flat - base) / step
    : freq === "MONTHLY" ? ((f.getUTCFullYear() - a.getUTCFullYear()) * 12 + f.getUTCMonth() - a.getUTCMonth()) / interval
      : (f.getUTCFullYear() - a.getUTCFullYear()) / interval));
  for (let k = first; k <= first + LIMITS[freq]; k += 1) for (const at of period(k)) {
    if (at < anchor) continue;
    if (at > flat) return unfloat(at, now);
    if (count) return null; // a one-shot's only run has passed
  }
  return null;
}

/** hl: runs once (COUNT=1). */
export function oneShot(rule) {
  return rule.count === 1;
}

const only = (rule, allowed) => [...rule.keys].every((key) => allowed.includes(key));

/** gl: a heartbeat's plain interval in ms (runs every N from now, not on the clock), else null. */
export function heartbeatInterval(rule) {
  if (rule.dtstart) return null;
  if (rule.freq === "MINUTELY") return only(rule, ["FREQ", "INTERVAL"]) ? rule.interval * MIN : null;
  // ponytail: ChatGPT reads an unwritten HOURLY BYMINUTE off the real clock here (an interval only
  // at :00 UTC); codex-ui takes it as unwritten, which runs at the same times give or take seconds.
  if (rule.freq !== "HOURLY" || !only(rule, ["FREQ", "INTERVAL", "BYDAY", "BYMINUTE"])) return null;
  if (rule.byminute && (rule.byminute.length !== 1 || rule.byminute[0] !== 0)) return null;
  return !rule.byday || rule.byday.length === 7 ? rule.interval * HOUR : null;
}

/** _l: the jitter span in seconds either side of a run. */
export function jitterSpan(rule) {
  if (rule.count === 1) return 0;
  if (rule.freq === "MINUTELY") return rule.interval >= 60 && only(rule, ["FREQ", "INTERVAL", "COUNT", "DTSTART"]) ? 300 : 0;
  if (rule.freq !== "HOURLY" && rule.freq !== "DAILY" && rule.freq !== "WEEKLY") return 0;
  return rule.byminute?.length > 1 ? 119 : 300;
}

const clock = (hour, minute) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
const names = (days) => {
  const words = days.map((day) => NAMES[day]);
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join("、")}和${words.at(-1)}`;
};
const same = (days, list) => days.length === list.length && list.every((day) => days.includes(day));
const WORK = [1, 2, 3, 4, 5], WEEKEND = [0, 6];

/** A Chinese summary like Claude's 每天 {time} {tz} 运行; 自定义日程 when there is no short one. */
export function describeRrule(text, { tz = "" } = {}) {
  const say = (line) => line.replace(/ {2,}/g, " ").trim();
  const rule = parseRrule(text);
  if (!rule) return CUSTOM;
  const { freq, interval, byday, byhour, byminute, bymonth, bymonthday, count, dtstart } = rule;
  if (count) {
    // The one run is the first occurrence from DTSTART, which BYHOUR / BYMINUTE can move.
    const run = dtstart && nextRun(rule, new Date(dtstart.year, dtstart.month - 1, dtstart.day, dtstart.hour, dtstart.minute, dtstart.second).getTime() - 1);
    if (run == null) return "运行一次";
    return say(`于 ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(run)} ${tz} 运行一次`);
  }
  const some = byday && byday.length < 7 ? byday : null;
  if (freq === "MINUTELY" || freq === "HOURLY") {
    if (byhour || (byminute && (freq === "MINUTELY" || byminute.length > 1))) return CUSTOM;
    const when = some ? (same(some, WORK) ? "工作日" : same(some, WEEKEND) ? "周末" : names(some)) : "";
    const unit = freq === "MINUTELY" ? "分钟" : "小时";
    return `${when}${interval === 1 ? `每${unit}` : `每 ${interval} ${unit}`}运行一次`;
  }
  if (!byhour || !byminute || byhour.length > 1 || byminute.length > 1) return CUSTOM;
  // Claude _p formats the time hour "numeric" (9:00 in zh-Hans), as its page and toasts do.
  const time = `${byhour[0]}:${String(byminute[0]).padStart(2, "0")}`, at = (when) => say(`${when} ${time} ${tz} 运行`);
  if (freq === "MONTHLY" || freq === "YEARLY") {
    if (interval !== 1 || byday || !bymonthday || (freq === "MONTHLY" ? bymonth : bymonth?.length !== 1)) return CUSTOM;
    return at(freq === "MONTHLY" ? `每月 ${bymonthday.join("、")} 日` : `每年 ${bymonth[0]} 月 ${bymonthday.join("、")} 日`);
  }
  if (bymonth || bymonthday) return CUSTOM;
  const week = byday ?? (freq === "DAILY" ? [0, 1, 2, 3, 4, 5, 6] : null);
  if (!week) return CUSTOM; // WEEKLY without BYDAY takes the weekday of whenever it is computed
  if (interval > 1) return freq === "DAILY" ? (byday ? CUSTOM : at(`每 ${interval} 天`)) : at(`每 ${interval} 周的${names(week)}`);
  if (week.length === 7) return at("每天");
  if (same(week, WORK)) return at("每个工作日");
  if (same(week, WEEKEND)) return at("周末");
  if (week.length === 1) return at(`每${NAMES[week[0]]}`);
  const from = week.find((day) => !week.includes((day + 6) % 7));
  if (week.length >= 3 && week.every((_, i) => week.includes((from + i) % 7))) return say(`于 ${NAMES[from]} 至 ${NAMES[(from + week.length - 1) % 7]} 的 ${time} ${tz} 运行`);
  return at(`每${names(week)}`);
}

const sortDays = (list) => DAYS.filter((day) => list.includes(day));
const hm = (time) => {
  const [hour, minute] = String(time).split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? [hour, minute] : [9, 0]; // Rwt, else 09:00
};
const positive = (n) => (Number.isFinite(n) && Math.round(n) >= 1 ? Math.round(n) : null);

export const DEFAULT_SCHEDULE = Object.freeze({ mode: "daily", intervalHours: 24, intervalMinutes: null, weekdays: Object.freeze([...DAYS]), time: "09:00", monthDay: 1, customRrule: "" });

/** The form's schedule for a rule (JCt): an interval, a daily/weekday/weekly time, a monthly day, else custom. */
export function scheduleOf(text) {
  const base = { ...DEFAULT_SCHEDULE, mode: "hourly", intervalHours: 1, intervalMinutes: 30, weekdays: [...DAYS] }; // qCt
  const raw = String(text ?? "").trim();
  const rule = parseRrule(raw);
  // Unlike JCt (which falls back to every 30 minutes), a rule outside the subset stays as written.
  if (!rule) return { ...base, mode: "custom", customRrule: raw };
  const { freq, interval, byday, byhour, byminute } = rule;
  const weekdays = (byday ?? [0, 1, 2, 3, 4, 5, 6]).map((day) => DAYS[day]);
  const time = byhour && byminute ? clock(byhour[0], byminute[0]) : "09:00";
  const custom = { ...base, mode: "custom", weekdays, time, customRrule: raw };
  if (byhour?.length > 1 || byminute?.length > 1) return custom;
  const plain = !rule.dtstart;
  if (plain && freq === "MINUTELY" && only(rule, ["FREQ", "INTERVAL"])) return { ...base, intervalHours: Math.max(1, Math.round(interval / 60)), intervalMinutes: interval };
  // Hours stay hours (JCt folds them into minutes): rruleOf writes back the same HOURLY rule, run on the UTC hour.
  if (plain && freq === "HOURLY" && only(rule, ["FREQ", "INTERVAL", "BYDAY", "BYMINUTE"]) && byminute?.[0] === 0 && weekdays.length === 7) return { ...base, intervalHours: interval, intervalMinutes: null };
  if (plain && only(rule, ["FREQ", "INTERVAL", "BYDAY", "BYHOUR", "BYMINUTE"]) && byhour && byminute && interval === 1 && (freq === "DAILY" || (freq === "WEEKLY" && byday))) {
    // Several weekdays stay "weekly" here (ChatGPT calls them custom); rruleOf writes the same rule.
    return { ...base, mode: weekdays.length === 7 ? "daily" : same(weekdays, WORKDAYS) ? "weekdays" : "weekly", weekdays, time };
  }
  const builder = builderOf(raw);
  if (builder?.frequency === "monthly" && builder.interval === 1 && builder.monthDays.length === 1) return { ...base, mode: "monthly", weekdays, time, monthDay: builder.monthDays[0] };
  return custom;
}

/** sb: the RRULE the form writes, as rrule.js's toString would. */
export function rruleOf(schedule) {
  const weekly = (days) => {
    const [hour, minute] = hm(schedule.time), list = sortDays(days);
    return `RRULE:FREQ=WEEKLY;BYHOUR=${hour};BYMINUTE=${minute}${list.length ? `;BYDAY=${list.join(",")}` : ""}`;
  };
  switch (schedule.mode) {
    case "hourly": return schedule.intervalMinutes == null
      ? `RRULE:FREQ=HOURLY;INTERVAL=${positive(schedule.intervalHours) ?? 1};BYMINUTE=0;BYDAY=${DAYS.join(",")}`
      : `RRULE:FREQ=MINUTELY;INTERVAL=${positive(schedule.intervalMinutes) ?? 30}`;
    case "daily": return weekly(DAYS);
    case "weekdays": return weekly(WORKDAYS);
    case "weekly": return weekly(schedule.weekdays.length ? schedule.weekdays : [DAYS[0]]);
    case "monthly": return builderRrule({ frequency: "monthly", interval: 1, weekdays: schedule.weekdays, month: 1, monthDays: [schedule.monthDay ?? 1], time: schedule.time, minute: 0 });
    default: return schedule.customRrule.trim();
  }
}

/** nwt: the custom builder's fields for a rule it can show, else null. */
export function builderOf(text) {
  const rule = parseRrule(text);
  if (!rule || rule.dtstart || rule.byhour?.length > 1 || rule.byminute?.length > 1) return null;
  const { freq, interval, byday, byhour, byminute, bymonth, bymonthday } = rule;
  const weekdays = (byday ?? [0, 1, 2, 3, 4, 5, 6]).map((day) => DAYS[day]);
  const timed = byhour && byminute, keys = ["FREQ", "INTERVAL", "BYHOUR", "BYMINUTE"];
  const base = { interval, weekdays, month: 1, monthDays: [1], time: timed ? clock(byhour[0], byminute[0]) : "09:00", minute: byminute?.[0] ?? 0 };
  switch (freq) {
    case "HOURLY": return byminute && weekdays.length === 7 && only(rule, ["FREQ", "INTERVAL", "BYMINUTE", "BYSECOND", "BYDAY"]) ? { ...base, frequency: "hourly" } : null;
    case "DAILY": return timed && only(rule, keys) ? { ...base, frequency: "daily" } : null;
    case "WEEKLY": return timed && byday && only(rule, [...keys, "BYDAY"]) ? { ...base, frequency: "weekly" } : null;
    case "MONTHLY": return timed && bymonthday && only(rule, [...keys, "BYMONTHDAY"]) ? { ...base, frequency: "monthly", monthDays: bymonthday } : null;
    case "YEARLY": return timed && bymonthday && bymonth?.length === 1 && only(rule, [...keys, "BYMONTHDAY", "BYMONTH"]) ? { ...base, frequency: "yearly", month: bymonth[0], monthDays: bymonthday } : null;
    default: return null;
  }
}

/** rwt: the custom builder's RRULE, as rrule.js's toString would. */
export function builderRrule(builder) {
  const interval = Math.max(1, Math.round(builder.interval));
  if (builder.frequency === "hourly") return `RRULE:FREQ=HOURLY;INTERVAL=${interval};BYMINUTE=${Math.min(59, Math.max(0, Math.round(builder.minute)))}`;
  const [hour, minute] = hm(builder.time);
  const head = `RRULE:FREQ=${builder.frequency.toUpperCase()};INTERVAL=${interval};BYHOUR=${hour};BYMINUTE=${minute}`;
  const monthDays = [...new Set(builder.monthDays.map((day) => Math.min(31, Math.max(1, Math.round(day)))))].sort((a, b) => a - b);
  const byMonthDay = monthDays.length ? `;BYMONTHDAY=${monthDays.join(",")}` : "";
  if (builder.frequency === "weekly") { const days = sortDays(builder.weekdays); return days.length ? `${head};BYDAY=${days.join(",")}` : head; }
  if (builder.frequency === "monthly") return head + byMonthDay;
  if (builder.frequency === "yearly") return `${head};BYMONTH=${Math.min(12, Math.max(1, Math.round(builder.month)))}${byMonthDay}`;
  return head;
}
