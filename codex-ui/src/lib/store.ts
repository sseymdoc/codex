// Global UI state. Updates are immutable so React can compare by reference;
// subscribers are notified once per animation frame, which keeps token streams cheap.

import { useSyncExternalStore } from "react";
import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
import type { Config } from "@protocol/v2/Config";
import type { ConfigRequirements } from "@protocol/v2/ConfigRequirements";
import type { ExperimentalFeature } from "@protocol/v2/ExperimentalFeature";
import type { ExternalAgentConfigImportTypeResult } from "@protocol/v2/ExternalAgentConfigImportTypeResult";
import type { GetAccountRateLimitsResponse } from "@protocol/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@protocol/v2/GetAccountResponse";
import type { GuardianApprovalReview } from "@protocol/v2/GuardianApprovalReview";
import type { GuardianApprovalReviewAction } from "@protocol/v2/GuardianApprovalReviewAction";
import type { HookErrorInfo } from "@protocol/v2/HookErrorInfo";
import type { HookMetadata } from "@protocol/v2/HookMetadata";
import type { HookRunSummary } from "@protocol/v2/HookRunSummary";
import type { McpServerStartupFailureReason } from "@protocol/v2/McpServerStartupFailureReason";
import type { McpServerStartupState } from "@protocol/v2/McpServerStartupState";
import type { McpServerStatus } from "@protocol/v2/McpServerStatus";
import type { Model } from "@protocol/v2/Model";
import type { PermissionProfileSummary } from "@protocol/v2/PermissionProfileSummary";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import type { Project } from "@protocol/v2/Project";
import type { RemoteControlStatusChangedNotification } from "@protocol/v2/RemoteControlStatusChangedNotification";
import type { SandboxPolicy } from "@protocol/v2/SandboxPolicy";
import type { Thread } from "@protocol/v2/Thread";
import type { ThreadAttachment } from "@protocol/v2/ThreadAttachment";
import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { ThreadReadState } from "@protocol/v2/ThreadReadState";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import type { QueuedSubmission } from "@protocol/v2/QueuedSubmission";
import type { ThreadTokenUsage } from "@protocol/v2/ThreadTokenUsage";
import type { Turn } from "@protocol/v2/Turn";
import type { TurnError } from "@protocol/v2/TurnError";
import type { TurnPlanStep } from "@protocol/v2/TurnPlanStep";
import type { SessionSort, TranscriptView } from "./session";

export type PermissionPreset = "read-only" | "auto" | "full-access";
/** Who reviews approval requests: the user, or the auto-review (Guardian) subagent. */
export type Reviewer = "user" | "auto_review";
/** "priority" is Codex fast mode; "default" explicitly asks for standard speed. */
export type ServiceTierPick = "priority" | "default";

/** Agent-started background process (thread/backgroundTerminals/list; experimental, not in the stable schema). */
export interface BackgroundTerminal {
  itemId: string;
  processId: string;
  command: string;
  cwd: string;
  osPid: number | null;
  cpuPercent: number | null;
  rssKb: number | null;
}

export interface McpRuntime {
  status: McpServerStartupState;
  error: string | null;
  failureReason: McpServerStartupFailureReason | null;
}

/** A ready-to-render line the transcript shows after `turnId` (or at the end when null). */
export interface Notice {
  id: number;
  turnId: string | null;
  kind: "warning" | "reroute" | "verification" | "strictReview" | "authRecovery" | "authRecovered" | "guardian" | "mcpFailed" | "mcpReauth";
  text: string;
  detail?: string;
  /** Already passed through externalUrl(). */
  url?: string;
  /** mcpReauth: the server whose 重新登录 button calls loginMcpServer(server). */
  server?: string;
}

/** One auto-review (Guardian) lifecycle keyed by reviewId. */
export interface AutoReview {
  id: string;
  targetItemId: string | null;
  startedAtMs: number;
  completedAtMs: number | null;
  /** status inProgress | approved | denied | timedOut | aborted, plus riskLevel, userAuthorization, rationale. */
  review: GuardianApprovalReview;
  action: GuardianApprovalReviewAction;
  /** Chinese one-line summary of the reviewed action. */
  summary: string;
  /** Denied, and the action can be rebuilt as a core event for 仍然允许. */
  overridable: boolean;
  /** 仍然允许 was accepted by the server. */
  overridden?: boolean;
}

export interface Connector {
  id: string;
  name: string;
  description: string | null;
  iconUrl: string | null;
  iconUrlDark: string | null;
  installUrl: string | null;
  enabled: boolean;
  callable: boolean;
}

