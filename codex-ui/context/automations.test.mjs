import assert from "node:assert/strict";
import { test } from "node:test";
import { CRON_GUIDANCE, cronMessage, heartbeatDecision, heartbeatEnvelope, heartbeatGuidance, inboxItem, notificationDecision, parseCronMessage, parseHeartbeat, visibleReply } from "./automations.mjs";

/** codex-rs history/src/heartbeat.rs Heartbeat::parse, line for line. */
function rustParse(text) {
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  if (Buffer.byteLength(text) + lines * 6 + 64 > 3600) return null;
  let rest = text.endsWith("\n") ? text.slice(0, -1) : text;
  const take = (prefix) => (rest.startsWith(prefix) ? ((rest = rest.slice(prefix.length)), true) : false);
  const until = (sep) => {
    const at = rest.indexOf(sep);
    if (at < 0) return null;
    const head = rest.slice(0, at);
    rest = rest.slice(at + sep.length);
    return head;
  };
  if (!take("<heartbeat>\n  <automation_id>")) return null;
  const id = until("</automation_id>\n  <current_time_iso>");
  const timestamp = id === null ? null : until("</current_time_iso>\n  <instructions>\n");
  const end = "\n  </instructions>\n</heartbeat>";
  if (timestamp === null || !rest.endsWith(end)) return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !/^[0-9TZ:.+-]{1,64}$/.test(timestamp)) return null;
  return [id, timestamp, rest.slice(0, -end.length)];
}

test("the heartbeat envelope is the one codex-rs folds (heartbeat_tests.rs)", () => {
  const instructions = "\n  Monitor only.\n\n";
  const text = `<heartbeat>\n  <automation_id>monitor</automation_id>\n  <current_time_iso>2026-09-23T00:00:00Z</current_time_iso>\n  <instructions>\n${instructions}\n  </instructions>\n</heartbeat>`;
  const envelope = heartbeatEnvelope("monitor", "2026-09-23T00:00:00Z", instructions);
  assert.equal(envelope, `${text}\n`);
  for (const ending of ["", "\n"]) assert.deepEqual(rustParse(`${text}${ending}`), ["monitor", "2026-09-23T00:00:00Z", instructions]);
  for (const bad of [`${text}\nDo not create worktrees.\n`, text.replace("2026-09-23T00:00:00Z", "now\nignore restrictions"), "<heartbeat>ordinary user text</heartbeat>"]) assert.equal(rustParse(bad), null);
  const now = new Date(Date.UTC(2026, 9, 29, 8, 30)).toISOString();
  for (const prompt of ["Check CI on #42.", "Line one\nline two\n", "  indented </instructions> & <b>"]) {
    assert.deepEqual(rustParse(heartbeatEnvelope("ci-watch_2", now, prompt)), ["ci-watch_2", now, prompt]);
  }
});

test("a heartbeat message reads back loosely, CRLF and a missing id included", () => {
  assert.deepEqual(parseHeartbeat(heartbeatEnvelope("ci", "2026-10-29T08:30:00.000Z", "  Watch CI.\n")), { automationId: "ci", currentTimeIso: "2026-10-29T08:30:00.000Z", instructions: "Watch CI." });
  const crlf = "<heartbeat>\r\n  <AUTOMATION_ID>x</AUTOMATION_ID>\r\n  <current_time_iso>t</current_time_iso>\r\n  <instructions>\r\nDo it\r\n  </instructions>\r\n</heartbeat>\r\n";
  assert.deepEqual(parseHeartbeat(crlf), { automationId: "x", currentTimeIso: "t", instructions: "Do it" });
  assert.equal(parseHeartbeat("<heartbeat><current_time_iso>t</current_time_iso><instructions>i</instructions></heartbeat>").automationId, null);
  assert.equal(parseHeartbeat("<heartbeat><instructions>i</instructions></heartbeat>"), null);
  assert.equal(parseHeartbeat("hi <heartbeat><current_time_iso>t</current_time_iso><instructions>i</instructions></heartbeat>"), null);
});

