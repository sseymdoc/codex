// Global UI state. Updates are immutable so React can compare by reference;
// subscribers are notified once per animation frame, which keeps token streams cheap.

import { useMemo, useSyncExternalStore } from "react";
import { agentTasks } from "./background.ts";
import { loadSideSessions, readJson, record, writeJson, type Proposal, type ProposalOutcome, type SessionLink } from "./side-sessions.ts";
import { upsertBy } from "./protocol.ts";
import type { ConnKind } from "./rpc.ts";
import type { RewindPreview } from "./rewind.ts";
import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
import type { Config } from "@protocol/v2/Config";
import type { ConfigReadResponse } from "@protocol/v2/ConfigReadResponse";
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
  backgrounded?: boolean | null;
  cwd: string;
  cpuPercent: number | null;
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
  marketplacePath: string | null;
}

/** How plugin/read and plugin/install name a plugin: its local marketplace file, or a remote catalog. */
export type PluginRef = { pluginName: string; marketplacePath?: string | null; remoteMarketplaceName?: string | null };

export type VoiceState = { status: "idle" } | { status: "connecting" | "active"; threadId: string; error?: string };

export interface TurnState extends Turn {
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
  /** 更改文件夹…: the folder the session moves to (thread/settings/update, else the next turn/start). */
  cwd?: string;
}

export interface ThreadState {
  meta: Thread;
  /** Latest persisted agent turn status, read without loading its transcript or resuming it. */
  agentTurn?: { id?: string; updatedAt: number; status: TurnState["status"] | null };
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
  /** A repeat came too late in the 30s window to get its full time. */
  capped?: boolean;
  /** When it first showed (ms since epoch). */
  at: number;
  /** How long it shows before going by itself (ms). */
  timeout: number;
  /** Dismissed: kept for the leaving animation. */
  ending?: boolean;
  /**
   * A button under the text (c39a247c4 gt: 撤销). `key` with Ctrl (⌘ on a Mac) presses it too,
   * while this toast leads the stack and no field has focus.
   */
  action?: { label: string; key?: string; run(): void };
}

/** The settings dialog's pages: "account" is the 用量 page; "system" exists in the desktop shell only; "about" is not in the rail. */
export type SettingsPage = "general" | "account" | "capabilities" | "memory" | "codex" | "import" | "labs" | "system" | "about";

/** The 自定义 page's sections (components/Customize.tsx). */
export type CustomizeSection = "plugins" | "skills" | "connectors" | "hooks";

/** What openSettings takes: a settings page, or a 自定义 section it hands over to that page ("mcp" is 连接器). */
export type SettingsTab = SettingsPage | CustomizeSection | "mcp";

/**
 * Where the 自定义 page is: a section, its 我的 / 发现 view, a plugin's page, a connector's page (an
 * item key, `mcp:<pluginId>:<name>` or `app:<id>`), and a one-off request to open the MCP form.
 */
export interface CustomizeRoute {
  section: CustomizeSection;
  view: "mine" | "discover";
  detail: PluginRef | null;
  connector: string | null;
  add: "mcp" | null;
}

/** The 资料库 page's tabs (the ChatGPT app's library-page La fileTabs). */
export type LibraryTab = "suggested" | "favorites" | "folders" | "images" | "all";

/**
 * Where the 资料库 page is (the ChatGPT app's /library location, MTo): a tab, a folder in it, the
 * trash, the file opened from the list, and the storage banner's 管理 (storage_cleanup: a list, the
 * largest first). Search and filters stay the page's own.
 */
export interface LibraryRoute {
  tab: LibraryTab;
  directoryId?: string;
  deleted?: boolean;
  fileId?: string;
  /** 新建 → 笔记: the new note's key (noteSessionOf); its file once the first save makes it goes in fileId too. */
  note?: string;
  storageCleanup?: boolean;
}

/** The sidebar's Filter ▸ Status (shared-20 oS(): kept across starts, Active by default). */
export type StatusFilter = "active" | "archived" | "all";

