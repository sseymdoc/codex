// Scheduled tasks on this machine, kept apart from ChatGPT's own: <CODEX_HOME>/codex-ui/automations/
// holds a folder per task with automation.toml in ChatGPT 26.1023's format (src-tOjGKoT3.js tl, read
// back with its checks, $c), the schedule state (state.json), the run records (runs.json) and the
// model's memory.md. Pages claim due runs here every 30 seconds; claim files make each run start once
// across tabs and both bridge processes (desktop and browser mode share one CODEX_HOME).
// Sync fs throughout, as ChatGPT: nothing interleaves inside a process.
// ponytail: sync reads of a few small files per task block the bridge briefly; go async if task counts grow.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DEFAULT_RRULE, heartbeatInterval, jitterSpan, nextRun, oneShot, parseRrule, rruleProblem } from "../context/rrule.mjs";

const TOML = "automation.toml", STATE = "state.json", RUNS = "runs.json";
const GAP = 60_000; // qc: the least time between two runs of one task
const RETRY = 60_000; // Jc: a blocked run tries again this much later
const LEASE = 120_000; // a claimed heartbeat waits this long for its page to say it started
const CLAIM_TTL = 600_000; // claim files older than this are swept
// ponytail: one runs.json per task, rewritten whole (1000 run files took 375 ms to read here); keeps the newest 200.
const KEEP_RUNS = 200, SHOWN_RUNS = 50;
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const UNREAD = ["PENDING_REVIEW", "ACCEPTED"]; // TM
const THREAD = /^[A-Za-z0-9_-]{1,128}$/;
const PAUSE = new Int32Array(new SharedArrayBuffer(4));

const coded = (code, message) => Object.assign(new Error(message), { code });
const invalid = (message) => coded("INVALID", message);

// q, then \uXXXX for the other control characters (ChatGPT writes those raw, which is not TOML).
const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/"/g, "\\\"")
  .replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`)}"`;

/** tl: a task's automation.toml, key for key as ChatGPT 26.1023 writes it. */
export function automationToml(a) {
  const cron = a.kind === "cron";
  const lines = ["version = 1", `id = ${quote(a.id)}`, `kind = ${quote(a.kind)}`, `name = ${quote(a.name)}`, `prompt = ${quote(a.prompt)}`, `status = ${quote(a.status)}`, `rrule = ${quote(a.rrule)}`];
  if (a.model != null) lines.push(`model = ${quote(a.model)}`);
  if (a.reasoningEffort != null) lines.push(`reasoning_effort = ${quote(a.reasoningEffort)}`);
  if (cron && a.autoArchive) lines.push("auto_archive = true");
  if (a.notificationPolicy != null) lines.push(`notification_policy = ${quote(a.notificationPolicy)}`);
  if (cron) {
    if (a.pluginTemplateId != null) lines.push(`plugin_template_id = ${quote(a.pluginTemplateId)}`);
    lines.push(`execution_environment = ${quote(a.executionEnvironment)}`);
    if (a.localEnvironmentConfigPath != null) lines.push(`local_environment_config_path = ${quote(a.localEnvironmentConfigPath)}`);
    // codex-ui never writes a project target (ChatGPT would look its own project id up and skip the task); one read in stays.
    if (a.target?.type === "project") lines.push(`target = { type = "project", project_id = ${quote(a.target.projectId)} }`);
    else if (a.target?.type === "projectless") lines.push("target = { type = \"projectless\" }");
    lines.push(`cwds = [${a.cwds.map(quote).join(", ")}]`);
  } else lines.push(`target_thread_id = ${quote(a.targetThreadId)}`);
  lines.push(`created_at = ${a.createdAt}`, `updated_at = ${a.updatedAt}`);
  return `${lines.join("\n")}\n`;
}