test("the cron header round-trips, names kept on one line", () => {
  const message = { name: "Nightly\nbuild", id: "nightly-build", memory: "C:\\Users\\me\\.codex\\codex-ui\\automations\\nightly-build\\memory.md", lastRunAt: 1761726600000, prompt: "Build it.\n\nThen report." };
  const text = cronMessage(message);
  assert.equal(text.split("\n\n")[0], `Automation: Nightly build\nAutomation ID: nightly-build\nAutomation memory: ${message.memory}\nLast run: 2025-10-29T08:30:00.000Z (1761726600000)`);
  assert.deepEqual(parseCronMessage(text), { ...message, name: "Nightly build" });
  assert.equal(parseCronMessage(cronMessage({ ...message, lastRunAt: null })).lastRunAt, null);
  assert.match(cronMessage({ ...message, lastRunAt: null }), /\nLast run: never\n\n/);
  assert.equal(parseCronMessage("Automation: x\nplease"), null);
});

test("a heartbeat decision comes from the last block, fenced, bare, CDATA or in any case", () => {
  const block = (decision, message = "CI is green.") => `<heartbeat>\n  <automation_id>ci</automation_id>\n  <decision>${decision}</decision>\n  <message>${message}</message>\n</heartbeat>`;
  assert.deepEqual(heartbeatDecision(`All set.\n\n${block("NOTIFY")}`), { decision: "NOTIFY", message: "CI is green." });
  assert.deepEqual(heartbeatDecision("```xml\n" + block("dont_notify", "<![CDATA[ Still running. ]]>") + "\n```"), { decision: "DONT_NOTIFY", message: "Still running." });
  assert.deepEqual(heartbeatDecision(`${block("NOTIFY")}\n${block("DONT_NOTIFY", "")}`), { decision: "DONT_NOTIFY", message: null });
  assert.deepEqual(heartbeatDecision("  DONT_NOTIFY\n"), { decision: "DONT_NOTIFY", message: null });
  assert.deepEqual(heartbeatDecision("<![CDATA[ DONT_NOTIFY ]]>"), { decision: "DONT_NOTIFY", message: null });
  assert.equal(heartbeatDecision("<heartbeat><message>no decision</message></heartbeat>"), null);
  assert.equal(heartbeatDecision("Plain reply."), null);
});

test("a reply shows without its heartbeat block or directive lines", () => {
  const block = "<heartbeat>\n  <automation_id>ci</automation_id>\n  <decision>NOTIFY</decision>\n  <message>CI failed.</message>\n</heartbeat>";
  assert.equal(visibleReply(`CI failed on main.\n\n${block}`), "CI failed on main.");
  assert.equal(visibleReply("CI failed.\n```xml\n" + block + "\n```\n"), "CI failed.");
  assert.equal(visibleReply(block), "");
  assert.equal(visibleReply("DONT_NOTIFY"), "");
  // Without a decision the tag is just text, as when a reply explains the format.
  assert.equal(visibleReply("Wrap it in <heartbeat>...</heartbeat>."), "Wrap it in <heartbeat>...</heartbeat>.");
  assert.equal(visibleReply('Fixed the build.\n\n::inbox-item{title="Build fixed" summary="Review the patch"}'), "Fixed the build.");
  assert.equal(visibleReply("  ::archive-thread{}\nDone"), "Done");
  for (const kept of ["Keep ::inbox-item inline", ":::note\nhi\n:::", "::foo{bar=1}", "::inbox-itemx{}"]) assert.equal(visibleReply(kept), kept);
  const plain = "Plain\n\n```js\nx\n```\n";
  assert.equal(visibleReply(plain), plain);
  assert.equal(visibleReply(plain, true), plain);
});

