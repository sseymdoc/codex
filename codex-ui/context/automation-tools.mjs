// codex_ui_desktop's scheduled-task tools: automation_update for the tasks Codex UI runs on this
// computer (server/automations.mjs; fields as ChatGPT 26.1023's automation_update, S7a), and
// cloud_task_update for the user's ChatGPT cloud tasks (src/lib/cloud-automations.ts). Schemas,
// argument and receipt checks, result text. No I/O.
import { rruleProblem } from "./rrule.mjs";

export const AUTOMATION_TOOL_NAMES = Object.freeze(["automation_update", "cloud_task_update"]);
export const AUTOMATION_MODES = Object.freeze(["list", "view", "create", "update", "delete", "suggested_create", "suggested_update"]);
export const CLOUD_TASK_MODES = Object.freeze(["list", "create", "update", "pause", "resume", "delete"]);
/** server/automations.mjs EFFORTS. */
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
/** The fields only a cron task has: a heartbeat runs with its session's own settings. */
export const CRON_FIELDS = Object.freeze(["projectId", "cwds", "executionEnvironment", "model", "reasoningEffort", "autoArchive"]);
const LOCAL_FIELDS = ["kind", "name", "prompt", "rrule", "status", "notificationPolicy", "targetThreadId", ...CRON_FIELDS];
const CLOUD_FIELDS = ["title", "prompt", "rrule", "fireAt", "timezone"];
/** A list answers with this many tasks at most. */
export const LIST_MAX = 200;

const text = (maxLength, description) => ({ type: "string", minLength: 1, maxLength, description });

export const AUTOMATION_TOOLS = [
  { name: "automation_update", description: "Create, list, read, change or delete the scheduled tasks Codex UI runs on this computer (its 定时任务 page). Use it when the user wants something done on a schedule or later: a reminder, a recurring check, monitoring, \"look again in an hour\", \"keep an eye on this\". A heartbeat, the default, sends its prompt into a session (this chat unless targetThreadId names another) each time it is due, so the follow-up stays with the work. A cron task starts a fresh session in a folder at each run; use it only when the user wants a new session per run or standalone recurring work on a project. Tasks run while Codex UI is open; a missed run runs once when it next is. Call list first and update a task that exists rather than creating a second one; an update changes only the fields you send. suggested_create and suggested_update show the user the task on a card and save it only if they allow it: use them when the user should confirm the details, and suggested_create for a schedule anchored with DTSTART. In a turn the user did not start (a heartbeat, a scheduled run, an event), any other create or change also waits on that card; pausing (status PAUSED) and deleting never do. The prompt is shown to the user and sent as written at every run: the task itself in plain words, without the schedule, folder or session. Never show RRULE text to the user; say the schedule in words.",
    inputSchema: { type: "object", additionalProperties: false, required: ["mode"], properties: {
      mode: { type: "string", enum: [...AUTOMATION_MODES], description: "list: every task with its id. view: one task. create, update, delete: save at once (except where the description says a card asks first). suggested_create, suggested_update: the user allows it on a card first." },
      id: text(128, "The task's id from list. Required for view, update, delete and suggested_update."),
      kind: { type: "string", enum: ["heartbeat", "cron"], description: "To create: heartbeat (the usual choice: runs in a session) or cron (a fresh session in a folder at each run). A task's kind never changes." },
      name: text(250, "A short readable name. Required to create."),
      prompt: text(100_000, "What to do at each run, standalone and in plain words, with no schedule, folder or session in it. Required to create."),
      rrule: text(2000, "The schedule as an RRULE on the user's local wall clock, without converting to UTC: FREQ=DAILY;BYHOUR=9;BYMINUTE=0, FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=17;BYMINUTE=30; a heartbeat may also run every N minutes or hours (FREQ=MINUTELY;INTERVAL=30). Supported: FREQ, INTERVAL, BYDAY (MO to SU), BYHOUR, BYMINUTE, BYMONTHDAY, BYMONTH, COUNT=1 (run once). DTSTART only with suggested_create. Required to create; leave it out of an update that keeps the schedule."),
      status: { type: "string", enum: ["ACTIVE", "PAUSED"], description: "ACTIVE (default) or PAUSED; create one paused only when the user asks." },
      notificationPolicy: { type: ["string", "null"], enum: ["failed_runs_only", null], description: "failed_runs_only when the user asks not to be told (only failed runs notify); null to notify again. Omit to keep it. Not part of the prompt." },
      targetThreadId: text(128, "Heartbeat: the session it runs in, an id from a tool result or the Linked sessions note; omitted, this chat. Never guess one."),
      projectId: text(200, "Cron: a Codex UI project id; the task works in that project's folders. Not with cwds."),
      cwds: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 4096 }, description: "Cron: the folders the task works in, absolute or relative to this chat's folder; the first is where it runs. [] for no folder. Omitted when creating: this chat's folder." },
      executionEnvironment: { type: "string", enum: ["local", "worktree"], description: "Cron: local (default) works in the folder itself, worktree in a fresh git worktree of it at each run." },
      model: text(200, "Cron: a model id from this app's model list; omitted, the user's default model."),
      reasoningEffort: { type: "string", enum: [...EFFORTS], description: "Cron: reasoning effort; omitted, the model's default." },
      autoArchive: { type: "boolean", description: "Cron: archive a run's session once it completed and nobody carried on in it." },
    } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "cloud_task_update", description: "List, create, change, pause, resume or delete the user's cloud scheduled tasks in ChatGPT, the cloud cards of the 定时任务 page. ChatGPT runs them on its servers, each run a ChatGPT conversation, whether or not this computer is on, and they cannot reach this computer's files. Use it only when the user asks for a cloud or ChatGPT task; for anything else use automation_update. Every change, whoever started the turn, first waits on a card where the user allows or declines it: one change per call, and report what came back. Needs Codex UI signed in with ChatGPT.",
    inputSchema: { type: "object", additionalProperties: false, required: ["mode"], properties: {
      mode: { type: "string", enum: [...CLOUD_TASK_MODES], description: "list: the tasks with their ids. create, update, pause, resume, delete: each asks the user on a card first." },
      id: text(200, "The task's id from list; required except for list and create."),
      title: text(250, "A short name; omitted when creating, the start of the prompt."),
      prompt: text(100_000, "What ChatGPT does at each run. Required to create."),
      rrule: text(2000, "A repeating schedule as an RRULE on timezone's wall clock, e.g. FREQ=DAILY;BYHOUR=9;BYMINUTE=0. Not with fireAt."),
      fireAt: text(64, "One run at this moment, ISO 8601 with its offset, e.g. 2026-11-02T09:00:00+08:00. Not with rrule."),
      timezone: text(64, "An IANA time zone such as Asia/Shanghai; omitted when creating, this computer's."),
    } },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
];

