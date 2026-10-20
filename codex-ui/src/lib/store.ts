// Global UI state. Updates are immutable so React can compare by reference;
// subscribers are notified once per animation frame, which keeps token streams cheap.

import { useMemo, useSyncExternalStore } from "react";
import { agentTasks } from "./background.ts";
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
import type { ProviderQuotaReport } from "./format";
import { withLineage, type SessionSort, type TranscriptView } from "./session.ts";

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
  kind: "reroute" | "verification" | "strictReview" | "authRecovery" | "authRecovered" | "mcpReauth" | "environment";
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
  /** The latest turn/plan/updated, and how many items the turn had when it came. */
  plan?: { steps: TurnPlanStep[]; at: number };
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
  /** The last page of older turns failed to load (the transcript offers 重试). */
  olderError?: boolean;
  /** Opening the thread failed: the error, shown in place of the transcript. */
  loadError?: string | null;
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

/** CDS Toast variants (shared-19 MU / FU): there is no success variant. */
export interface Toast {
  id: number;
  kind: "neutral" | "warning" | "danger";
  title: string;
  detail?: string;
  /** Repeats merged into this toast, shown as " (×n)" after the title. */
  count: number;
  /** When it first showed (ms since epoch). */
  at: number;
  /** Dismissed: kept for the leaving animation. */
  ending?: boolean;
}

/** "account" is the 用量 page; "system" exists in the desktop shell only; "about" is not in the rail. */
export type SettingsTab = "general" | "account" | "capabilities" | "memory" | "codex" | "import" | "labs" | "system" | "mcp" | "connectors" | "plugins" | "skills" | "hooks" | "about";

/** The sidebar's Filter ▸ Status (shared-20 oS(): kept across starts, Active by default). */
export type StatusFilter = "active" | "archived" | "all";

export type DialogState =
  | { type: "review"; threadId: string | null }
  | { type: "rename"; threadId: string }
  | { type: "delete"; threadId: string }
  | { type: "folder" }
  | { type: "createProject"; cwd?: string }
  | { type: "project"; projectId: string; action: "rename" | "delete" }
  | { type: "section"; sectionId: string | null; threadId?: string }
  /** Confirm deleting a sidebar section (shared-20 ConfirmationDialog「Delete group?」). */
  | { type: "deleteSection"; sectionId: string }
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

/** A right-hand pane (lib/panes.ts). */
export type PaneId = "diff" | "files" | "terminal" | "plan" | "background" | "browser";

/** One view's panes, top to bottom, and the one expanded over the chat. */
export interface PaneLayout {
  open: PaneId[];
  expanded: PaneId | null;
}

export interface PendingMessage {
  item: Extract<ThreadItem, { type: "userMessage" }>;
  turnId?: string;
  accepted?: boolean;
  error?: string;
}