const LINE_END = /\\[ \t]*\r?\n[ \t\r\n]*/y;
const BARE = /[A-Za-z0-9_-]+/y;
const NUMBER = /[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?/y;

/**
 * The TOML automation.toml files need: `key = value` lines (comments, CRLF, quoted keys), the four
 * string kinds, decimal numbers, booleans, arrays and inline tables. Throws on anything else
 * ([tables], dotted or repeated keys, dates).
 */
export function parseToml(text) {
  const src = String(text);
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const fail = (what) => { throw new SyntaxError(`automation.toml: ${what} at offset ${i}`); };
  const newline = () => (src[i] === "\n" ? 1 : src[i] === "\r" && src[i + 1] === "\n" ? 2 : 0);
  const spaces = () => { while (src[i] === " " || src[i] === "\t") i += 1; };
  const blank = () => { spaces(); if (src[i] === "#") while (i < src.length && !newline()) i += 1; };
  const gap = () => { for (blank(); newline(); blank()) i += newline(); };
  const escape = () => {
    const c = src[i + 1];
    i += 2;
    const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", "\"": "\"", "\\": "\\" }[c];
    if (simple) return simple;
    const size = c === "u" ? 4 : c === "U" ? 8 : 0, hex = src.slice(i, i + size), code = parseInt(hex, 16);
    if (!size || hex.length !== size || !/^[\dA-Fa-f]+$/.test(hex) || code > 0x10ffff || (code >= 0xd800 && code < 0xe000)) fail("bad escape");
    i += size;
    return String.fromCodePoint(code);
  };
  const string = (multiline) => {
    const q = src[i], three = q.repeat(3);
    let out = "";
    if (multiline && src.startsWith(three, i)) {
      i += 3;
      i += newline(); // a newline right after the quotes is not content
      for (;;) {
        if (i >= src.length) fail("unclosed string");
        if (src.startsWith(three, i)) {
          let end = i + 3;
          while (src[end] === q && end < i + 5) end += 1; // one or two more quotes still belong to the content
          out += q.repeat(end - i - 3);
          i = end;
          return out;
        }
        LINE_END.lastIndex = i;
        if (q === "\"" && LINE_END.test(src)) i = LINE_END.lastIndex;
        else if (q === "\"" && src[i] === "\\") out += escape();
        else { out += src[i]; i += 1; }
      }
    }
    for (i += 1; src[i] !== q; ) {
      if (i >= src.length || src[i] === "\n" || src[i] === "\r") fail("unclosed string");
      if (q === "\"" && src[i] === "\\") out += escape();
      else { out += src[i]; i += 1; }
    }
    i += 1;
    return out;
  };
  const value = () => {
    const c = src[i];
    if (c === "\"" || c === "'") return string(true);
    if (c === "[") {
      const list = [];
      for (i += 1, gap(); src[i] !== "]"; gap()) {
        list.push(value());
        gap();
        if (src[i] === ",") i += 1;
        else if (src[i] !== "]") fail("expected , or ]");
      }
      i += 1;
      return list;
    }
    if (c === "{") {
      const table = {};
      i += 1;
      spaces();
      if (src[i] === "}") { i += 1; return table; }
      for (;;) {
        pair(table);
        spaces();
        if (src[i] === "}") { i += 1; return table; }
        if (src[i] !== ",") fail("expected , or }");
        i += 1;
        spaces();
      }
    }
    if (src.startsWith("true", i)) { i += 4; return true; }
    if (src.startsWith("false", i)) { i += 5; return false; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(src);
    if (!m) fail("expected a value");
    i = NUMBER.lastIndex;
    return Number(m[0].replaceAll("_", ""));
  };
  const pair = (table) => {
    let key;
    if (src[i] === "\"" || src[i] === "'") key = string(false);
    else {
      BARE.lastIndex = i;
      key = BARE.exec(src)?.[0] ?? fail("expected a key");
      i = BARE.lastIndex;
    }
    spaces();
    if (src[i] === ".") fail("dotted keys are not supported");
    if (src[i] !== "=") fail("expected =");
    if (key === "__proto__" || Object.hasOwn(table, key)) fail(`repeated key ${key}`);
    i += 1;
    spaces();
    table[key] = value();
  };
  const root = {};
  for (gap(); i < src.length; gap()) {
    if (src[i] === "[") fail("tables are not supported");
    pair(root);
    blank();
    if (i < src.length && !newline()) fail("expected the end of the line");
  }
  return root;
}

const optional = (value, check) => value === undefined || check(value);
const isString = (value) => typeof value === "string";
const oneOf = (list) => (value) => list.includes(value);
const isTarget = (v) => v !== null && typeof v === "object" && (v.type === "projectless" || (v.type === "project" && isString(v.project_id)));

/** $c with zod Tr: the task an automation.toml holds, or why it is skipped (ChatGPT's reason names). */
export function parseAutomationToml(text, dirId) {
  let t;
  try { t = parseToml(text); } catch { return { error: "invalid_toml" }; }
  const fits = isString(t.id) && isString(t.name) && isString(t.prompt) && Number.isFinite(t.created_at) && Number.isFinite(t.updated_at)
    && ["ACTIVE", "PAUSED", "DELETED", "DISABLED"].includes(t.status)
    && ["rrule", "model", "local_environment_config_path", "plugin_template_id", "target_thread_id"].every((key) => optional(t[key], isString))
    && optional(t.version, Number.isFinite) && optional(t.kind, oneOf(["cron", "heartbeat"])) && optional(t.execution_environment, oneOf(["worktree", "local"]))
    && optional(t.reasoning_effort, oneOf(EFFORTS)) && optional(t.notification_policy, oneOf(["failed_runs_only"]))
    && optional(t.auto_archive, (v) => typeof v === "boolean") && optional(t.cwds, (v) => Array.isArray(v) && v.every(isString)) && optional(t.target, isTarget);
  if (!fits) return { error: "invalid_schema" };
  if (t.version !== undefined && t.version !== 1) return { error: "unsupported_version" };
  if (t.id !== dirId) return { error: "id_mismatch" };
  const base = { id: t.id, name: t.name, prompt: t.prompt, status: t.status === "DISABLED" ? "PAUSED" : t.status, rrule: t.rrule?.trim() || DEFAULT_RRULE,
    model: t.model?.trim() || null, reasoningEffort: t.reasoning_effort ?? null, notificationPolicy: t.notification_policy ?? null, createdAt: t.created_at, updatedAt: t.updated_at };
  if (t.kind === "heartbeat") return t.target_thread_id?.trim() ? { automation: { ...base, kind: "heartbeat", targetThreadId: t.target_thread_id } } : { error: "missing_heartbeat_target" };
  if (!t.cwds) return { error: "missing_cron_cwds" };
  return { automation: { ...base, kind: "cron", pluginTemplateId: t.plugin_template_id?.trim() || null, autoArchive: t.auto_archive ?? false,
    target: t.target?.type === "project" ? { type: "project", projectId: t.target.project_id } : t.target?.type === "projectless" ? { type: "projectless" } : null,
    cwds: t.cwds, executionEnvironment: t.execution_environment ?? "worktree", localEnvironmentConfigPath: t.local_environment_config_path?.trim() || null } };
}

/** jc, plus what Windows refuses in a folder name. */
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128 && id !== "." && id !== ".." && !/[\\/<>:"|?*\x00-\x1f\x7f]/.test(id);

/** vl: a task's fixed offset for one nominal time, within ±span seconds. */
const jitterMs = (id, nominal, salt, span) => ((createHash("sha256").update(`${salt}:${id}:${nominal}`).digest().readUInt32BE(0) % (2 * span + 1)) - span) * 1000;

/** ml: the next run after now (or after the nominal time of the run it follows), jittered. */
export function computeNext({ automation, salt, now, afterNominalRunAt }) {
  const rule = parseRrule(automation.rrule), found = rule && nextRun(rule, Math.max(now, afterNominalRunAt ?? now));
  if (found == null) return null;
  // gl: a plain-interval heartbeat counts from now, not on the clock.
  const interval = automation.kind === "heartbeat" ? heartbeatInterval(rule) : null, nominal = interval == null ? found : now + interval;
  const span = jitterSpan(rule);
  return { nextRunAt: Math.max(now, nominal + (span ? jitterMs(automation.id, nominal, salt, span) : 0)), nextRunNominalAt: nominal };
}

/** Qc: the next run once a due (or run-now) run starts. A missed run runs once and the next counts from it. */
function advance(automation, state, now, salt) {
  const rule = parseRrule(automation.rrule), next = state.next_run_at, nominal = state.next_run_nominal_at;
  if (automation.kind === "cron" || !rule || heartbeatInterval(rule) == null) {
    if (next != null && next > now && nominal != null && nominal > now) return { nextRunAt: next, nextRunNominalAt: nominal };
    if (next == null && nominal != null && state.last_run_at != null) return null;
  }
  // ponytail: ChatGPT ends only a cron one-shot here; codex-ui ends a heartbeat one too ("at 9 tomorrow" would repeat daily).
  if (next != null && next <= now && rule && oneShot(rule)) return null;
  return computeNext({ automation, salt, now, afterNominalRunAt: next != null && next <= now ? nominal : undefined });
}

/** bl: the schedule state for a task as its TOML now reads; a changed rule or status (a hand edit too) recomputes it. */
function syncState(automation, state, now, salt) {
  const changed = !state || state.rrule !== automation.rrule || state.status !== automation.status;
  const last = state?.last_run_at ?? null, rule = parseRrule(automation.rrule);
  let next = state?.next_run_at ?? null, nominal = state?.next_run_nominal_at ?? null;
  if (automation.status !== "ACTIVE") next = nominal = null;
  // bl's test, untangled: changed, or no next run and either never run or no nominal time on a repeating rule.
  else if (changed || (next == null && (last == null || (nominal == null && !(rule && oneShot(rule)))))) {
    const computed = computeNext({ automation, salt, now });
    next = computed?.nextRunAt ?? null;
    nominal = computed?.nextRunNominalAt ?? null;
  }
  return { rrule: automation.rrule, status: automation.status, next_run_at: next, next_run_nominal_at: nominal, last_run_at: last, lease_key: changed || next == null ? null : state.lease_key ?? null };
}

// Al after Qc: the state once a run starts (a finished task keeps its last nominal time, as ChatGPT's does).
function moved(automation, state, now, salt) {
  const next = automation.status === "ACTIVE" ? advance(automation, state, now, salt) : null;
  return { ...state, next_run_at: next?.nextRunAt ?? null, next_run_nominal_at: next ? next.nextRunNominalAt : state.next_run_nominal_at, last_run_at: now, lease_key: null };
}

// The fields a new task or an edit sets, checked as ChatGPT's Tr and form do; `old` fills what the input leaves out.
function normalize(input, old, now) {
  if (!input || typeof input !== "object") throw invalid("缺少定时任务内容");
  const pick = (key, fallback) => (input[key] === undefined ? fallback : input[key]);
  const text = (key, fallback, limit, label) => {
    const value = pick(key, fallback) ?? "";
    if (!isString(value) || value.length > limit) throw invalid(`${label}无效`);
    return value;
  };
  const kind = old?.kind ?? pick("kind", "cron");
  if (kind !== "cron" && kind !== "heartbeat") throw invalid("定时任务类型无效");
  if (old && input.kind !== undefined && input.kind !== old.kind) throw invalid("不能更改定时任务的类型");
  const prompt = text("prompt", old?.prompt, 100_000, "指令");
  if (!prompt.trim()) throw invalid("请输入指令");
  // mTt: an unnamed task takes the start of its prompt.
  const name = text("name", old?.name, 250, "名称").trim() || prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  const status = pick("status", old?.status ?? "ACTIVE");
  if (status !== "ACTIVE" && status !== "PAUSED") throw invalid("状态无效");
  const rrule = text("rrule", old?.rrule, 2000, "日程").trim() || DEFAULT_RRULE;
  const problem = rruleProblem(rrule, now);
  // Tl refuses a schedule that never runs; El only one that stays active, so pausing always works.
  if (problem && (!old || status === "ACTIVE")) throw invalid(problem.message);
  const notificationPolicy = pick("notificationPolicy", old?.notificationPolicy ?? null);
  if (notificationPolicy !== null && notificationPolicy !== "failed_runs_only") throw invalid("通知设置无效");
  const common = { kind, name, prompt, status, rrule, notificationPolicy };
  if (kind === "heartbeat") {
    const targetThreadId = pick("targetThreadId", old?.targetThreadId);
    if (!isString(targetThreadId) || !THREAD.test(targetThreadId)) throw invalid("请选择会话");
    return { ...common, model: null, reasoningEffort: null, targetThreadId }; // a heartbeat runs with its thread's settings
  }
  const model = text("model", old?.model, 200, "模型").trim() || null;
  const reasoningEffort = pick("reasoningEffort", old?.reasoningEffort ?? null);
  if (reasoningEffort !== null && !EFFORTS.includes(reasoningEffort)) throw invalid("推理强度无效");
  const executionEnvironment = pick("executionEnvironment", old?.executionEnvironment ?? "worktree");
  if (executionEnvironment !== "local" && executionEnvironment !== "worktree") throw invalid("运行环境无效");
  const autoArchive = pick("autoArchive", old?.autoArchive ?? false);
  if (typeof autoArchive !== "boolean") throw invalid("归档设置无效");
  const cwds = pick("cwds", old?.cwds ?? []);
  if (!Array.isArray(cwds) || !cwds.every((cwd) => isString(cwd) && path.isAbsolute(cwd))) throw invalid("文件夹必须是绝对路径");
  // Folders go in cwds only, and a task without one is projectless.
  const target = input.cwds === undefined && old ? old.target : cwds.length ? null : { type: "projectless" };
  return { ...common, model, reasoningEffort, pluginTemplateId: old?.pluginTemplateId ?? null, autoArchive, target, cwds, executionEnvironment, localEnvironmentConfigPath: old?.localEnvironmentConfigPath ?? null };
}

const camel = (record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]));
const RANK = { IN_PROGRESS: 0, PENDING_REVIEW: 1 };
const byStatus = (a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || b.created_at - a.created_at; // wM
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createAutomations({ home = process.env.CODEX_HOME || path.join(homedir(), ".codex"), now = Date.now } = {}) {
  const root = path.join(home, "codex-ui", "automations");
  const file = (id, name) => path.join(root, id, name);
  const json = (where) => { try { return JSON.parse(readFileSync(where, "utf8")); } catch { return null; } };
  // nl: write beside the file and rename over it; the temporary name is unique, as two processes may write at once.
  // Windows refuses to replace a file another process is reading that moment, so a refused rename tries again
  // shortly (ChatGPT deletes the file first instead, which readers then find missing).
  const write = (where, text) => {
    const tmp = path.join(path.dirname(where), `.${path.basename(where)}.tmp-${Date.now()}-${randomUUID()}`);
    writeFileSync(tmp, text);
    for (let attempt = 1; ; attempt += 1) {
      try { return renameSync(tmp, where); } catch (error) {
        if (attempt === 40 || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) { rmSync(tmp, { force: true }); throw error; }
        Atomics.wait(PAUSE, 0, 0, 5);
      }
    }
  };
  let salted = "";
  const salt = () => {
    const where = path.join(root, ".run-jitter-salt");
    if (!salted) try { salted = readFileSync(where, "utf8").trim(); } catch {}
    if (salted) return salted;
    mkdirSync(root, { recursive: true });
    try { writeFileSync(where, `${randomUUID()}\n`, { flag: "wx" }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    return (salted = readFileSync(where, "utf8").trim());
  };
  const stamp = () => Number(json(path.join(root, ".stamp"))) || 0;
  // Every change moves the stamp on, so pages of the other process find it at their next claim. Only a hint:
  // a write it loses to a busy file must not fail the change (or the claims) already made.
  const touch = () => {
    const value = Math.max(Date.now(), stamp() + 1);
    try { mkdirSync(root, { recursive: true }); write(path.join(root, ".stamp"), `${value}\n`); } catch {}
    return value;
  };
  const ids = () => { try { return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name); } catch { return []; } };
  // A folder's task as { automation } or { error }; null without an automation.toml (being created, or not a task) or when DELETED.
  const read = (id) => {
    if (!validId(id)) return { error: "unsafe_id" };
    let text;
    try { text = readFileSync(file(id, TOML), "utf8"); } catch { return null; }
    const found = parseAutomationToml(text, id);
    return found.automation?.status === "DELETED" ? null : found;
  };
  const load = (id) => read(id)?.automation ?? null;
  const loaded = (id) => {
    const automation = load(id);
    if (!automation) throw coded("NOT_FOUND", "找不到此定时任务");
    return automation;
  };
  const readState = (id) => json(file(id, STATE));
  const saveState = (id, state) => write(file(id, STATE), `${JSON.stringify(state)}\n`);
  // Writes the state unless another process changed it since `before` was read: a compare-and-swap whose
  // window is microseconds, where a read-modify-write would span the whole claim.
  // ponytail: no lock; two processes re-syncing one hand edit at the moment it falls due may both run it.
  const commit = (id, before, after) => {
    if (!same(readState(id), before)) return false;
    try { saveState(id, after); return true; } catch { return false; }
  };
  const sync = (automation, time) => {
    const before = readState(automation.id), state = syncState(automation, before, time, salt());
    return same(state, before) || commit(automation.id, before, state) ? state : readState(automation.id) ?? state;
  };
  const runsOf = (id) => json(file(id, RUNS)) ?? [];
  const saveRuns = (id, runs) => write(file(id, RUNS), `${JSON.stringify(runs.slice(0, KEEP_RUNS))}\n`);
  const findRun = (threadId) => {
    for (const id of ids()) {
      const runs = runsOf(id), run = runs.find((item) => item.thread_id === threadId);
      if (run) return { id, runs, run };
    }
    return null;
  };
  const view = (automation, state, runs, time) => ({ ...automation,
    nextRunAt: state.next_run_at, nextRunNominalAt: state.next_run_nominal_at, lastRunAt: state.last_run_at,
    running: (state.lease_key != null && state.next_run_at > time) || runs.some((run) => run.status === "IN_PROGRESS"),
    dir: path.join(root, automation.id) });
  // A claim file only matters while its due time is the task's next run; old ones go.
  const sweep = (id) => {
    let names = [];
    try { names = readdirSync(path.join(root, id)); } catch {}
    for (const name of names) if (name.startsWith(".claim-")) try { if (statSync(file(id, name)).mtimeMs < Date.now() - CLAIM_TTL) rmSync(file(id, name), { force: true }); } catch {}
  };
  // Fc: the name's slug, then -2 to -20, then a random suffix; mkdir takes the name across processes.
  const reserve = (name) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").slice(0, 64).replace(/-$/, "") || "automation";
    for (const id of [base, ...Array.from({ length: 19 }, (_, n) => `${base}-${n + 2}`), `${base}-${randomUUID().slice(0, 8)}`]) {
      try { mkdirSync(path.join(root, id)); return id; } catch (error) { if (error.code !== "EEXIST") throw error; }
    }
    throw coded("CONFLICT", "无法为定时任务创建文件夹");
  };

  function update(id, patch) {
    const old = loaded(id), time = now();
    const automation = { id, ...normalize(patch, old, time), createdAt: old.createdAt, updatedAt: time };
    write(file(id, TOML), automationToml(automation));
    const state = syncState(automation, readState(id), time, salt());
    saveState(id, state);
    touch();
    return view(automation, state, runsOf(id), time);
  }

  function runEvent({ threadId, event, failed = false, inboxTitle, inboxSummary, readAt, archivedReason, archivedUserMessage, archivedAssistantMessage } = {}) {
    const found = findRun(threadId);
    if (!found) return null;
    const { id, runs, run } = found, time = now();
    if (event === "completed") {
      // ea and aa: done, waiting for review; failed_runs_only reads a success at once.
      if (run.status === "IN_PROGRESS" || run.status === "PENDING_REVIEW") {
        run.status = "PENDING_REVIEW";
        if (!failed && load(id)?.notificationPolicy === "failed_runs_only") run.read_at ??= time;
      }
      if (isString(inboxTitle)) run.inbox_title = inboxTitle;
      if (isString(inboxSummary)) run.inbox_summary = inboxSummary;
    } else if (event === "accepted") { if (run.status !== "ARCHIVED") run.status = "ACCEPTED"; } // $i: the user carried on in it
    else if (event === "archived") { // na and ra
      run.status = "ARCHIVED";
      run.archived_reason ??= isString(archivedReason) ? archivedReason : null;
      if (isString(archivedUserMessage)) run.archived_user_message = archivedUserMessage;
      if (isString(archivedAssistantMessage)) run.archived_assistant_message = archivedAssistantMessage;
    } else if (event === "unarchived") { if (run.status === "ARCHIVED") Object.assign(run, { status: "ACCEPTED", read_at: run.read_at ?? time, archived_reason: null }); } // ua
    else if (event === "read") run.read_at = Number.isFinite(readAt) ? readAt : time;
    else if (event === "unread") run.read_at = null;
    else throw invalid("未知的运行事件");
    run.updated_at = time;
    saveRuns(id, runs);
    touch();
    return camel(run);
  }

  return {
    root,
    /** The time of the last change, as list() and claim() report it. */
    stamp,
    /** Every task (next runs synced), the folders that do not read as one, the newest runs and the unread ones (TM). */
    list() {
      const time = now(), items = [], invalidItems = [], runs = [], unread = [];
      for (const id of ids()) {
        const found = read(id);
        if (!found) continue;
        if (found.error) { invalidItems.push({ id, reason: found.error }); continue; }
        const own = runsOf(id);
        items.push(view(found.automation, sync(found.automation, time), own, time));
        runs.push(...[...own].sort(byStatus).slice(0, SHOWN_RUNS));
        for (const run of own) if (run.read_at == null && UNREAD.includes(run.status)) unread.push({ automationId: id, threadId: run.thread_id });
      }
      return { root, stamp: stamp(), items: items.sort((a, b) => b.updatedAt - a.updatedAt), invalid: invalidItems, runs: runs.sort(byStatus).map(camel),
        unread: { total: unread.length, automationIds: [...new Set(unread.map((run) => run.automationId))], unreadRuns: unread } };
    },
    create(input) {
      const time = now(), fields = normalize(input, null, time);
      mkdirSync(root, { recursive: true });
      const automation = { id: reserve(fields.name), ...fields, createdAt: time, updatedAt: time };
      write(file(automation.id, TOML), automationToml(automation));
      const state = syncState(automation, null, time, salt());
      saveState(automation.id, state);
      touch();
      return view(automation, state, [], time);
    },
    update,
    /** Dl: the task's whole folder, runs and memory too. False when there was none. */
    remove(id) {
      if (!validId(id)) return false;
      try { if (!statSync(path.join(root, id)).isDirectory()) return false; } catch { return false; }
      rmSync(path.join(root, id), { recursive: true, force: true });
      touch();
      return true;
    },
    /**
     * Sse's pick: up to `max` due ACTIVE tasks, soonest first, at least a minute after their last run and one
     * heartbeat per thread at a time. A cron task moves on to its next run before it starts; a heartbeat is
     * leased until its page reports. The claim token goes back to report().
     */
    claim({ max = 3 } = {}) {
      const time = now(), tasks = [], claims = [];
      let wrote = false;
      for (const id of ids()) {
        sweep(id);
        const automation = load(id);
        if (automation) tasks.push({ automation, state: sync(automation, time) });
      }
      const leased = new Set(tasks.filter(({ automation, state }) => automation.kind === "heartbeat" && state.lease_key != null && state.next_run_at > time).map(({ automation }) => automation.targetThreadId));
      const due = tasks.filter(({ automation, state }) => automation.status === "ACTIVE" && state.next_run_at != null && state.next_run_at <= time)
        .sort((a, b) => a.state.next_run_at - b.state.next_run_at).slice(0, max);
      for (const { automation, state } of due) {
        const { id } = automation, defer = (at) => { wrote = commit(id, state, { ...state, next_run_at: at }) || wrote; };
        if (state.last_run_at != null && state.last_run_at + GAP > time) { defer(state.last_run_at + GAP); continue; }
        if (automation.kind === "heartbeat" && leased.has(automation.targetThreadId)) { defer(time + RETRY); continue; }
        // The due time is the key: whoever creates its file runs it, and a state that moved on meanwhile
        // (another process ran it, or synced it to another time) hands the claim back.
        const key = String(state.next_run_at), claimFile = file(id, `.claim-${key}`);
        try { writeFileSync(claimFile, `${time}\n`, { flag: "wx" }); } catch { continue; }
        const fresh = readState(id);
        const next = fresh?.next_run_at !== state.next_run_at ? null
          : automation.kind === "heartbeat" ? { ...fresh, next_run_at: time + LEASE, lease_key: key } : moved(automation, fresh, time, salt());
        if (!next || !commit(id, fresh, next)) { rmSync(claimFile, { force: true }); continue; }
        wrote = true;
        if (automation.kind === "heartbeat") leased.add(automation.targetThreadId);
        claims.push({ token: `${id}/${key}/${fresh.next_run_nominal_at ?? ""}`, trigger: "scheduled", automation: view(automation, next, runsOf(id), time), lastRunAt: fresh.last_run_at, nominalAt: fresh.next_run_nominal_at });
      }
      return { claims, stamp: wrote ? touch() : stamp() };
    },
    /** Cse: a run started by hand. A cron task's schedule moves on now; a heartbeat's when its page reports it started. */
    runNow(id) {
      const automation = loaded(id), time = now(), state = sync(automation, time);
      const next = automation.kind === "cron" ? moved(automation, state, time, salt()) : state;
      if (next !== state) saveState(id, next);
      touch();
      return { token: `${id}/now-${time}/`, trigger: "run_now", automation: view(automation, next, runsOf(id), time), lastRunAt: state.last_run_at, nominalAt: null };
    },
    /**
     * What became of a claim: `started` (a heartbeat's schedule moves on, a cron run is recorded IN_PROGRESS),
     * `retry` (a minute later), `failed` (logged; `retry` as well when asked) or `paused` (its thread is archived).
     * A heartbeat's report after its lease ran out is stale and changes nothing.
     */
    report(token, outcome, { threadId = null, threadTitle = null, sourceCwd = null, retry = false } = {}) {
      const [id, key = "", nominal = ""] = String(token).split("/");
      const automation = load(id);
      if (!automation || !key) return { ok: false, stale: true };
      const time = now(), state = sync(automation, time), scheduled = /^\d+$/.test(key), heartbeat = automation.kind === "heartbeat";
      if (heartbeat && scheduled && state.lease_key !== key) return { ok: false, stale: true };
      let next = state;
      if (outcome === "paused") {
        if (automation.status === "ACTIVE") update(id, { status: "PAUSED" });
        return { ok: true };
      } else if (outcome === "retry" || (outcome === "failed" && retry)) {
        // ponytail: Zc retries at the sooner of this and the next scheduled run. The claim's nominal time comes
        // back so the retried run still counts as that one. A run-now has nothing to retry.
        if (scheduled && automation.status === "ACTIVE") next = { ...state, next_run_at: time + RETRY, next_run_nominal_at: /^\d+$/.test(nominal) ? Number(nominal) : state.next_run_nominal_at, lease_key: null };
      } else if (outcome === "started" || outcome === "failed") {
        if (heartbeat) next = moved(automation, scheduled ? { ...state, next_run_at: Number(key) } : state, time, salt());
        else if (outcome === "started") { // Qi
          if (!isString(threadId) || !THREAD.test(threadId)) throw invalid("缺少会话 ID");
          const runs = runsOf(id);
          if (!runs.some((run) => run.thread_id === threadId)) {
            saveRuns(id, [{ thread_id: threadId, automation_id: id, status: "IN_PROGRESS", read_at: null, thread_title: isString(threadTitle) ? threadTitle : null,
              source_cwd: isString(sourceCwd) ? sourceCwd : null, inbox_title: null, inbox_summary: null, archived_user_message: null, archived_assistant_message: null,
              archived_reason: null, created_at: time, updated_at: time }, ...runs]);
          }
        }
        // A failed cron run only gets logged by its page: the schedule moved on when it was claimed (Sse).
      } else throw invalid("未知的运行结果");
      if (next !== state) saveState(id, next);
      touch();
      return { ok: true };
    },
    /** A run's thread moved on: completed, accepted, archived, unarchived, read or unread. Null when no run has the thread. */
    runEvent,
    /** Marks every unread run read; returns how many. */
    readAll(readAt) {
      const time = Number.isFinite(readAt) ? readAt : now();
      let count = 0;
      for (const id of ids()) {
        const runs = runsOf(id), unread = runs.filter((run) => run.read_at == null && UNREAD.includes(run.status));
        if (!unread.length) continue;
        for (const run of unread) Object.assign(run, { read_at: time, updated_at: time });
        saveRuns(id, runs);
        count += unread.length;
      }
      if (count) touch();
      return count;
    },
    /**
     * A thread was archived, unarchived or deleted: its run follows (na / ua / removed), heartbeats on it
     * pause when it is archived (ChatGPT finds that when one next runs) and go with it when deleted (Fm).
     */
    threadEvent(threadId, event) {
      if (event !== "archived" && event !== "unarchived" && event !== "deleted") throw invalid("未知的会话事件");
      const automations = [], found = findRun(threadId);
      if (found && event === "deleted") saveRuns(found.id, found.runs.filter((run) => run !== found.run));
      else if (found) runEvent({ threadId, event });
      if (event !== "unarchived") for (const id of ids()) {
        const automation = load(id);
        if (automation?.kind !== "heartbeat" || automation.targetThreadId !== threadId) continue;
        if (event === "deleted") rmSync(path.join(root, id), { recursive: true, force: true });
        else if (automation.status === "ACTIVE") update(id, { status: "PAUSED" });
        else continue;
        automations.push(id);
      }
      if (found || automations.length) touch();
      return { automations, runs: found ? 1 : 0 };
    },
  };
}
