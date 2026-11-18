// Pure helpers for the approval cards (components/Approvals.tsx): which Codex decisions fill Claude
// Desktop's button slots (c96d752d0 Rj), the MCP form checks and content of the chat-side
// ElicitationModal (c385ec32f G / ue), and the input of a terminal-stdin approval. No DOM and no
// store, so `pnpm test` runs them directly.

import type { CommandExecutionApprovalDecision } from "@protocol/v2/CommandExecutionApprovalDecision";
import type { CommandExecutionRequestApprovalParams } from "@protocol/v2/CommandExecutionRequestApprovalParams";
import type { McpElicitationPrimitiveSchema } from "@protocol/v2/McpElicitationPrimitiveSchema";
import type { McpElicitationSchema } from "@protocol/v2/McpElicitationSchema";

type Decision = CommandExecutionApprovalDecision;

/** availableDecisions and additionalPermissions are experimental, absent from the stable schema. */
export type CommandParams = CommandExecutionRequestApprovalParams & {
  availableDecisions?: Decision[] | null;
  additionalPermissions?: unknown;
};

/** The command an execpolicy prefix stands for, without a `bash -lc` wrapper. */
export function prefixLabel(command: string[]): string {
  const parts = command[0]?.match(/(^|[\\/])(ba|z)?sh(\.exe)?$/) && command[1] === "-lc" ? command.slice(2) : command;
  return parts.join(" ");
}

/** availableDecisions, or the server's own defaults for older servers (protocol/src/approvals.rs). */
export function commandDecisions(params: CommandParams): Decision[] {
  if (params.availableDecisions) return params.availableDecisions;
  if (params.networkApprovalContext) {
    const allow = params.proposedNetworkPolicyAmendments?.find((amendment) => amendment.action === "allow");
    return ["accept", "acceptForSession", ...(allow ? [{ applyNetworkPolicyAmendment: { network_policy_amendment: allow } }] : []), "cancel"];
  }
  if (params.additionalPermissions) return ["accept", "cancel"];
  const prefix = params.proposedExecpolicyAmendment;
  return ["accept", ...(prefix ? [{ acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } }] : []), "cancel"];
}

export interface CommandSlots {
  deny?: Decision;
  session?: Decision;
  always?: Decision;
  once?: Decision;
}

/**
 * Claude's buttons for a command: Deny is decline when offered (the turn goes on, like Claude's
 * deny) and cancel otherwise; Always allow is a one-line execpolicy prefix or the host's allow
 * rule. A host deny rule gets no button: Claude has no "always deny".
 */
export function commandSlots(decisions: Decision[]): CommandSlots {
  const slots: CommandSlots = {};
  for (const decision of decisions) {
    if (decision === "accept") slots.once = decision;
    else if (decision === "acceptForSession") slots.session = decision;
    else if (decision === "decline") slots.deny = decision;
    else if (decision === "cancel") slots.deny ??= decision;
    else if ("acceptWithExecpolicyAmendment" in decision) {
      if (!prefixLabel(decision.acceptWithExecpolicyAmendment.execpolicy_amendment).includes("\n")) slots.always ??= decision;
    } else if (decision.applyNetworkPolicyAmendment.network_policy_amendment.action === "allow") slots.always ??= decision;
  }
  return slots;
}

// ---------------------------------------------------------------------------
// MCP form elicitations

export type FieldValue = string | number | boolean | string[];

interface Checks {
  type: string;
  format?: string;
  pattern?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number | bigint;
  maxItems?: number | bigint;
  items?: { enum?: unknown; anyOf?: unknown };
}

const isEmpty = (value: FieldValue | undefined) => value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
const EMAIL = /^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+.-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

function formatError(format: string | undefined, value: string): string | null {
  switch (format) {
    case "email":
      return EMAIL.test(value) ? null : "请输入有效的邮箱地址。";
    case "uri":
      try {
        new URL(value);
      } catch {
        return "请输入有效的 URL。";
      }
      return /^https?:\/\//i.test(value) ? null : "URL 必须以 http:// 或 https:// 开头。";
    case "date": {
      const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
      if (!valid) return "请输入有效的日期（YYYY-MM-DD）。";
      return Number(value.slice(0, 4)) >= 1000 ? null : "请输入四位数年份。";
    }
    case "date-time":
      return Number.isNaN(Date.parse(value)) ? "请输入有效的日期和时间。" : null;
    default:
      return null;
  }
}