export interface InstalledPlugin extends PluginSummary {
  marketplaceName: string;
}

export type VoiceState = { status: "idle" } | { status: "connecting" | "active"; threadId: string; error?: string };

export interface TurnState extends Turn {
  plan?: { explanation: string | null; steps: TurnPlanStep[] };
  diff?: string;
  /** The error the server is retrying after (willRetry), with codexErrorInfo and additionalDetails. */
  retrying?: TurnError | null;
  /** turn/interrupt was sent and the turn has not completed yet. */
  stopping?: boolean;
  /** Hook runs for this turn, by run id, in display order. */
  hooks?: HookRunSummary[];
  /** Auto-review (Guardian) lifecycles for this turn. */
  reviews?: AutoReview[];
  /** Safety buffering is slowing this turn down; cleared once the reply starts streaming. */
  buffering?: { fasterModel: string | null } | null;
  /** The server refused to steer this turn (review or compaction). */
  steerable?: false;
}

/** Effective per-thread settings as last reported by the server, plus local picks for the next turn. */
export interface ThreadSettings {
  model: string | null;
  effort: string | null;
  approvalPolicy: AskForApproval | null;
  sandbox: SandboxPolicy | null;
  cwd: string;
  /** "priority" = fast mode; null or "default" = standard. */
  serviceTier: string | null;
  approvalsReviewer: Reviewer | null;
  /** Active named permissions profile id (":workspace", or a custom [permissions.<id>]). */
  permissionProfile: string | null;
}

/** Picks made in the composer that ride along with the next turn/start. */
export interface ThreadOverrides {
  model?: string;
  effort?: string;
  permission?: PermissionPreset;
  /** A custom permissions profile id; null clears it (a built-in preset was picked). */
  permissionProfile?: string | null;
  serviceTier?: ServiceTierPick;
  reviewer?: Reviewer;
}

export interface ThreadState {
  meta: Thread;
  turns: TurnState[];
  olderCursor: string | null;
  loading: boolean;
  loaded: boolean;
  subscribed: boolean;
  settings: ThreadSettings | null;
  overrides: ThreadOverrides;
  planMode: boolean;
  tokenUsage: ThreadTokenUsage | null;
  /** item id -> [startedAtMs, completedAtMs] */
  timing: Record<string, [number, number?]>;
  goal: ThreadGoal | null;
  /** A turn finished while another thread was on screen (used when the server has no read state). */
  unread: boolean;
  /** Messages sent while a turn ran, waiting for the thread to go idle (thread/queue/*). */
  queue: QueuedSubmission[];
  /** This thread's transcript view; null follows the default. */
  view: TranscriptView | null;
  /** Durable read receipt (0.163+); null when the server has none for this thread. */
  readState: ThreadReadState | null;
  /** Hook runs that belong to no turn (for example sessionStart). */
  hooks: HookRunSummary[];
  notices: Notice[];
  /** This thread's MCP server startup statuses, by server name. */
  mcp: Record<string, McpRuntime>;
  /** Agent-started background terminals (only known while the thread is subscribed). */
  background: BackgroundTerminal[];
  attachments: ThreadAttachment[] | null;
  /** Last memory mode set from this UI; the server has no read API. */
  memory: "enabled" | "disabled" | null;
  /** A queued message just sent with Send now: its clientUserMessageId. */
  landed: { id: string; at: number } | null;
  /** itemId -> latest item/mcpToolCall/progress message. */
  progress: Record<string, string>;
  /** itemId -> stdin the agent wrote to that running command (terminalInteraction). */
  stdin: Record<string, string[]>;
  /** A turn/start is in flight (the working line says 正在发送… until turn/started). */
  sending: boolean;
}

export interface LoginState {
  loginId: string;
  kind: "chatgpt" | "chatgptDeviceCode";
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
  error?: string;
}

export interface Toast {
  id: number;
  kind: "info" | "warning" | "error" | "success";
  title: string;
  detail?: string;
}

export type SettingsTab = "general" | "account" | "mcp" | "connectors" | "plugins" | "skills" | "hooks" | "memory" | "labs" | "about";

export type DialogState =
  | { type: "review"; threadId: string | null }
  | { type: "rename"; threadId: string }
  | { type: "delete"; threadId: string }
  | { type: "folder" }
  | { type: "section"; sectionId: string | null; threadId?: string }
  | { type: "feedback"; threadId: string; turnId: string | null; good: boolean | null }
  /** Confirm rewinding to before `turnId`; `text` goes back into the composer afterwards. */
  | { type: "rewind"; threadId: string; turnId: string; text: string }
  | null;