export interface AppState {
  /**
   * kind: why the last connection ended (network: bridge unreachable or stream ended; exited:
   * app-server quit; fatal: the bridge could not start codex; unauthorized: missing token).
   * retryAt is when the next automatic reconnect fires (ms since epoch), null once retries
   * stopped. silent: app-server quit and is being restarted behind the boot skeleton; crashed:
   * it kept quitting, so it is no longer restarted on its own.
   */
  conn: {
    status: "connecting" | "ready" | "closed";
    error?: string;
    detail?: string;
    kind?: "network" | "exited" | "fatal" | "unauthorized";
    retryAt?: number | null;
    silent?: boolean;
    crashed?: boolean;
  };
  /** version: the codex binary's version, from initialize's userAgent. */
  server: { cwd: string; command: string; info: InitializeResponse | null; version: string | null };
  account: GetAccountResponse | null;
  rateLimits: GetAccountRateLimitsResponse | null;
  /** The ChatGPT account's credits left and the percent spent (meterCredits); null without any left. */
  chatgptCredits: { balance: number; percent: number } | null;
  /** Per-provider quota from a local opencodex proxy, for models it routes; empty without one. */
  providerQuotas: ProviderQuotaReport[];
  login: LoginState | null;
  models: Model[];
  /** Hidden catalog models (without the auto-review model): not listed in the model menu, but a session's model or /model can name one. */
  hiddenModels: Model[];
  modes: CollaborationModeMask[];
  features: ExperimentalFeature[];
  config: Config | null;
  /** Managed requirements (configRequirements/read); null means unrestricted. */
  requirements: ConfigRequirements | null;
  /** Custom permissions profiles (built-in :read-only / :workspace / :danger-full-access left out); empty hides them. */
  permissionProfiles: PermissionProfileSummary[];
  threads: Record<string, ThreadState>;
  /** Local sends awaiting their server item; the empty key belongs to the new-session page. */
  pendingMessages: Record<string, PendingMessage | undefined>;
  sections: ThreadSection[];
  projects: Project[];
  /**
   * error: the last list load failed (cleared by the next success). status is the sidebar's
   * Filter ▸ Status (archived mirrors status === "archived"); sort is its Sort by.
   */
  list: { ids: string[]; cursor: string | null; loading: boolean; archived: boolean; status: StatusFilter; sort: SessionSort; error?: string };
  /** The new-session page's own session list (refreshLanding: the 50 most recent); null until loaded. */
  landing: string[] | null;
  activeId: string | null;
  /** 返回 / 前进 history (recordRoute / stepRoute): session ids, null for the new-session page. */
  nav: { stack: (string | null)[]; index: number };
  requests: ServerRequest[];
  /** Mid-turn questions answered, skipped or closed here (settleQuestions; questions.ts waitingQuestions). */
  settledQuestions: ReadonlySet<string>;
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
  /** Right-hand panes per view: a thread id, or "draft" for the new-session page (lib/panes.ts). */
  panes: Record<string, PaneLayout>;
  defaultView: TranscriptView;
  settings: SettingsTab | null;
  /** Settings → Codex → 允许绕过权限模式 (cd19fedd2 bypassPermissions, off by default): off, no menu offers the full-access preset. */
  allowFullAccess: boolean;
  /** Settings → Codex → 归档不活跃的会话: days without activity before a session is archived, 0 = never. */
  autoArchiveDays: number;
  /** Settings → 功能 → 合并模型与努力程度 (on by default): one model pill whose menu holds the effort slider; off, two buttons. */
  mergedModelPicker: boolean;
  /** Settings → 功能 → 计划卡 (on by default): sessions codex-ui starts get Codex's update_plan tool. */
  planCard: boolean;
  dialog: DialogState;
  palette: boolean;
  /** Image shown full-window, as a URL. */
  lightbox: string | null;
  sidebarOpen: boolean;
  /** The session rail stays docked where it fits (persisted.epitaxy.sessionRailShown, on by default). */
  railShown: boolean;
}

/** A saved choice from localStorage, if it is one of `allowed`. */
const VIEWS_KEY = "codex-ui:session-views";

/** Per-session transcript views (c03935b01 transcriptModeBySession); only picks off the default are kept. */
export function sessionViews(): Record<string, TranscriptView> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, TranscriptView>) : {};
  } catch {
    return {};
  }
}

/** A session's transcript view (menu or Ctrl+O), remembered unless it is the default. */
export function setSessionView(threadId: string, view: TranscriptView): void {
  updateThread(threadId, (t) => ({ ...t, view }));
  saveSessionView(threadId, view === getState().defaultView ? null : view);
}

function saveSessionView(threadId: string, view: TranscriptView | null): void {
  const views = sessionViews();
  // Re-inserted, so key order is last-picked order for the trim below.
  delete views[threadId];
  if (view) views[threadId] = view;
  // ponytail: oldest-first trim at 200 sessions, insertion order stands in for recency.
  const ids = Object.keys(views);
  for (const id of ids.slice(0, Math.max(0, ids.length - 200))) delete views[id];
  try {
    localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Private mode: the pick lasts for this page only.
  }
}

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

/** The model and effort last picked on the new-session page (codex.ts setOverride), kept across restarts. */
export const NEW_SESSION_PICKS = { model: "codex-ui:new-session-model", effort: "codex-ui:new-session-effort" } as const;

function savedPick(key: keyof typeof NEW_SESSION_PICKS): string | null {
  try {
    return localStorage.getItem(NEW_SESSION_PICKS[key]);
  } catch {
    return null;
  }
}

/**
 * The remembered picks the catalog still offers: a model it no longer lists goes, the effort
 * picked with it too, and so does an effort the model does not support. An effort picked for the
 * default model stays (which model that is depends on config.toml).
 */