/** The first problem with a field's value, as the chat-side form reports it on submit (c385ec32f G / le). */
export function fieldError(schema: McpElicitationPrimitiveSchema, value: FieldValue | undefined, required: boolean): string | null {
  const s = schema as Checks;
  if (required) {
    if (s.type === "boolean") {
      if (value !== true) return "必须勾选此字段。";
    } else if (s.type === "array") {
      if (!Array.isArray(value) || value.length === 0) return "请至少选择一个选项。";
    } else if (isEmpty(value) || (typeof value === "string" && !value.trim())) return "此字段为必填项。";
  }
  if (isEmpty(value)) return null;
  if (s.type === "array" && Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < Number(s.minItems)) return `请至少选择 ${s.minItems} 项。`;
    if (s.maxItems !== undefined && value.length > Number(s.maxItems)) return `最多选择 ${s.maxItems} 项。`;
  } else if (s.type === "string" && typeof value === "string") {
    if (s.minLength !== undefined && value.length < s.minLength) return `长度不得少于 ${s.minLength} 个字符。`;
    if (s.maxLength !== undefined && value.length > s.maxLength) return `不得超过 ${s.maxLength} 个字符。`;
    if (typeof s.pattern === "string" && s.pattern.length <= 200) {
      try {
        if (!new RegExp(s.pattern).test(value)) return "格式无效。";
      } catch {
        // An invalid pattern checks nothing.
      }
    }
    return formatError(s.format, value);
  } else if (s.type === "number" || s.type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) return "必须是有效的数字。";
    if (s.type === "integer" && !Number.isInteger(value)) return "必须为整数。";
    if (s.minimum !== undefined && value < s.minimum) return `不得小于 ${s.minimum}。`;
    if (s.maximum !== undefined && value > s.maximum) return `不得超过 ${s.maximum}。`;
  }
  return null;
}

/** A field this form can draw: a string, number, integer, boolean or an enum-array (c385ec32f H). */
export function fieldShown(schema: McpElicitationPrimitiveSchema): boolean {
  const s = schema as Checks;
  if (s.type === "array") return typeof s.items === "object" && s.items !== null && ("enum" in s.items || "anyOf" in s.items);
  return s.type === "boolean" || s.type === "number" || s.type === "integer" || s.type === "string";
}

/** The form can be answered: every required field can be drawn (c385ec32f U). */
export function formShown(schema: McpElicitationSchema): boolean {
  return Object.entries(schema.properties).every(([key, field]) => (field && fieldShown(field)) || !(schema.required?.includes(key) ?? false));
}

/** The accepted form's content: the filled fields, a date-time as an ISO instant (c385ec32f ue). */
export function formContent(schema: McpElicitationSchema, values: Record<string, FieldValue | undefined>): Record<string, FieldValue> {
  const content: Record<string, FieldValue> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    let value = values[key];
    if (!field || value === undefined || isEmpty(value)) continue;
    if ((field as Checks).format === "date-time" && typeof value === "string" && !Number.isNaN(new Date(value).getTime())) value = new Date(value).toISOString();
    content[key] = value;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Terminal stdin

/** POSIX words as shlex quotes them: '…' literal, "…" with \\ \" \$ \` escapes, \x outside quotes. */
function shellWords(text: string): string[] | null {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) return null;
      word = (word ?? "") + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      word ??= "";
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === "\\" && i + 1 < text.length && '\\"$`'.includes(text[i + 1])) i++;
        word += text[i];
      }
      if (i >= text.length) return null;
    } else if (c === "\\") {
      word = (word ?? "") + (text[++i] ?? "");
    } else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? "") + c;
  }
  if (word !== null) words.push(word);
  return words;
}

/** What a stdin approval writes: the last word of `write_stdin --session-id <id> <input>` (core/src/tools/approvals.rs). */
export function stdinInput(command: string): string | null {
  const words = shellWords(command);
  return words && words[0] === "write_stdin" && words.length >= 4 ? words[words.length - 1] : null;
}