export type DialogState =
  | { type: "review"; threadId: string | null }
  | { type: "rename"; threadId: string }
  | { type: "delete"; threadId: string }
  /** With `threadId`: 更改文件夹… for that session instead of the next one's folder. */
  | { type: "folder"; threadId?: string }
  /** With `threadId`: the session's 保存 (另存为环境), which binds it to the new environment. */
  | { type: "createProject"; cwd?: string; threadId?: string }
  | { type: "editProject"; projectId: string }
  | { type: "section"; sectionId: string | null; threadId?: string }
  /** Confirm deleting a sidebar section (shared-20 ConfirmationDialog「Delete group?」). */
  | { type: "deleteSection"; sectionId: string }
  | { type: "feedback"; threadId: string; turnId: string | null; good: boolean | null }
  /**
   * Confirm rewinding to before `turnId`; `text` goes back into the composer afterwards. `preview`:
   * the files the turns from there changed, which the dialog offers to restore (rewind.ts).
   */
  | { type: "rewind"; threadId: string; turnId: string; text: string; preview: RewindPreview | null }
  | null;

/**
 * A rewind's divider (c4de0b325 p_e): the turns from `turnId` on were cut (pending: undo offered;
 * back: redone after an undo) or brought back (forward: redo offered). Kept in memory only, like
 * the backend's mark, and dropped once a message is sent.
 */
export interface RewindMark {
  turnId: string;
  at: number;
  variant: "pending" | "forward" | "back";
}

