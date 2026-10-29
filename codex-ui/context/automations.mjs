// 定时任务 in the transcript: the messages Codex UI's scheduler sends (a heartbeat envelope into an
// existing session, a cron header opening a fresh one), the guidance that goes with them, and the
// cleanup of what the model answers with (its <heartbeat> decision block and ::inbox-item line).

/** The additionalContext key the heartbeat guidance rides on, once per heartbeat turn. */
export const HEARTBEAT_KEY = "codex-ui.heartbeat";

/**
 * The heartbeat message, byte for byte what codex-rs history/src/heartbeat.rs parses (LF, two-space
 * indent, the prompt unescaped, a closing newline): only then does Codex fold repeated checks with
 * unchanged instructions. It folds only ids of [A-Za-z0-9_-]{1,128} and envelopes under ~3.6 KB;
 * past that the message still goes, it just isn't folded.
 */
export function heartbeatEnvelope(id, nowIso, prompt) {
  return `<heartbeat>\n  <automation_id>${id}</automation_id>\n  <current_time_iso>${nowIso}</current_time_iso>\n  <instructions>\n${prompt}\n  </instructions>\n</heartbeat>\n`;
}

const tag = (text, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(text)?.[1].trim() ?? null;

/** A heartbeat message, read as loosely as ChatGPT does (yv): any line ends, tags in any case. */
export function parseHeartbeat(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("<heartbeat>") || !trimmed.endsWith("</heartbeat>")) return null;
  const currentTimeIso = tag(trimmed, "current_time_iso");
  const instructions = tag(trimmed, "instructions");
  return currentTimeIso === null || instructions === null ? null : { automationId: tag(trimmed, "automation_id"), currentTimeIso, instructions };
}

/** The first message of a cron run: four header lines, a blank line, then the task. `memory` is an absolute path. */
export function cronMessage({ name, id, memory, lastRunAt, prompt }) {
  const last = lastRunAt == null ? "never" : `${new Date(lastRunAt).toISOString()} (${lastRunAt})`;
  return `Automation: ${String(name).replace(/\s*[\r\n]+\s*/g, " ")}\nAutomation ID: ${id}\nAutomation memory: ${memory}\nLast run: ${last}\n\n${prompt}`;
}

export function parseCronMessage(text) {
  const match = /^Automation: (.*)\nAutomation ID: (.*)\nAutomation memory: (.*)\nLast run: (?:never|\S+ \((\d+)\))\n\n([\s\S]*)$/.exec(text.trim());
  return match && { name: match[1], id: match[2], memory: match[3], lastRunAt: match[4] ? Number(match[4]) : null, prompt: match[5] };
}

/** Developer instructions for a cron run's session (appended to config.developer_instructions at thread/start). */
export const CRON_GUIDANCE = `## Scheduled task
Codex UI started this session for a scheduled task the user set up. Its first message comes from the scheduler, not from the user typing now: the header names the task (Automation), its id (Automation ID), a memory file (Automation memory) and the last run (Last run), and the task follows the blank line. Nobody watches while it runs, so don't wait on answers you can infer; say in your reply what blocked you.

- Read the memory file first (it may not exist yet) and build on earlier runs instead of repeating them. Before you finish, add a short note to it: when this run happened, what you did and what you decided.
- Reply briefly: what you found, what you changed and what the user should look at now. Link files with Markdown and absolute paths.
- When you open a pull request, add the codex-automation label next to the usual ones if the repository has it.
- End the reply with exactly one line of the form ::inbox-item{title="..." summary="..."} on its own, attributes separated by a space (no comma), nothing after it. Codex UI hides the line and shows it in the task's history: the title says what is now true in about 4-8 words (state and subject, such as "Nightly build fails on Windows"), the summary what the user should do or know next in about 6-14 words. Avoid empty words such as Update, Done or FYI.`;

/** The heartbeat turn's application context. Only with the scheduling tools does it mention them. */
export function heartbeatGuidance(tools) {
  return [
    "A user message wrapped in <heartbeat> comes from a scheduled task the user attached to this session, not from the user typing now. Codex UI sends it at the interval they chose: <instructions> holds what they asked you to keep an eye on and <automation_id> names the task.",
    'Find out where things stand with your tools, then decide whether the user needs to hear about it now. Stay quiet by default: when nothing changed or nothing can be acted on yet (still pending, queued, running or healthy), choose DONT_NOTIFY. Choose NOTIFY only for a completion, a failure, a meaningful change or something the user has to do. Being woken, having done some work, or instructions that ask for "status" are no reason to notify unless the user asked for regular updates.',
    "End every heartbeat turn with exactly one non-empty final reply whose last part is this block, as plain text, with the task's id and one decision:\n<heartbeat>\n  <automation_id>ID</automation_id>\n  <decision>NOTIFY or DONT_NOTIFY</decision>\n  <message>One sentence for the user.</message>\n</heartbeat>",
    "With NOTIFY, a short update may come before the block and <message> is the notification the user gets. With DONT_NOTIFY, write nothing outside the block, progress notes included; <message> says in a sentence why the user needn't act. Write the message in the user's language. Never end with an empty reply: when nothing changed, the reply is the DONT_NOTIFY block.",
    tools
      ? 'When what the task watches for is done, stale or no longer worth checking, first call automation_update to delete it (mode "delete") or pause it (mode "update", status PAUSED) by that automation id, then reply with NOTIFY and say why it stopped. When the work changed but the check still helps, update the task\'s instructions with automation_update rather than leaving them stale.'
      : "When what the task watches for looks done or stale, choose NOTIFY and suggest that the user pause or delete the scheduled task.",
  ].join("\n\n");
}