const refuse = (message) => { throw Object.assign(new Error(message), { code: "INVALID_INPUT" }); };
const THREAD = /^[A-Za-z0-9_-]{1,128}$/;
const plain = (entry, max) => typeof entry === "string" && !!entry.trim() && entry.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(entry);
const oneLine = (entry, max) => plain(entry, max) && !/[\r\n]/.test(entry);
const SUPPORTED = "Supported: FREQ (MINUTELY to YEARLY), INTERVAL, BYDAY (MO to SU), BYHOUR, BYMINUTE, BYMONTHDAY, BYMONTH, COUNT=1.";

/** The rule's problem in context/rrule.mjs's words (Chinese, as the 定时任务 page shows it), for the model to fix. */
function checkRrule(rrule, onlyInvalid) {
  const problem = rruleProblem(rrule, Date.now());
  if (problem && (!onlyInvalid || problem.code === "invalid")) refuse(`rrule can't be used (${problem.code}): ${problem.message} ${SUPPORTED}`);
}

/** The keys of `value` that carry something. */
const given = (value) => Object.keys(value).filter((key) => value[key] !== undefined);

/** Text fields into `args`: the prompt as written, a rule over lines (DTSTART, RRULE), the rest one trimmed line. */
function readText(value, args, fields) {
  for (const [key, max] of fields) {
    if (value[key] === undefined) continue;
    const lines = key === "prompt" || key === "rrule";
    if (!(lines ? plain : oneLine)(value[key], max)) refuse(`${key} must be ${lines ? "text" : "one line of text"} of at most ${max} characters.`);
    args[key] = key === "prompt" ? value[key] : value[key].trim();
  }
}