/** An away recap (Claude Code awaySummary → c4de0b325 mue): its text, when it was made, the turn it ends at. */
export interface Recap {
  text: string;
  at: number;
  turnId: string;
}

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
   * app-server quit; fatal: the bridge could not start codex; output: oversized backend output;
   * unauthorized: missing token).
   * retryAt is when the next automatic reconnect fires (ms since epoch), null once retries
   * stopped. silent: app-server quit and is being restarted behind the boot skeleton; crashed:
   * it kept quitting, so it is no longer restarted on its own.
   */
  conn: {
    status: "connecting" | "ready" | "closed";
    error?: string;
    detail?: string;
    kind?: ConnKind;
    retryAt?: number | null;
    silent?: boolean;
    crashed?: boolean;
  };
  /** version: the codex binary's version, from initialize's userAgent. */
  /** `experimental`: started as the experimental backend (hello), whatever initialize then reports. */
  server: { cwd: string; command: string; experimental: boolean; info: InitializeResponse | null; version: string | null };
  account: GetAccountResponse | null;
  accountProfile: { displayName: string | null; avatarUrl: string | null } | null;
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
  /** config/read's origins: the layer each dotted key comes from (user, project, managed…). */
  configOrigins: ConfigReadResponse["origins"];
  /** Managed requirements (configRequirements/read); null means unrestricted. */
  requirements: ConfigRequirements | null;
  /** Custom permissions profiles (built-in :read-only / :workspace / :danger-full-access left out); empty hides them. */
  permissionProfiles: PermissionProfileSummary[];
  threads: Record<string, ThreadState>;
  /** A dot's threads on ChatGPT's durable host (lib/dot-work.ts): shown in the Dots page only. */
  durableThreads: Record<string, ThreadState>;
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
  /** Split view: the other session on screen beside activeId (which has focus), on the left when splitLeft. */
  splitId: string | null;
  splitLeft: boolean;
  /** The Codex Cloud task shown instead of the new-session page while no session is open (lib/cloud.ts). */
  cloudTaskId: string | null;
  /** The ChatGPT Dots page shown instead of the new-session page (lib/dots.ts, components/Dots.tsx). */
  dotsOpen: boolean;
  /** The 自定义 page shown instead of the new-session page (components/Customize.tsx). */
  customizeRoute: CustomizeRoute | null;
  /** The 资料库 page shown instead of the new-session page (lib/library.ts, components/Library.tsx). */
  libraryRoute: LibraryRoute | null;
  /** 返回 / 前进 history (recordRoute / stepRoute): session ids, null for the new-session page. */
  nav: { stack: (string | null)[]; index: number };
  requests: ServerRequest[];
  /** Mid-turn questions answered, skipped or closed here (settleQuestions; questions.ts waitingQuestions). */
  settledQuestions: ReadonlySet<string>;
  /** Sessions with 保持计算机唤醒 on (setKeepAwake): the desktop shell keeps the computer awake for them. */
  keepAwake: ReadonlySet<string>;
  /** Who named each session (setTitleSource); a session missing here was named elsewhere or not at all. */
  titleSources: Readonly<Record<string, TitleSource>>;
  /** set_session_title waiting to replace a name the user gave, by session (askTitleConsent). */
  titleConsents: Readonly<Record<string, TitleConsent>>;
  /** enter_plan_mode waiting on 拒绝 / 允许一次, its request id by session (askPlanConsent). */
  planConsents: Readonly<Record<string, string>>;
  /** run_in_terminal waiting on 拒绝 / 允许一次, by session (askTerminalConsent). */
  terminalConsents: Readonly<Record<string, TerminalConsent>>;
  /** set_setting waiting on 拒绝 / 允许一次, by session (askSettingConsent). */
  settingConsents: Readonly<Record<string, SettingConsent>>;
  /** start_session proposals waiting on their cards, by the session that made them (linked.ts). */
  proposals: Readonly<Record<string, readonly Proposal[]>>;
  /** How proposals left their queue, by task id (Claude resolvedBackgroundTaskSuggestions and the card's outcomes). */
  proposalOutcomes: Readonly<Record<string, ProposalOutcome>>;
  /** Proposals being started right now (Claude spawningTaskIds). */
  spawning: ReadonlySet<string>;
  /** start_session offers waiting on their card: the task id by session (Claude offerWaiters). */
  offers: Readonly<Record<string, string>>;
  /** Sessions another session started, by the started one (Claude spawnedFrom). */
  links: Readonly<Record<string, SessionLink>>;
  /** Sessions where 不再询问 → 始终在此处执行 was picked (Claude sideSessionOffersMuted). */
  offersMuted: ReadonlySet<string>;
  /** Settings → Codex → 当您请求无关的任务时 (Claude ccNewTaskPrompt): ask, keep it here, or a new session. */
  newTaskPrompt: NewTaskPrompt;
  /** Comments on the plan pane's text by session (cc32965c2 Cs bySession), sent with the plan card's 修订. */
  planComments: Readonly<Record<string, readonly PlanComment[]>>;
  /** Plan feedback put back after a 修订 failed to send, by plan (cc32965c2 Cs unsentFeedback). */
  unsentFeedback: Readonly<Record<string, string>>;
  /** Blocking questions asked and settled, by session (recordAsked; asked.ts draws them). */
  askedQuestions: Readonly<Record<string, readonly Asked[]>>;
  /** update_plan calls by session (recordTodo): the plan card, the 待办事项 rows, the plan pane. */
  todoUpdates: Readonly<Record<string, readonly TodoUpdate[]>>;
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
  settings: SettingsPage | null;
  /** Settings → Codex → 允许绕过权限模式 (cd19fedd2 bypassPermissions, off by default): off, no menu offers the full-access preset. */
  allowFullAccess: boolean;
  /** Settings → Codex → 归档不活跃的会话: days without activity before a session is archived, 0 = never. */
  autoArchiveDays: number;
  /** Settings → 功能 → 合并模型与努力程度 (on by default): one model pill whose menu holds the effort slider; off, two buttons. */
  mergedModelPicker: boolean;
  /** Settings → 功能 → 计划卡 (on by default): sessions codex-ui starts get Codex's update_plan tool. */
  planCard: boolean;
  /** Settings → 功能 → 离开后的回顾 (Claude Code's awaySummaryEnabled, on by default). */
  awayRecap: boolean;
  /** Per session: the latest away recap (codex.ts maybeRecap) and the turn it covers. */
  recaps: Record<string, Recap>;
  /** Settings → 通用 → 外观: the Claude flags codex-ui draws both ways (CLAUDE_FLAGS). */
  claudeFlags: Record<ClaudeFlag, boolean>;
  dialog: DialogState;
  /** Per thread: the latest rewind's divider. */
  rewindMarks: Record<string, RewindMark>;
  palette: boolean;
  /** Image shown full-window, as a URL. */
  lightbox: string | null;
  sidebarOpen: boolean;
  /** The session rail stays docked where it fits (persisted.epitaxy.sessionRailShown, on by default). */
  railShown: boolean;
}

