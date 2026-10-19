// What fills a thread's context window, for the rail's 上下文 card. Claude's breakdown comes from
// Claude Code (get_context_usage); Codex's app-server reports only totals, but a thread's rollout
// records what the model is shown: each context fragment as one content part (typed by
// content_item_kinds, or opened by its marker in older rollouts), the conversation, compactions
// with the history that replaces them, and the exact token count of every request. Parts are
// estimated the way Codex estimates history (core/src/context_manager/history.rs: 4 bytes a
// token). A window that records its instructions and tool declarations (incremental windows,
// after a compaction) carries them as items; before that they ride along with each request, the
// base instructions in session_meta and the tools nowhere, so the tools are what the first
// request's exact input leaves once its text is counted. The card takes Messages as the live
// total less these parts.

import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";

/** A rollout's file name; nothing else is read here. */
export const ROLLOUT_FILE = /^rollout-.+\.jsonl$/;

/** history.rs RESIZED_IMAGE_BYTES_ESTIMATE. */
const IMAGE_BYTES = 7373;
const BASE_KIND = "model.base_instructions";
const KEPT = 32;
const cache = new Map();

const size = (text) => Buffer.byteLength(text ?? "", "utf8");
const tokens = (bytes) => Math.ceil(bytes / 4);

/** content_item_kinds families (codex-rs core/src/context) → part. */
const FAMILIES = { host_skills: "skills", skills: "skills", memories: "memory", agents_md: "agents", tools: "mcp", plugins: "apps", apps: "apps" };

/** The same, by opening marker, for rollouts written before parts carried their kind. */
const MARKERS = [
  [/^<skills_instructions>/, "skills"],
  [/^(# AGENTS\.md instructions|<user_instructions>)/, "agents"],
  [/^## Memory\b/, "memory"],
  [/^<tools>/, "mcp"],
  [/^<(apps_instructions|plugins_instructions|recommended_plugins|codex_apps_open_page_instructions)>/, "apps"],
  [/^<environment_context>/, "system"],
];

/**
 * The part one content part belongs to. The developer's other text is harness text (system),
 * except hook context; the user side is the conversation (null), except the environment.
 */
function partOf(role, text, kind) {
  if (kind && kind !== "unknown") {
    const family = kind.split(".")[0];
    if (FAMILIES[family]) return FAMILIES[family];
    if (kind === "additional_content.codex_apps_open_page_instructions") return "apps";
    return (role === "developer" && family !== "hooks") || family === "environments" ? "system" : null;
  }
  const head = text.trimStart();
  for (const [marker, part] of MARKERS) if (marker.test(head)) return part;
  return role === "developer" && head.startsWith("<") ? "system" : null;
}

const kindsOf = (item) => item.internal_chat_message_metadata_passthrough?.content_item_kinds ?? [];
const contentTokens = (part) => tokens(part.type?.includes("image") ? IMAGE_BYTES : size(part.text));

function outputBytes(output) {
  if (!Array.isArray(output)) return size(typeof output === "string" ? output : JSON.stringify(output ?? ""));
  return output.reduce((n, part) => n + (part.type?.includes("image") ? IMAGE_BYTES : size(part.text)), 0);
}

/** Model-visible tokens of one history item (history.rs estimate_response_item_model_visible_bytes). */
function itemTokens(item) {
  switch (item.type) {
    case "message":
      return (item.content ?? []).reduce((n, part) => n + contentTokens(part), 0);
    case "reasoning":
      return tokens(item.encrypted_content ? Math.max(0, Math.floor((item.encrypted_content.length * 3) / 4) - 650) : 0);
    case "compaction":
    case "context_compaction":
      return tokens(item.encrypted_content ? Math.ceil(item.encrypted_content.length / 3) : 0);
    case "function_call":
    case "custom_tool_call":
      return tokens(size(item.name) + size(item.namespace ?? "functions") + size(item.arguments ?? item.input));
    case "function_call_output":
    case "custom_tool_call_output":
      return tokens(outputBytes(item.output) + size(item.call_id) + size(item.name));
    case "additional_tools":
    case "tool_search_output":
      return tokens(size(JSON.stringify(item.tools ?? [])));
    default:
      return tokens(size(JSON.stringify(item)));
  }
}

/** Whether this history carries its own instructions and tools (history.rs has_recorded_instructions). */
const recorded = (items) => items.some((item) => item.type === "additional_tools" || (item.type === "message" && kindsOf(item).includes(BASE_KIND)));

/** Anything but the input the client sent: the first one marks the end of the first request. */
const isOutput = (item) => (item.type === "message" ? item.role === "assistant" : item.type !== "additional_tools");

/**
 * The parts of the thread's current context window, in tokens, or null before its first request
 * has finished. Cached until the file changes.
 */
export async function readContextUsage(file) {
  const { size: bytes, mtimeMs } = statSync(file);
  const hit = cache.get(file);
  if (hit?.bytes === bytes && hit.mtimeMs === mtimeMs) return hit.value;

  let base = 0;
  let items = [];
  let opening = null;
  let firstInput = null;
  let last = null;
  const total = (list) => list.reduce((n, item) => n + itemTokens(item), recorded(list) ? 0 : base);
  // ponytail: rereads the whole rollout on every change (~1 s at 90 MB); resume from the last
  // offset if long sessions make the card slow.
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // blank, or still being written
    }
    const { type, payload } = entry;
    if (type === "session_meta") base ||= tokens(size(payload?.base_instructions?.text));
    else if (type === "response_item") {
      if (opening === null && isOutput(payload)) opening = total(items);
      items.push(payload);
    } else if (type === "compacted") {
      items = payload.replacement_history ?? [{ type: "message", role: "assistant", content: [{ type: "output_text", text: payload.message ?? "" }] }];
    } else if (type === "event_msg" && payload?.type === "token_count" && payload.info) {
      last = payload.info;
      // A compaction resets the count to zero until the next request.
      if (firstInput === null && last.last_token_usage.input_tokens > 0) {
        firstInput = last.last_token_usage.input_tokens;
        opening ??= total(items);
      }
    }
  }

  let value = null;
  if (last) {
    const own = recorded(items);
    const parts = { system: own ? 0 : base, tools: own || firstInput === null ? 0 : Math.max(0, firstInput - opening), skills: 0, agents: 0, memory: 0, mcp: 0, apps: 0 };
    let mcpDeferred = false;
    for (const item of items) {
      if (item.type === "additional_tools") {
        // A namespace of one MCP server's tools (mcp__<server>) or Codex's own.
        for (const tool of item.tools ?? []) parts[tool.name?.startsWith("mcp__") ? "mcp" : "tools"] += tokens(size(JSON.stringify(tool)));
      } else if (item.type === "tool_search_output") parts.mcp += itemTokens(item);
      else if (item.type === "message" && item.role !== "assistant") {
        const kinds = kindsOf(item);
        (item.content ?? []).forEach((content, index) => {
          const part = typeof content.text === "string" ? partOf(item.role, content.text, kinds[index]) : null;
          if (!part) return;
          parts[part] += contentTokens(content);
          // Codex lists MCP namespaces here when the model loads their tools by search.
          if (part === "mcp") mcpDeferred = true;
        });
      }
    }
    value = { usedTokens: last.last_token_usage.total_tokens, windowTokens: last.model_context_window ?? null, mcpDeferred, ...parts };
  }
  cache.delete(file);
  cache.set(file, { bytes, mtimeMs, value });
  if (cache.size > KEPT) cache.delete(cache.keys().next().value);
  return value;
}
