// What fills a thread's context window, for the rail's 上下文 card. Claude's breakdown comes from
// Claude Code (get_context_usage); Codex's app-server reports only totals, but a thread's rollout
// records what the model is shown: each context fragment as one content part (typed by
// content_item_kinds, or opened by its marker in older rollouts), the conversation, compactions
// with the history that replaces them, and the exact token count of every request. Parts are
// estimated the way Codex estimates history (core/src/context_manager/history.rs: 4 bytes a
// token). A window that records its instructions and tool declarations (incremental windows,
// after a compaction) carries them as items; before that they ride along with each request, the
// base instructions in session_meta and the tools nowhere, so the tools are what the first
// request's exact input leaves once its text is counted. The card takes Messages as the read's
// total (usedTokens) less these parts.

import { createReadStream, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** A rollout's file name; nothing else is read here. */
export const ROLLOUT_FILE = /^rollout-.+\.jsonl$/;

/** history.rs RESIZED_IMAGE_BYTES_ESTIMATE. */
const IMAGE_BYTES = 7373;
/** history.rs approx_bytes_for_tokens(ORIGINAL_IMAGE_MAX_PATCHES). */
const ORIGINAL_IMAGE_BYTES = 10_000 * 4;
const BASE_KIND = "model.base_instructions";
const KEPT = 32;
const SCANNED = 4;
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

/** core agents_md.rs AGENTS_MD_SEPARATOR: where the project's instructions start. */
const PROJECT_DOC = "\n\n--- project-doc ---\n\n";

/**
 * The AGENTS.md files behind one instructions fragment (core agents_md.rs legacy_text), for the
 * card's 记忆文件 list: the user's own (CODEX_HOME/AGENTS.md) before the project-doc marker, the
 * project's after it, each sized by its share of the bytes. Codex joins the project's files with a
 * blank line and names only the working folder, so that part points at the folder's AGENTS.md.
 * Without the marker the fragment is the project's when that file is there, else the user's. A
 * file that is not there has no path.
 */
export function agentsFiles(text, total, home = process.env.CODEX_HOME || path.join(homedir(), ".codex"), exists = existsSync) {
  const dir = /^# AGENTS\.md instructions for (.+)$/m.exec(text)?.[1]?.trim();
  const found = (file) => (file && exists(file) ? file : null);
  const own = found(path.join(home, "AGENTS.md"));
  const project = found(dir ? path.join(dir, "AGENTS.md") : null);
  const at = text.indexOf(PROJECT_DOC);
  if (at < 0) return [{ path: project ?? own, tokens: total }];
  const user = Math.min(total, tokens(size(text.slice(0, at))));
  return [
    { path: own, tokens: user },
    { path: project, tokens: total - user },
  ].filter((file) => file.tokens > 0);
}

const kindsOf = (item) => item.internal_chat_message_metadata_passthrough?.content_item_kinds ?? [];
const json = (value) => size(JSON.stringify(value ?? null));

/**
 * One content part (history.rs): text, an image (estimate_image_reference_bytes: an original-detail
 * file image is ORIGINAL_IMAGE_MAX_PATCHES' worth) or encrypted content (9/16 of its length).
 * ponytail: an inline original-detail image counts as resized and audio as nothing, where
 * history.rs reads the image's dimensions and the audio's length; read them if such inputs show up.
 */
function partBytes(part) {
  if (part.type?.includes("image")) return part.file_id && part.detail === "original" ? ORIGINAL_IMAGE_BYTES : IMAGE_BYTES;
  if (part.type === "encrypted_content") return Math.ceil(((part.encrypted_content ?? "").length * 9) / 16);
  return size(part.text);
}
const contentTokens = (part) => tokens(partBytes(part));

function outputBytes(output) {
  if (!Array.isArray(output)) return size(typeof output === "string" ? output : JSON.stringify(output ?? ""));
  return output.reduce((n, part) => n + partBytes(part), 0);
}

/** Model-visible tokens of one history item (history.rs estimate_response_item_model_visible_bytes). */
function itemTokens(item) {
  switch (item.type) {
    case "message":
      return (item.content ?? []).reduce((n, part) => n + contentTokens(part), 0);
    case "agent_message":
      return tokens((item.content ?? []).reduce((n, part) => n + partBytes(part), size(item.author) + size(item.recipient)));
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
      return tokens(outputBytes(item.output) + size(item.call_id) + size(item.name) + size(item.namespace));
    // JSON arguments rather than envelopes around text: their syntax counts.
    case "additional_tools":
    case "tool_search_output":
      return tokens(json(item.tools ?? []));
    case "tool_search_call":
      return tokens(json(item.arguments));
    case "local_shell_call":
      return tokens(json(item.action));
    case "web_search_call":
      return tokens(item.action ? json(item.action) : 0);
    case "image_generation_call":
      return tokens(size(item.revised_prompt) + (item.result ? IMAGE_BYTES : 0));
    // configuration_update, compaction_trigger, and what Codex reads as Other.
    default:
      return 0;
  }
}

/** Whether this history carries its own instructions and tools (history.rs has_recorded_instructions). */
const recorded = (items) => items.some((item) => item.type === "additional_tools" || (item.type === "message" && kindsOf(item).includes(BASE_KIND)));

const MODEL_ITEMS = new Set(["reasoning", "function_call", "tool_search_call", "web_search_call", "image_generation_call", "custom_tool_call", "local_shell_call", "compaction", "context_compaction"]);
/** What the model wrote (history.rs is_model_generated_item): the first one ends the first request. */
const isOutput = (item) => (item.type === "message" ? item.role === "assistant" : MODEL_ITEMS.has(item.type));

/**
 * The parts of the thread's current context window, in tokens, or null before its first request
 * has finished. Cached until the file changes.
 */
export async function readContextUsage(file) {
  const { size: bytes, mtimeMs, ino } = statSync(file);
  const hit = cache.get(file);
  if (hit?.bytes === bytes && hit.mtimeMs === mtimeMs) return hit.value;

  // A rollout only grows: a change reads on from the last whole line, unless the file shrank or was replaced.
  const from = hit?.scan && hit.ino === ino && bytes >= hit.scan.offset ? hit.scan : null;
  let offset = from?.offset ?? 0;
  let base = from?.base ?? 0;
  let items = from ? [...from.items] : [];
  let opening = from?.opening ?? null;
  let firstInput = from?.firstInput ?? null;
  let last = from?.last ?? null;
  const total = (list) => list.reduce((n, item) => n + itemTokens(item), recorded(list) ? 0 : base);
  const read = (line) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return false; // blank, damaged or still being written
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
    return true;
  };
  // A last line without its newline counts once it reads whole; one still being written waits for the next change.
  let rest = Buffer.alloc(0);
  for await (const chunk of createReadStream(file, { start: offset })) {
    const buffer = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    let start = 0;
    for (let end; (end = buffer.indexOf(10, start)) !== -1; start = end + 1) read(buffer.toString("utf8", start, end));
    offset += start;
    rest = buffer.subarray(start);
  }
  if (rest.length && read(rest.toString("utf8"))) offset += rest.length;

  let value = null;
  if (last) {
    const own = recorded(items);
    const parts = { system: own ? 0 : base, tools: own || firstInput === null ? 0 : Math.max(0, firstInput - opening), skills: 0, agents: 0, memory: 0, mcp: 0, apps: 0 };
    let mcpDeferred = false;
    const memoryFiles = new Map();
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
          if (part === "agents")
            for (const file of agentsFiles(content.text, contentTokens(content))) memoryFiles.set(file.path, (memoryFiles.get(file.path) ?? 0) + file.tokens);
          // Codex lists MCP namespaces here when the model loads their tools by search.
          if (part === "mcp") mcpDeferred = true;
        });
      }
    }
    value = {
      usedTokens: last.last_token_usage.total_tokens,
      windowTokens: last.model_context_window ?? null,
      mcpDeferred,
      ...parts,
      memoryFiles: [...memoryFiles].map(([file, count]) => ({ path: file, tokens: count })),
    };
  }
  cache.delete(file);
  cache.set(file, { bytes, mtimeMs, ino, value, scan: { offset, base, items, opening, firstInput, last } });
  if (cache.size > KEPT) cache.delete(cache.keys().next().value);
  // The items read so far (screenshots and all) stay only for the latest few rollouts; older ones reread in full.
  let rank = cache.size;
  for (const kept of cache.values()) if (--rank >= SCANNED) delete kept.scan;
  return value;
}