export type NewTaskPrompt = "ask" | "here" | "new_session";

/** A saved choice from localStorage, if it is one of `allowed`. */
const VIEWS_KEY = "codex-ui:session-views";

/** Per-session transcript views (c03935b01 transcriptModeBySession); only picks off the default are kept. */
export function sessionViews(): Record<string, TranscriptView> {
  return record(readJson(VIEWS_KEY)) as Record<string, TranscriptView>;
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
  writeJson(VIEWS_KEY, views);
}

/** JSON in localStorage (null when missing or unreadable), alongside readPref / writePref. */
export { readJson, record, writeJson };

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

/**
 * Claude Desktop GrowthBook flags whose both sides codex-ui draws, switchable in 设置 → 通用 → 外观.
 * Each default is the user's Claude (its persisted bootstrap, read 2026-10-25).
 */
export const CLAUDE_FLAGS = {
  /** c227f4d5e code_ring_motion: the usage ring inside c403c4b83 UsageRingMotion. */
  ringMotion: { id: "__gb__437380009", on: false },
  /** cd19fedd2 interfaceFontInGeneral: 界面字体 on 通用 → 外观 instead of Codex → 外观. */
  interfaceFontInGeneral: { id: "__gb__1197194941", on: true },
  /** shared-8 S_: the collapsed sidebar edge's proximity hint and magnet peek. */
  sidebarEdgePeek: { id: "__gb__741807810", on: false },
  /** c26fb8b6b chat chrome; for codex-ui (its other pieces already on), c19e90103 Mx's phrase fade. */
  phraseFade: { id: "__gb__2846116625", on: false },
  /** c19e90103 fy: a Markdown file previews as the reading page, not pane prose. */
  documentPage: { id: "__gb__1590565993", on: true },
  /** cfc0d8c26 → c96d752d0 Tf: the reply's smart quotes (quotes.ts) and, with them, its hanging quotes. */
  smartQuotes: { id: "__gb__2215170874", on: true },
  /** shared-16 wh: Ctrl+Tab opens the recents switcher (Palette.tsx HistorySwitcher) instead of stepping the sidebar. */
  recentsSwitcher: { id: "__gb__320800483", on: true },
} as const;
export type ClaudeFlag = keyof typeof CLAUDE_FLAGS;

const flagKey = (name: ClaudeFlag) => `codex-ui:${CLAUDE_FLAGS[name].id}`;

function readFlags(): Record<ClaudeFlag, boolean> {
  const names = Object.keys(CLAUDE_FLAGS) as ClaudeFlag[];
  return Object.fromEntries(names.map((name) => [name, readPref(flagKey(name), ["true", "false"], CLAUDE_FLAGS[name].on ? "true" : "false") === "true"])) as Record<ClaudeFlag, boolean>;
}