const BLOCKS = /<heartbeat>[\s\S]*?<\/heartbeat>/gi;
const FENCED = /```(?:xml)?\s*<heartbeat>[\s\S]*?<\/heartbeat>\s*```/gi;
const CDATA = /^<!\[CDATA\[([\s\S]*)\]\]>$/;
const quietWord = (text) => (CDATA.exec(text.trim())?.[1] ?? text).trim() === "DONT_NOTIFY";

/** The decision a heartbeat reply ends with (its last <heartbeat> block, fenced or bare), or a bare DONT_NOTIFY. */
export function heartbeatDecision(text) {
  if (quietWord(text)) return { decision: "DONT_NOTIFY", message: null };
  const block = [...text.matchAll(BLOCKS)].at(-1)?.[0];
  const decision = block && /<decision>\s*(NOTIFY|DONT_NOTIFY)\s*<\/decision>/i.exec(block);
  if (!decision) return null;
  const message = /<message>\s*([\s\S]*?)\s*<\/message>/i.exec(block)?.[1].trim() ?? "";
  return { decision: decision[1].toUpperCase(), message: (CDATA.exec(message)?.[1].trim() ?? message) || null };
}

/** While it streams, a reply stops before a heartbeat block that has begun, so no tag flashes by. */
function beforeBlock(text) {
  const open = /^[ \t]*<heartbeat>/im.exec(text);
  const tail = /^[ \t]*(<[a-z]*)$/im.exec(text.slice(text.lastIndexOf("\n") + 1));
  const at = open ? open.index : tail && "<heartbeat>".startsWith(tail[1].toLowerCase()) ? text.length - tail[1].length : -1;
  if (at >= 0) return text.slice(0, at).replace(/```(?:xml)?\s*$/i, "");
  // A fence just opened at the very end may be the block's ```xml.
  const fence = text.search(/```(?:x(?:m(?:l)?)?)?\s*$/i);
  return fence >= 0 && (text.slice(0, fence).match(/```/g)?.length ?? 0) % 2 === 0 ? text.slice(0, fence) : text;
}

/** ChatGPT's leaf directives that carry no text for the reader (Dqn). `:::` containers stay. */
const DIRECTIVES = ["inbox-item", "archive-thread", "thread-purpose-changed", "created-thread", "code-comment", "git-stage", "git-commit", "git-create-branch", "git-push", "git-create-pr", "pr-auto-fix-progress"];

function directive(line, unfinished) {
  const rest = line.trimStart();
  if (!rest.startsWith("::") || rest.startsWith(":::")) return false;
  const name = /^[\w-]*/.exec(rest.slice(2))[0];
  return unfinished && name.length === rest.length - 2 ? DIRECTIVES.some((known) => known.startsWith(name)) : DIRECTIVES.includes(name);
}

/**
 * What a reply shows: without a decided heartbeat block, the directive lines and a bare
 * DONT_NOTIFY; while it streams, also without a block or directive line still being written.
 * Text with none of these comes back as it was.
 */
export function visibleReply(text, streaming = false) {
  if (quietWord(text)) return "";
  let shown = heartbeatDecision(text) ? text.replace(FENCED, "").replace(BLOCKS, "") : text;
  if (streaming) shown = beforeBlock(shown);
  if (shown.includes("::")) {
    const lines = shown.split("\n");
    shown = lines.filter((line, at) => !directive(line, streaming && at === lines.length - 1)).join("\n");
  }
  return shown === text ? text : shown.trim();
}

/** The ::inbox-item a cron reply ends with (summary may be spelled description or subtitle). */
export function inboxItem(text) {
  const line = text.split("\n").map((row) => row.trim()).findLast((row) => /^::inbox-item(?![\w-])/.test(row));
  if (!line) return null;
  const attrs = {};
  for (const [, key, double, single, bare] of (/\{(.*)\}/.exec(line)?.[1] ?? "").matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'}]+))/g)) attrs[key] = double ?? single ?? bare;
  const title = attrs.title?.trim() || null;
  const summary = (attrs.summary ?? attrs.description ?? attrs.subtitle)?.trim() || null;
  return title || summary ? { title, summary } : null;
}

/**
 * Whether a finished run should reach the user: failures always do, "failed_runs_only" keeps the
 * rest quiet, a heartbeat follows its decision (an empty reply is quiet), a cron run notifies.
 * Null for an interrupted turn, which tells nobody anything.
 */
export function notificationDecision(kind, policy, status, reply) {
  if (status === "failed") return "NOTIFY";
  if (status !== "completed") return null;
  if (policy === "failed_runs_only") return "DONT_NOTIFY";
  if (kind !== "heartbeat") return "NOTIFY";
  const text = reply ?? "";
  return heartbeatDecision(text)?.decision ?? (visibleReply(text) ? "NOTIFY" : "DONT_NOTIFY");
}