export function offeredPicks(prefs: NewChatPrefs, models: Model[]): NewChatPrefs {
  if (!prefs.model) return prefs;
  const model = models.find((m) => m.id === prefs.model || m.model === prefs.model);
  if (!model) return { ...prefs, model: null, effort: null };
  return !prefs.effort || model.supportedReasoningEfforts.some((o) => o.reasoningEffort === prefs.effort) ? prefs : { ...prefs, effort: null };
}

const initialStatus = readPref<StatusFilter>("codex-ui:status-filter", ["active", "archived", "all"], "active");

/** Kept, so a closed question card stays closed after a restart. */
const SETTLED_KEY = "codex-ui:settled-questions";

function readSettled(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SETTLED_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Questions answered, skipped or closed on their card (settled), or open again when the answer failed to send. */
export function settleQuestions(ids: string[], settled: boolean): void {
  const next = new Set(state.settledQuestions);
  for (const id of ids) {
    if (settled) next.add(id);
    else next.delete(id);
  }
  writePref(SETTLED_KEY, JSON.stringify([...next].slice(-200)));
  setState({ settledQuestions: next });
}

const initialState: AppState = {
  conn: { status: "connecting" },
  server: { cwd: "", command: "", info: null, version: null },
  account: null,
  rateLimits: null,
  chatgptCredits: null,
  providerQuotas: [],
  login: null,
  models: [],
  hiddenModels: [],
  modes: [],
  features: [],
  config: null,
  requirements: null,
  permissionProfiles: [],
  threads: {},
  pendingMessages: {},
  sections: [],
  projects: [],
  list: {
    ids: [],
    cursor: null,
    loading: false,
    archived: initialStatus === "archived",
    status: initialStatus,
    sort: readPref("codex-ui:sort", ["recency", "alpha", "created"], "recency"),
  },
  landing: null,
  activeId: null,
  nav: { stack: [null], index: 0 },
  requests: [],
  settledQuestions: new Set(readSettled()),
  toasts: [],
  prefs: { cwd: "", model: savedPick("model"), effort: savedPick("effort"), permission: null, planMode: false, projectId: null, memory: true, serviceTier: null, reviewer: null, permissionProfile: null },
  draftEpoch: 0,
  plugins: null,
  connectors: null,
  hooks: null,
  mcp: null,
  skillsRev: 0,
  remoteControl: null,
  voice: { status: "idle" },
  imports: null,
  panes: {},
  defaultView: readPref("codex-ui:view", ["normal", "thinking", "verbose"], "normal"),
  settings: null,
  allowFullAccess: readPref("codex-ui:allow-full-access", ["true", "false"], "false") === "true",
  autoArchiveDays: Number(readPref("codex-ui:auto-archive-days", ["0", "1", "2", "7", "14", "30"], "0")),
  mergedModelPicker: readPref("codex-ui:merged-model-picker", ["true", "false"], "true") === "true",
  planCard: readPref("codex-ui:plan-card", ["true", "false"], "true") === "true",
  dialog: null,
  palette: false,
  lightbox: null,
  sidebarOpen: readPref("codex-ui:sidebar", ["open", "collapsed"], "open") === "open",
  railShown: readPref("codex-ui:rail", ["shown", "hidden"], "shown") === "shown",
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

export function useAgentTasks(thread: ThreadState) {
  const threads = useStore((s) => s.threads);
  return useMemo(() => agentTasks(thread, threads), [thread, threads]);
}

export function updateThread(id: string, update: (thread: ThreadState) => ThreadState): void {
  setState((current) => {
    const thread = current.threads[id];
    return thread ? { threads: { ...current.threads, [id]: update(thread) } } : {};
  });
}

export function emptyThreadState(meta: Thread): ThreadState {
  return {
    meta: { ...withLineage(meta), turns: [] },
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
    view: sessionViews()[meta.id] ?? null,
    readState: null,
    hooks: [],
    notices: [],
    mcp: {},
    background: [],
    attachments: null,
    memory: null,
    landed: null,
    progress: {},
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

/**
 * A patch Codex streamed as the model wrote it (item/fileChange/patchUpdated) but refused before
 * applying it (apply_patch verification failed) never starts: once another item of its turn
 * starts, it failed. Its own item/started, should that still come, puts it back.
 */
export function refuseStreamed(turn: TurnState, started: string, timing: ThreadState["timing"]): TurnState {
  const refused = (item: ThreadItem) => item.type === "fileChange" && item.status === "inProgress" && item.id !== started && !timing[item.id];
  if (!turn.items.some(refused)) return turn;
  return { ...turn, items: turn.items.map((item) => (item.type === "fileChange" && refused(item) ? { ...item, status: "failed" } : item)) };
}

// ---------------------------------------------------------------------------
// Toasts (CDS Toast, shared-19 OU / AU; the app layer, shared-23 KU / nW): 6.5s, never under
// 6s. A repeat of a live toast (same kind, title and detail) counts up " (×n)" and restarts its
// timer, though not past 30s after it first showed.
// ponytail: timers do not pause while the stack is hovered (Base UI's viewport does).

const TOAST_MS = 6500;
const MIN_TOAST_MS = 6000;
const REPEAT_WINDOW_MS = 30_000;
/** The leaving fade (--cds-dur-base). */
const TOAST_LEAVE_MS = 200;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
let toastId = 0;

function scheduleToast(id: number, ms: number): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.set(id, setTimeout(() => dismissToast(id), ms));
}

export function toast(kind: Toast["kind"], title: string, detail?: string): void {
  const now = Date.now();
  const same = state.toasts.find((t) => !t.ending && t.kind === kind && t.title === title && t.detail === detail);
  if (same) {
    setState((current) => ({ toasts: current.toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t)) }));
    const left = same.at + REPEAT_WINDOW_MS - now;
    if (left >= MIN_TOAST_MS) scheduleToast(same.id, Math.min(left, TOAST_MS));
    return;
  }
  const id = ++toastId;
  setState((current) => ({ toasts: [...current.toasts, { id, kind, title, detail, count: 1, at: now }] }));
  scheduleToast(id, TOAST_MS);
}

/** The close button, Esc or the timer: the toast fades out, then goes. */
export function dismissToast(id: number): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  setState((current) => ({ toasts: current.toasts.map((t) => (t.id === id ? { ...t, ending: true } : t)) }));
  setTimeout(() => setState((current) => ({ toasts: current.toasts.filter((t) => t.id !== id) })), TOAST_LEAVE_MS);
}