export function setClaudeFlag(name: ClaudeFlag, on: boolean): void {
  writePref(flagKey(name), String(on));
  setState({ claudeFlags: { ...state.claudeFlags, [name]: on } });
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

/** A kept list of ids ([] when missing or unreadable). */
function readIds(key: string): string[] {
  const value = readJson(key);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
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

/**
 * Claude 3.6556 titleSource: generated (auto), the user's own rename (user) or the agent's
 * set_session_title (tool). Codex keeps no such field, so it is kept here until the session is deleted.
 */
export type TitleSource = "auto" | "user" | "tool";
const TITLE_SOURCES_KEY = "codex-ui:title-sources";

function readTitleSources(): Record<string, TitleSource> {
  return Object.fromEntries(Object.entries(record(readJson(TITLE_SOURCES_KEY))).filter((entry): entry is [string, TitleSource] => ["auto", "user", "tool"].includes(entry[1] as string)));
}

export function setTitleSource(threadId: string, source: TitleSource | undefined): void {
  if (state.titleSources[threadId] === source) return;
  const next = { ...state.titleSources };
  if (source) next[threadId] = source;
  else delete next[threadId];
  writePref(TITLE_SOURCES_KEY, JSON.stringify(next));
  setState({ titleSources: next });
}

/** A desktop request (its id) to rename a session to title, replacing the user's own name. */
export interface TitleConsent { id: string; title: string }
/** A desktop request (its id) to type `command` into a terminal tab: its label, or null for a new tab in `folder`. */
export interface TerminalConsent { id: string; command: string; tab: string | null; folder: string }
/** A desktop request (its id) to change a preference: its label and its value now and asked for, as the Settings page names them. */
export interface SettingConsent { id: string; label: string; from: string; to: string }
const consentAnswers = new Map<string, (allow: boolean) => void>();

/**
 * Docks a desktop request's card and waits for 拒绝 / 允许一次. A cancelled call (turn stopped,
 * timed out, disconnected) takes the card away as a denial.
 */
function askConsent<F extends "titleConsents" | "planConsents" | "terminalConsents" | "settingConsents">(field: F, threadId: string, id: string, value: AppState[F][string], signal: AbortSignal): Promise<boolean> {
  const idOf = (entry: TitleConsent | TerminalConsent | SettingConsent | string | undefined) => (typeof entry === "string" ? entry : entry?.id);
  return new Promise((resolve) => {
    const settle = (allow: boolean) => {
      if (!consentAnswers.delete(id)) return;
      signal.removeEventListener("abort", cancel);
      setState((s) => {
        if (idOf(s[field][threadId]) !== id) return {};
        const next: Record<string, unknown> = { ...s[field] };
        delete next[threadId];
        return { [field]: next } as Partial<AppState>;
      });
      resolve(allow);
    };
    const cancel = () => settle(false);
    consentAnswers.set(id, settle);
    signal.addEventListener("abort", cancel, { once: true });
    setState((s) => ({ [field]: { ...s[field], [threadId]: value } }) as Partial<AppState>);
    if (signal.aborted) cancel();
  });
}

/** Claude 3.6556 setSessionTitleConsent. */
export function askTitleConsent(threadId: string, consent: TitleConsent, signal: AbortSignal): Promise<boolean> {
  return askConsent("titleConsents", threadId, consent.id, consent, signal);
}

/** Claude Code's EnterPlanMode permission (Enter plan mode?), for codex_ui_desktop enter_plan_mode. */
export function askPlanConsent(threadId: string, id: string, signal: AbortSignal): Promise<boolean> {
  return askConsent("planConsents", threadId, id, id, signal);
}

/** run_in_terminal outside full access: the command is typed only once the user allows it. */
export function askTerminalConsent(threadId: string, consent: TerminalConsent, signal: AbortSignal): Promise<boolean> {
  return askConsent("terminalConsents", threadId, consent.id, consent, signal);
}

/** set_setting: every change waits for the user to allow it, whatever the permission mode. */
export function askSettingConsent(threadId: string, consent: SettingConsent, signal: AbortSignal): Promise<boolean> {
  return askConsent("settingConsents", threadId, consent.id, consent, signal);
}

export function answerConsent(id: string, allow: boolean): void {
  consentAnswers.get(id)?.(allow);
}

/** A comment on the plan pane's text (cc32965c2 Cs): offsets into its rendered text (planComments.ts). */
export interface PlanComment { id: string; startOffset: number; endOffset: number; selectedText: string; comment: string }

function setPlanComments(threadId: string, change: (comments: readonly PlanComment[]) => readonly PlanComment[]): void {
  setState((s) => {
    const next = { ...s.planComments, [threadId]: change(s.planComments[threadId] ?? []) };
    if (!next[threadId].length) delete next[threadId];
    return { planComments: next };
  });
}

/** cc32965c2 Es: add / update / remove, take (the 修订 sending them) and restore (it failed). */
export const planComments = {
  add: (threadId: string, comment: Omit<PlanComment, "id">) => setPlanComments(threadId, (all) => [...all, { ...comment, id: crypto.randomUUID() }]),
  update: (threadId: string, id: string, comment: string) => setPlanComments(threadId, (all) => all.map((entry) => (entry.id === id ? { ...entry, comment } : entry))),
  remove: (threadId: string, id: string) => setPlanComments(threadId, (all) => all.filter((entry) => entry.id !== id)),
  take(threadId: string): readonly PlanComment[] {
    const taken = state.planComments[threadId] ?? [];
    setPlanComments(threadId, () => []);
    return taken;
  },
  restore(threadId: string, taken: readonly PlanComment[]): void {
    if (taken.length) setPlanComments(threadId, (all) => [...taken, ...all]);
  },
};

export function setUnsentFeedback(key: string, text: string | undefined): void {
  setState((s) => {
    const next = { ...s.unsentFeedback };
    if (text === undefined) delete next[key];
    else next[key] = text;
    return { unsentFeedback: next };
  });
}

/**
 * A blocking question (request_user_input) once settled: what was asked, what came back and how
 * (answered on the card, closed with ✕, or a message sent instead), and the turn item it came
 * after. Codex keeps no item for it, so the transcript's record of it lives here.
 */
export interface Asked {
  itemId: string;
  turnId: string;
  after: string | null;
  questions: { header: string; question: string; multiSelect?: boolean }[];
  answers: string[][];
  how: "answered" | "dismissed" | "replied";
  at: number;
}

const ASKED_KEY = "codex-ui:asked-questions";
// ponytail: kept on this machine only, newest 200; a backend item would carry them everywhere.
const ASKED_LIMIT = 200;

function readAsked(): Record<string, Asked[]> {
  return record(readJson(ASKED_KEY)) as Record<string, Asked[]>;
}

function saveAsked(next: Record<string, readonly Asked[]>): void {
  writePref(ASKED_KEY, JSON.stringify(next));
  setState({ askedQuestions: next });
}

/** Drops the oldest records (by `at`, across sessions) past `limit`. */
function trimRecords<T extends { at: number }>(next: Record<string, readonly T[]>, limit: number): Record<string, readonly T[]> {
  const all = Object.entries(next).flatMap(([id, entries]) => entries.map((entry) => [id, entry] as const)).sort((a, b) => a[1].at - b[1].at);
  for (const [id, entry] of all.slice(0, Math.max(0, all.length - limit))) {
    next[id] = next[id].filter((kept) => kept !== entry);
    if (!next[id].length) delete next[id];
  }
  return next;
}

/** Keeps a settled question's record, the oldest going past the limit. */
export function recordAsked(threadId: string, asked: Asked): void {
  saveAsked(trimRecords({ ...state.askedQuestions, [threadId]: [...(state.askedQuestions[threadId] ?? []).filter((entry) => entry.itemId !== asked.itemId), asked] }, ASKED_LIMIT));
}

/** A deleted session takes its records with it. */
export function forgetAsked(threadId: string): void {
  if (!state.askedQuestions[threadId]) return;
  const next = { ...state.askedQuestions };
  delete next[threadId];
  saveAsked(next);
}

/**
 * One update_plan call (turn/plan/updated): the steps it set and the turn item it came after. Codex
 * keeps no item for it, so the transcript's 已更新待办事项 rows, the plan card and the plan pane's
 * 任务 read it from here, as the asked records are.
 */
export interface TodoUpdate {
  id: string;
  turnId: string;
  after: string | null;
  steps: TurnPlanStep[];
  at: number;
}

const TODO_KEY = "codex-ui:todo-updates";
// ponytail: kept on this machine only, newest 1000; a backend item would carry them everywhere.
const TODO_LIMIT = 1000;

function readTodos(): Record<string, TodoUpdate[]> {
  return record(readJson(TODO_KEY)) as Record<string, TodoUpdate[]>;
}

function saveTodos(next: Record<string, readonly TodoUpdate[]>): void {
  writePref(TODO_KEY, JSON.stringify(next));
  setState({ todoUpdates: next });
}

/** Keeps an update_plan call's steps, after the turn's latest item, the oldest going past the limit. */
export function recordTodo(threadId: string, turnId: string, steps: TurnPlanStep[]): void {
  const kept = state.todoUpdates[threadId] ?? [];
  const after = state.threads[threadId]?.turns.find((turn) => turn.id === turnId)?.items.at(-1)?.id ?? null;
  const update: TodoUpdate = { id: `todo-${turnId}-${kept.filter((entry) => entry.turnId === turnId).length}`, turnId, after, steps, at: Date.now() };
  saveTodos(trimRecords({ ...state.todoUpdates, [threadId]: [...kept, update] }, TODO_LIMIT));
}

/** A deleted session takes its records with it. */
export function forgetTodos(threadId: string): void {
  if (!state.todoUpdates[threadId]) return;
  const next = { ...state.todoUpdates };
  delete next[threadId];
  saveTodos(next);
}

/** Kept, so 保持计算机唤醒 stays on for a session across restarts until it is archived or deleted. */
const KEEP_AWAKE_KEY = "codex-ui:keep-awake";

/** 查看选项 → 保持计算机唤醒 · 仅限本次会话 (3.6556 cf74bc599 DA, the session's manualKeepAwake). */
export function setKeepAwake(threadId: string, on: boolean): void {
  if (state.keepAwake.has(threadId) === on) return;
  const next = new Set(state.keepAwake);
  if (on) next.add(threadId);
  else next.delete(threadId);
  writePref(KEEP_AWAKE_KEY, JSON.stringify([...next]));
  setState({ keepAwake: next });
}

const initialState: AppState = {
  conn: { status: "connecting" },
  server: { cwd: "", command: "", experimental: false, info: null, version: null },
  account: null,
  accountProfile: null,
  rateLimits: null,
  chatgptCredits: null,
  providerQuotas: [],
  login: null,
  models: [],
  hiddenModels: [],
  modes: [],
  features: [],
  config: null,
  configOrigins: {},
  requirements: null,
  permissionProfiles: [],
  threads: {},
  durableThreads: {},
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
  splitId: null,
  splitLeft: false,
  cloudTaskId: null,
  dotsOpen: false,
  customizeRoute: null,
  libraryRoute: null,
  nav: { stack: [null], index: 0 },
  requests: [],
  settledQuestions: new Set(readIds(SETTLED_KEY)),
  keepAwake: new Set(readIds(KEEP_AWAKE_KEY)),
  titleSources: readTitleSources(),
  titleConsents: {},
  planConsents: {},
  terminalConsents: {},
  settingConsents: {},
  ...loadSideSessions(),
  spawning: new Set(),
  offers: {},
  newTaskPrompt: readPref<NewTaskPrompt>("codex-ui:new-task-prompt", ["ask", "here", "new_session"], "ask"),
  planComments: {},
  unsentFeedback: {},
  askedQuestions: readAsked(),
  todoUpdates: readTodos(),
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
  awayRecap: readPref("codex-ui:away-recap", ["true", "false"], "true") === "true",
  recaps: record(readJson("codex-ui:recaps")) as Record<string, Recap>,
  claudeFlags: readFlags(),
  dialog: null,
  rewindMarks: {},
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
    if (thread) return { threads: { ...current.threads, [id]: update(thread) } };
    const durable = current.durableThreads[id];
    return durable ? { durableThreads: { ...current.durableThreads, [id]: update(durable) } } : {};
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
  return { ...turn, items: upsertBy(turn.items, (existing) => existing.id, item) };
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
// Toasts (CDS Toast, shared-19 PO / IO; the app layer, shared-50 nw / ew and shared-52): a notice
// shows 6.5s, a warning or failure (addError: the warning variant) 10s, unless the caller says;
// CDS floors any shorter time to 6s (fO: the sidebar's 3s bulk notices last 6s). A repeat of a live
// toast (same kind, title and detail) counts up " (×n)" and restarts its timer, though not past
// 30s after it first showed. A repeated warning that the user closes, or that hit that 30s cap,
// keeps its copies away for 30s (ew KC). One with an action (as Claude's sidebar undo, c39a247c4
// ot, which codex-ui leaves off as its flag is) has 6s and never merges. Hovering or focusing the
// stack, or the window losing focus, holds every timer (c39a247c4 hold, as Base UI's viewport
// pauses).
// ponytail: the last release starts each toast's time over rather than resuming what was left,
// and an action toast pushed behind another keeps counting (c39a247c4 vt holds it).

const TOAST_MS = 6500;
const ALERT_TOAST_MS = 10_000;
const MIN_TOAST_MS = 6000;
/** The undo window (c39a247c4 at). */
const ACTION_TOAST_MS = 6000;
const REPEAT_WINDOW_MS = 30_000;
/** The leaving fade (--cds-dur-base). */
const TOAST_LEAVE_MS = 200;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();
/** Warnings kept quiet after a repeated copy closed: key → until (ms since epoch). */
const quietToasts = new Map<string, number>();
const toastKey = (t: Pick<Toast, "kind" | "title" | "detail">) => `${t.kind}|${t.title}|${t.detail ?? ""}`;
let toastId = 0;
let toastHolds = 0;

/** `ms` Infinity: it stays until closed (the desktop app's duration Infinity / 0). */
function scheduleToast(id: number, ms: number): void {
  clearTimeout(toastTimers.get(id));
  if (toastHolds || ms === Infinity) toastTimers.delete(id);
  else toastTimers.set(id, setTimeout(() => dismissToast(id), ms));
}

export function toast(kind: Toast["kind"], title: string, detail?: string, timeout?: number): void {
  timeout = Math.max(MIN_TOAST_MS, timeout ?? (kind === "neutral" ? TOAST_MS : ALERT_TOAST_MS));
  const now = Date.now();
  if ((quietToasts.get(toastKey({ kind, title, detail })) ?? 0) > now) return;
  const same = state.toasts.find((t) => !t.ending && !t.action && t.kind === kind && t.title === title && t.detail === detail);
  if (same) {
    const left = same.at + REPEAT_WINDOW_MS - now;
    const capped = left < timeout || same.capped;
    setState((current) => ({ toasts: current.toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1, capped } : t)) }));
    if (left >= MIN_TOAST_MS && same.timeout !== Infinity) scheduleToast(same.id, Math.min(left, same.timeout));
    return;
  }
  const id = ++toastId;
  setState((current) => ({ toasts: [...current.toasts, { id, kind, title, detail, count: 1, at: now, timeout }] }));
  scheduleToast(id, timeout);
}