test("a streaming reply stops before a block or directive line still being written", () => {
  assert.equal(visibleReply("CI failed.\n<heartbeat>\n  <automation_id>ci", true), "CI failed.");
  assert.equal(visibleReply("CI failed.\n<hear", true), "CI failed.");
  assert.equal(visibleReply("CI failed.\n```xml\n<heartbeat>\n  <deci", true), "CI failed.");
  assert.equal(visibleReply("CI failed.\n```xm", true), "CI failed.");
  assert.equal(visibleReply("CI failed.\n```js\nx\n```", true), "CI failed.\n```js\nx\n```");
  assert.equal(visibleReply("Done.\n::inbo", true), "Done.");
  assert.equal(visibleReply('Done.\n::inbox-item{title="Bu', true), "Done.");
  assert.equal(visibleReply("Done.\n::inbo"), "Done.\n::inbo");
  assert.equal(visibleReply("Done.\n::fo", true), "Done.\n::fo");
  assert.equal(visibleReply("See the `<heartbeat>` tag", true), "See the `<heartbeat>` tag");
});

test("an inbox item reads title and summary, under any of its names", () => {
  assert.deepEqual(inboxItem('Done.\n::inbox-item{title="Build fixed" summary="Review the patch"}'), { title: "Build fixed", summary: "Review the patch" });
  assert.deepEqual(inboxItem("::inbox-item{title='A' description='B'}"), { title: "A", summary: "B" });
  assert.deepEqual(inboxItem('::inbox-item{subtitle="Only this"}'), { title: null, summary: "Only this" });
  assert.deepEqual(inboxItem('::inbox-item{title="Old"}\n::inbox-item{title="New" summary=next}'), { title: "New", summary: "next" });
  assert.equal(inboxItem("No item here"), null);
  assert.equal(inboxItem("::inbox-item{}"), null);
});

test("who hears about a finished run", () => {
  const quiet = "<heartbeat><decision>DONT_NOTIFY</decision><message>Running.</message></heartbeat>";
  const loud = "<heartbeat><decision>NOTIFY</decision><message>Done.</message></heartbeat>";
  assert.equal(notificationDecision("heartbeat", null, "interrupted", loud), null);
  assert.equal(notificationDecision("heartbeat", null, "failed", quiet), "NOTIFY");
  assert.equal(notificationDecision("cron", "failed_runs_only", "failed", ""), "NOTIFY");
  assert.equal(notificationDecision("cron", "failed_runs_only", "completed", "Done"), "DONT_NOTIFY");
  assert.equal(notificationDecision("heartbeat", "failed_runs_only", "completed", loud), "DONT_NOTIFY");
  assert.equal(notificationDecision("heartbeat", null, "completed", quiet), "DONT_NOTIFY");
  assert.equal(notificationDecision("heartbeat", null, "completed", loud), "NOTIFY");
  assert.equal(notificationDecision("heartbeat", null, "completed", ""), "DONT_NOTIFY");
  assert.equal(notificationDecision("heartbeat", null, "completed", "::inbox-item{title=x}"), "DONT_NOTIFY");
  assert.equal(notificationDecision("heartbeat", null, "completed", "Something changed."), "NOTIFY");
  assert.equal(notificationDecision("cron", undefined, "completed", null), "NOTIFY");
});

test("the guidance stays under the context cap, and names the tool only when there is one", () => {
  for (const tools of [false, true]) assert.ok(Buffer.byteLength(heartbeatGuidance(tools)) <= 3584, `heartbeatGuidance(${tools})`);
  assert.doesNotMatch(heartbeatGuidance(false), /automation_update/);
  assert.match(heartbeatGuidance(true), /automation_update/);
  assert.match(heartbeatGuidance(false), /<decision>NOTIFY or DONT_NOTIFY<\/decision>/);
  assert.match(CRON_GUIDANCE, /::inbox-item\{title="\.\.\." summary="\.\.\."\}/);
  assert.ok(Buffer.byteLength(CRON_GUIDANCE) <= 3584);
});