// ---------------------------------------------------------------------------
// 返回 / 前进 (pp/shared-20 Ap): a browser-style history of what the main column shows. openThread
// and newChat record every move; the move stepRoute itself asks for is not recorded again.

let stepping: string | null | undefined;

/** Leaving `from` for `to` drops the entries ahead, as a browser does. */
export function recordRoute(from: string | null, to: string | null): void {
  const skip = stepping === to;
  stepping = undefined;
  if (skip || from === to) return;
  setState(({ nav }) => {
    // The current entry takes `from`: the open session can change without a move (a session
    // started from the new-session page, the open one archived).
    const stack = [...nav.stack.slice(0, nav.index), from, to];
    return { nav: { stack, index: stack.length - 1 } };
  });
}

/** The nearest entry one way (-1 back, 1 forward) whose session still exists, or -1. */
function routeIndex(s: AppState, direction: -1 | 1): number {
  for (let index = s.nav.index + direction; index >= 0 && index < s.nav.stack.length; index += direction) {
    const route = s.nav.stack[index];
    if (route === null || s.threads[route]) return index;
  }
  return -1;
}

export function canStepRoute(s: AppState, direction: -1 | 1): boolean {
  return routeIndex(s, direction) !== -1;
}

/** Moves the history one step: the session to open (null: the new-session page), undefined when there is none. */
export function stepRoute(direction: -1 | 1): string | null | undefined {
  const index = routeIndex(state, direction);
  if (index === -1) return undefined;
  setState(({ nav }) => ({ nav: { ...nav, index } }));
  stepping = state.nav.stack[index];
  return stepping;
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

export interface AttachedPullRequest {
  url: string;
  /** The PR's head branch where Codex recorded it (payload.headBranch). */
  branch: string | null;
  /** The attachment's identityKey, to remove it by. */
  key: string;
}

/** Pull-request links attached to the thread (thread/attachment/*), https only. */
export function pullRequests(thread: ThreadState): AttachedPullRequest[] {
  const prs: AttachedPullRequest[] = [];
  for (const attachment of thread.attachments ?? []) {
    if (attachment.attachmentType !== "pull_request") continue;
    const { url, headBranch } = (attachment.payload ?? {}) as { url?: unknown; headBranch?: unknown };
    if (typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
        prs.push({ url: parsed.href, branch: typeof headBranch === "string" && headBranch ? headBranch : null, key: attachment.identityKey });
    } catch {
      // Not a URL: skip it.
    }
  }
  return prs;
}
