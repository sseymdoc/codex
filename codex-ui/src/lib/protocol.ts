// Pure protocol helpers for the controller: error classification, version parsing, the core
// event the auto-review override needs, and the copy for notices. No DOM and no store, so
// `pnpm test` runs them directly.

import type { GuardianApprovalReview } from "@protocol/v2/GuardianApprovalReview";
import type { GuardianApprovalReviewAction } from "@protocol/v2/GuardianApprovalReviewAction";
import type { McpServerConnectionStatus } from "@protocol/v2/McpServerConnectionStatus";
import type { McpServerStartupFailureReason } from "@protocol/v2/McpServerStartupFailureReason";
import type { McpServerStartupState } from "@protocol/v2/McpServerStartupState";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { ThreadReadState } from "@protocol/v2/ThreadReadState";
import type { WindowsWorldWritableWarningNotification } from "@protocol/v2/WindowsWorldWritableWarningNotification";

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  data?: unknown;
}

const errorParts = (error: unknown): ErrorLike => (typeof error === "object" && error !== null ? (error as ErrorLike) : {});
const messageOf = (error: unknown) => {
  const { message } = errorParts(error);
  return typeof message === "string" ? message : "";
};

/**
 * The server does not have this method: unknown methods come back as -32600 "unknown
 * variant", experimental ones without the opt-in as "requires experimentalApi", and
 * unimplemented ones as -32601.
 */
export function unsupported(error: unknown): boolean {
  return errorParts(error).code === -32601 || /unknown variant|requires experimentalApi/.test(messageOf(error));
}

/** turn/steer refused because the running turn is a review or a compaction. */
export function notSteerable(error: unknown): boolean {
  const data = errorParts(error).data as { codexErrorInfo?: unknown } | null | undefined;
  const info = data?.codexErrorInfo;
  return (typeof info === "object" && info !== null && "activeTurnNotSteerable" in info) || /cannot steer/.test(messageOf(error));
}

/** turn/steer arrived after the turn ended (or before one started). */
export function noActiveTurn(error: unknown): boolean {
  return /no active turn to steer|expected active turn id/.test(messageOf(error));
}

/** thread/readState/update lost a race: the receipt the server holds now. */
export function readStateConflict(error: unknown): ThreadReadState | null {
  const data = errorParts(error).data as { reason?: unknown; readState?: ThreadReadState } | null | undefined;
  return data?.reason === "readStateConflict" && data.readState ? data.readState : null;
}

/** "codex_ui/0.163.0-alpha.10.2 (Windows …)" -> "0.163.0-alpha.10.2". */
export function parseVersion(userAgent: string | null | undefined): string | null {
  const version = userAgent?.split(" ")[0]?.split("/")[1];
  return version || null;
}

// ---------------------------------------------------------------------------
// Auto-review (Guardian)

/** One line naming the reviewed action, as the TUI words it (tui/src/chatwidget/tool_requests.rs). */
export function reviewSummary(action: GuardianApprovalReviewAction): string {
  switch (action.type) {
    case "command":
      return action.command;
    case "execve":
      return (action.argv.length ? action.argv : [action.program]).join(" ");
    case "writeStdin":
      return "向运行中的终端写入";
    case "applyPatch":
      return action.files.length === 1 ? `修改 ${action.files[0]}` : `修改 ${action.files.length} 个文件`;
    case "networkAccess":
      return `访问 ${action.target}`;
    case "mcpToolCall":
      return `MCP ${action.toolTitle ?? action.toolName}（${action.connectorName ?? action.server}）`;
    case "requestPermissions":
      return action.reason?.trim() ? `申请权限：${action.reason.trim()}` : "申请权限";
  }
}

/** Denials the override can rebuild; stdin writes and permission requests carry core-only shapes. */
export function overridable(action: GuardianApprovalReviewAction): boolean {
  return action.type !== "writeStdin" && action.type !== "requestPermissions";
}

const snake = (value: string) => value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * The core GuardianAssessmentEvent (snake_case JSON) that thread/approveGuardianDeniedAction
 * takes, rebuilt from the v2 review the same way the TUI does
 * (tui/src/chatwidget/protocol_requests.rs on_guardian_review_notification).
 */
