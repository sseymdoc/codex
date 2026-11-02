import assert from "node:assert/strict";
import { test } from "node:test";
import { MANAGE_ASKS, MANAGE_TOOLS, MANAGE_TOOL_NAMES, manageInput, manageReceipt, manageResult } from "./manage-tools.mjs";

const invalid = () => { throw new Error("invalid"); };

test("arguments are checked against each tool's own schema", () => {
  // Trimmed, deduplicated, an optional session_id defaulting to "self".
  assert.deepEqual(manageInput("move_sessions", { session_ids: [" a ", "a", "b"], group_id: null }), { session_ids: ["a", "b"], group_id: null });
  assert.deepEqual(manageInput("get_usage", {}), { session_id: "self" });
  assert.deepEqual(manageInput("set_transcript_view", { view: "verbose" }), { view: "verbose", session_id: "self" });
  assert.throws(() => manageInput("set_pinned", { session_id: "x" }), /pinned is required/);
  assert.throws(() => manageInput("set_pinned", { session_id: "x", pinned: "yes" }), /pinned must be boolean/);
  assert.throws(() => manageInput("set_view", { group_by: "state" }), /group_by must be one of/);
  assert.throws(() => manageInput("list_sessions", { limit: 0 }), /limit must be 1 to 200/);
  assert.throws(() => manageInput("delete_session", { session_ids: Array.from({ length: 26 }, (_, i) => `s${i}`) }), /1 to 25 entries/);
  assert.throws(() => manageInput("create_group", { name: "a\nb" }), /plain text/);
  assert.throws(() => manageInput("close_pane", { pane: "files", extra: 1 }), /Unknown close_pane arguments: extra/);
});

test("a receipt carries one of the tool's outcomes; a declined call is an error result", () => {
  const request = { args: {} };
  assert.equal(manageReceipt("set_pinned", { threadId: "a", cwd: "/x", outcome: "changed" }, request, invalid).outcome, "changed");
  assert.throws(() => manageReceipt("set_pinned", { threadId: "a", cwd: "/x", outcome: "archived" }, request, invalid));
  assert.throws(() => manageReceipt("set_pinned", { threadId: "a", cwd: "/x", outcome: "changed", extra: 1 }, request, invalid));
  assert.deepEqual(manageResult("set_pinned", { pinned: true }, { outcome: "declined" }), { isError: true, content: [{ type: "text", text: "The user declined; nothing was changed." }] });
  assert.equal(manageResult("list_groups", {}, { outcome: "listed", data: [] }).content[0].text, "[]");
  assert.match(manageResult("list_events", {}, { outcome: "read", data: { sessionId: "s", title: "T", text: "hi", cursor: "c1" } }).content[0].text, /untrusted data[\s\S]*before "c1"/);
});

test("every tool is listed with a closed schema, and none asks Codex for MCP approval", () => {
  assert.deepEqual(MANAGE_TOOLS.map((tool) => tool.name), [...MANAGE_TOOL_NAMES]);
  for (const tool of MANAGE_TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
  }
  for (const name of MANAGE_ASKS) assert.ok(MANAGE_TOOL_NAMES.includes(name), name);
});