/** A toast with an action, neutral for the undo window unless told; returns its id. */
export function actionToast(title: string, action: NonNullable<Toast["action"]>, kind: Toast["kind"] = "neutral", timeout = ACTION_TOAST_MS): number {
  const id = ++toastId;
  setState((current) => ({ toasts: [...current.toasts, { id, kind, title, count: 1, at: Date.now(), timeout, action }] }));
  scheduleToast(id, timeout);
  return id;
}

/** Stops every toast's timer until the returned release (each hold is released once). */
export function holdToasts(): () => void {
  if (toastHolds++ === 0) {
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--toastHolds === 0) for (const t of state.toasts) if (!t.ending) scheduleToast(t.id, t.timeout);
  };
}

/** The close button or Esc (byUser), or the timer: the toast fades out, then goes. */
export function dismissToast(id: number, byUser = false): void {
  clearTimeout(toastTimers.get(id));
  toastTimers.delete(id);
  const gone = state.toasts.find((t) => t.id === id);
  if (gone && gone.kind !== "neutral" && gone.count > 1 && (byUser || gone.capped)) quietToasts.set(toastKey(gone), Date.now() + REPEAT_WINDOW_MS);
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

/** The plugins feature is switched off: the 自定义 page drops its 插件 section, the sidebar row says 自定义. */
export const pluginsOff = (s: AppState): boolean => s.features.some((feature) => feature.name === "plugins" && !feature.enabled);

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

// ---------------------------------------------------------------------------
// Split view: two sessions side by side. activeId is the one with focus (shortcuts, palette, menu
// commands follow it); splitId is the other. Focus moves by swapping the two, so the columns stay put.

/** On screen in either column. */
export const isShown = (s: Pick<AppState, "activeId" | "splitId">, id: string): boolean => s.activeId === id || s.splitId === id;

/** The sessions on screen, left to right. */
export function splitColumns(s: Pick<AppState, "activeId" | "splitId" | "splitLeft">): string[] {
  if (!s.activeId) return [];
  if (!s.splitId) return [s.activeId];
  return s.splitLeft ? [s.splitId, s.activeId] : [s.activeId, s.splitId];
}

/** Focus the split column holding `id`: the two swap roles, the columns keep their places. */
export function focusSession(id: string): void {
  setState((s) => (s.splitId === id && s.activeId ? { activeId: id, splitId: s.activeId, splitLeft: !s.splitLeft } : {}));
}