export function automationInput(name, value) {
  if (name === "cloud_task_update") return cloudInput(value);
  if (name !== "automation_update") refuse("Unknown scheduled-task tool.");
  const extra = Object.keys(value).filter((key) => key !== "mode" && key !== "id" && !LOCAL_FIELDS.includes(key));
  if (extra.length) refuse(`Unknown automation_update arguments: ${extra.join(", ")}.`);
  const { mode } = value;
  if (!AUTOMATION_MODES.includes(mode)) refuse(`mode must be one of: ${AUTOMATION_MODES.join(", ")}.`);
  const keys = given(value);
  if (mode === "list") {
    if (keys.length > 1) refuse("list takes only mode.");
    return { mode };
  }
  const creating = mode === "create" || mode === "suggested_create";
  if (creating ? value.id !== undefined : !oneLine(value.id, 128)) refuse(creating ? "id names an existing task; leave it out to create one." : `${mode} needs the task's id (from list).`);
  if (mode === "view" || mode === "delete") {
    if (keys.length > 2) refuse(`${mode} takes only mode and id.`);
    return { mode, id: value.id.trim() };
  }
  const args = { mode, ...(!creating && { id: value.id.trim() }) };
  if (creating) {
    if (value.kind !== "heartbeat" && value.kind !== "cron") refuse("kind must be heartbeat or cron.");
    for (const key of ["name", "prompt", "rrule"]) if (value[key] === undefined) refuse(`${key} is required to create a task.`);
    args.kind = value.kind;
  } else {
    if (value.kind !== undefined) refuse("A task's kind can't change; delete it and create one of the other kind.");
    if (keys.length <= 2) refuse(`${mode} needs at least one field to change.`);
  }
  readText(value, args, [["name", 250], ["prompt", 100_000], ["rrule", 2000], ["projectId", 200], ["model", 200]]);
  if (value.rrule !== undefined) {
    // ChatGPT's create refuses DTSTART: the anchor's wall clock would read as UTC. The card shows it.
    if (mode === "create" && /(^|[;\n])\s*DTSTART\b/i.test(value.rrule)) refuse("create takes no DTSTART: write the time with BYHOUR and BYMINUTE on the user's wall clock, or use suggested_create for a schedule anchored to a start date, which the user confirms on a card.");
    checkRrule(args.rrule, false);
  }
  const choice = (key, options) => {
    if (value[key] === undefined) return;
    if (!options.includes(value[key])) refuse(`${key} must be one of: ${options.map(String).join(", ")}.`);
    args[key] = value[key];
  };
  choice("status", ["ACTIVE", "PAUSED"]);
  choice("notificationPolicy", ["failed_runs_only", null]);
  choice("executionEnvironment", ["local", "worktree"]);
  choice("reasoningEffort", EFFORTS);
  choice("autoArchive", [true, false]);
  if (value.targetThreadId !== undefined) {
    if (typeof value.targetThreadId !== "string" || !THREAD.test(value.targetThreadId.trim())) refuse("targetThreadId must be a session id.");
    args.targetThreadId = value.targetThreadId.trim();
  }
  if (value.cwds !== undefined) {
    if (!Array.isArray(value.cwds) || value.cwds.length > 8 || !value.cwds.every((cwd) => oneLine(cwd, 4096))) refuse("cwds must be a list of at most 8 folders.");
    args.cwds = value.cwds.map((cwd) => cwd.trim());
  }
  if (args.projectId !== undefined && args.cwds !== undefined) refuse("Pass projectId or cwds, not both.");
  if (creating) kindFields(args.kind, args);
  return args;
}

/** A heartbeat takes no cron fields, a cron task no session; an update checks this once its task's kind is known. */
export function kindFields(kind, args) {
  const cron = CRON_FIELDS.filter((key) => args[key] !== undefined);
  if (kind === "heartbeat" && cron.length) refuse(`${cron.join(", ")} apply only to cron tasks; a heartbeat runs with its session's own settings.`);
  if (kind === "cron" && args.targetThreadId !== undefined) refuse("targetThreadId applies only to heartbeats; a cron task starts a fresh session at each run.");
  // As the 定时任务 form: minute intervals are a heartbeat's.
  if (kind === "cron" && /FREQ=MINUTELY/i.test(args.rrule ?? "")) refuse("A cron task starts a fresh session at each run, so it runs hourly at most: use FREQ=HOURLY, or a heartbeat for checks every few minutes.");
}