export interface NewChatPrefs {
  cwd: string;
  model: string | null;
  effort: string | null;
  permission: PermissionPreset | null;
  planMode: boolean;
  /** Codex project the new thread joins (project/list). */
  projectId: string | null;
  /** false: the new thread opts out of memory generation. */
  memory: boolean;
  serviceTier: ServiceTierPick | null;
  reviewer: Reviewer | null;
  /** A custom permissions profile for the new thread (instead of `permission`). */
  permissionProfile: string | null;
}

export interface ImportState {
  id: string;
  results: ExternalAgentConfigImportTypeResult[];
  done: boolean;
}

export interface AppState {
  /**
   * kind: why the last connection ended (network: bridge unreachable or stream ended; exited:
   * app-server quit; fatal: the bridge could not start codex; unauthorized: missing token).
   * exits counts consecutive app-server exits and resets once ready. retryAt is when the next
   * automatic reconnect fires (ms since epoch), null once retries stopped.
   */
  conn: {
    status: "connecting" | "ready" | "closed";
    error?: string;
    detail?: string;
    kind?: "network" | "exited" | "fatal" | "unauthorized";
    exits?: number;
    retryAt?: number | null;
  };
  /** version: the codex binary's version, from initialize's userAgent. */
  server: { cwd: string; command: string; info: InitializeResponse | null; version: string | null };
  account: GetAccountResponse | null;
  rateLimits: GetAccountRateLimitsResponse | null;
  login: LoginState | null;
  models: Model[];
  /** Hidden catalog models for 更多模型 (without the auto-review model). */
  hiddenModels: Model[];
  modes: CollaborationModeMask[];
  features: ExperimentalFeature[];
  config: Config | null;
  /** Managed requirements (configRequirements/read); null means unrestricted. */
  requirements: ConfigRequirements | null;
  /** Custom permissions profiles (built-in :read-only / :workspace / :danger-full-access left out); empty hides them. */
  permissionProfiles: PermissionProfileSummary[];
  threads: Record<string, ThreadState>;
  sections: ThreadSection[];
  projects: Project[];
  /** error: the last list load failed (cleared by the next success). */
  list: { ids: string[]; cursor: string | null; loading: boolean; archived: boolean; sort: SessionSort; error?: string };
  activeId: string | null;
  requests: ServerRequest[];
  toasts: Toast[];
  prefs: NewChatPrefs;
  /** Bumped by every newChat(), also when the new-chat page is already open. */
  draftEpoch: number;
  /** Installed plugins (plugin/installed); null until loaded. */
  plugins: InstalledPlugin[] | null;
  /** Installed connectors (app/installed + app/read); null until loaded. */
  connectors: Connector[] | null;
  hooks: { list: HookMetadata[]; warnings: string[]; errors: HookErrorInfo[] } | null;
  /** MCP inventory (mcpServerStatus/list); runtimeStatus is patched from startup notifications. */
  mcp: McpServerStatus[] | null;
  /** Bumped on skills/changed so skill lists refetch. */
  skillsRev: number;
  remoteControl: RemoteControlStatusChangedNotification | null;
  voice: VoiceState;
  imports: ImportState | null;
  /** Right-hand pane: the turn diff or the session details rail. */
  panel: "diff" | "details" | null;
  defaultView: TranscriptView;
  settings: SettingsTab | null;
  dialog: DialogState;
  palette: boolean;
  /** Image shown full-window, as a URL. */
  lightbox: string | null;
  sidebarOpen: boolean;
}

/** A saved choice from localStorage, if it is one of `allowed`. */
export function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value !== null && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice just will not persist.
  }
}

const initialState: AppState = {
  conn: { status: "connecting" },
  server: { cwd: "", command: "", info: null, version: null },
  account: null,
  rateLimits: null,
  login: null,
  models: [],
  hiddenModels: [],
  modes: [],
  features: [],
  config: null,
  requirements: null,
  permissionProfiles: [],
  threads: {},
  sections: [],
  projects: [],
  list: { ids: [], cursor: null, loading: false, archived: false, sort: readPref("codex-ui:sort", ["recency", "alpha", "created"], "recency") },
  activeId: null,
  requests: [],
  toasts: [],
  prefs: { cwd: "", model: null, effort: null, permission: null, planMode: false, projectId: null, memory: true, serviceTier: null, reviewer: null, permissionProfile: null },
  draftEpoch: 0,
  plugins: null,
  connectors: null,
  hooks: null,
  mcp: null,
  skillsRev: 0,
  remoteControl: null,
  voice: { status: "idle" },
  imports: null,
  panel: null,
  defaultView: readPref("codex-ui:view", ["normal", "thinking", "verbose"], "normal"),
  settings: null,
  dialog: null,
  palette: false,
  lightbox: null,
  sidebarOpen: readPref("codex-ui:sidebar", ["open", "collapsed"], "open") === "open",
};

