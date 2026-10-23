// Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readContextUsage } from "./context-usage.mjs";

// Text of `n` tokens (4 bytes each) that opens with `head`.
const text = (head, n) => head.padEnd(n * 4, "x");
const line = (type, payload) => JSON.stringify({ timestamp: "2026-10-19T00:00:00Z", type, payload });
const message = (role, texts, kinds) => ({
  type: "message",
  role,
  content: texts.map((t) => ({ type: "input_text", text: t })),
  ...(kinds && { internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } }),
});
const item = (payload) => line("response_item", payload);
const tokenCount = (input, total) =>
  line("event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: input, total_tokens: total }, model_context_window: 9500 } });

// Written before parts carried their kind: the markers say what each part is.
const opening = [
  line("session_meta", { id: "t", base_instructions: { text: text("You are Codex.", 100) } }),
  item(message("developer", [text("<permissions instructions>", 10), text("<skills_instructions>", 20), text("## Memory\n", 10), text("<tools>\nDeferred tool namespaces:", 10), text("<apps_instructions>", 10)])),
  item(message("user", [text("# AGENTS.md instructions", 10), text("<environment_context>", 10)])),
  item(message("developer", [text("PONYTAIL MODE ACTIVE", 10)])), // hook context: the conversation
  item(message("user", [text("hello", 3)])),
];

test("splits the current window into Codex's context parts and infers the tools from the first request", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "context-usage-"));
  const write = (name, lines) => {
    const file = path.join(dir, name);
    writeFileSync(file, `${lines.join("\n")}\n`);
    return file;
  };
  try {
    // The first request carried the 193 tokens above and 1,000 of tool definitions.
    const first = [...opening, item({ type: "reasoning", encrypted_content: null }), tokenCount(1193, 1300)];
    assert.deepEqual(await readContextUsage(write("rollout-a.jsonl", first)), {
      usedTokens: 1300,
      windowTokens: 9500,
      mcpDeferred: true,
      system: 120,
      tools: 1000,
      skills: 20,
      agents: 10,
      memory: 10,
      mcp: 10,
      apps: 10,
    });

    // A compaction into an incremental window: the history now carries the base instructions and
    // the tool declarations, MCP namespaces apart, and every part says its kind.
    const functions = { type: "namespace", name: "functions", tools: [{ type: "function", name: "exec", description: text("Run code.", 40) }] };
    const repl = { type: "namespace", name: "mcp__repl", tools: [{ type: "function", name: "js", description: text("Run JS.", 12) }] };
    const json = (value) => Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 4);
    const window = [
      { type: "additional_tools", role: "developer", tools: [functions, repl] },
      message("developer", [text("You are a coding agent.", 50)], ["model.base_instructions"]),
      message("developer", [text("<skills_instructions>", 20), text("PONYTAIL", 10)], ["host_skills.instructions", "hooks.additional_context"]),
      message("user", [text("# AGENTS.md instructions", 10), text("hello", 3)], ["agents_md.instructions", "user.text"]),
    ];
    const compacted = [...first, line("compacted", { message: "", replacement_history: window }), tokenCount(0, 0), tokenCount(1200, 1250)];
    const after = await readContextUsage(write("rollout-b.jsonl", compacted));
    assert.equal(after.usedTokens, 1250);
    assert.deepEqual(
      [after.system, after.tools, after.mcp, after.skills, after.agents, after.memory, after.mcpDeferred],
      [50, json(functions), json(repl), 20, 10, 0, false],
    );

    assert.equal(await readContextUsage(write("rollout-c.jsonl", opening)), null, "no request has finished");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("counts history items as history.rs does, and only model output ends the first request", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "context-usage-"));
  try {
    // A sub-agent's first request: the base instructions (100), a developer part (10), a config
    // update (none) and the parent's message (author + recipient + text = 16 bytes, 4), then 500
    // of tools. The image the model drew afterwards counts as one resized image, not its base64.
    const lines = [
      line("session_meta", { id: "t", base_instructions: { text: text("You are Codex.", 100) } }),
      item(message("developer", [text("<permissions instructions>", 10)])),
      item({ type: "configuration_update", update: { model: text("gpt", 300) } }),
      item({ type: "agent_message", author: "root", recipient: "work", content: [{ type: "input_text", text: "do it ok" }] }),
      item({ type: "image_generation_call", id: "ig", status: "completed", revised_prompt: "a cat", result: "x".repeat(400_000) }),
      tokenCount(614, 700),
    ];
    const file = path.join(dir, "rollout-d.jsonl");
    writeFileSync(file, `${lines.join("\n")}\n`);
    const usage = await readContextUsage(file);
    assert.equal(usage.tools, 500);
    assert.equal(usage.system, 110);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