export function guardianEvent(
  turnId: string,
  review: { id: string; targetItemId: string | null; startedAtMs: number; completedAtMs: number | null; review: GuardianApprovalReview; action: GuardianApprovalReviewAction },
): Record<string, unknown> {
  const action = Object.fromEntries(
    Object.entries(review.action).map(([key, value]) => [snake(key), key === "type" || key === "source" ? snake(String(value)) : value]),
  );
  const event: Record<string, unknown> = {
    id: review.id,
    turn_id: turnId,
    started_at_ms: review.startedAtMs,
    status: snake(review.review.status),
    decision_source: "agent",
    action,
  };
  if (review.completedAtMs !== null) event.completed_at_ms = review.completedAtMs;
  if (review.targetItemId !== null) event.target_item_id = review.targetItemId;
  if (review.review.riskLevel !== null) event.risk_level = review.review.riskLevel;
  if (review.review.userAuthorization !== null) event.user_authorization = review.review.userAuthorization;
  if (review.review.rationale !== null) event.rationale = review.review.rationale;
  return event;
}

// ---------------------------------------------------------------------------
// Notice copy (Chinese; the English originals are the TUI's)

/** "This request requires additional safety checks, some tool calls might take extra time" */
export const STRICT_REVIEW_TEXT = "此请求需要额外的安全检查，部分工具调用可能更慢";

/** tui/src/chatwidget.rs TRUSTED_ACCESS_FOR_CYBER_VERIFICATION_WARNING */
export const VERIFICATION_TEXT =
  "你的会话多次被标记为可能的网络安全风险，额外的安全检查会让回复变慢。如需从事安全工作，可加入 Trusted Access for Cyber 计划。";
export const VERIFICATION_URL = "https://chatgpt.com/cyber";

/** Guardian also reports approvals as warnings; the TUI hides those. */
export function guardianWarningShown(message: string): boolean {
  return !message.startsWith("Automatic approval review approved (");
}

export function rerouteText(fromModel: string, toModel: string, reason: string): { text: string; detail?: string } {
  return {
    text: `本轮已改用 ${toModel}（原为 ${fromModel}）`,
    detail: reason === "highRiskCyberActivity" ? "检测到高风险网络安全活动" : undefined,
  };
}

export function worldWritableText(p: WindowsWorldWritableWarningNotification): { title: string; detail?: string } {
  if (p.failedScan) return { title: "无法检查哪些目录对所有用户可写" };
  const paths = p.samplePaths.slice(0, 3).join("、");
  const more = p.extraCount > 0 ? `（另有 ${p.extraCount} 个）` : "";
  return { title: "以下目录对所有用户可写，Windows 沙箱保护不到", detail: `${paths}${more}` || undefined };
}

/** An MCP startup state as the connection status McpServerStatus.runtimeStatus uses. */
export function mcpRuntimeStatus(state: McpServerStartupState, failureReason: McpServerStartupFailureReason | null): McpServerConnectionStatus {
  if (state === "ready") return "connected";
  if (state === "failed") return failureReason === "reauthenticationRequired" ? "authenticationRequired" : "failed";
  return state;
}

// ---------------------------------------------------------------------------
// Small data helpers

/** Replace the element with the same key, or append it. */
export function upsertBy<T>(list: readonly T[], key: (item: T) => string, item: T): T[] {
  const id = key(item);
  const index = list.findIndex((existing) => key(existing) === id);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

/** Base64 to bytes (process and command output streams). */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** UTF-8 text to base64 (stdin writes). */
export function textToBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** fs/readFile's base64 payload as UTF-8 text. */
export function base64ToText(base64: string): string {
  return new TextDecoder("utf-8").decode(base64ToBytes(base64));
}

/**
 * The last final answer in a thread's turns (any order of turns, oldest item first within a
 * turn): a final_answer message wins, else the last message that is not commentary.
 */
export function finalAnswer(turns: readonly { startedAt?: number | null; items: readonly ThreadItem[] }[]): string | null {
  const ordered = turns.slice().sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  let fallback: string | null = null;
  for (let t = ordered.length - 1; t >= 0; t--) {
    const items = ordered[t].items;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type !== "agentMessage" || !item.text.trim()) continue;
      if (item.phase === "final_answer") return item.text;
      if (fallback === null && item.phase !== "commentary") fallback = item.text;
    }
    if (fallback !== null) return fallback;
  }
  return fallback;
}