let state = initialState;
const listeners = new Set<() => void>();
let frame = 0;

export function getState(): AppState {
  return state;
}

export function setState(update: Partial<AppState> | ((current: AppState) => Partial<AppState>)): void {
  const patch = typeof update === "function" ? update(state) : update;
  state = { ...state, ...patch };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    for (const listener of listeners) listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select a slice of state; the selector must return stable references for unchanged data. */
export function useStore<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function updateThread(id: string, update: (thread: ThreadState) => ThreadState): void {
  setState((current) => {
    const thread = current.threads[id];
    return thread ? { threads: { ...current.threads, [id]: update(thread) } } : {};
  });
}

export function emptyThreadState(meta: Thread): ThreadState {
  return {
    meta: { ...meta, turns: [] },
    turns: [],
    olderCursor: null,
    loading: false,
    loaded: false,
    subscribed: false,
    settings: null,
    overrides: {},
    planMode: false,
    tokenUsage: null,
    timing: {},
    goal: null,
    unread: false,
    queue: [],
    view: null,
    readState: null,
    hooks: [],
    notices: [],
    mcp: {},
    background: [],
    attachments: null,
    memory: null,
    landed: null,
    progress: {},
    stdin: {},
    sending: false,
  };
}

/** Apply `update` to one turn, creating a placeholder if the turn has not been seen yet. */
export function updateTurn(thread: ThreadState, turnId: string, update: (turn: TurnState) => TurnState): ThreadState {
  const index = thread.turns.findIndex((turn) => turn.id === turnId);
  const turns = thread.turns.slice();
  if (index === -1) {
    turns.push(
      update({
        id: turnId,
        rootTurnId: null,
        items: [],
        itemsView: "full",
        status: "inProgress",
        error: null,
        startedAt: Math.floor(Date.now() / 1000),
        completedAt: null,
        durationMs: null,
      }),
    );
  } else {
    turns[index] = update(turns[index]);
  }
  return { ...thread, turns };
}

/** Insert or replace an item within a turn, keeping first-seen order. */
export function upsertItem(turn: TurnState, item: ThreadItem): TurnState {
  const index = turn.items.findIndex((existing) => existing.id === item.id);
  const items = turn.items.slice();
  if (index === -1) items.push(item);
  else items[index] = item;
  return { ...turn, items };
}

export function updateItem(turn: TurnState, itemId: string, update: (item: ThreadItem) => ThreadItem): TurnState {
  const index = turn.items.findIndex((item) => item.id === itemId);
  if (index === -1) return turn;
  const items = turn.items.slice();
  items[index] = update(items[index]);
  return { ...turn, items };
}

let toastId = 0;
export function toast(kind: Toast["kind"], title: string, detail?: string): void {
  const id = ++toastId;
  setState((current) => ({ toasts: [...current.toasts.slice(-3), { id, kind, title, detail }] }));
  setTimeout(() => setState((current) => ({ toasts: current.toasts.filter((t) => t.id !== id) })), kind === "error" ? 9000 : 5000);
}

// ---------------------------------------------------------------------------
// Selectors

/** Unread by the server's durable receipt when it has one, else by the local flag. */
export function isUnread(thread: ThreadState): boolean {
  return thread.readState ? thread.readState.firstUnread !== null : thread.unread;
}

/** Enabled hooks that will not run until trusted (untrusted, or changed since trusted). */
export function hooksNeedingReview(s: AppState): HookMetadata[] {
  return s.hooks?.list.filter((hook) => hook.enabled && (hook.trustStatus === "untrusted" || hook.trustStatus === "modified")) ?? [];
}

/** MCP servers that finished starting for this thread. */
export function mcpReady(thread: ThreadState): number {
  return Object.values(thread.mcp).filter((m) => m.status === "ready").length;
}

/** Pull-request links attached to the thread (thread/attachment/*), https only. */
export function pullRequests(thread: ThreadState): string[] {
  const urls: string[] = [];
  for (const attachment of thread.attachments ?? []) {
    if (attachment.attachmentType !== "pull_request") continue;
    const url = (attachment.payload as { url?: unknown } | null)?.url;
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) urls.push(parsed.href);
    } catch {
      // Not a URL: skip it.
    }
  }
  return urls;
}