function cloudInput(value) {
  const extra = Object.keys(value).filter((key) => key !== "mode" && key !== "id" && !CLOUD_FIELDS.includes(key));
  if (extra.length) refuse(`Unknown cloud_task_update arguments: ${extra.join(", ")}.`);
  const { mode } = value;
  if (!CLOUD_TASK_MODES.includes(mode)) refuse(`mode must be one of: ${CLOUD_TASK_MODES.join(", ")}.`);
  const keys = given(value);
  if (mode === "list") {
    if (keys.length > 1) refuse("list takes only mode.");
    return { mode };
  }
  if (mode === "create" ? value.id !== undefined : !oneLine(value.id, 200)) refuse(mode === "create" ? "id names an existing task; leave it out to create one." : `${mode} needs the task's id (from list).`);
  const args = { mode, ...(mode !== "create" && { id: value.id.trim() }) };
  if (mode === "pause" || mode === "resume" || mode === "delete") {
    if (keys.length > 2) refuse(`${mode} takes only mode and id.`);
    return args;
  }
  if (mode === "create" && value.prompt === undefined) refuse("prompt is required to create a task.");
  if (mode === "create" && (value.rrule === undefined) === (value.fireAt === undefined)) refuse("Give either rrule (a repeating task) or fireAt (one run).");
  if (value.rrule !== undefined && value.fireAt !== undefined) refuse("Give rrule or fireAt, not both.");
  if (mode === "update" && keys.length <= 2) refuse("update needs at least one field to change.");
  readText(value, args, [["title", 250], ["prompt", 100_000], ["rrule", 2000], ["fireAt", 64], ["timezone", 64]]);
  // ChatGPT reads more of RRULE than Codex UI runs (UNTIL, say): only text that does not read is refused.
  if (args.rrule !== undefined) checkRrule(args.rrule, true);
  if (args.fireAt !== undefined && (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(args.fireAt) || !Number.isFinite(Date.parse(args.fireAt)))) refuse("fireAt must be an ISO 8601 time with its offset, e.g. 2026-11-02T09:00:00+08:00.");
  if (args.timezone !== undefined) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: args.timezone }); } catch { refuse("timezone must be an IANA time zone such as Asia/Shanghai."); }
  }
  return args;
}

const LOCAL_TASK_KEYS = ["id", "kind", "name", "prompt", "status", "schedule", "rrule", "nextRunAt", "lastRunAt", "notificationPolicy", "targetThreadId", "cwds", "executionEnvironment", "model", "reasoningEffort", "autoArchive"];
const CLOUD_TASK_KEYS = ["id", "title", "prompt", "schedule", "timezone", "status", "nextRunAt"];
const OUTCOMES = {
  automation_update: { list: ["listed"], view: ["viewed"], create: ["created", "declined"], suggested_create: ["created", "declined"], update: ["updated", "declined"], suggested_update: ["updated", "declined"], delete: ["deleted"] },
  cloud_task_update: { list: ["listed"], create: ["created", "declined"], update: ["updated", "declined"], pause: ["paused", "declined"], resume: ["resumed", "declined"], delete: ["deleted", "declined"] },
};

export function automationReceipt(name, value, request, invalid) {
  const keys = name === "cloud_task_update" ? CLOUD_TASK_KEYS : LOCAL_TASK_KEYS;
  const task = (entry) => !!entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).every((key) => keys.includes(key)) && oneLine(entry.id, 200);
  if (Object.keys(value).some((key) => !["threadId", "cwd", "outcome", "task", "tasks"].includes(key))) invalid();
  const { mode } = request.args;
  if (!OUTCOMES[name]?.[mode]?.includes(value.outcome)) invalid();
  if (value.outcome === "listed") {
    if (!Array.isArray(value.tasks) || value.tasks.length > LIST_MAX || !value.tasks.every(task) || value.task !== undefined) invalid();
  } else if (value.tasks !== undefined || (value.outcome === "declined" ? value.task !== undefined : !task(value.task))) invalid();
  if (value.task && request.args.id !== undefined && value.task.id !== request.args.id) invalid();
  return value;
}

const VERBS = { create: "creating", suggested_create: "creating", update: "changing", suggested_update: "changing", pause: "pausing", resume: "resuming", delete: "deleting" };

export function automationResult(name, args, receipt) {
  const text = (body) => ({ content: [{ type: "text", text: body }] });
  const cloud = name === "cloud_task_update";
  const what = cloud ? "cloud scheduled task" : "scheduled task";
  const { task } = receipt;
  if (receipt.outcome === "declined") return { isError: true, content: [{ type: "text", text: `The user declined ${VERBS[args.mode]} the ${what}. Nothing was changed.` }] };
  if (receipt.outcome === "listed") return text(JSON.stringify({ tasks: receipt.tasks }));
  if (receipt.outcome === "viewed") return text(JSON.stringify({ task }));
  const label = `the ${what} “${cloud ? task.title : task.name}” (id ${task.id})`;
  if (receipt.outcome === "deleted") return text(`Deleted ${label}.`);
  const done = { created: "Created", updated: "Updated", paused: "Paused", resumed: "Resumed" }[receipt.outcome];
  return text(`${done} ${label}.\n${JSON.stringify({ task })}`);
}
