// Controller: owns the app-server connection, turns server notifications into
// state, and exposes the actions the UI calls.

import { appendDeveloperInstructions, hostContext, LAZY_WORKTREE, planningConfig, WORKFLOW_KEYWORD } from "../../context/index.mjs";

import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { FuzzyFileSearchResponse } from "@protocol/FuzzyFileSearchResponse";
import type { RequestId } from "@protocol/RequestId";
import type { ServerNotification } from "@protocol/ServerNotification";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AddCreditsNudgeCreditType } from "@protocol/v2/AddCreditsNudgeCreditType";
import type { AddCreditsNudgeEmailStatus } from "@protocol/v2/AddCreditsNudgeEmailStatus";
import type { AppToolSummary } from "@protocol/v2/AppToolSummary";
import type { AppsInstalledResponse } from "@protocol/v2/AppsInstalledResponse";
import type { AppsListResponse } from "@protocol/v2/AppsListResponse";
import type { AppsReadResponse } from "@protocol/v2/AppsReadResponse";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
import { agentRunStatus, agentTasks, agentThreadIds, type BackgroundTask } from "./background";
import { isStopping, markStopped, setStopping, showAgent } from "./background-view";
import { adoptDraftUltracode, hasUltracodeKeyword, ultracodeOn, workflowsEnabled } from "./ultracode";
import { endRun, endRunningRuns, recheckRuns } from "./workflow-runs";
import { openWritten } from "./browser";
import { forkTitle, placeholderTitle, requestTitle } from "./titles";
import type { CommandExecResponse } from "@protocol/v2/CommandExecResponse";
import type { ConfigBatchWriteParams } from "@protocol/v2/ConfigBatchWriteParams";
import type { ConfigReadResponse } from "@protocol/v2/ConfigReadResponse";
import type { ConfigRequirementsReadResponse } from "@protocol/v2/ConfigRequirementsReadResponse";
import type { ConfigWriteResponse } from "@protocol/v2/ConfigWriteResponse";
import type { ConsumeAccountRateLimitResetCreditOutcome } from "@protocol/v2/ConsumeAccountRateLimitResetCreditOutcome";
import type { ConsumeAccountRateLimitResetCreditResponse } from "@protocol/v2/ConsumeAccountRateLimitResetCreditResponse";
import type { ExperimentalFeatureEnablementSetResponse } from "@protocol/v2/ExperimentalFeatureEnablementSetResponse";
import type { ExperimentalFeatureListResponse } from "@protocol/v2/ExperimentalFeatureListResponse";
import type { ExternalAgentConfigDetectResponse } from "@protocol/v2/ExternalAgentConfigDetectResponse";
import type { ExternalAgentConfigImportResponse } from "@protocol/v2/ExternalAgentConfigImportResponse";
import type { ExternalAgentConfigMigrationItem } from "@protocol/v2/ExternalAgentConfigMigrationItem";
import type { FeedbackUploadResponse } from "@protocol/v2/FeedbackUploadResponse";
import type { FsReadDirectoryEntry } from "@protocol/v2/FsReadDirectoryEntry";
import type { FsReadDirectoryResponse } from "@protocol/v2/FsReadDirectoryResponse";
import type { FsReadFileResponse } from "@protocol/v2/FsReadFileResponse";
import type { FsWatchResponse } from "@protocol/v2/FsWatchResponse";
import type { GetAccountRateLimitsResponse } from "@protocol/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@protocol/v2/GetAccountResponse";
import type { GetAccountTokenUsageResponse } from "@protocol/v2/GetAccountTokenUsageResponse";
import type { HookMetadata } from "@protocol/v2/HookMetadata";
import type { HookRunSummary } from "@protocol/v2/HookRunSummary";
import type { HooksListResponse } from "@protocol/v2/HooksListResponse";
import type { ListMcpServerStatusResponse } from "@protocol/v2/ListMcpServerStatusResponse";
import type { LoginAccountResponse } from "@protocol/v2/LoginAccountResponse";
import type { MarketplaceAddResponse } from "@protocol/v2/MarketplaceAddResponse";
import type { MarketplaceRemoveResponse } from "@protocol/v2/MarketplaceRemoveResponse";
import type { MarketplaceUpgradeResponse } from "@protocol/v2/MarketplaceUpgradeResponse";
import type { McpServerOauthLoginResponse } from "@protocol/v2/McpServerOauthLoginResponse";
import type { Model } from "@protocol/v2/Model";
import type { ModelListResponse } from "@protocol/v2/ModelListResponse";
import type { PermissionProfileListResponse } from "@protocol/v2/PermissionProfileListResponse";
import type { PermissionProfileSummary } from "@protocol/v2/PermissionProfileSummary";
import type { PluginDetail } from "@protocol/v2/PluginDetail";
import type { PluginInstalledResponse } from "@protocol/v2/PluginInstalledResponse";
import type { PluginInstallResponse } from "@protocol/v2/PluginInstallResponse";
import type { PluginListMarketplaceKind } from "@protocol/v2/PluginListMarketplaceKind";
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginReadResponse } from "@protocol/v2/PluginReadResponse";
import type { PluginReconcileResponse } from "@protocol/v2/PluginReconcileResponse";
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { PluginSearchScope } from "@protocol/v2/PluginSearchScope";
import type { PluginShareCheckoutResponse } from "@protocol/v2/PluginShareCheckoutResponse";
import type { PluginShareContext } from "@protocol/v2/PluginShareContext";
import type { PluginShareDeleteResponse } from "@protocol/v2/PluginShareDeleteResponse";
import type { PluginShareDiscoverability } from "@protocol/v2/PluginShareDiscoverability";
import type { PluginShareListItem } from "@protocol/v2/PluginShareListItem";
import type { PluginShareListResponse } from "@protocol/v2/PluginShareListResponse";
import type { PluginShareSaveResponse } from "@protocol/v2/PluginShareSaveResponse";
import type { PluginShareUpdateTargetsResponse } from "@protocol/v2/PluginShareUpdateTargetsResponse";
import type { PluginSummary } from "@protocol/v2/PluginSummary";
import type { Project } from "@protocol/v2/Project";
import type { QueuedSubmission } from "@protocol/v2/QueuedSubmission";
import type { RemoteControlStatusChangedNotification } from "@protocol/v2/RemoteControlStatusChangedNotification";
import type { ReviewStartResponse } from "@protocol/v2/ReviewStartResponse";
import type { ReviewTarget } from "@protocol/v2/ReviewTarget";
import type { SandboxMode } from "@protocol/v2/SandboxMode";
import type { SandboxPolicy } from "@protocol/v2/SandboxPolicy";
import type { SendAddCreditsNudgeEmailResponse } from "@protocol/v2/SendAddCreditsNudgeEmailResponse";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import type { Thread } from "@protocol/v2/Thread";
import { readGitSnapshot, gitContext, type GitSnapshot } from "./git";
import type { ThreadAttachmentListResponse } from "@protocol/v2/ThreadAttachmentListResponse";
import type { ThreadForkResponse } from "@protocol/v2/ThreadForkResponse";
import type { ThreadGoalGetResponse } from "@protocol/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetResponse } from "@protocol/v2/ThreadGoalSetResponse";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import type { ThreadListResponse } from "@protocol/v2/ThreadListResponse";
import type { ThreadMetadataUpdateResponse } from "@protocol/v2/ThreadMetadataUpdateResponse";
import type { ThreadReadState } from "@protocol/v2/ThreadReadState";
import type { ThreadResumeResponse } from "@protocol/v2/ThreadResumeResponse";
import type { ThreadRevertResponse } from "@protocol/v2/ThreadRevertResponse";
import type { ThreadSearchResult } from "@protocol/v2/ThreadSearchResult";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import type { ThreadSectionCreateResponse } from "@protocol/v2/ThreadSectionCreateResponse";
import type { ThreadSectionListResponse } from "@protocol/v2/ThreadSectionListResponse";
import type { ThreadSourceKind } from "@protocol/v2/ThreadSourceKind";
import type { ThreadStartResponse } from "@protocol/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@protocol/v2/ThreadTurnsListResponse";
import type { TurnStartParams } from "@protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@protocol/v2/TurnStartResponse";
import type { UserInput } from "@protocol/v2/UserInput";
import type { WindowsSandboxReadiness } from "@protocol/v2/WindowsSandboxReadiness";
import type { WindowsSandboxReadinessResponse } from "@protocol/v2/WindowsSandboxReadinessResponse";
import type { WindowsSandboxSetupMode } from "@protocol/v2/WindowsSandboxSetupMode";
import type { WindowsSandboxSetupStartResponse } from "@protocol/v2/WindowsSandboxSetupStartResponse";
import {
  STRICT_REVIEW_TEXT,
  VERIFICATION_TEXT,
  VERIFICATION_URL,
  base64ToBytes,
  base64ToText,
  finalAnswer,
  guardianEvent,
  mcpRuntimeStatus,
  noActiveTurn,
  notSteerable,
  overridable,
  parseVersion,
  readStateConflict,
  rerouteText,
  reviewSummary,
  textToBase64,
  unsupported,
  upsertBy,
  worldWritableText,
} from "./protocol";
import { environmentOf, type EnvironmentConfig, type EnvironmentKind } from "./environments";
import { mintScratch } from "./scratch";
import { libraryPrefs } from "./library";
import { sshCommand, sshConnections, sshEnvironmentId, type SshConnection } from "./ssh";
import { basename, joinPath, meterBalances, meterCredits, normalizePath, parentDir, samePath, threadMarkdown, threadTitle, type BalanceTracks, type ProviderQuotaReport } from "./format";
import { appliedChanges, touchedPaths, undoChanges } from "./rewind";
import { streamedChange } from "./panes";
import { commandRunning, parseShells } from "./terminal";
import { keptTargets } from "./plugins";
import { keySegment, recommendedSkills, type RecommendedSkill } from "./customize";
import { autoMergeCommand, createdPrs, ghProblem, ghProblemText, githubRemote, mergeMethod, mergeMethodCommand, parsePr, parsePrExtra, parsePrView, prExtraCommand, prIdentity, prViewCommand, type GhProblem, type PrStatus } from "./pr";
import { Rpc, RpcError, type ConnKind, type Hello, type Method, type ParamsOf } from "./rpc";
import { outliving, spawnOf, spawnRoot, withLineage, type SessionSort } from "./session";
import {
  emptyThreadState,
  focusSession,
  getState,
  isShown,
  NEW_SESSION_PICKS,
  offeredPicks,
  readJson,
  record,
  recordRoute,
  refuseStreamed,
  setKeepAwake,
  setState,
  setTitleSource,
  forgetAsked,
  forgetTodos,
  recordTodo,
  toast,
  updateItem,
  updateThread,
  updateTurn,
  upsertItem,
  writeJson,
  writePref,
  type AppState,
  type AutoReview,
  type BackgroundTerminal,
  type Connector,
  type CustomizeRoute,
  type CustomizeSection,
  type InstalledPlugin,
  type LibraryRoute,
  type Notice,
  type PluginRef,
  type PermissionPreset,
  type Reviewer,
  type RewindMark,
  type ScheduledRoute,
  type ServiceTierPick,
  type StatusFilter,
  type ThreadSettings,
  type ThreadState,
  type TitleSource,
  type TurnState,
} from "./store";
import { PLAN_RESUME, WORKTREE_RESUME, requestSummary, splitRequest } from "./questions";
import { forgetSession, sentSideContext, sideContext, turnEnded } from "./linked";
import { automationOf, automationThreadEvent, automationTurnCompleted, automationsState, hasUnreadRun, noteRead, noteUserTurn, quietCompletion, refreshAutomations } from "./automations";
import { onRealtimeNotification, resetVoice } from "./voice";

declare const __APP_VERSION__: string;
/** package.json's version, which vite.config.mjs defines; empty outside a Vite build. */
export const VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

declare const __BUILD_TIME__: string;
declare const __GIT_SHA__: string;
/** Shown on the About card: the UI version, build time (ISO) and git commit; empty when unknown. */
export const BUILD = {
  version: VERSION,
  time: typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "",
  sha: typeof __GIT_SHA__ === "string" ? __GIT_SHA__ : "",
};

// ---------------------------------------------------------------------------
// Experimental response shapes missing from the stable schema export
// (copied from `codex app-server generate-ts --experimental`).

export interface ThreadSearchOccurrence {
  turnId: string;
  itemId: string;
  snippet: string;
  /** UTF-16 range within snippet. */
  snippetMatchRange: { start: number; end: number };
  /** Opaque inclusive cursor accepted by thread/turns/list for this turn. */
  turnCursor: string;
}

export interface RemotePairing {
  pairingCode: string;
  manualPairingCode: string | null;
  environmentId: string;
  expiresAt: number;
}

export interface RemoteClient {
  clientId: string;
  displayName: string | null;
  deviceType: string | null;
  platform: string | null;
  osVersion: string | null;
  deviceModel: string | null;
  appVersion: string | null;
  lastSeenAt: number | null;
}

export interface MemoryStatus {
  v2ConsolidatedThreads: number;
  v2Ready: boolean;
}

interface Responses {
  initialize: InitializeResponse;
  "account/read": GetAccountResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "account/rateLimitResetCredit/consume": ConsumeAccountRateLimitResetCreditResponse;
  "account/sendAddCreditsNudgeEmail": SendAddCreditsNudgeEmailResponse;
  "account/usage/read": GetAccountTokenUsageResponse;
  "account/login/start": LoginAccountResponse;
  "app/installed": AppsInstalledResponse;
  "app/read": AppsReadResponse;
  "config/read": ConfigReadResponse;
  "config/batchWrite": ConfigWriteResponse;
  "configRequirements/read": ConfigRequirementsReadResponse;
  "experimentalFeature/list": ExperimentalFeatureListResponse;
  "experimentalFeature/enablement/set": ExperimentalFeatureEnablementSetResponse;
  "externalAgentConfig/detect": ExternalAgentConfigDetectResponse;
  "externalAgentConfig/import": ExternalAgentConfigImportResponse;
  "feedback/upload": FeedbackUploadResponse;
  "fs/readDirectory": FsReadDirectoryResponse;
  "fs/readFile": FsReadFileResponse;
  "fs/watch": FsWatchResponse;
  fuzzyFileSearch: FuzzyFileSearchResponse;
  "hooks/list": HooksListResponse;
  "marketplace/add": MarketplaceAddResponse;
  "marketplace/remove": MarketplaceRemoveResponse;
  "marketplace/upgrade": MarketplaceUpgradeResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "mcpServer/oauth/login": McpServerOauthLoginResponse;
  "model/list": ModelListResponse;
  "permissionProfile/list": PermissionProfileListResponse;
  "plugin/installed": PluginInstalledResponse;
  "plugin/list": PluginListResponse;
  "plugin/read": PluginReadResponse;
  "plugin/install": PluginInstallResponse;
  "plugin/reconcile": PluginReconcileResponse;
  "plugin/share/save": PluginShareSaveResponse;
  "plugin/share/updateTargets": PluginShareUpdateTargetsResponse;
  "plugin/share/list": PluginShareListResponse;
  "plugin/share/checkout": PluginShareCheckoutResponse;
  "plugin/share/delete": PluginShareDeleteResponse;
  "review/start": ReviewStartResponse;
  "skills/list": SkillsListResponse;
  "thread/list": ThreadListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/revert": ThreadRevertResponse;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/metadata/update": ThreadMetadataUpdateResponse;
  "thread/attachment/list": ThreadAttachmentListResponse;
  "thread/goal/get": ThreadGoalGetResponse;
  "thread/goal/set": ThreadGoalSetResponse;
  "threadSection/list": ThreadSectionListResponse;
  "threadSection/create": ThreadSectionCreateResponse;
  "turn/start": TurnStartResponse;
  "windowsSandbox/readiness": WindowsSandboxReadinessResponse;
  "windowsSandbox/setupStart": WindowsSandboxSetupStartResponse;
}

const rpc = new Rpc({
  open: (hello) => void onOpen(hello),
  close: onClose,
  notification: onNotification,
  request: onServerRequest,
  desktop: async (request, signal) => (await import("../components/DesktopTools")).displayRequest(request, signal),
  delivered: (requestId) => receiptDelivered(requestId),
});

type Result<M extends Method> = M extends keyof Responses ? Responses[M] : unknown;

export function call<M extends Method>(method: M, params: ParamsOf<M>): Promise<Result<M>> {
  return rpc.request<Result<M>>(method, params);
}

/** The bridge connection this page's /api calls name (null while disconnected). */
export const connectionId = () => rpc.connection;

/** Experimental methods are absent from the stable generated union. */
export function callExperimental<R>(method: string, params: unknown): Promise<R> {
  return rpc.request<R>(method as Method, params);
}

/** The repository `cwd` is in, null outside one, undefined when it could not be asked. */
export const gitRoot = (cwd: string): Promise<string | null | undefined> =>
  callExperimental<{ root: string | null }>("codexUi/git/branches", { cwd }).then((info) => info.root, () => undefined);

/** Methods this server rejected as unknown, gated or unimplemented; cleared on every connect. */
const missing = new Set<string>();

/** False once the connected server rejected `method` as unknown, gated or unimplemented. */
export function supports(method: string): boolean {
  return !missing.has(method);
}

/** An optional call: null when the server does not have the method (remembered), other errors throw. */
export async function optional<R>(method: string, params: unknown): Promise<R | null> {
  if (missing.has(method)) return null;
  try {
    return await rpc.request<R>(method as Method, params);
  } catch (error) {
    if (!unsupported(error)) throw error;
    missing.add(method);
    return null;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A rejection handler: a warning toast with `title`, the error under it. */
export const fail = (title: string) => (error: unknown) => toast("warning", title, errorMessage(error));

// ---------------------------------------------------------------------------
// Permission presets (mirrors codex-rs/utils/approval-presets)

export const PRESETS: Record<
  PermissionPreset,
  { label: string; description: string; approval: AskForApproval; sandbox: SandboxMode; policy: SandboxPolicy }
> = {
  "read-only": {
    label: "只读",
    description: "可以读取工作区文件；修改文件或访问网络前需要您批准。",
    approval: "on-request",
    sandbox: "read-only",
    policy: { type: "readOnly", networkAccess: false },
  },
  auto: {
    label: "自动",
    description: "可以在工作区内读写文件、运行命令；访问网络或修改工作区外的文件前需要批准。",
    approval: "on-request",
    sandbox: "workspace-write",
    policy: {
      type: "workspaceWrite",
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  },
  "full-access": {
    label: "绕过权限",
    description: "无需批准即可修改任意文件并访问网络。请谨慎使用。",
    approval: "never",
    sandbox: "danger-full-access",
    policy: { type: "dangerFullAccess" },
  },
};

export function presetOf(approval: AskForApproval | null | undefined, sandbox: SandboxPolicy | SandboxMode | null | undefined): PermissionPreset | null {
  const kind = typeof sandbox === "string" ? sandbox : sandbox?.type;
  if (kind === "dangerFullAccess" || kind === "danger-full-access") return approval === "never" ? "full-access" : null;
  if (kind === "workspaceWrite" || kind === "workspace-write") return "auto";
  if (kind === "readOnly" || kind === "read-only") return "read-only";
  return null;
}

/**
 * Managed requirements may forbid some approval policies or sandbox modes; null lists allow all.
 * Full access also waits for Settings → Codex → 允许绕过权限模式 (c71860c77 bypassPermissions opt-in).
 */
export function presetAllowed(preset: PermissionPreset): boolean {
  const { requirements, allowFullAccess } = getState();
  if (preset === "full-access" && !allowFullAccess) return false;
  const { approval, sandbox } = PRESETS[preset];
  const approvals = requirements?.allowedApprovalPolicies;
  const sandboxes = requirements?.allowedSandboxModes;
  return (!approvals || approvals.includes(approval)) && (!sandboxes || sandboxes.includes(sandbox));
}

export function defaultModel(models: Model[]): Model | undefined {
  return models.find((model) => model.isDefault) ?? models[0];
}

export function modelLabel(id: string | null | undefined): string {
  if (!id) return "默认模型";
  const { models, hiddenModels } = getState();
  return [...models, ...hiddenModels].find((model) => model.id === id || model.model === id)?.displayName ?? id;
}

/** Fast mode is offered when the feature is on and the model has the priority tier. */
export function fastAvailable(modelId: string | null | undefined): boolean {
  if (!featureEnabled("fast_mode")) return false;
  const { models, hiddenModels } = getState();
  const model = [...models, ...hiddenModels].find((m) => m.id === modelId || m.model === modelId);
  return !!model && (model.serviceTiers.some((tier) => tier.id === "priority") || model.additionalSpeedTiers.includes("fast"));
}

/** Auto-review needs the guardian feature and requirements that allow it. */
export function autoReviewAvailable(): boolean {
  // An experimental field, absent from the stable schema.
  const allowed = (getState().requirements as { allowedApprovalsReviewers?: string[] | null } | null)?.allowedApprovalsReviewers;
  return featureEnabled("guardian_approval") && (!allowed || allowed.includes("auto_review") || allowed.includes("guardian_subagent"));
}

const tierPick = (tier: string | null | undefined): ServiceTierPick | null =>
  tier === "priority" || tier === "fast" ? "priority" : tier === "default" ? "default" : null;
const reviewerOf = (value: string | null | undefined): Reviewer | null =>
  value === "auto_review" || value === "guardian_subagent" ? "auto_review" : value === "user" ? "user" : null;

/** Built-in profiles (":read-only", ":workspace", ":danger-full-access") are what the presets select. */
const customProfile = (id: string | null | undefined): string | null => (id && !id.startsWith(":") ? id : null);
/** activePermissionProfile is an experimental response field, absent from the stable schema. */
const activeProfileOf = (value: unknown): string | null =>
  (value as { activePermissionProfile?: { id: string } | null }).activePermissionProfile?.id ?? null;

/**
 * Model / effort / preset / custom permissions profile / speed / reviewer the composer should
 * show for a thread or the new-chat screen. A custom profile wins over the preset (permission
 * is then null); picking a preset clears the profile.
 */
export function effectiveSettings(thread: ThreadState | null) {
  const { prefs, config, models } = getState();
  const configTier = tierPick(config?.service_tier) ?? "default";
  const configReviewer = reviewerOf(config?.approvals_reviewer) ?? "user";
  if (!thread) {
    const model = prefs.model ?? config?.model ?? defaultModel(models)?.id ?? null;
    const configProfile = customProfile((config as { default_permissions?: string | null } | null)?.default_permissions);
    const permissionProfile = prefs.permission ? null : (prefs.permissionProfile ?? configProfile);
    return {
      model,
      effort: prefs.effort ?? config?.model_reasoning_effort ?? models.find((m) => m.id === model)?.defaultReasoningEffort ?? null,
      permission: permissionProfile ? null : (prefs.permission ?? presetOf(config?.approval_policy, config?.sandbox_mode)),
      permissionProfile,
      planMode: prefs.planMode,
      serviceTier: prefs.serviceTier ?? configTier,
      reviewer: prefs.reviewer ?? configReviewer,
    };
  }
  const settings = thread.settings;
  const model = thread.overrides.model ?? settings?.model ?? thread.meta.model;
  const { overrides } = thread;
  const permissionProfile = overrides.permission
    ? null
    : overrides.permissionProfile !== undefined
      ? overrides.permissionProfile
      : customProfile(settings?.permissionProfile);
  return {
    model,
    effort:
      thread.overrides.effort ??
      settings?.effort ??
      thread.meta.reasoningEffort ??
      models.find((m) => m.id === model)?.defaultReasoningEffort ??
      null,
    permission: permissionProfile ? null : (overrides.permission ?? presetOf(settings?.approvalPolicy, settings?.sandbox)),
    permissionProfile,
    planMode: thread.planMode,
    serviceTier: thread.overrides.serviceTier ?? tierPick(settings?.serviceTier) ?? (settings ? "default" : configTier),
    reviewer: thread.overrides.reviewer ?? settings?.approvalsReviewer ?? configReviewer,
  };
}

export function activeTurn(thread: ThreadState | undefined): TurnState | undefined {
  return thread?.turns.findLast((turn) => turn.status === "inProgress");
}

/**
 * Whether a message sent now can steer the running turn: the server refuses review and
 * compaction turns (core/src/session/turn_input.rs), so those queue instead.
 */
export function canSteer(thread: ThreadState | undefined): boolean {
  const turn = activeTurn(thread);
  if (!turn || turn.steerable === false) return false;
  let reviewing = false;
  for (const item of turn.items) {
    if (item.type === "enteredReviewMode") reviewing = true;
    else if (item.type === "exitedReviewMode") reviewing = false;
  }
  return !reviewing && !(turn.items.length > 0 && turn.items.every((item) => item.type === "contextCompaction"));
}

// ---------------------------------------------------------------------------
// Connection lifecycle

// Notifications the UI never reads; app/list/updated alone is 6.7 MB.
const OPT_OUT = ["item/fileChange/outputDelta", "item/commandExecution/terminalInteraction", "thread/compacted", "turn/moderationMetadata", "rawResponseItem/completed", "rawResponse/completed", "app/list/updated", "guardianWarning"];
// Automatic reconnects (lzaSYO3Q xJn / SJn / CJn): right away, after 15s, then every 30s, ±20%,
// while the next one starts within 180s of the first failure.
const RETRY_DELAYS = [0, 15_000, 30_000];
const RETRY_WINDOW_MS = 180_000;
// lzaSYO3Q $Jn / TJn: focusing or showing the window retries early, at most every 10s.
const EARLY_RETRY_MS = 10_000;
// lzaSYO3Q dJn / fJn: an app-server exit is restarted quietly three times, the next one shows
// 反复崩溃 without automatic retries; the count starts over after 5 minutes without an exit.
const QUIET_RESTARTS = 3;
const EXIT_GAP_MS = 300_000;
// No answer to initialize within a minute drops the connection, which onClose then retries.
const INIT_TIMEOUT_MS = 60_000;
let retryAttempt = 0;
let failingSince = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastRetry = 0;
let restarts = 0;
let lastExit = 0;

/** Connect now and restart the automatic retry window (startup, or 重新加载). */
export function connect(): void {
  retryAttempt = 0;
  failingSince = 0;
  lastRetry = Date.now();
  reconnect();
}

function reconnect(): void {
  clearTimeout(retryTimer);
  setState((s) => ({ conn: { status: "connecting", kind: s.conn.kind, silent: s.conn.silent } }));
  void rpc.connect();
}

/** The window came back while the connection is down: retry now rather than wait for the timer. */
function retryEarly(): void {
  const { conn } = getState();
  if (conn.status !== "closed" || conn.kind !== "network" || Date.now() - lastRetry < EARLY_RETRY_MS) return;
  lastRetry = Date.now();
  reconnect();
}

if (typeof window !== "undefined") {
  window.addEventListener("focus", retryEarly);
  window.addEventListener("focus", () => {
    const { activeId, conn } = getState();
    if (activeId && conn.status === "ready") void refreshThreadGit(activeId, true);
    refreshVisibleBackground();
    void refreshAccountProfile();
  });
  window.addEventListener("online", () => void refreshAccountProfile());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { retryEarly(); refreshVisibleBackground(); void refreshAccountProfile(); }
    else stopBackgroundCheck();
  });
}

// The connection's first account, models, config, features, modes, requirements and projects reads (onOpen).
let reads: Promise<void> = Promise.resolve();
let readsDone = false;
/** Whether they are in: a scheduled run started before them would miss the user's config and settings. */
export const readsSettled = () => readsDone;
/** Settles with them (or with the last connection's, which readsSettled then tells apart). */
export const whenReadsSettled = () => reads;

async function onOpen(hello: Hello): Promise<void> {
  missing.clear();
  gitSnapshots.clear();
  setState((s) => ({
    server: { ...s.server, cwd: hello.cwd, command: hello.command, experimental: hello.experimentalBackend === true },
    // No folder unless one was asked for: 本电脑 then starts each session in a scratch workspace (startThread).
    prefs: { ...s.prefs, cwd: s.prefs.cwd || hello.folder || "" },
  }));
  const stalled = setTimeout(() => rpc.disconnect(), INIT_TIMEOUT_MS);
  try {
    const info = await call("initialize", {
      clientInfo: { name: "codex_ui", title: "Codex UI", version: VERSION },
      // openai/form: MCP servers may send form elicitations (Approvals.tsx renders the form); the
      // legacy flag stays for servers older than `extensions`.
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        extensions: { "openai/form": {} },
        mcpServerOpenaiFormElicitation: true,
        optOutNotificationMethods: OPT_OUT,
      },
    });
    rpc.notify("initialized");
    retryAttempt = 0;
    failingSince = 0;
    recheckRuns();
    setState((s) => ({ conn: { status: "ready" }, server: { ...s.server, info, version: parseVersion(info.userAgent) } }));
  } catch (error) {
    // A connection that dropped meanwhile has been through onClose already.
    if (getState().conn.status === "connecting") setState({ conn: { status: "closed", error: `初始化失败：${errorMessage(error)}`, kind: "fatal", retryAt: null } });
    return;
  } finally {
    clearTimeout(stalled);
  }
  // Account/quota and capability refreshes must not hold up the restored conversation.
  const restoringId = getState().activeId;
  const restoringSplit = getState().splitId;
  const connection = rpc.connection;
  readsDone = false;
  // A scheduled run waits for these alone (quotas go through the bridge and may take 15 s).
  reads = Promise.allSettled([
    refreshAccount(),
    refreshModels(),
    refreshConfig(),
    refreshFeatures(),
    loadModes(),
    refreshRequirements(),
    refreshProjects(),
  ]).then(() => { if (connection === rpc.connection) readsDone = true; });
  void Promise.allSettled([refreshSections(), refreshRemoteControl(), refreshPermissionProfiles(), refreshProviderQuotas()]);
  await refreshThreads();
  if (restoringId && getState().activeId === restoringId) await openThread(restoringId, true);
  if (restoringSplit && getState().splitId === restoringSplit) await loadThread(restoringSplit);
}

function onClose(reason: string, detail?: string, kind: ConnKind = "network"): void {
  readsDone = false;
  hostContextGeneration++;
  hostContextPending.clear();
  for (const terminal of terminals.values()) terminal.onExit(-1);
  terminals.clear();
  watchers.clear();
  stopBackgroundCheck();
  backgroundReads.clear();
  resetVoice();
  let retryAt: number | null = null;
  let silent = false;
  let crashed = false;
  if (kind === "exited") {
    const now = Date.now();
    if (now - lastExit > EXIT_GAP_MS) restarts = 0;
    lastExit = now;
    crashed = restarts >= QUIET_RESTARTS;
    if (!crashed) {
      restarts++;
      silent = true;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(reconnect, 0);
    }
  } else if (kind === "network") {
    failingSince ||= Date.now();
    const delay = Math.round(RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)] * (0.8 + Math.random() * 0.4));
    if (Date.now() + delay - failingSince < RETRY_WINDOW_MS) {
      retryAttempt++;
      retryAt = Date.now() + delay;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(reconnect, delay);
    }
  }
  for (const job of namingJobs.values()) job.abort();
  namingJobs.clear();
  profileRequest?.abort();
  profileRequest = undefined;
  clearTimeout(profileRetry);
  accountRevision++;
  setState((s) => ({
    conn: { status: "closed", error: reason, detail, kind, retryAt, silent, crashed },
    pendingMessages: Object.fromEntries(Object.entries(s.pendingMessages).map(([id, pending]) => [id, pending && { ...pending, error: pending.error ?? "连接中断，发送状态未确认。请检查会话后重试，以免重复发送。" }])),
    requests: [],
    accountProfile: null,
    threads: Object.fromEntries(Object.entries(s.threads).map(([id, t]) => [id, { ...t, subscribed: false, background: [] }])),
  }));
}

// ---------------------------------------------------------------------------
// Account, models, config

let accountRevision = 0;
let readingAccount = false;
let profileRequest: AbortController | undefined;
let profileRetry: ReturnType<typeof setTimeout> | undefined;

export async function refreshAccount(): Promise<void> {
  const revision = ++accountRevision;
  readingAccount = true;
  const connection = rpc.connection;
  profileRequest?.abort();
  profileRequest = undefined;
  clearTimeout(profileRetry);
  setState({ accountProfile: null });
  try {
    const account = await call("account/read", { refreshToken: false });
    if (revision !== accountRevision || connection !== rpc.connection) return;
    readingAccount = false;
    setState({ account });
    if (account.account) void refreshRateLimits();
    void refreshAccountProfile();
  } catch (error) {
    toast("warning", "读取账户信息失败", errorMessage(error));
  } finally {
    if (revision === accountRevision) readingAccount = false;
  }
}

/** Retry transient startup failures, then wait for focus, connectivity or the account menu. */
export async function refreshAccountProfile(attempt = 0): Promise<void> {
  const { account, accountProfile, conn } = getState();
  const connection = rpc.connection;
  if (readingAccount || profileRequest || accountProfile || conn.status !== "ready" || account?.account?.type !== "chatgpt" || !connection) return;
  clearTimeout(profileRetry);
  const revision = accountRevision;
  const abort = new AbortController();
  profileRequest = abort;
  const current = () => !abort.signal.aborted && revision === accountRevision && connection === rpc.connection;
  try {
    const response = await fetch(`/api/account/profile?c=${encodeURIComponent(connection)}`, { signal: abort.signal });
    const { profile } = response.ok ? await response.json() : { profile: null };
    if (current()) setState({ accountProfile: profile });
  } catch {
    // A cosmetic request must not interrupt sign-in or conversation restoration.
  } finally {
    if (profileRequest === abort) profileRequest = undefined;
    if (current() && !getState().accountProfile && attempt < 2) {
      profileRetry = setTimeout(() => void refreshAccountProfile(attempt + 1), attempt === 0 ? 1000 : 5000);
    }
  }
}

export async function refreshRateLimits(): Promise<void> {
  try {
    setState({ rateLimits: await call("account/rateLimits/read", undefined as never) });
    readCredits();
  } catch {
    // Not every provider reports rate limits.
  }
}

const BALANCE_TRACKS = "codex-ui:balance-tracks";

/** Where each balance bar counts spending from, kept across restarts (meterBalances). */
function balanceTracks(): BalanceTracks {
  return (readJson(BALANCE_TRACKS) ?? {}) as BalanceTracks;
}

/** Meter the ChatGPT account's credits (meterCredits) after each rate-limit read or update. */
function readCredits(): void {
  const { rateLimits, account } = getState();
  const owner = rateLimits?.accountId ?? (account?.account?.type === "chatgpt" ? account.account.email : null) ?? "";
  const { credits, tracks } = meterCredits(rateLimits, owner, balanceTracks());
  writePref(BALANCE_TRACKS, JSON.stringify(tracks));
  setState({ chatgptCredits: credits });
}

/**
 * Quota for the models a local opencodex proxy routes to other providers and for the provider
 * cc-switch switched Codex to (Codex's own limits only describe the ChatGPT account), read through
 * the bridge; with neither it stays empty.
 */
export async function refreshProviderQuotas(): Promise<void> {
  try {
    const read = (url: string): Promise<{ reports?: ProviderQuotaReport[]; report?: ProviderQuotaReport | null }> =>
      fetch(url).then((response) => (response.ok ? response.json() : {}));
    const [opencodex, ccSwitch] = await Promise.all([read("/api/opencodex/quotas"), read("/api/ccswitch/quota")]);
    const all: ProviderQuotaReport[] = [...(opencodex.reports ?? []), ...(ccSwitch.report ? [ccSwitch.report] : [])];
    const { reports, tracks } = meterBalances(all, balanceTracks());
    writePref(BALANCE_TRACKS, JSON.stringify(tracks));
    setState({ providerQuotas: reports });
  } catch {
    // The bridge is unreachable; the connection banner says so.
  }
}

// A balance only shows the net change between two reads, so a top-up hides whatever was spent
// since the last one (meterBalances). While the page is open, read every 5½ minutes: just past
// opencodex's 5-minute report cache, so each read is fresh (every 5 would hit the cache every
// other time).
if (typeof window !== "undefined") setInterval(() => void refreshProviderQuotas(), 330_000);

// A window past its reset keeps its old usage until something re-reads it, and with no turn
// running nothing does (the TUI polls every minute instead): re-read once one passes, then at
// most once a minute while the backend still reports it. A clock check rather than a timer set
// for the reset, so a sleep across it is caught on wake.
let expiredLimitsRead = 0;
export function rereadExpiredLimits(now = Date.now()): void {
  const limits = getState().rateLimits;
  if (!limits || now - expiredLimitsRead < 60_000) return;
  const snapshots = [limits.rateLimits, ...Object.values(limits.rateLimitsByLimitId ?? {})];
  if (!snapshots.some((s) => [s?.primary, s?.secondary].some((w) => w?.resetsAt && w.resetsAt * 1000 <= now))) return;
  expiredLimitsRead = now;
  void refreshRateLimits();
}
if (typeof window !== "undefined") setInterval(() => rereadExpiredLimits(), 15_000);

/** Redeem one rate-limit reset credit (the backend picks one when creditId is omitted). */
export async function consumeRateLimitResetCredit(creditId?: string): Promise<ConsumeAccountRateLimitResetCreditOutcome> {
  const { outcome } = await call("account/rateLimitResetCredit/consume", { idempotencyKey: crypto.randomUUID(), creditId: creditId ?? null });
  await refreshRateLimits();
  return outcome;
}

/** A workspace member out of credits or usage asks the owner for more (the usage popover's 请求更多). */
export async function requestMoreUsage(creditType: AddCreditsNudgeCreditType): Promise<AddCreditsNudgeEmailStatus> {
  return (await call("account/sendAddCreditsNudgeEmail", { creditType })).status;
}

export async function loginChatGpt(deviceCode: boolean): Promise<void> {
  const response = await call("account/login/start", deviceCode ? { type: "chatgptDeviceCode" } : { type: "chatgpt" });
  if (response.type === "chatgpt") {
    setState({ login: { loginId: response.loginId, kind: "chatgpt", authUrl: response.authUrl } });
    window.open(response.authUrl, "_blank", "noopener");
  } else if (response.type === "chatgptDeviceCode") {
    setState({
      login: {
        loginId: response.loginId,
        kind: "chatgptDeviceCode",
        verificationUrl: response.verificationUrl,
        userCode: response.userCode,
      },
    });
  }
}

export async function loginApiKey(apiKey: string): Promise<void> {
  await call("account/login/start", { type: "apiKey", apiKey });
  await refreshAccount();
}

export async function cancelLogin(): Promise<void> {
  const login = getState().login;
  setState({ login: null });
  if (login) await call("account/login/cancel", { loginId: login.loginId }).catch(() => {});
}

export async function logout(): Promise<void> {
  await call("account/logout", undefined as never);
  setState({ rateLimits: null, chatgptCredits: null, accountProfile: null });
  await refreshAccount();
}

/** One catalog pass with hidden models; the auto-review model is not a chat model. */
async function refreshModels(): Promise<void> {
  const all: Model[] = [];
  let cursor: string | null = null;
  try {
    do {
      const page: ModelListResponse = await call("model/list", { cursor, limit: 100, includeHidden: true });
      all.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    const models = all.filter((model) => !model.hidden);
    setState((s) => ({
      models,
      hiddenModels: all.filter((model) => model.hidden && !model.id.startsWith("codex-auto-review")),
      prefs: offeredPicks(s.prefs, models),
    }));
  } catch (error) {
    toast("warning", "读取模型列表失败", errorMessage(error));
  }
}

async function loadModes(): Promise<void> {
  const response = await optional<{ data: CollaborationModeMask[] }>("collaborationMode/list", {}).catch(() => null);
  setState({ modes: response?.data ?? [] });
}

export async function refreshFeatures(): Promise<void> {
  try {
    const response = await call("experimentalFeature/list", { limit: 200 });
    setState({ features: response.data });
  } catch {
    // Older servers have no feature registry; the Labs tab then stays empty.
  }
}

export async function setFeature(name: string, enabled: boolean): Promise<void> {
  await call("experimentalFeature/enablement/set", { enablement: { [name]: enabled } });
  setState((s) => ({ features: s.features.map((f) => (f.name === name ? { ...f, enabled } : f)) }));
}

export function featureEnabled(name: string): boolean {
  return getState().features.some((feature) => feature.name === name && feature.enabled);
}

export async function readUsage(): Promise<GetAccountTokenUsageResponse> {
  return call("account/usage/read", {});
}

/** `quiet`: no toast when it fails (the scheduler's retry). */
export async function refreshConfig(quiet = false): Promise<void> {
  try {
    const response = await call("config/read", { includeLayers: false, cwd: getState().prefs.cwd || null });
    setState({ config: response.config, configOrigins: response.origins });
  } catch (error) {
    if (!quiet) toast("warning", "读取配置失败", errorMessage(error));
  }
}

export async function writeConfig(edits: ConfigBatchWriteParams["edits"]): Promise<void> {
  await call("config/batchWrite", { edits, reloadUserConfig: true });
  await refreshConfig();
}

export async function refreshRequirements(): Promise<void> {
  try {
    setState({ requirements: (await call("configRequirements/read", undefined)).requirements });
  } catch {
    setState({ requirements: null });
  }
}

/**
 * Custom permission profiles (beyond the built-in :read-only / :workspace / :danger-full-access)
 * into state.permissionProfiles; the composer lists them only when non-empty.
 */
export async function refreshPermissionProfiles(cwd = getState().prefs.cwd): Promise<void> {
  const profiles = await call("permissionProfile/list", { cwd: cwd || null }).then((response) => response.data, (): PermissionProfileSummary[] => []);
  setState({ permissionProfiles: profiles.filter((profile) => profile.allowed && customProfile(profile.id)) });
}

/**
 * Upload feedback about a turn. The logs option also sends the session file, so the UI must
 * say that both go to OpenAI.
 */
export async function uploadFeedback(o: {
  threadId: string;
  turnId?: string | null;
  good: boolean | null;
  category?: "bug" | "safety_check" | "other";
  reason?: string;
  includeLogs: boolean;
}): Promise<void> {
  const path = getState().threads[o.threadId]?.meta.path ?? null;
  await call("feedback/upload", {
    classification: o.good === true ? "good_result" : o.good === false ? "bad_result" : (o.category ?? "other"),
    reason: o.reason?.trim() || null,
    threadId: o.threadId,
    includeLogs: o.includeLogs,
    extraLogFiles: o.includeLogs && path ? [path] : null,
    tags: o.turnId ? { turn_id: o.turnId } : null,
  });
}

/** Process diagnostics for the About card (experimental). */
export interface ServerDiagnostics {
  process: { id: number; residentMemoryBytes: number | null };
  gauges: { name: string; value: number }[];
}

export async function serverDiagnostics(): Promise<ServerDiagnostics | null> {
  return optional<ServerDiagnostics>("server/diagnostics", {}).catch(() => null);
}

// ---------------------------------------------------------------------------
// Thread list

// Sub-agent threads spawned by a thread join the list so the sidebar can nest them.
// ponytail: explicit kinds drop Custom("atlas"/"chatgpt") sources (no ThreadSourceKind selects them).
const LIST_SOURCES: ThreadSourceKind[] = ["cli", "vscode", "subAgentThreadSpawn"];

function mergeMeta(previous: Thread, next: Thread, cwd = next.cwd): Thread {
  // Early notifications carry an empty preview; keep the one shown optimistically. thread/list
  // leaves threadSource null where thread/start and thread/resume name it ("automation"). A thread
  // the server has not loaded lists `environments: null` too (thread_from_stored_thread; the list
  // only enriches loaded ones): that is no news, so the selection its resume reported stays, which
  // an unloaded thread cannot change. An empty list is a selection.
  const environments = (next as WithEnvironments).environments ?? (previous as WithEnvironments).environments;
  return { ...withLineage(liveGitMeta({ ...previous, ...next, ...(environments !== undefined && { environments }) }, cwd)), preview: next.preview || previous.preview, threadSource: next.threadSource ?? previous.threadSource, turns: [] };
}

/** readStates: null/undefined = the server has none; a missing entry = that thread is ineligible. */
function rememberThreads(threads: Thread[], current = getState().threads, readStates?: Record<string, ThreadReadState | undefined> | null): Record<string, ThreadState> {
  const merged = { ...current };
  for (const thread of threads) {
    const base = merged[thread.id] ? { ...merged[thread.id], meta: mergeMeta(merged[thread.id].meta, thread, merged[thread.id].settings?.cwd ?? thread.cwd) } : emptyThreadState(liveGitMeta(thread));
    if (base.agentTurn && thread.status?.type === "active") base.agentTurn = undefined;
    // A cron session's receipt always reads as read: an unread run keeps it unread (automations.ts markUnreadRuns).
    const runUnread = readStates && hasUnreadRun(thread.id) && !isShown(getState(), thread.id);
    merged[thread.id] = runUnread ? { ...base, readState: null, unread: true } : readStates ? { ...base, readState: readStates[thread.id] ?? null } : base;
  }
  return merged;
}

const readStatesOf = (response: ThreadListResponse) => (response as ThreadListResponse & { readStates?: Record<string, ThreadReadState | undefined> | null }).readStates;

/** Title search over every session (the search dialog); the list itself is not filtered. */
export async function searchThreads(term: string, archived = false, limit = 25): Promise<Thread[]> {
  const response = await call("thread/list", { limit, sortKey: "recency_at", searchTerm: term || undefined, sourceKinds: LIST_SOURCES, archived });
  for (const thread of response.data) archived ? archivedIds.add(thread.id) : archivedIds.delete(thread.id);
  setState((s) => ({ threads: rememberThreads(response.data, s.threads, readStatesOf(response)) }));
  return response.data;
}

/** Content search with a snippet per thread (thread/search); falls back to title search. */
export async function searchThreadContent(term: string, archived = false): Promise<{ thread: Thread; snippet: string | null }[]> {
  const response = await optional<{ data: ThreadSearchResult[] }>("thread/search", { searchTerm: term, limit: 25, sortKey: "recency_at", archived });
  if (!response) return (await searchThreads(term, archived)).map((thread) => ({ thread, snippet: null }));
  for (const { thread } of response.data) archived ? archivedIds.add(thread.id) : archivedIds.delete(thread.id);
  setState((s) => ({ threads: rememberThreads(response.data.map((r) => r.thread), s.threads) }));
  return response.data;
}

/** Sessions the list read from the archive (Filter ▸ Status Archived or All). */
const archivedIds = new Set<string>();

export function isArchivedThread(id: string): boolean {
  return archivedIds.has(id);
}

/**
 * Sessions joining the list as they appear, and the sub-agents a session spawned joining the store
 * (for their rows, tasks and records: Claude's list has no subagents). No thread/started announces
 * a spawned sub-agent and thread/list leaves out sessions with no preview (every MultiAgentV2
 * sub-agent), so those come by id or by ancestor.
 */
function joinList(threads: Thread[], archived = false): void {
  if (!threads.length) return;
  for (const thread of threads) {
    if (archived) archivedIds.add(thread.id);
    else archivedIds.delete(thread.id);
  }
  setState((s) => {
    const shown = s.list.status === "all" || s.list.archived === archived;
    const fresh = shown ? threads.filter((t) => !t.ephemeral && !t.parentThreadId && !spawnOf(t) && !s.list.ids.includes(t.id)).map((t) => t.id) : [];
    return { threads: rememberThreads(threads, s.threads), list: fresh.length ? { ...s.list, ids: [...fresh, ...s.list.ids] } : s.list };
  });
}

/** The sub-agents under a session at any depth, on one side of the archive (Codex's listDescendantThreads). */
async function descendantsOf(id: string, archived: boolean): Promise<Thread[]> {
  // ancestorThreadId is experimental, so the stable params type lacks it.
  const threads: Thread[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: ThreadListResponse | null = await callExperimental<ThreadListResponse>("thread/list", { ancestorThreadId: id, sourceKinds: ["subAgentThreadSpawn"], archived, useStateDbOnly: true, limit: 100, cursor }).catch(() => null);
    if (!page?.data) break;
    threads.push(...page.data);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) break;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return threads;
}

/** Lists a session's sub-agents under it. */
async function loadDescendants(id: string): Promise<void> {
  const archived = isArchivedThread(id);
  const threads = await descendantsOf(id, archived);
  joinList(threads, archived);
  await loadAgentHistory(threads);
}

/** Old agents are notLoaded after restart; their last turn still records how the task ended. */
async function loadAgentHistory(threads: Thread[]): Promise<void> {
  await Promise.all(threads.map(async (meta) => {
    const thread = getState().threads[meta.id];
    if (!thread || thread.meta.status?.type === "active" || (thread.agentTurn && thread.agentTurn.updatedAt === meta.updatedAt)) return;
    const response = await call("thread/turns/list", { threadId: meta.id, limit: 1, sortDirection: "desc", itemsView: "notLoaded" }).catch(() => null);
    if (!response?.data) return;
    updateThread(meta.id, (t) => t.meta.updatedAt !== meta.updatedAt || t.meta.status?.type === "active" ? t
      : { ...t, agentTurn: { id: response.data[0]?.id, updatedAt: meta.updatedAt, status: response.data[0]?.status ?? null } });
  }));
}

/**
 * Sub-agents a session just spawned: read them in and list them under it (Codex's discoverForSpawn).
 * Codex writes a sub-agent's rollout once it has the folder's git info and thread/read fails on the
 * empty file until then, so one that cannot be read yet is read again a little later.
 */
async function joinSpawned(ids: string[], archived = false): Promise<void> {
  // ponytail: three reads over 3s (Codex's discovery retries once after 1s); a slower git leaves it to loadDescendants.
  let missing = ids;
  for (const wait of [0, 1000, 2000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    await ensureThreads(missing);
    const { threads } = getState();
    const found = missing.flatMap((id) => (threads[id] ? [threads[id].meta] : []));
    joinList(found, archived);
    await loadAgentHistory(found);
    missing = missing.filter((id) => !threads[id]);
    if (!missing.length) return;
  }
}

export async function refreshThreads(more = false): Promise<void> {
  const { list } = getState();
  if (more && !list.cursor) return;
  setState({ list: { ...list, loading: true } });
  // Status All reads both lists; its cursor carries the two pages' cursors.
  const archive = list.status === "all" ? [false, true] : [list.status === "archived"];
  const cursors: (string | null)[] = !more ? archive.map(() => null) : list.status === "all" ? (JSON.parse(list.cursor ?? "[]") as (string | null)[]) : [list.cursor];
  try {
    const pages = await Promise.all(
      archive.map((archived, index) =>
        more && !cursors[index]
          ? null
          : call("thread/list", {
              cursor: cursors[index] ?? null,
              limit: 40,
              sortKey: list.sort === "created" ? "created_at" : "recency_at",
              archived,
              sourceKinds: LIST_SOURCES,
            }),
      ),
    );
    pages.forEach((page, index) => {
      // Either list says which side a session is on now: one restored elsewhere leaves the set.
      for (const thread of page?.data ?? []) {
        if (archive[index]) archivedIds.add(thread.id);
        else archivedIds.delete(thread.id);
      }
    });
    const next = pages.map((page, index) => (page ? page.nextCursor : (cursors[index] ?? null)));
    const cursor = list.status === "all" ? (next.some(Boolean) ? JSON.stringify(next) : null) : next[0];
    setState((s) => {
      let threads = s.threads;
      for (const page of pages) if (page) threads = rememberThreads(page.data, threads, readStatesOf(page));
      // The page lists v1 sub-agents too (LIST_SOURCES keeps them for the store); the list does not.
      const ids = pages.flatMap((page) => page?.data.flatMap((thread) => (spawnOf(thread) ? [] : [thread.id])) ?? []);
      return {
        threads,
        list: {
          ...s.list,
          ids: more ? [...s.list.ids, ...ids.filter((id) => !s.list.ids.includes(id))] : [...new Set(ids)],
          cursor,
          loading: false,
          error: undefined,
        },
      };
    });
  } catch (error) {
    setState((s) => ({ list: { ...s.list, loading: false, error: errorMessage(error) } }));
    toast("warning", "读取会话列表失败", errorMessage(error));
  }
}

/** The sidebar's Filter ▸ Status and Sort by; the palette's archive switch speaks in `archived`. */
export function setListFilter(filter: Partial<{ archived: boolean; status: StatusFilter; sort: SessionSort }>): void {
  const status = filter.status ?? (filter.archived === undefined ? undefined : filter.archived ? "archived" : "active");
  if (status) writePref("codex-ui:status-filter", status);
  setState((s) => {
    const next = status ?? s.list.status;
    return { list: { ...s.list, ...(filter.sort ? { sort: filter.sort } : {}), status: next, archived: next === "archived", cursor: null } };
  });
  void refreshThreads();
}

/** Loads sessions the list has not paged in (pinned ones, sub-agents); one that cannot be read stays out. */
export async function ensureThreads(ids: string[]): Promise<void> {
  const missing = ids.filter((id) => !getState().threads[id]);
  const results = await Promise.all(missing.map((threadId) => optional<{ thread: Thread }>("thread/read", { threadId }).catch(() => null)));
  const found = results.flatMap((result) => (result ? [result.thread] : []));
  if (found.length) setState((s) => ({ threads: rememberThreads(found, s.threads) }));
}

/** A folder's checkout: its branch, the remote's default branch and how many paths `git status` lists. */
export interface FolderStatus {
  branch: string;
  base: string | null;
  files: number;
}

// Claude shared-11 zd/Rd and GitStatusService: per-folder queries, 5s freshness, focus refresh.
const gitSnapshots = new Map<string, { snapshot?: GitSnapshot; known?: GitSnapshot; pending?: Promise<GitSnapshot>; again?: boolean; at: number }>();

// Native thread.environments is experimental and intentionally absent from the stable TS type.
type WithEnvironments = Thread & { environments?: { environmentId: string }[] | null };

function gitEnvironment(meta: Thread): string {
  const environments = (meta as WithEnvironments).environments;
  if (environments !== undefined) return environments?.[0]?.environmentId ?? "unknown";
  const project = getState().projects.find((project) => project.id === meta.projectId);
  if (meta.projectId && !project) return "unknown";
  const environment = environmentOf(project);
  return environment.kind === "local" ? "local" : `${environment.kind}:${environment.ssh?.connectionId ?? environment.cloud?.environmentId ?? "unknown"}`;
}

/**
 * Where a session runs, as gitEnvironment tells it (a new session: its project's environment);
 * null when that cannot be told. Library files attach to local sessions only: an SSH host cannot
 * read this machine's files and a cloud task takes text.
 */
export function environmentKind(threadId: string | null): EnvironmentKind | null {
  const { threads, projects, prefs } = getState();
  if (threadId === null) return environmentOf(projects.find((project) => project.id === prefs.projectId)).kind;
  const meta = threads[threadId]?.meta;
  if (!meta) return null;
  const id = gitEnvironment(meta);
  // An SSH session's environments echo the id it started with (sshEnvironmentId); "ssh:" is the
  // project's fallback when a thread carries none.
  return id === "local" ? "local" : id.startsWith("codexui-ssh-") || id.startsWith("ssh:") ? "ssh" : id.startsWith("cloud:") ? "cloud" : null;
}

const gitSnapshotKey = (cwd: string, environmentId: string) => JSON.stringify([environmentId, cwd]);

function liveGitMeta(meta: Thread, cwd = meta.cwd): Thread {
  const environmentId = gitEnvironment(meta);
  if (environmentId !== "local") return { ...meta, gitInfo: null };
  const snapshot = gitSnapshots.get(gitSnapshotKey(cwd, environmentId))?.known;
  return snapshot ? { ...meta, gitInfo: snapshot.info } : cwd !== meta.cwd ? { ...meta, gitInfo: null } : meta;
}

async function folderGit(cwd: string, force = false, environmentId = "local"): Promise<GitSnapshot> {
  const key = gitSnapshotKey(cwd, environmentId);
  let entry = gitSnapshots.get(key);
  if (entry?.pending) { if (force) entry.again = true; return entry.pending; }
  if (!force && entry?.snapshot && Date.now() - entry.at < 5000) return entry.snapshot;
  entry ??= { at: 0 };
  gitSnapshots.set(key, entry);
  const current = entry;
  current.pending = readGitSnapshot(cwd, (params) => optional<CommandExecResponse>("command/exec", params), environmentId).then((snapshot) => {
    // A reconnect discards reads from the old server.
    if (gitSnapshots.get(key) !== current) return snapshot;
    current.pending = undefined;
    // A change during the probe invalidates its result, just like Claude's GitState subscription.
    if (current.again) { current.again = false; return folderGit(cwd, true, environmentId); }
    current.snapshot = snapshot;
    current.at = Date.now();
    if (snapshot.state !== "unavailable") current.known = snapshot;
    if (snapshot.state !== "unavailable") setState((s) => ({ threads: Object.fromEntries(Object.entries(s.threads).map(([id, thread]) =>
      [id, threadCwd(thread) === cwd && gitEnvironment(thread.meta) === environmentId ? { ...thread, meta: { ...thread.meta, gitInfo: snapshot.info } } : thread],
    )) }));
    return snapshot;
  });
  return current.pending;
}

/** The folder a session works in: 更改文件夹… while it is on its way, else the server's. */
export const threadCwd = (thread: ThreadState): string => thread.overrides.cwd ?? thread.settings?.cwd ?? thread.meta.cwd;

export async function refreshThreadGit(id: string, force = false): Promise<GitSnapshot | null> {
  const thread = getState().threads[id];
  const cwd = thread && threadCwd(thread);
  if (!cwd) return null;
  const environmentId = gitEnvironment(thread.meta);
  const snapshot = await folderGit(cwd, force, environmentId);
  const current = getState().threads[id];
  if (!current) return null;
  return threadCwd(current) !== cwd || gitEnvironment(current.meta) !== environmentId ? refreshThreadGit(id, force) : snapshot;
}

/** A local folder's branch and origin (the 环境 card's other folders), as a session's are read. */
export const folderGitInfo = (cwd: string) => folderGit(cwd).then((snapshot) => snapshot.info);

export async function folderStatus(cwd: string, force = false): Promise<FolderStatus | null> {
  const snapshot = await folderGit(cwd, force);
  return snapshot.info?.branch && snapshot.files !== null ? { branch: snapshot.info.branch, base: snapshot.base, files: snapshot.files } : null;
}

/** Dictation: the bridge has ChatGPT transcribe a recording under this session's login (server/bridge.mjs). */
export async function transcribe(clip: Blob): Promise<string> {
  const id = rpc.connection;
  if (!id) throw new Error("未连接到 app-server");
  const response = await fetch(`/api/transcribe?c=${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": clip.type || "audio/webm" }, body: clip });
  if (!response.ok) throw new Error((await response.text()) || `无法转录音频（${response.status}）`);
  return ((await response.json()) as { text: string }).text;
}

/**
 * The new-session page's own list (the start card reads every session, cc43287c9 P3, not the
 * sidebar's page or filter): the 50 most recent unarchived sessions. A failure leaves it empty.
 */
export async function refreshLanding(): Promise<void> {
  try {
    const response = await call("thread/list", { limit: 50, sortKey: "recency_at", archived: false, sourceKinds: LIST_SOURCES });
    setState((s) => ({ threads: rememberThreads(response.data, s.threads, readStatesOf(response)), landing: response.data.map((thread) => thread.id) }));
  } catch {
    setState((s) => ({ landing: s.landing ?? [] }));
  }
}

async function writeReadState(threadId: string, type: "read" | "unread"): Promise<void> {
  const readState = getState().threads[threadId]?.readState;
  if (!readState) {
    updateThread(threadId, (t) => ({ ...t, unread: type === "unread" }));
    return;
  }
  if ((type === "read") === (readState.firstUnread === null)) return;
  try {
    const response = await optional<{ readState: ThreadReadState }>("thread/readState/update", {
      threadId,
      expectedRevision: readState.revision,
      operation: { type },
    });
    if (response) updateThread(threadId, (t) => ({ ...t, readState: response.readState, unread: false }));
    else updateThread(threadId, (t) => ({ ...t, readState: null, unread: type === "unread" }));
  } catch (error) {
    // Lost a race with another window: take its receipt instead of retrying blindly.
    const current = readStateConflict(error);
    if (current) updateThread(threadId, (t) => ({ ...t, readState: current }));
  }
}

/** Mark a thread read (also syncs Codex desktop's unread dot on servers with read state). */
export function markRead(threadId: string): Promise<void> {
  noteRead(threadId);
  updateThread(threadId, (t) => ({ ...t, unread: false }));
  return writeReadState(threadId, "read");
}

export function markUnread(threadId: string): Promise<void> {
  return writeReadState(threadId, "unread");
}

// ---------------------------------------------------------------------------
// Sidebar sections (server-owned folders that sync across clients)

export async function refreshSections(): Promise<void> {
  try {
    const sections: ThreadSection[] = [];
    let cursor: string | null = null;
    do {
      const page: ThreadSectionListResponse = await call("threadSection/list", { cursor, limit: 100 });
      sections.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    setState({ sections });
  } catch {
    // Servers without section support simply show date groups.
  }
}

/** Point every loaded thread in `id` at its latest section record, or at none. */
function relinkSection(id: string, section: ThreadSection | null): void {
  setState((s) => ({
    threads: Object.fromEntries(
      Object.entries(s.threads).map(([key, t]) => [key, t.meta.section?.id === id ? { ...t, meta: { ...t.meta, section } } : t]),
    ),
  }));
}

export async function createSection(name: string, color: string | null): Promise<ThreadSection> {
  const { section } = await call("threadSection/create", { name, appearance: color ? { icon: null, color } : null });
  setState((s) => ({ sections: [...s.sections, section] }));
  return section;
}

export async function updateSection(sectionId: string, name: string, color: string | null): Promise<void> {
  const appearance = color ? { icon: null, color } : null;
  await call("threadSection/update", { sectionId, name, appearance });
  const section = { id: sectionId, name, appearance };
  setState((s) => ({ sections: s.sections.map((x) => (x.id === sectionId ? section : x)) }));
  relinkSection(sectionId, section);
}

export async function deleteSection(sectionId: string): Promise<void> {
  await call("threadSection/delete", { sectionId });
  setState((s) => ({ sections: s.sections.filter((x) => x.id !== sectionId) }));
  relinkSection(sectionId, null);
}

export async function moveToSection(threadId: string, sectionId: string | null): Promise<void> {
  await call("thread/section/move", { threadId, sectionId });
  const section = getState().sections.find((x) => x.id === sectionId) ?? null;
  updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, section, sectionEnteredAt: section ? Math.floor(Date.now() / 1000) : null } }));
}

// ---------------------------------------------------------------------------
// Codex projects (named groups of roots, shared with Codex desktop)

export async function refreshProjects(): Promise<void> {
  const response = await optional<{ data: Project[] }>("project/list", { sortKey: "position", limit: 100 }).catch(() => undefined);
  if (response === undefined) return;
  const projects = response?.data ?? [];
  setState((s) => ({ projects, prefs: s.prefs.projectId && !projects.some((project) => project.id === s.prefs.projectId) ? { ...s.prefs, projectId: null } : s.prefs }));
}

/** The project whose root contains `cwd`. */
export function projectFor(cwd: string | null | undefined): Project | undefined {
  if (!cwd) return undefined;
  const target = normalizePath(cwd);
  return getState().projects.find((project) =>
    project.roots.some((root) => {
      const base = normalizePath(root.path);
      return target === base || target.startsWith(`${base}/`);
    }),
  );
}

/** Pick a project for the next new chat: its first root becomes the workspace. */
export function chooseProject(projectId: string | null): void {
  const project = getState().projects.find((p) => p.id === projectId);
  setState((s) => ({ prefs: { ...s.prefs, projectId: project?.id ?? null, cwd: project?.roots[0]?.path ?? s.prefs.cwd } }));
  void refreshConfig();
  void refreshPermissionProfiles();
}

export async function createProject(name: string, roots: string[], idempotencyKey = crypto.randomUUID(), metadata?: Record<string, string>): Promise<Project | null> {
  name = name.trim();
  if (!name) throw new Error("请输入环境名称");
  // Only a local environment needs local folders (an SSH one keeps its host's in the metadata).
  if (!roots.length && environmentOf({ metadata: metadata ?? {} }).kind === "local") throw new Error("请添加至少一个源文件夹");
  const response = await optional<{ project: Project }>("project/create", { name, roots: roots.map((path) => ({ path })), idempotencyKey, ...(metadata && { metadata }) });
  if (response) setState((s) => ({ projects: upsertBy(s.projects, (project) => project.id, response.project) }));
  return response?.project ?? null;
}

/** `metadata` replaces the stored map whole (the server does not merge): pass withEnvironment's. */
export async function updateProject(projectId: string, name: string, roots?: string[], metadata?: Record<string, string>): Promise<void> {
  name = name.trim();
  if (!name) throw new Error("请输入环境名称");
  if (roots && !roots.length && environmentOf({ metadata: metadata ?? {} }).kind === "local") throw new Error("请添加至少一个源文件夹");
  const response = await optional<{ project: Project }>("project/update", { projectId, name, ...(roots && { roots: roots.map((path) => ({ path })) }), ...(metadata && { metadata }) });
  if (response === null) throw new Error("当前 Codex 版本不支持项目");
  setState((s) => ({ projects: s.projects.map((p) => (p.id === projectId ? response.project : p)) }));
}

/** Removes the project record only: its folders and threads stay. */
export async function deleteProject(projectId: string): Promise<void> {
  const response = await optional("project/delete", { projectId });
  if (response === null) throw new Error("当前 Codex 版本不支持项目");
  setState((s) => ({ projects: s.projects.filter((p) => p.id !== projectId), prefs: s.prefs.projectId === projectId ? { ...s.prefs, projectId: null } : s.prefs }));
}

/** Move a thread into a project, or out of every project with null. */
export async function setThreadProject(threadId: string, projectId: string | null): Promise<void> {
  // The server reads null as "unchanged"; an empty string clears the project.
  await callExperimental("thread/metadata/update", { threadId, projectId: projectId ?? "" });
  updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, projectId } }));
}

// ---------------------------------------------------------------------------
// Opening threads and paging history

function settingsFrom(response: ThreadStartResponse | ThreadResumeResponse | ThreadForkResponse): ThreadSettings {
  return {
    model: response.model,
    effort: response.reasoningEffort,
    approvalPolicy: response.approvalPolicy,
    sandbox: response.sandbox,
    cwd: response.cwd,
    serviceTier: response.serviceTier,
    approvalsReviewer: reviewerOf(response.approvalsReviewer),
    permissionProfile: activeProfileOf(response),
  };
}

/**
 * Off the open session onto the draft page, or a page in its place that history keeps as the draft page.
 * ponytail: 返回 from a session opened on the 定时任务 / 自定义 / 图像 / Dots page lands on the draft page, not
 * that page (Claude's goBack is the router's); history entries naming a page would take store.nav
 * entries beyond session ids and Frame.navigate opening them.
 */
function leave(patch: Partial<AppState>): void {
  const { activeId: previous, splitId } = getState();
  recordRoute(previous, null);
  setState({ activeId: null, splitId: null, cloudTaskId: null, imagesOpen: false, dotsOpen: false, customizeRoute: null, scheduledRoute: null, libraryRoute: null, ...patch });
  if (previous) void releaseThread(previous);
  if (splitId) void releaseThread(splitId);
}

// Panes stay per view (state.panes): the draft page shows its own.
export const newChat = (): void => leave({ draftEpoch: getState().draftEpoch + 1 });

/**
 * Split view: `id` beside the focused session (on the left when `left`), loaded without taking
 * focus; with no session open it simply opens. A sub-agent never gets a column of its own.
 */
export async function openSplit(id: string, left = getState().splitLeft): Promise<void> {
  if (!getState().threads[id]) await ensureThreads([id]);
  const thread = getState().threads[id];
  if (!thread || thread.meta.parentThreadId) return void toast("warning", "无法在分屏中打开此会话");
  const { activeId, splitId } = getState();
  if (!activeId) return openThread(id);
  if (id === activeId) return;
  setState({ splitId: id, splitLeft: left });
  if (splitId && splitId !== id) void releaseThread(splitId);
  if (!thread.subscribed || !thread.loaded) await loadThread(id);
}

/** 关闭分栏: `id` leaves its column and the other session fills the window. */
export function closeSplit(id: string): void {
  const { activeId, splitId } = getState();
  if (!splitId || (id !== activeId && id !== splitId)) return;
  setState(id === splitId ? { splitId: null } : { activeId: splitId, splitId: null });
  void releaseThread(id);
}

/** A Codex Cloud task in the main column (components/CloudTask.tsx). */
export const openCloudTask = (id: string): void => leave({ cloudTaskId: id });

/** The ChatGPT Dots page in the main column (components/Dots.tsx). */
export const openDots = (): void => leave({ dotsOpen: true });

/** The 图像 page in the main column (components/Images.tsx). */
export const openImages = (): void => leave({ imagesOpen: true });

/** The 定时任务 page in the main column (components/Scheduled.tsx): its list unless told where. */
export const openScheduled = (route: Partial<ScheduledRoute> = {}): void => leave({ scheduledRoute: { task: null, dialog: null, ...route } });

/** A change inside the open 定时任务 page (a task opened or left, a dialog opened or closed). */
export function patchScheduled(patch: Partial<ScheduledRoute>): void {
  setState((s) => (s.scheduledRoute ? { scheduledRoute: { ...s.scheduledRoute, ...patch } } : {}));
}

/**
 * The 自定义 page in the main column (components/Customize.tsx) on `section`. With no view given it
 * keeps the one the section shows, or opens the section's own (插件: 发现, the rest: 我的); a plugin's or
 * a connector's page and the MCP form request are cleared unless asked for.
 */
export function openCustomize(section: CustomizeSection, options: Partial<Omit<CustomizeRoute, "section">> = {}): void {
  const current = getState().customizeRoute;
  const view = options.view ?? (current?.section === section ? current.view : section === "plugins" ? "discover" : "mine");
  leave({ customizeRoute: { section, view, detail: options.detail ?? null, connector: options.connector ?? null, add: options.add ?? null } });
}

/** A change inside the open 自定义 page (its view, a page closed, a request handled). */
export function patchCustomize(patch: Partial<CustomizeRoute>): void {
  setState((s) => (s.customizeRoute ? { customizeRoute: { ...s.customizeRoute, ...patch } } : {}));
}

/** The 资料库 page in the main column (components/Library.tsx), on the tab it was last left on unless told where. */
export const openLibrary = (route?: LibraryRoute): void => leave({ libraryRoute: route ?? { tab: libraryPrefs().lastTab } });

/** 插件 › 发现, on one plugin's page when given (the composer's 浏览插件, /plugin). */
export const openPlugins = (detail: PluginRef | null = null): void => openCustomize("plugins", { view: "discover", detail });

export async function openThread(id: string, force = false): Promise<void> {
  if (id === getState().splitId && !force) return focusSession(id);
  // A sub-agent's row names a session the store may not have (nothing announces a spawned one,
  // and thread/list leaves out those with no preview); without it the view is the new-session page.
  if (!getState().threads[id]) {
    const from = getState().activeId;
    await ensureThreads([id]);
    if (getState().activeId !== from) return;
    if (!getState().threads[id]) {
      toast("warning", "无法打开此会话");
      return;
    }
  }
  // Claude never opens a sub-agent as a session: its record opens in the 后台任务 pane of the
  // session it runs in (rows, task lists, notifications, history and a restored view alike).
  // A parent that cannot be read leaves the sub-agent to open as before.
  let root = id;
  for (let up = getState().threads[id].meta.parentThreadId, depth = 0; up && depth < 32; up = getState().threads[root]?.meta.parentThreadId, depth++) {
    if (!getState().threads[up]) await ensureThreads([up]);
    if (!getState().threads[up]) break;
    root = up;
  }
  if (root !== id) {
    showAgent(root, id);
    return openThread(root, force);
  }
  const previous = getState().activeId;
  recordRoute(previous, id);
  setState({ activeId: id, cloudTaskId: null, imagesOpen: false, dotsOpen: false, customizeRoute: null, scheduledRoute: null, libraryRoute: null });
  if (previous && previous !== id) void releaseThread(previous);
  // A cron run's session can read as read (the list's receipt) while its run is not.
  noteRead(id);
  const thread = getState().threads[id];
  // The list's receipt may be stale: thread/read gives the current one (null on servers without it).
  if (thread && (thread.unread || thread.readState?.firstUnread)) {
    void optional<{ readState?: ThreadReadState | null }>("thread/read", { threadId: id })
      .catch(() => null)
      .then((response) => {
        if (response?.readState) updateThread(id, (t) => ({ ...t, readState: response.readState ?? t.readState }));
        return markRead(id);
      });
  }
  if (!thread || (thread.subscribed && thread.loaded && !force)) {
    if (thread?.subscribed) { void refreshBackground(id); void refreshThreadGit(id); }
    return;
  }
  return loadThread(id);
}

/**
 * Resumes a session and loads its turns without showing it: openThread's load, and how a message
 * the app sends to a session out of view (自动修复, a linked session's report) reaches it.
 * `unloadAtOnce`: see UNLOAD_AT_ONCE.
 */
async function loadThread(id: string, unloadAtOnce = false): Promise<void> {
  const thread = getState().threads[id];
  if (!thread) return;
  updateThread(id, (t) => ({ ...t, loading: true, loadError: null }));
  try {
    // A MultiAgentV2 sub-agent resumes only through its loaded parent; otherwise it reads like an
    // archived session (the server's own advice: thread/read to inspect it).
    if (!isArchivedThread(id) && thread.meta.status.type === "notLoaded") await ensureThreadEnvironment(thread.meta.projectId);
    const response = isArchivedThread(id)
      ? null
      : await call("thread/resume", {
          threadId: id,
          excludeTurns: true,
          // Only a thread the server has to load takes them: resuming a loaded idle one with
          // overrides shuts it down and loads it again, background terminals and all.
          config: thread.meta.status.type === "notLoaded" ? { ...threadConfig(thread.meta.projectId), ...(unloadAtOnce && UNLOAD_AT_ONCE) } : null,
        }).catch((error: unknown) => {
          if (spawnOf(thread.meta)) return null;
          throw error;
        });
    if (response) {
      const mode = (response.collaborationMode as { mode?: string } | null)?.mode;
      updateThread(id, (t) => ({
        ...t,
        meta: mergeMeta(t.meta, response.thread),
        settings: settingsFrom(response),
        planMode: mode === "plan",
        subscribed: true,
      }));
    }
    if (response) await syncHostContext(id);
    void refreshThreadGit(id);
    await loadTurns(id, false);
    void loadGoal(id);
    void refreshQueue(id);
    void refreshAttachments(id);
    void refreshBackground(id);
  } catch (error) {
    // The transcript shows 无法加载此会话 with 重试 (cf74bc599 b_).
    updateThread(id, (t) => ({ ...t, loading: false, loadError: errorMessage(error) }));
  }
}

/**
 * A session loaded only for a scheduled run (automations.ts) unloads as soon as the page lets go of
 * it, so its writer lock is free at once for another tab or bridge (the default waits 30 minutes).
 * ponytail: backends before 0.164 (no c633a9f2d1) ignore a per-thread delay and keep the lock for
 * their server-wide one; a session the user then opens in this page keeps the zero delay, so
 * leaving it unloads it at once, background terminals and all. Leave the delay out on those backends
 * (the hello capabilities tell them apart) if that bites.
 */
const UNLOAD_AT_ONCE = { thread_unload_delay_secs: 0 };

/** loadThread for a session the list may not have paged in; throws what kept it from loading. */
export async function resumeThread(id: string, unloadAtOnce = false): Promise<void> {
  if (!getState().threads[id]) {
    const { thread } = await callExperimental<{ thread: Thread }>("thread/read", { threadId: id });
    setState((s) => ({ threads: rememberThreads([thread], s.threads) }));
  }
  await loadThread(id, unloadAtOnce);
  const error = getState().threads[id]?.loadError;
  if (error) throw new Error(error);
}

async function loadGoal(id: string): Promise<void> {
  if (!featureEnabled("goals")) return;
  try {
    const { goal } = await call("thread/goal/get", { threadId: id });
    updateThread(id, (t) => ({ ...t, goal }));
  } catch {
    // Goals are experimental; a server that refuses simply shows none.
  }
}

const agentLoads = new Set<string>();

/**
 * A sub-agent read in for its row, task and record: its turns only, never resumed (Claude's subagent
 * view is read-only; its live items come in through the parent's subscription meanwhile).
 */
export async function loadAgent(id: string): Promise<void> {
  if (agentLoads.has(id)) return;
  agentLoads.add(id);
  try {
    if (!getState().threads[id]) await ensureThreads([id]);
    const thread = getState().threads[id];
    if (!thread || thread.loaded) return;
    updateThread(id, (t) => ({ ...t, loading: true, loadError: null }));
    await loadTurns(id, false);
  } catch (error) {
    updateThread(id, (t) => ({ ...t, loading: false, loadError: errorMessage(error) }));
  } finally {
    agentLoads.delete(id);
  }
}

export async function loadTurns(id: string, older: boolean): Promise<void> {
  const thread = getState().threads[id];
  if (!thread || (older && !thread.olderCursor)) return;
  if (older) updateThread(id, (t) => ({ ...t, loading: true, olderError: false }));
  let response;
  try {
    response = await call("thread/turns/list", {
      threadId: id,
      cursor: older ? thread.olderCursor : null,
      limit: 20,
      sortDirection: "desc",
      itemsView: "full",
    });
  } catch (error) {
    // The transcript's top row turns into 无法加载更早的消息。 with 重试 (c96d752d0 Cw).
    if (older) updateThread(id, (t) => ({ ...t, loading: false, olderError: true }));
    throw error;
  }
  const page: TurnState[] = response.data.slice().reverse();
  updateThread(id, (t) => {
    let turns: TurnState[];
    if (older) {
      turns = [...page, ...t.turns.filter((turn) => !page.some((p) => p.id === turn.id))];
    } else {
      // Keep live turns that streamed in while the page was loading.
      const live = new Map(t.turns.map((turn) => [turn.id, turn]));
      turns = page.map((turn) => {
        const current = live.get(turn.id);
        return current?.status === "inProgress" && current.items.length >= turn.items.length ? current : turn;
      });
      turns.push(...t.turns.filter((turn) => !page.some((p) => p.id === turn.id)));
    }
    return {
      ...t,
      turns,
      olderCursor: older || !t.loaded ? response.nextCursor : t.olderCursor,
      loaded: true,
      loading: false,
    };
  });
  reconcilePendingMessage(id);
  void joinSpawned(agentThreadIds(page.flatMap((turn) => turn.items)), isArchivedThread(id));
}

/** Drop idle threads we navigated away from (or a scheduled run is done with) so app-server can unload them. */
export async function releaseThread(id: string): Promise<void> {
  if (backgroundCheck?.threadId === id) stopBackgroundCheck();
  const thread = getState().threads[id];
  if (!thread?.subscribed || isShown(getState(), id) || activeTurn(thread) || getState().requests.some((r) => requestThreadId(r) === id)) return;
  updateThread(id, (t) => ({ ...t, subscribed: false, loaded: false, background: [] }));
  await call("thread/unsubscribe", { threadId: id }).catch(() => {});
}

const agentReports = new Map<string, { at: number; text: string | null }>();

/** The final reply of a (sub-agent) thread, for 收到的消息来自… rows; cached per thread update. */
export async function readAgentReport(threadId: string): Promise<string | null> {
  const updatedAt = getState().threads[threadId]?.meta.updatedAt ?? 0;
  const cached = agentReports.get(threadId);
  if (cached && cached.at === updatedAt) return cached.text;
  const loaded = getState().threads[threadId]?.turns;
  let text = loaded?.length ? finalAnswer(loaded) : null;
  if (text === null) {
    const response = await call("thread/turns/list", { threadId, limit: 3, sortDirection: "desc", itemsView: "full" });
    text = finalAnswer(response.data);
  }
  agentReports.set(threadId, { at: updatedAt, text });
  return text;
}

// ---------------------------------------------------------------------------
// Starting work

// Legacy backends append planning guidance only when creating a thread. Capable backends
// receive UI rules separately through syncHostContext, leaving user instructions intact.
// The thread's environment adds its variables: config overrides don't persist on a thread, so
// every start, resume and fork passes them (one table key, so a name with a dot stays whole).
const threadConfig = (projectId?: string | null) => {
  const { planCard, config, projects } = getState();
  const env = projectId ? environmentOf(projects.find((project) => project.id === projectId)).env : {};
  const base = hostContextSupported()
    ? {
      "tools.update_plan.enabled": planCard,
      ...(typeof config?.developer_instructions === "string" ? { developer_instructions: config.developer_instructions } : {}),
    }
    : planningConfig(planCard, config?.developer_instructions);
  return Object.keys(env).length ? { ...base, "shell_environment_policy.set": env } : base;
};

interface Checkouts {
  cwd: string;
  roots: string[];
  worktrees: string[];
  /** The first folder's worktree waits until the session is about to change files (改代码前再建工作树). */
  lazy?: boolean;
}

/** codex-worktree's root: `[desktop] git-worktree-root`, else $CODEX_HOME/worktrees. */
export function worktreeRoot(): string {
  const configured = (getState().config?.desktop as Record<string, unknown> | undefined)?.["git-worktree-root"];
  if (typeof configured === "string" && configured.trim()) return configured.trim();
  const home = getState().server.info?.codexHome;
  if (!home) throw new Error("无法确定工作树文件夹。");
  return `${home}${home.includes("\\") ? "\\" : "/"}worktrees`;
}

/**
 * The chosen environment's folders as its session starts with them (ca690a791: every worktree is
 * created when the session starts). A folder with Worktree on gets one from its picked branch, a
 * later folder of the same repository goes inside that one, and the first folder without one
 * switches to its picked branch in place.
 */
async function prepareCheckouts(project: Project): Promise<Checkouts> {
  const environment = environmentOf(project);
  const folders = project.roots.map((root) => root.path);
  const settingsOf = (index: number) => (index === 0 ? environment.settings : environment.folderSettings[folders[index]] ?? {});
  const anyWorktree = folders.some((_, index) => settingsOf(index).worktree);
  const repositories = anyWorktree
    ? await Promise.all(folders.map((cwd) => callExperimental<{ root: string | null }>("codexUi/git/branches", { cwd }).then((info) => info.root, () => null)))
    : folders.map(() => null);
  const made = new Map<string, string>();
  const checkouts: Checkouts = { cwd: folders[0], roots: [], worktrees: [] };
  for (const [index, folder] of folders.entries()) {
    const repository = repositories[index];
    const earlier = repository ? repositories.indexOf(repository) : -1;
    if (repository && earlier >= 0 && earlier < index) {
      const worktree = made.get(repository);
      const tail = folder.slice(repository.length);
      checkouts.roots.push(worktree && samePath(folder.slice(0, repository.length), repository) ? worktree + tail : folder);
      continue;
    }
    const { worktree, branch, lazy } = settingsOf(index);
    // Deferred: the session starts here and enter_worktree makes the worktree from HEAD later; without
    // the desktop tools to call it, the worktree is made now.
    if (worktree && lazy && index === 0 && desktopToolsAvailable()) {
      checkouts.lazy = true;
      checkouts.roots.push(folder);
      continue;
    }
    if (worktree) {
      const created = await callExperimental<{ cwd: string; worktree: string; repository: string }>("codexUi/worktree/create", { cwd: folder, base: branch ?? null, root: worktreeRoot() });
      made.set(repository ?? created.repository, created.worktree);
      checkouts.worktrees.push(created.worktree);
      checkouts.roots.push(created.cwd);
    } else {
      if (index === 0 && branch) await callExperimental("codexUi/git/switch", { cwd: folder, branch });
      checkouts.roots.push(folder);
    }
  }
  checkouts.cwd = checkouts.roots[0];
  return checkouts;
}

/** The backend accepts SSH environments (environment/addStdio) only with the experimental backend on. */
export const sshSupported = () => getState().server.info?.codexUiStdioEnvironments === true;

/** A folder in Codex's worktree root: a session's own checkout, not a folder to keep as an environment. */
export function inWorktreeRoot(path: string): boolean {
  let root: string;
  try {
    root = worktreeRoot();
  } catch {
    return false;
  }
  return normalizePath(path).startsWith(`${normalizePath(root)}/`);
}

export type SshStatus = { status: "ready" | "pending" | "disconnected" | "unknown"; error?: string };

/** How the session's SSH host is doing (environment/status: read only, it never connects). */
export async function sshStatus(connection: SshConnection): Promise<SshStatus> {
  if (!sshSupported()) return { status: "unknown" };
  return callExperimental<SshStatus>("environment/status", { environmentId: sshEnvironmentId(connection) });
}

/** The backend keeps added environments in memory only: register the host again when it lacks it. */
export async function ensureSshEnvironment(connection: SshConnection, replace = false): Promise<string> {
  const environmentId = sshEnvironmentId(connection);
  const known = !replace && await callExperimental<{ status: string }>("environment/status", { environmentId }).then((r) => r.status !== "unknown", () => false);
  if (!known) await callExperimental("environment/addStdio", { environmentId, ...sshCommand(connection) });
  return environmentId;
}

function sshConnectionOf(environment: EnvironmentConfig): SshConnection {
  const connection = sshConnections().find((c) => c.id === environment.ssh?.connectionId);
  if (!connection) throw new Error("找不到此环境的 SSH 连接，请在环境设置中重新选择主机。");
  if (!sshSupported()) throw new Error("SSH 环境需要开启实验型后端。");
  return connection;
}

/** A session in an SSH environment runs its tools on the host: its folders, else the host's default one. */
async function sshEnvironments(environment: EnvironmentConfig) {
  const environmentId = await ensureSshEnvironment(sshConnectionOf(environment));
  let folders = environment.ssh?.folders ?? [];
  if (!folders.length) {
    const info = await callExperimental<{ cwd: string | null }>("environment/info", { environmentId });
    if (!info.cwd) throw new Error("无法确定主机的默认文件夹。");
    folders = [decodeURIComponent(new URL(info.cwd).pathname)];
  }
  return [{ environmentId, cwd: folders[0], runtimeWorkspaceRoots: folders }];
}

/** Before a cold resume or fork: the backend may have restarted and lost the session's SSH host. */
async function ensureThreadEnvironment(projectId: string | null | undefined): Promise<void> {
  const environment = environmentOf(getState().projects.find((project) => project.id === projectId));
  if (environment.kind === "ssh") await ensureSshEnvironment(sshConnectionOf(environment));
}

export function hostContextSupported(): boolean {
  return getState().server.info?.codexUiHostContext === true;
}
let hostContextGeneration = 0;
const hostContextPending = new Map<string, Promise<void>>();

export function syncHostContext(id: string): Promise<void> {
  if (!hostContextSupported()) return Promise.resolve();
  const generation = hostContextGeneration;
  const next = (hostContextPending.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (generation !== hostContextGeneration) throw new Error("连接已更换，宿主上下文未同步。");
    const thread = getState().threads[id];
    if (!thread?.subscribed || thread.meta.parentThreadId || spawnOf(thread.meta)) return;
    await callExperimental("thread/settings/update", { threadId: id, codexUiContext: hostContext(thread.settings?.cwd ?? thread.meta.cwd, getState().planCard, {
      desktopContext: getState().server.info?.codexUiDesktopContext === true,
      desktopTools: desktopToolsReady(getState()),
      hostContextV2: getState().server.info?.codexUiHostContextV2 === true,
      hostContextMaxBytes: hostTextBudget(),
      workflows: getState().server.info?.codexUiWorkflows === true ? { enabled: workflowsEnabled(), ultracode: ultracodeOn(id) } : undefined,
    }) });
  });
  hostContextPending.set(id, next);
  void next.finally(() => { if (hostContextPending.get(id) === next) hostContextPending.delete(id); }).catch(() => {});
  return next;
}

/** The host text the backend holds (initialize codexUiHostContextMaxBytes); 8 KiB before it said. */
function hostTextBudget(): number | undefined {
  const max = (getState().server.info as { codexUiHostContextMaxBytes?: unknown } | null)?.codexUiHostContextMaxBytes;
  return typeof max === "number" && Number.isSafeInteger(max) && max > 0 ? max : undefined;
}

export async function syncHostContexts(): Promise<void> {
  await Promise.all(Object.values(getState().threads).filter((thread) => thread.subscribed).map((thread) => syncHostContext(thread.meta.id)));
}

/**
 * `plain` (the 图像 page): a session outside the draft page's project, environment, permissions
 * and plan pick, read-only, on the given model; the draft page's own picks stay as they are.
 */
/** `stay`: Ctrl+Enter on the new-session page (c518a31cc 4cA0613U5L) starts it without opening it. */
export async function startThread(pendingMessageId?: string, plain?: { model: string | null }, stay = false): Promise<string> {
  const { prefs } = getState();
  const preset = plain ? PRESETS["read-only"] : prefs.permission ? PRESETS[prefs.permission] : null;
  const projectId = plain ? null : prefs.projectId ?? projectFor(prefs.cwd)?.id ?? null;
  // Only an environment picked as such starts with its worktrees and extra folders; a folder that
  // merely lies inside one still joins it (and takes its variables).
  const chosen = plain ? undefined : getState().projects.find((project) => project.id === prefs.projectId);
  const kind = chosen ? environmentOf(chosen).kind : null;
  // A cloud environment starts Codex Cloud tasks (the composer's startCloudTask), never a session here.
  if (kind === "cloud") throw new Error("云端环境只能启动云端任务。");
  const checkouts = chosen && kind === "local" && chosen.roots.length ? await prepareCheckouts(chosen) : null;
  const environments = chosen && kind === "ssh" ? await sshEnvironments(environmentOf(chosen)) : null;
  // 本电脑 with no folder: a scratch workspace of its own, as Claude starts a folderless session.
  const scratch = !plain && !chosen && !prefs.cwd ? await mintScratch() : null;
  const params: Record<string, unknown> = {
    cwd: plain ? null : checkouts?.cwd ?? (scratch || prefs.cwd || null),
    model: plain ? plain.model : prefs.model,
    approvalPolicy: preset?.approval ?? null,
    sandbox: preset?.sandbox ?? null,
    config: threadConfig(projectId),
  };
  // The extra folders are workspace roots: writable under workspace-write, like Claude's --add-dir.
  if (checkouts && checkouts.roots.length > 1) params.runtimeWorkspaceRoots = checkouts.roots;
  if (environments) params.environments = environments;
  // A custom profile replaces the sandbox (the server rejects the two together).
  if (!preset && prefs.permissionProfile) {
    delete params.sandbox;
    params.permissions = prefs.permissionProfile;
  }
  if (prefs.serviceTier) params.serviceTier = prefs.serviceTier;
  // A plain session's approvals are the user's: neither the draft page's 自动 nor config.toml's auto_review.
  if (plain) params.approvalsReviewer = "user";
  else if (prefs.reviewer) params.approvalsReviewer = prefs.reviewer;
  if (projectId) params.projectId = projectId;
  const response = await call("thread/start", params as never);
  const id = response.thread.id;
  // Ownership as Codex's desktop app records it, so its worktree cleanup knows the session.
  for (const worktree of checkouts?.worktrees ?? []) void callExperimental("codexUi/worktree/bind", { cwd: worktree, threadId: id }).catch(() => {});
  if (checkouts?.lazy) setLazy(id, {});
  setState((s) => ({
    ...(pendingMessageId && s.pendingMessages[""]?.item.id === pendingMessageId
      ? { pendingMessages: { ...s.pendingMessages, "": undefined, [id]: s.pendingMessages[""] } }
      : {}),
    threads: {
      ...s.threads,
      [id]: {
        ...emptyThreadState(liveGitMeta(response.thread)),
        ...(s.threads[id] ? { turns: s.threads[id].turns, timing: s.threads[id].timing } : {}),
        subscribed: true,
        loaded: true,
        settings: settingsFrom(response),
        planMode: plain ? false : prefs.planMode,
        overrides: prefs.effort ? { effort: prefs.effort } : {},
      },
    },
    list: s.list.archived ? s.list : { ...s.list, ids: [id, ...s.list.ids.filter((x) => x !== id)] },
    ...(stay ? {} : {
      activeId: id,
      scheduledRoute: null,
      libraryRoute: null,
      // The 图像 page that started it goes with it, even when syncHostContext below fails.
      imagesOpen: false,
    }),
    // Plan is the draft's own pick (Claude keeps it out of the folder's and the landing page's mode).
    ...(plain ? {} : { prefs: { ...s.prefs, planMode: false } }),
  }));
  if (!plain) adoptDraftUltracode(id);
  await syncHostContext(id);
  if (!prefs.memory) void setMemoryMode(id, "disabled").catch(() => {});
  scheduleBackgroundCheck(id, true);
  void refreshThreadGit(id);
  return id;
}

/**
 * The collaboration mode (plan / default) a turn or thread/settings/update carries; null without
 * modes. It carries the session's own model and effort, never the mode preset's (the built-in
 * plan preset pins medium): switching modes changes neither, as Claude Desktop's
 * setPermissionMode leaves model and effort alone. The server takes these settings over the
 * request's model / effort, so a preset value would stick after leaving plan mode too. A session
 * the server resumed in plan mode still gets one, without modes listed, so it can leave it.
 */
function collaborationModeFor(thread: ThreadState, planMode: boolean, wasPlan = false): Record<string, unknown> | null {
  if (!getState().modes.length && !planMode && !wasPlan) return null;
  const effective = effectiveSettings(thread);
  return {
    mode: planMode ? "plan" : "default",
    settings: {
      model: effective.model ?? defaultModel(getState().models)?.id ?? "",
      reasoning_effort: effective.effort ?? null,
      developer_instructions: null,
    },
  };
}

function turnOverrides(thread: ThreadState): Partial<TurnStartParams> {
  const params: Partial<TurnStartParams> = {};
  const { overrides } = thread;
  if (overrides.model) params.model = overrides.model;
  if (overrides.effort) params.effort = overrides.effort;
  if (overrides.permission) {
    params.approvalPolicy = PRESETS[overrides.permission].approval;
    params.sandboxPolicy = PRESETS[overrides.permission].policy;
  } else if (overrides.permissionProfile) {
    // Experimental turn/start.permissions; the server rejects it together with sandboxPolicy.
    (params as Record<string, unknown>).permissions = overrides.permissionProfile;
  }
  if (overrides.serviceTier) params.serviceTier = overrides.serviceTier;
  if (overrides.reviewer) params.approvalsReviewer = overrides.reviewer;
  if (overrides.cwd) params.cwd = overrides.cwd;
  // The Codex app (its concurrent_reasoning_summaries override) asks every turn for detailed
  // summaries unless config.toml picks a level. The models default to none, and then a reasoning
  // item arrives only once it is done, so the working line never sees it open (思考中). Thinking
  // views need summaries a configured none turned off.
  if (!getState().config?.model_reasoning_summary) params.summary = "detailed";
  else if ((thread.view ?? getState().defaultView) !== "normal" && getState().config?.model_reasoning_summary === "none") params.summary = "auto";
  const collaborationMode = collaborationModeFor(thread, thread.planMode);
  if (collaborationMode) (params as Record<string, unknown>).collaborationMode = collaborationMode;
  return params;
}

/** Fold the composer's pending picks into the thread's settings once the server has them. */
function settleOverrides(t: ThreadState): ThreadState {
  const { overrides } = t;
  return {
    ...t,
    // A session not yet resumed has no settings to take the folder: it waits for the next turn.
    overrides: overrides.cwd && !t.settings ? { cwd: overrides.cwd } : {},
    // A moved session's git meta follows now: thread/settings/updated then finds no move.
    meta: overrides.cwd ? liveGitMeta(t.meta, overrides.cwd) : t.meta,
    settings: t.settings && {
      ...t.settings,
      cwd: overrides.cwd ?? t.settings.cwd,
      model: overrides.model ?? t.settings.model,
      effort: overrides.effort ?? t.settings.effort,
      serviceTier: overrides.serviceTier ?? t.settings.serviceTier,
      approvalsReviewer: overrides.reviewer ?? t.settings.approvalsReviewer,
      permissionProfile: overrides.permission
        ? null
        : overrides.permissionProfile !== undefined
          ? overrides.permissionProfile
          : t.settings.permissionProfile,
      ...(overrides.permission ? { approvalPolicy: PRESETS[overrides.permission].approval, sandbox: PRESETS[overrides.permission].policy } : {}),
    },
  };
}

/**
 * Sessions whose enter_plan_mode was allowed mid-turn (DesktopTools.ts), by that turn: Claude's
 * EnterPlanMode goes on in plan mode in the same turn, Codex holds a turn's mode, so once that turn
 * completes the plan-mode turn starts at once (questions.ts PLAN_RESUME, left out of the transcript).
 */
const resumes = new Map<string, { turnId: string; text: string }>();

export function resumeInPlanMode(threadId: string, turnId: string): void {
  resumes.set(threadId, { turnId, text: PLAN_RESUME });
}

// ---------------------------------------------------------------------------
// 改代码前再建工作树: a session that starts in the user's checkout and gets its worktree only when
// the model is about to change files (enter_worktree). Codex fixes a turn's folder and sandbox when
// it starts, so the session moves once the call has its answer and goes on in the next turn.

const LAZY_KEY = "codex-ui:lazy-worktrees";
type LazyWorktree = { moveTo?: string };
const lazyWorktrees = () => (readJson(LAZY_KEY) ?? {}) as Record<string, LazyWorktree>;

function setLazy(threadId: string, value: LazyWorktree | null): void {
  const all = lazyWorktrees();
  if (value) all[threadId] = value;
  else delete all[threadId];
  writeJson(LAZY_KEY, all);
}

/** The session still works in the user's checkout and is to get its worktree before it changes files. */
export const defersWorktree = (threadId: string): boolean => !!lazyWorktrees()[threadId] && !lazyWorktrees()[threadId].moveTo;

/** enter_worktree made its worktree and the session is about to move there. */
export const movingToWorktree = (threadId: string): boolean => !!lazyWorktrees()[threadId]?.moveTo;

/**
 * The desktop tools, enter_worktree among them, reach this window's sessions: the backend offers them
 * and Codex UI started it as the experimental backend (hello; a CODEX_BIN that sets the mark itself
 * gets no bridge MCP), in the desktop app.
 */
export const desktopToolsReady = (s: AppState): boolean => s.server.info?.codexUiDesktopTools === true && s.server.experimental && typeof window !== "undefined" && !!window.codexDesktop;
const desktopToolsAvailable = () => desktopToolsReady(getState());

/** What runs once a desktop call's receipt reached the bridge (rpc.ts delivered), by request id. */
const afterReceipt = new Map<string, () => void>();

/**
 * enter_worktree: a worktree cut from the checkout's HEAD, owned by the session, which moves into
 * it once this call has its answer and continues there in the next turn (WORKTREE_RESUME).
 */
export async function enterWorktree(threadId: string, requestId: string): Promise<{ worktree: string; base: string | null }> {
  const thread = getState().threads[threadId];
  if (!thread) throw new Error("This session is not loaded.");
  const created = await callExperimental<{ cwd: string; worktree: string; base?: string | null }>("codexUi/worktree/create", { cwd: threadCwd(thread), base: null, root: worktreeRoot() });
  await callExperimental("codexUi/worktree/bind", { cwd: created.worktree, threadId }).catch(() => {});
  setLazy(threadId, { moveTo: created.cwd });
  const turn = activeTurn(getState().threads[threadId]);
  if (turn) resumes.set(threadId, { turnId: turn.id, text: WORKTREE_RESUME });
  afterReceipt.set(requestId, () => void moveLazy(threadId).catch((error) => toast("warning", "无法移入工作树", errorMessage(error))));
  return { worktree: created.worktree, base: created.base ?? null };
}

/** The session's folder becomes the worktree enter_worktree made (its next turn starts there). */
async function moveLazy(threadId: string): Promise<void> {
  const target = lazyWorktrees()[threadId]?.moveTo;
  if (!target) return;
  if (getState().threads[threadId]?.subscribed && (await optional("thread/settings/update", { threadId, cwd: target })) !== null) {
    updateThread(threadId, (t) => (t.settings ? { ...t, meta: liveGitMeta(t.meta, target), settings: { ...t.settings, cwd: target } } : t));
  } else updateThread(threadId, (t) => ({ ...t, overrides: { ...t.overrides, cwd: target } }));
  setLazy(threadId, null);
  void refreshThreadGit(threadId, true);
  void syncHostContext(threadId);
}

/**
 * Before a turn starts: a move whose receipt never arrived happens now; without the desktop tools
 * (the experimental backend turned off since), the worktree is made now, as an ordinary one would be.
 */
async function settleLazyWorktree(threadId: string): Promise<void> {
  const lazy = lazyWorktrees()[threadId];
  if (!lazy) return;
  if (!lazy.moveTo && desktopToolsAvailable()) return;
  if (!lazy.moveTo) {
    const thread = getState().threads[threadId];
    const created = await callExperimental<{ cwd: string; worktree: string }>("codexUi/worktree/create", { cwd: threadCwd(thread), base: null, root: worktreeRoot() });
    await callExperimental("codexUi/worktree/bind", { cwd: created.worktree, threadId }).catch(() => {});
    setLazy(threadId, { moveTo: created.cwd });
  }
  await moveLazy(threadId);
}

/** What 与基础分支同步 did (server/git.mjs syncWithBase). */
export interface SyncResult {
  outcome: "up_to_date" | "merged" | "conflicts" | "dirty" | "merging";
  /** The branch merged, as a remote-tracking ref when it has a remote. */
  target?: string;
  /** Whether fetching it worked; null without a remote. */
  fetched?: boolean | null;
  head?: string;
  files?: string[];
  count?: number;
}

/** 与基础分支同步: the base branch merged into a worktree session's HEAD, then fresh Git facts. */
export async function syncThreadWithBase(threadId: string, base?: string): Promise<SyncResult> {
  const thread = getState().threads[threadId];
  if (!thread) throw new Error("This session is not loaded.");
  const result = await callExperimental<SyncResult>("codexUi/worktree/sync", { cwd: threadCwd(thread), base: base ?? null });
  void refreshThreadGit(threadId, true);
  return result;
}

/** rpc.ts: a receipt reached the bridge, so its call has its answer. */
function receiptDelivered(requestId: string): void {
  const then = afterReceipt.get(requestId);
  afterReceipt.delete(requestId);
  then?.();
}

/** A session that leaves (deleted) takes its deferred worktree with it. */
export function forgetLazyWorktree(threadId: string): void {
  if (lazyWorktrees()[threadId]) setLazy(threadId, null);
}

/**
 * Sends user input. Idle: starts a turn (and the thread if needed). Busy: steers the running
 * turn (Enter), or queues it with `queue` (Ctrl+Enter) and whenever the turn cannot be steered.
 * Throws when queueing is needed but the server has no queue. `fresh`: `threadId` was just started
 * for this message (startThread's plain session), so it gets a title like one started here.
 */
/** Resolves with the session it went to (a new one's id from the new-session page). */
export async function sendMessage(threadId: string | null, input: UserInput[], opts: { queue?: boolean; fresh?: boolean; stay?: boolean } = {}): Promise<string> {
  const key = threadId ?? "";
  if (getState().pendingMessages[key]) throw new Error("请先处理上一条待发送的消息。");
  // Keep busy-turn steering/queueing on its existing path; only idle sends need a local echo.
  if (!threadId || !activeTurn(getState().threads[threadId])) {
    const clientId = crypto.randomUUID();
    const fresh = opts.fresh || threadId === null;
    setState((s) => ({ pendingMessages: { ...s.pendingMessages, [key]: { item: { type: "userMessage", id: clientId, clientId, content: input }, ...(fresh && { fresh }) } } }));
    return submitPendingMessage(threadId, opts.stay);
  }
  await sendToThread(threadId, input, opts);
  return threadId;
}

/** Retry only on request: a lost connection may have delivered the original message. */
export async function retryPendingMessage(threadId: string | null): Promise<void> {
  const key = threadId ?? "";
  const pending = getState().pendingMessages[key];
  if (!pending?.error) return;
  setState((s) => ({ pendingMessages: { ...s.pendingMessages, [key]: { ...pending, error: undefined } } }));
  try {
    if (threadId) {
      await openThread(threadId, true);
      if (getState().threads[threadId]?.loadError) throw new Error(getState().threads[threadId].loadError!);
      reconcilePendingMessage(threadId);
      if (!getState().pendingMessages[threadId]) return;
      if (activeTurn(getState().threads[threadId])) throw new Error("会话仍在运行，请等待完成后再重试。");
    }
    await submitPendingMessage(threadId);
  } catch (error) {
    setState((s) => {
      const current = s.pendingMessages[key];
      return current?.item.id === pending.item.id ? { pendingMessages: { ...s.pendingMessages, [key]: { ...current, error: current.error ?? errorMessage(error) } } } : {};
    });
    throw error;
  }
}

async function submitPendingMessage(threadId: string | null, stay = false): Promise<string> {
  let id = threadId;
  const pending = getState().pendingMessages[id ?? ""]!;
  const newlyStarted = pending.fresh ?? false;
  const clientId = pending.item.id;
  const update = (patch: Partial<typeof pending>) => setState((s) => {
    const key = id ?? "";
    const current = s.pendingMessages[key];
    return current?.item.id === clientId ? { pendingMessages: { ...s.pendingMessages, [key]: { ...current, ...patch } } } : {};
  });
  update({ error: undefined, accepted: false, turnId: undefined });
  try {
    id ??= await startThread(clientId, undefined, stay);
    await sendToThread(id, pending.item.content, {}, clientId, newlyStarted);
    reconcilePendingMessage(id);
    return id;
  } catch (error) {
    update({ error: error instanceof RpcError && error.code === -32001 ? "连接中断，发送状态未确认。请检查会话后重试，以免重复发送。" : errorMessage(error) });
    throw error;
  }
}

/** Reconcile by client id, with a turn-scoped fallback for older servers without clientId. */
function reconcilePendingMessage(threadId: string): void {
  setState((s) => {
    const pending = s.pendingMessages[threadId];
    if (!pending) return {};
    const turns = s.threads[threadId]?.turns ?? [];
    const delivered = turns.some((turn) => turn.items.some((item) => item.type === "userMessage" &&
      (item.clientId === pending.item.id || (item.clientId == null && turn.id === pending.turnId))));
    const ended = turns.find((turn) => turn.id === pending.turnId && turn.status !== "inProgress");
    return delivered || ended ? { pendingMessages: { ...s.pendingMessages, [threadId]: delivered ? undefined : { ...pending, error: ended?.error?.message ?? "本轮已结束，消息未被接受。您可以重试。" } } } : {};
  });
}

type ContextEntries = Record<string, { kind: "untrusted" | "application"; value: string }>;

/**
 * `context` joins the turn's additional context; `automation` marks the scheduler's own turn, which
 * is no user carrying on in a scheduled run's session; `onTurn` hears the started turn's id.
 */
interface SendOptions { queue?: boolean; turnTrigger?: string; context?: ContextEntries; automation?: boolean; onTurn?: (turnId: string) => void }

async function sendToThread(id: string, input: UserInput[], opts: SendOptions, clientUserMessageId?: string, newlyStarted = false): Promise<void> {
  if (!opts.automation) noteUserTurn(id);
  // Undo rewind works until the next message (the backend retires its mark on the next turn).
  setRewindMark(id, null);
  let thread = getState().threads[id];
  if (!thread.subscribed) {
    // A session out of view takes the message where it is, without taking the user's view.
    await (id === getState().activeId ? openThread(id, true) : loadThread(id));
    thread = getState().threads[id];
    if (thread.loadError) throw new Error(thread.loadError);
  }
  if (!activeTurn(thread)) await settleLazyWorktree(id);
  await syncHostContext(id);
  const running = activeTurn(thread);
  if (running) {
    if (clientUserMessageId || !input.length) throw new Error("会话仍在运行，请等待完成后再重试。");
    if (opts.queue || !canSteer(thread)) return queueMessage(id, input);
    try {
      const snapshot = await refreshThreadGit(id, true);
      const side = sideContext(id);
      await call("turn/steer", { threadId: id, input, ...turnContext(snapshot, side, input, id), expectedTurnId: running.id, clientUserMessageId: crypto.randomUUID() });
      sentSideContext(id, side);
      return;
    } catch (error) {
      if (notSteerable(error)) {
        updateThread(id, (t) => updateTurn(t, running.id, (turn) => ({ ...turn, steerable: false })));
        return queueMessage(id, input);
      }
      // The turn ended under us: start a new one below.
      if (!noActiveTurn(error)) throw error;
    }
  }
  // The server fills `preview` from the first message only once it is persisted; show it right away.
  // Its words only, as the server's strip_user_message_prefix keeps them: no attached files' block
  // (files alone: their names, as the sidebar shows the server's preview of them, threadTitle).
  const typed = input.find((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")?.text;
  const text = typed === undefined ? undefined : requestSummary(typed);
  // A retried first send finds the preview its failed try set.
  const needsTitle = newlyStarted && text && (!thread.meta.preview || thread.meta.preview === text) && !thread.meta.name;
  if (text && !thread.meta.preview) updateThread(id, (t) => ({ ...t, meta: { ...t.meta, preview: text } }));
  updateThread(id, (t) => ({ ...t, sending: true }));
  let response;
  try {
    const snapshot = await refreshThreadGit(id);
    const side = sideContext(id);
    response = await call("turn/start", { threadId: id, input, ...turnContext(snapshot, side, input, id, opts.context), ...(clientUserMessageId ? { clientUserMessageId } : {}), ...(opts.turnTrigger ? { turnTrigger: opts.turnTrigger } : {}), ...turnOverrides(getState().threads[id]) });
    sentSideContext(id, side);
  } finally {
    updateThread(id, (t) => ({ ...t, sending: false }));
  }
  opts.onTurn?.(response.turn.id);
  updateThread(id, (t) =>
    settleOverrides(
      updateTurn(t, response.turn.id, (turn) => ({
        ...response.turn,
        ...turn,
        status: turn.status === "inProgress" ? response.turn.status : turn.status,
      })),
    ),
  );
  setState((s) => {
    const pending = s.pendingMessages[id];
    return pending && pending.item.id === clientUserMessageId ? { pendingMessages: { ...s.pendingMessages, [id]: { ...pending, turnId: response.turn.id, accepted: true } } } : {};
  });
  if (needsTitle) void generateThreadTitle(id, text);
}

/**
 * A scheduled task's turn (automations.ts): no local echo and never steered into a running turn
 * (that throws, so the scheduler tries later). Resolves to the started turn's id.
 */
export async function sendAutomationTurn(threadId: string, text: string, opts: { turnTrigger: string; context?: ContextEntries }): Promise<string> {
  let turnId = "";
  await sendToThread(threadId, [{ type: "text", text, text_elements: [] }], { ...opts, automation: true, onTurn: (id) => (turnId = id) }, crypto.randomUUID());
  return turnId;
}

/**
 * A turn's added context: the Git snapshot, and what the sessions this one started (and the app)
 * have to tell it (linked.ts), dropped once the turn takes it; then the caller's own entries.
 */
function turnContext(snapshot: GitSnapshot | null, side: ReturnType<typeof sideContext>, input: UserInput[] = [], threadId?: string, extra?: ContextEntries): { additionalContext?: ContextEntries } {
  // claude.exe workflow_keyword_request: "ultracode" in a typed message opts that turn into a
  // workflow (in its words: not an attached file's name).
  const keyword = getState().server.info?.codexUiWorkflows === true && workflowsEnabled()
    && input.some((part) => part.type === "text" && hasUltracodeKeyword(splitRequest(part.text).request));
  const context = {
    ...(snapshot ? gitContext(snapshot) : {}), ...side?.entries,
    ...(keyword ? { "codex-ui.workflow-keyword": { kind: "application" as const, value: WORKFLOW_KEYWORD } } : {}),
    // 改代码前再建工作树: the turn knows it is in the user's checkout until enter_worktree.
    ...(threadId && defersWorktree(threadId) ? { "codex-ui.worktree": { kind: "application" as const, value: LAZY_WORKTREE } } : {}),
    ...extra,
  };
  return Object.keys(context).length ? { additionalContext: context } : {};
}

/** Threads whose next thread/reverted is our own revert. */
const ownReverts = new Set<string>();

/** Drop `turnId` and every later turn from the thread's history. Files the agent changed stay changed (restoreCode). */
export async function rewindThread(threadId: string, turnId: string): Promise<void> {
  if (!getState().threads[threadId]?.subscribed) await openThread(threadId, true);
  ownReverts.add(threadId);
  try {
    await call("thread/revert", { threadId, beforeTurnId: turnId });
  } catch (error) {
    ownReverts.delete(threadId);
    throw error;
  }
  updateThread(threadId, (t) => {
    const index = t.turns.findIndex((turn) => turn.id === turnId);
    return index === -1 ? t : { ...t, turns: t.turns.slice(0, index) };
  });
  // The revert shut the thread down, its workflows with it (as Claude's rewind ends the process).
  endRunningRuns(threadId);
  setRewindMark(threadId, { turnId, at: Date.now(), variant: "pending" });
}

function setRewindMark(threadId: string, mark: RewindMark | null): void {
  if (!mark && !getState().rewindMarks[threadId]) return;
  setState((s) => {
    const { [threadId]: _, ...rest } = s.rewindMarks;
    return { rewindMarks: mark ? { ...rest, [threadId]: mark } : rest };
  });
}

/**
 * Undo rewind / Redo rewind (c4de0b325 p_e → undoRewind / switchRewindMark): the experimental
 * backend points the thread back at the history the rewind replaced, or at the cut one again; the
 * thread/reverted that follows reloads the turns. False once that is no longer possible.
 */
export async function switchRewind(threadId: string, direction: "undo" | "redo"): Promise<boolean> {
  const mark = getState().rewindMarks[threadId];
  const { switched } = await callExperimental<{ switched: boolean }>("thread/revert/switch", { threadId, direction });
  if (mark) setRewindMark(threadId, switched ? { ...mark, variant: direction === "undo" ? "forward" : "back" } : null);
  return switched;
}

/**
 * Rewind's code half (cc43287c9 Yye, "代码与对话" / "仅代码"): undo the patches the turns from
 * `turnId` on applied (rewind.ts), writing through the app-server's fs. Returns the files skipped
 * because they changed since.
 */
export async function restoreCode(threadId: string, turnId: string): Promise<number> {
  const thread = getState().threads[threadId];
  const from = thread.turns.findIndex((turn) => turn.id === turnId);
  const changes = appliedChanges(from === -1 ? [] : thread.turns.slice(from), threadCwd(thread));
  const now = new Map(await Promise.all(touchedPaths(changes).map(async (path) => [path, await readTextFile(path).catch(() => null)] as const)));
  const { writes, skipped } = undoChanges(changes, now);
  for (const { path, content } of writes) {
    if (content === null) {
      await call("fs/remove", { path, recursive: false, force: true });
      continue;
    }
    if (now.get(path) === null) await call("fs/createDirectory", { path: parentDir(path), recursive: true }).catch(() => {});
    await call("fs/writeFile", { path, dataBase64: textToBase64(content) });
  }
  return skipped.length;
}

export async function setGoal(threadId: string | null, objective: string): Promise<void> {
  const id = threadId ?? (await startThread());
  if (!getState().threads[id].subscribed) await openThread(id, true);
  const { goal } = await call("thread/goal/set", { threadId: id, origin: "user", objective, status: "active" });
  updateThread(id, (t) => ({ ...t, goal }));
}

export async function setGoalStatus(threadId: string, status: ThreadGoalStatus): Promise<void> {
  const { goal } = await call("thread/goal/set", { threadId, origin: "user", status });
  updateThread(threadId, (t) => ({ ...t, goal }));
}

export async function clearGoal(threadId: string): Promise<void> {
  await call("thread/goal/clear", { threadId, origin: "user" });
  updateThread(threadId, (t) => ({ ...t, goal: null }));
}

export async function runShellCommand(threadId: string | null, command: string): Promise<void> {
  const id = threadId ?? (await startThread());
  if (!getState().threads[id].subscribed) await openThread(id, true);
  await call("thread/shellCommand", { threadId: id, command });
}

export async function interrupt(threadId: string): Promise<void> {
  const turn = activeTurn(getState().threads[threadId]);
  if (!turn) return;
  updateThread(threadId, (t) => updateTurn(t, turn.id, (current) => ({ ...current, stopping: true })));
  await call("turn/interrupt", { threadId, turnId: turn.id });
}

const idleWaiters = new Map<string, (() => void)[]>();

/** Resolves once the thread has no running turn (turn/completed), or after `ms`. */
function waitIdle(threadId: string, ms = 15_000): Promise<void> {
  if (!activeTurn(getState().threads[threadId])) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    idleWaiters.set(threadId, [...(idleWaiters.get(threadId) ?? []), () => (clearTimeout(timer), resolve())]);
  });
}

/** Safety buffering: stop the slow turn and resend its prompt with the suggested faster model. */
export async function retryFaster(threadId: string): Promise<void> {
  const thread = getState().threads[threadId];
  const turn = activeTurn(thread);
  const model = turn?.buffering?.fasterModel;
  const prompt = turn?.items.find((item) => item.type === "userMessage");
  if (!turn || !model || prompt?.type !== "userMessage") return;
  await interrupt(threadId);
  await waitIdle(threadId);
  setOverride(threadId, { model });
  await rewindThread(threadId, turn.id);
  await sendMessage(threadId, prompt.content);
}

/**
 * Claude's 重试 on any other retryable failure (c3e34355f pt): an empty turn, as the capacity retry
 * sends but without its trigger, so Codex carries on from the history; no new message, no rewind.
 */
export async function retryFailed(threadId: string): Promise<void> {
  if (overloadRetries.has(threadId) || getState().pendingMessages[threadId]) return;
  overloadRetries.add(threadId);
  try {
    await sendToThread(threadId, [], {});
  } finally {
    overloadRetries.delete(threadId);
  }
}

/** Threads with a capacity retry on its way (ChatGPT app jTn): one at a time, across remounts. */
const overloadRetries = new Set<string>();

/**
 * ChatGPT app's capacity Retry (system-error-content kn, manual only: backends from
 * 0.162.0-alpha.18 retry overloads themselves, so its 10/30/120/300 s countdown stays off):
 * an empty turn on the thread with the current settings. No new message, no rewind.
 */
export async function retryOverloaded(threadId: string): Promise<void> {
  if (overloadRetries.has(threadId) || getState().pendingMessages[threadId]) return;
  overloadRetries.add(threadId);
  try {
    await sendToThread(threadId, [], { turnTrigger: "capacity_retry_manual" });
  } finally {
    overloadRetries.delete(threadId);
  }
}

// ---------------------------------------------------------------------------
// Message queue (experimental thread/queue/*): messages wait here and the server starts the
// head once the thread goes idle (not after an interrupt).

async function queueMessage(threadId: string, input: UserInput[]): Promise<void> {
  const response = await optional<{ queuedSubmission: QueuedSubmission }>("thread/queue/add", {
    threadId,
    input,
    clientUserMessageId: crypto.randomUUID(),
  });
  if (!response) throw new Error("当前 Codex 版本不支持排队消息");
  const { queuedSubmission } = response;
  updateThread(threadId, (t) => ({ ...t, queue: t.queue.some((q) => q.id === queuedSubmission.id) ? t.queue : [...t.queue, queuedSubmission] }));
}

export async function refreshQueue(threadId: string): Promise<void> {
  const response = await optional<{ data: QueuedSubmission[] }>("thread/queue/list", { threadId, limit: 50 }).catch(() => null);
  if (response) updateThread(threadId, (t) => ({ ...t, queue: response.data }));
}

export async function removeQueued(threadId: string, id: string): Promise<void> {
  updateThread(threadId, (t) => ({ ...t, queue: t.queue.filter((q) => q.id !== id) }));
  await callExperimental("thread/queue/delete", { threadId, queuedSubmissionId: id });
}

/**
 * Send now: a steerable running turn reads it at its next step; otherwise the running turn is
 * interrupted and the message starts as the next turn. Either way `landed` marks it for D.
 */
export async function sendQueuedNow(threadId: string, id: string): Promise<void> {
  const thread = getState().threads[threadId];
  const queued = thread?.queue.find((q) => q.id === id);
  if (!thread || !queued) return;
  noteUserTurn(threadId);
  updateThread(threadId, (t) => ({ ...t, landed: { id: queued.clientUserMessageId, at: Date.now() } }));
  const running = activeTurn(thread);
  if (running && canSteer(thread)) {
    try {
      await syncHostContext(threadId);
      const snapshot = await refreshThreadGit(threadId, true);
      const side = sideContext(threadId);
      await call("turn/steer", { threadId, input: queued.input, ...turnContext(snapshot, side, queued.input, threadId), expectedTurnId: running.id, clientUserMessageId: queued.clientUserMessageId });
      sentSideContext(threadId, side);
      await removeQueued(threadId, id);
      return;
    } catch (error) {
      if (notSteerable(error)) updateThread(threadId, (t) => updateTurn(t, running.id, (turn) => ({ ...turn, steerable: false })));
      else if (!noActiveTurn(error)) throw error;
    }
  }
  if (activeTurn(getState().threads[threadId])) {
    await interrupt(threadId);
    await waitIdle(threadId);
  }
  await callExperimental("thread/queue/start", { threadId, queuedSubmissionId: id });
}

export async function reorderQueue(threadId: string, ids: string[]): Promise<void> {
  updateThread(threadId, (t) => ({ ...t, queue: ids.map((id) => t.queue.find((q) => q.id === id)).filter((q): q is QueuedSubmission => !!q) }));
  await callExperimental("thread/queue/reorder", { threadId, queuedSubmissionIds: ids });
}

/**
 * Composer picks for the next turn (or the next new chat when threadId is null). A built-in
 * preset (permission) and a custom profile (permissionProfile) exclude each other: picking a
 * preset clears the profile, picking a profile clears the preset.
 */
export function setOverride(
  threadId: string | null,
  patch: Partial<{
    model: string;
    effort: string;
    permission: PermissionPreset;
    permissionProfile: string | null;
    planMode: boolean;
    serviceTier: ServiceTierPick;
    reviewer: Reviewer;
  }>,
): Promise<boolean> {
  const presetPicked = patch.permission !== undefined && !patch.permissionProfile;
  const profilePicked = !!patch.permissionProfile;
  // Fast mode is one switch for every session, saved to config.toml as the Codex app does
  // (writeServiceTier), so the next launch starts where this one left off.
  if (patch.serviceTier) {
    const profile = getState().config?.profile;
    void writeConfig([{ keyPath: profile ? `profiles.${profile}.service_tier` : "service_tier", value: patch.serviceTier, mergeStrategy: "upsert" }]).catch(() => {
      // The pick still holds for this run; only the next launch misses it.
    });
  }
  if (!threadId) {
    // The new-session page remembers its model and effort across restarts (refreshModels checks them).
    if (patch.model) writePref(NEW_SESSION_PICKS.model, patch.model);
    if (patch.effort) writePref(NEW_SESSION_PICKS.effort, patch.effort);
    setState((s) => ({
      prefs: {
        ...s.prefs,
        ...patch,
        ...(presetPicked ? { permissionProfile: null } : {}),
        ...(profilePicked ? { permission: null } : {}),
      },
    }));
    return Promise.resolve(true);
  }
  const { planMode, ...rest } = patch;
  const before = getState().threads[threadId];
  updateThread(threadId, (t) => {
    const overrides = { ...t.overrides, ...rest };
    if (presetPicked) overrides.permissionProfile = null;
    if (profilePicked) delete overrides.permission;
    return { ...t, overrides, planMode: planMode ?? t.planMode };
  });
  // Resolves false when the server refused the pick (and it was taken back).
  return before?.subscribed ? applyThreadSettings(threadId, patch, before) : Promise.resolve(true);
}

/** A default saved in Settings (config.toml) takes over from the new-session page's remembered pick. */
export function forgetNewSessionPick(key: keyof typeof NEW_SESSION_PICKS): void {
  try {
    localStorage.removeItem(NEW_SESSION_PICKS[key]);
  } catch {
    // Private mode: nothing was kept.
  }
  setState((s) => ({ prefs: { ...s.prefs, [key]: null } }));
}

/**
 * A pick on an open session applies to the session right away (thread/settings/update; the
 * running turn too where turn/settings/update allows), as LocalSessions.setModel / setEffort /
 * setFastMode / setPermissionMode do in Claude Desktop. Servers without the method keep the
 * pick for the next turn/start. A refusal restores the previous pick.
 */
async function applyThreadSettings(threadId: string, patch: Parameters<typeof setOverride>[1], before: ThreadState): Promise<boolean> {
  const thread = getState().threads[threadId];
  if (!thread) return true;
  const params: Record<string, unknown> = { threadId };
  if (patch.model) params.model = patch.model;
  if (patch.effort) params.effort = patch.effort;
  if (patch.permission && !patch.permissionProfile) {
    params.approvalPolicy = PRESETS[patch.permission].approval;
    params.sandboxPolicy = PRESETS[patch.permission].policy;
  } else if (patch.permissionProfile) {
    params.permissions = patch.permissionProfile;
  }
  // "default" is the protocol's explicit standard-speed tier.
  if (patch.serviceTier) params.serviceTier = patch.serviceTier;
  if (patch.reviewer) params.approvalsReviewer = patch.reviewer;
  if (patch.planMode !== undefined) {
    const collaborationMode = collaborationModeFor(thread, patch.planMode, before.planMode);
    if (collaborationMode) params.collaborationMode = collaborationMode;
  }
  if (Object.keys(params).length === 1) return true;
  try {
    const response = await optional("thread/settings/update", params);
    if (response === null) return true;
    updateThread(threadId, settleOverrides);
    const running = activeTurn(getState().threads[threadId]);
    const turnParams: Record<string, unknown> = { threadId, turnId: running?.id };
    for (const key of ["model", "effort", "serviceTier", "approvalsReviewer"]) if (key in params) turnParams[key] = params[key];
    if (running && Object.keys(turnParams).length > 2) void optional("turn/settings/update", turnParams).catch(() => {});
    return true;
  } catch {
    updateThread(threadId, (t) => ({ ...t, overrides: before.overrides, planMode: before.planMode }));
    // c9543da06 / cc0051c10 / cc43287c9 failure toasts.
    const text = patch.model
      ? "无法应用模型更改。您可以重试。"
      : patch.effort
        ? "无法应用努力程度更改。您可以重试。"
        : patch.serviceTier
          ? "无法应用快速模式。您可以重试。"
          : "权限模式更改失败。您可以重试。";
    toast("warning", text);
    return false;
  }
}

/** c6314ba87 Z: a network (UNC) path is no session folder, null; WSL's are, as \\wsl.localhost. */
function sessionFolder(path: string): string | null {
  const slashed = path.replaceAll("\\", "/");
  const wsl = /^\/\/(wsl\$|wsl\.localhost)(\/|$)/i.test(slashed);
  if (!wsl) return slashed.startsWith("//") || slashed.startsWith("/??/") ? null : path;
  return /^\/\/wsl\$\//i.test(slashed) ? `\\\\wsl.localhost${path.slice("//wsl$".length)}` : path;
}

/**
 * 更改文件夹… (c6314ba87 he → Z changeCwd): the session works in `path` from its next turn on.
 * thread/settings/update moves it at once; a server without it carries the folder on the next
 * turn/start (turnOverrides). While a turn runs the move waits for it, as Claude's says.
 */
export async function changeThreadFolder(threadId: string, picked: string): Promise<void> {
  const before = getState().threads[threadId];
  if (!before) return;
  const path = sessionFolder(picked);
  if (path === null) return toast("warning", "网络（UNC）路径不能用作会话工作目录。");
  if (samePath(path, threadCwd(before))) return toast("neutral", "会话已在此目录中。");
  const keep = (t: ThreadState): ThreadState => {
    const { cwd: _, ...overrides } = t.overrides;
    return { ...t, overrides: before.overrides.cwd ? { ...overrides, cwd: before.overrides.cwd } : overrides };
  };
  const moved = () => toast("neutral", activeTurn(before) ? `本轮结束后将移至 ${basename(path)}` : `会话已移至 ${path}`);
  updateThread(threadId, (t) => ({ ...t, overrides: { ...t.overrides, cwd: path } }));
  if (!before.subscribed) return moved();
  try {
    if ((await optional("thread/settings/update", { threadId, cwd: path })) === null) return moved();
    updateThread(threadId, (t) => {
      const { cwd: _, ...overrides } = t.overrides;
      return t.settings ? { ...t, overrides, meta: liveGitMeta(t.meta, path), settings: { ...t.settings, cwd: path } } : t;
    });
    void refreshThreadGit(threadId, true);
    moved();
  } catch (error) {
    updateThread(threadId, keep);
    toast("warning", "无法更改会话目录。", errorMessage(error));
  }
}

/** Threads whose next turn/started is a review or compaction (not steerable). */
const nonSteerableNext = new Set<string>();

export async function startReview(threadId: string | null, target: ReviewTarget): Promise<void> {
  const id = threadId ?? (await startThread());
  if (!getState().threads[id].subscribed) await openThread(id, true);
  nonSteerableNext.add(id);
  // The review turn arrives through turn/started; its id need not match the response's turn id.
  await call("review/start", { threadId: id, target, delivery: "inline" });
}

export async function compactThread(id: string): Promise<void> {
  nonSteerableNext.add(id);
  await call("thread/compact/start", { threadId: id });
}

// ---------------------------------------------------------------------------
// Thread management

const namingJobs = new Map<string, AbortController>();

/**
 * Generation uses a private backend channel; applying a title uses the normal metadata RPC.
 * Claude 3.6556 cef1e6037 Ir: the first words stand in until the title comes, and are kept when
 * none does; the result lands only on that stand-in (or nothing), never on a name given meanwhile.
 */
async function generateThreadTitle(id: string, description: string): Promise<void> {
  const thread = getState().threads[id];
  const placeholder = placeholderTitle(description);
  if (!placeholder || !thread || thread.meta.name?.trim() || thread.meta.ephemeral || thread.meta.parentThreadId || spawnOf(thread.meta) || namingJobs.has(id)) return;
  const job = new AbortController();
  namingJobs.set(id, job);
  const named = (t: ThreadState, name: string | null) => !t.meta.name?.trim() || t.meta.name === placeholder ? { ...t, meta: { ...t.meta, name } } : t;
  updateThread(id, (t) => named(t, placeholder));
  try {
    const title = (await requestTitle(description, effectiveSettings(thread).model, job.signal).catch((error) => {
      if (!job.signal.aborted) console.warn("codex-ui: title generation failed", errorMessage(error));
      return null;
    })) ?? placeholder;
    const current = getState().threads[id]?.meta.name?.trim();
    const source = getState().titleSources[id];
    if (job.signal.aborted || source === "user" || source === "tool" || (current && current !== placeholder && current !== title)) return;
    await call("thread/name/set", { threadId: id, name: title });
    updateThread(id, (t) => named(t, title));
    if (!getState().titleSources[id]) setTitleSource(id, "auto");
  } catch (error) {
    if (!job.signal.aborted) console.warn("codex-ui: title generation failed", errorMessage(error));
  } finally {
    if (namingJobs.get(id) === job) namingJobs.delete(id);
    // A stand-in that never reached Codex goes with the job.
    if (job.signal.aborted) updateThread(id, (t) => t.meta.name === placeholder ? { ...t, meta: { ...t.meta, name: null } } : t);
  }
}

/** By hand it is the user's name (Claude's titleSource "user"); a failed rename puts the old name back. */
export async function renameThread(id: string, name: string, source: TitleSource = "user"): Promise<void> {
  const before = getState().threads[id]?.meta.name ?? null, beforeSource = getState().titleSources[id];
  updateThread(id, (t) => ({ ...t, meta: { ...t.meta, name } }));
  setTitleSource(id, source);
  try {
    await call("thread/name/set", { threadId: id, name });
  } catch (error) {
    updateThread(id, (t) => t.meta.name === name ? { ...t, meta: { ...t.meta, name: before } } : t);
    if (getState().titleSources[id] === source) setTitleSource(id, beforeSource);
    throw error;
  }
}

function forgetFromList(...ids: string[]): void {
  setState((s) => ({
    list: { ...s.list, ids: s.list.ids.filter((x) => !ids.includes(x)) },
    landing: s.landing && s.landing.filter((x) => !ids.includes(x)),
    ...(s.splitId && ids.includes(s.splitId) ? { splitId: null } : {}),
    ...(s.activeId && ids.includes(s.activeId) ? (s.splitId && !ids.includes(s.splitId) ? { activeId: s.splitId, splitId: null } : { activeId: null, splitId: null }) : {}),
  }));
}

/**
 * Filter ▸ Status ▸ All lists both kinds, so the row stays and only its archived mark flips;
 * the active or archived list loses it. The thread is touched so rows re-read the mark.
 */
function markArchived(id: string, archived: boolean): void {
  if (archived) archivedIds.add(id);
  else archivedIds.delete(id);
  if (getState().list.status === "all") updateThread(id, (t) => ({ ...t }));
  else forgetFromList(id);
}

export async function archiveThread(id: string): Promise<void> {
  await call("thread/archive", { threadId: id });
  markArchived(id, true);
}

export async function unarchiveThread(id: string): Promise<void> {
  await call("thread/unarchive", { threadId: id });
  markArchived(id, false);
  // thread/archive took its sub-agents along but thread/unarchive restores only the thread it names:
  // bring them back under it. One that fails (a selection restoring it too) stays where it is.
  const spawned = await descendantsOf(id, true);
  const results = await Promise.allSettled(spawned.map((t) => call("thread/unarchive", { threadId: t.id })));
  const restored = spawned.filter((_, index) => results[index].status === "fulfilled");
  for (const t of restored) markArchived(t.id, false);
  joinList(restored);
}

/**
 * thread/delete queues behind every other list write and first shuts a running thread down, so
 * the row (and the sub-agents Codex deletes with it) goes at once; a failed delete lists it again.
 */
export async function deleteThread(id: string): Promise<void> {
  const { list, threads, activeId } = getState();
  const kept = new Set(outliving(id, list.ids, (child) => threads[child]?.meta.parentThreadId));
  forgetFromList(id, ...list.ids.filter((x) => !kept.has(x)));
  try {
    await call("thread/delete", { threadId: id });
  } catch (error) {
    void refreshThreads();
    if (activeId === id && getState().activeId === null) setState({ activeId: id });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Away recap (Claude Code CLI 2.1.309 awaySummary, shown as c4de0b325 mue): back after 5+ minutes
// away, the open session gets a 1-2 sentence recap from its own model and context, through an
// ephemeral fork that runs read-only and asks for nothing. Skipped with a draft or a message on its
// way, a turn running, an earlier recap of the same turn, or the usage limit nearly reached.

/** The CLI's prompt, word for word, and its no-tools rule. */
const RECAP_PROMPT = "The user stepped away and is coming back. Recap in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents. Do not use tools.";
const AWAY_MS = 5 * 60_000;
const RECAP_MAX = 400;
const recapForks = new Map<string, { text: string | null; done(text: string | null): void }>();
const recapping = new Set<string>();
let awaySince: number | null = null;

async function generateRecap(threadId: string): Promise<string | null> {
  const { thread: fork } = await call("thread/fork", { threadId, ephemeral: true, excludeTurns: true, sandbox: "read-only", approvalPolicy: "never" });
  const answer = new Promise<string | null>((resolve) => recapForks.set(fork.id, { text: null, done: resolve }));
  try {
    await call("turn/start", { threadId: fork.id, input: [{ type: "text", text: RECAP_PROMPT, text_elements: [] }] });
    return await Promise.race([answer, new Promise<null>((resolve) => setTimeout(() => resolve(null), 90_000))]);
  } finally {
    recapForks.delete(fork.id);
    void call("thread/unsubscribe", { threadId: fork.id }).catch(() => {});
  }
}

export async function maybeRecap(threadId: string | null): Promise<void> {
  const state = getState();
  const thread = threadId ? state.threads[threadId] : undefined;
  const last = thread?.turns.at(-1);
  if (!threadId || !thread || !state.awayRecap || recapping.has(threadId) || !thread.loaded || thread.meta.parentThreadId || !last || last.status !== "completed" || activeTurn(thread)) return;
  if (state.recaps[threadId]?.turnId === last.id || state.pendingMessages[threadId]) return;
  if ((state.rateLimits?.rateLimits?.primary?.usedPercent ?? 0) >= 90) return;
  try {
    if (localStorage.getItem(`codex-ui:draft:${threadId}`)?.trim()) return;
  } catch {
    // No storage: no draft to keep the recap away from.
  }
  recapping.add(threadId);
  try {
    const text = (await generateRecap(threadId))?.replace(/\s+/g, " ").trim();
    if (!text || getState().threads[threadId]?.turns.at(-1)?.id !== last.id) return;
    const recap = { text: text.length > RECAP_MAX ? `${text.slice(0, RECAP_MAX)}…` : text, at: Date.now(), turnId: last.id };
    setState((s) => ({ recaps: { ...s.recaps, [threadId]: recap } }));
    writeJson("codex-ui:recaps", getState().recaps);
  } catch (error) {
    console.warn("codex-ui: away recap failed", errorMessage(error));
  } finally {
    recapping.delete(threadId);
  }
}

if (typeof window !== "undefined") {
  const away = () => (awaySince ??= Date.now());
  const back = () => {
    const since = awaySince;
    awaySince = null;
    if (since !== null && Date.now() - since >= AWAY_MS) void maybeRecap(getState().activeId);
  };
  window.addEventListener("blur", away);
  window.addEventListener("focus", back);
  document.addEventListener("visibilitychange", () => (document.hidden ? away() : back()));
}

const FORK_POINTS = "codex-ui:fork-points";

/**
 * Where each fork codex-ui made left its parent (c4de0b325 forkMarker): fork id → the last turn it
 * kept. Codex records no fork point, so forks made elsewhere have none and draw no marker.
 */
export function forkPoints(): Record<string, string> {
  return record(readJson(FORK_POINTS)) as Record<string, string>;
}

/** Downloads the whole thread as Markdown, paging in older turns first (导出, and export_transcript). */
export async function exportThread(id: string): Promise<void> {
  while (getState().threads[id]?.olderCursor) await loadTurns(id, true);
  const thread = getState().threads[id];
  if (!thread) return;
  const title = threadTitle(thread.meta);
  const url = URL.createObjectURL(new Blob([threadMarkdown(title, thread.turns)], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?"<>|\s]+/g, " ").trim().slice(0, 80) || "codex"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function forkThread(id: string, lastTurnId?: string): Promise<void> {
  await ensureThreadEnvironment(getState().threads[id]?.meta.projectId);
  const response = await call("thread/fork", { threadId: id, lastTurnId: lastTurnId ?? null, excludeTurns: true, config: threadConfig(getState().threads[id]?.meta.projectId) });
  const forkId = response.thread.id;
  const through = lastTurnId ?? getState().threads[id]?.turns.at(-1)?.id;
  if (through) writeJson(FORK_POINTS, { ...forkPoints(), [forkId]: through });
  setState((s) => ({
    threads: {
      ...s.threads,
      [forkId]: { ...emptyThreadState(response.thread), subscribed: true, settings: settingsFrom(response) },
    },
    list: { ...s.list, ids: [forkId, ...s.list.ids.filter((x) => x !== forkId)] },
  }));
  // Codex keeps the source's name as it is; Claude 3.6556 names a fork "<title> (fork)", with no titleSource.
  const name = forkTitle(threadTitle(getState().threads[id]?.meta ?? response.thread));
  try {
    await call("thread/name/set", { threadId: forkId, name });
    updateThread(forkId, (t) => ({ ...t, meta: { ...t.meta, name } }));
  } catch (error) {
    console.warn("codex-ui: naming the fork failed", errorMessage(error));
  }
  // The fork opens with no success toast (caec4a2d4 Wn).
  await openThread(forkId, true);
}

/** What a session another one starts runs with (Claude 4.29 startSideSession). */
export interface SideThreadSpec {
  context: "fresh" | "fork";
  /** fresh: its own worktree; omitted, it has one when the parent works in one. */
  useWorktree?: boolean;
  model?: string;
  effort?: string;
  permission?: PermissionPreset;
  /** fresh: another local folder than the parent's. */
  cwd?: string;
  // A session with no parent (a scheduled task's run) needs cwd and may name the rest.
  projectId?: string | null;
  threadSource?: string;
  /** Appended to the session's developer instructions (config.developer_instructions, so the user's stay). */
  instructions?: string;
  /** More writable workspace folders beside cwd. */
  roots?: string[];
  approvalPolicy?: AskForApproval | null;
  /** fresh: see UNLOAD_AT_ONCE. */
  unloadAtOnce?: boolean;
}

/** Its checkout as start_session's result says it (sessions.mjs checkoutNote). */
export type SideCheckout = "own" | "shared" | "none" | "fork";

/**
 * A session another one starts, in the background: no draft picks and no switch to it. It takes
 * the parent's folder, environment and settings unless the spec names its own (the caller keeps
 * them at or below the parent's). A worktree is cut from the parent's HEAD, Claude's default; a
 * fork from a worktree session gets a fresh one too. Without a parent it starts fresh in spec.cwd
 * with the new-session defaults, in a worktree only when asked.
 */
export async function startSideThread(parentId: string | null, spec: SideThreadSpec): Promise<{ id: string; checkout: SideCheckout }> {
  const parent = parentId ? getState().threads[parentId] : null;
  if (parentId && !parent) throw new Error("找不到发起此任务的会话。");
  if (!parent && (!spec.cwd || spec.context === "fork")) throw new Error("没有会话可以继承文件夹。");
  const settings = effectiveSettings(parent);
  const projectId = parent ? (spec.cwd ? null : (parent.meta.projectId ?? null)) : (spec.projectId ?? null);
  await ensureThreadEnvironment(projectId);
  let cwd = spec.cwd ?? threadCwd(parent!);
  let worktree: string | null = null;
  let checkout: SideCheckout = spec.context === "fork" ? "fork" : "shared";
  if (parent ? !spec.cwd && (spec.context === "fresh" ? (spec.useWorktree ?? inWorktreeRoot(cwd)) : inWorktreeRoot(cwd)) : spec.useWorktree) {
    const repository = await callExperimental<{ root: string | null }>("codexUi/git/branches", { cwd }).then((info) => info.root, () => null);
    if (repository) {
      const created = await callExperimental<{ cwd: string; worktree: string }>("codexUi/worktree/create", { cwd, base: null, root: worktreeRoot() });
      cwd = created.cwd;
      worktree = created.worktree;
      checkout = "own";
    } else if (spec.context === "fresh") checkout = "none";
  }
  const preset = spec.permission ?? settings.permission;
  const presetDef = preset ? PRESETS[preset] : null;
  const response = spec.context === "fork"
    ? await call("thread/fork", { threadId: parentId!, lastTurnId: null, excludeTurns: true, cwd, config: threadConfig(projectId) })
    : await call("thread/start", {
      cwd,
      model: spec.model ?? settings.model,
      approvalPolicy: spec.approvalPolicy ?? presetDef?.approval ?? null,
      // A custom profile replaces the sandbox (the server rejects the two together).
      ...(presetDef ? { sandbox: presetDef.sandbox } : settings.permissionProfile ? { permissions: settings.permissionProfile } : {}),
      // Not developerInstructions, which would replace the user's own and the host's. The config
      // override replaces config.toml's too, so the user's go first where threadConfig leaves them
      // to the server (an older backend with no plan card).
      config: {
        ...(spec.instructions
          ? appendDeveloperInstructions({ developer_instructions: getState().config?.developer_instructions, ...threadConfig(projectId) }, spec.instructions)
          : threadConfig(projectId)),
        ...(spec.unloadAtOnce && UNLOAD_AT_ONCE),
      },
      ...(settings.serviceTier !== "default" ? { serviceTier: settings.serviceTier } : {}),
      approvalsReviewer: settings.reviewer,
      ...(projectId ? { projectId } : {}),
      ...(spec.threadSource ? { threadSource: spec.threadSource } : {}),
      ...(spec.roots?.length ? { runtimeWorkspaceRoots: [...new Set([cwd, ...spec.roots])] } : {}),
    } as never);
  const id = response.thread.id;
  if (worktree) void callExperimental("codexUi/worktree/bind", { cwd: worktree, threadId: id }).catch(() => {});
  const effort = spec.effort ?? (spec.context === "fresh" ? settings.effort : null);
  setState((s) => ({
    threads: {
      ...s.threads,
      [id]: {
        ...emptyThreadState(liveGitMeta(response.thread)),
        subscribed: true,
        // A fork's history loads when it is opened.
        loaded: spec.context === "fresh",
        settings: settingsFrom(response),
        overrides: effort ? { effort } : {},
      },
    },
    list: s.list.archived ? s.list : { ...s.list, ids: [id, ...s.list.ids.filter((x) => x !== id)] },
  }));
  await syncHostContext(id);
  scheduleBackgroundCheck(id, true);
  void refreshThreadGit(id);
  return { id, checkout };
}

// ---------------------------------------------------------------------------
// Workspace helpers

export async function searchFiles(query: string, root: string): Promise<FuzzyFileSearchResponse["files"]> {
  const response = await call("fuzzyFileSearch", { query, roots: [root], cancellationToken: "composer" });
  return response.files;
}

export async function readDirectory(path: string): Promise<FsReadDirectoryResponse["entries"]> {
  return (await call("fs/readDirectory", { path })).entries;
}

/** A file on the app-server's host, decoded as UTF-8. */
export async function readTextFile(path: string): Promise<string> {
  return base64ToText((await call("fs/readFile", { path })).dataBase64);
}

/** An image on the app-server's host as a data URL (transcript thumbnails of local images). */
export async function readImage(path: string): Promise<string> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const type = ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : /^(png|jpeg|gif|webp|bmp)$/.test(ext) ? ext : "png";
  return `data:image/${type};base64,${(await call("fs/readFile", { path })).dataBase64}`;
}

const watchers = new Map<string, () => void>();

/** Call `onChange` whenever `path` changes (fs/watch); returns the unwatch function. */
export function watchFile(path: string, onChange: () => void): () => void {
  const watchId = crypto.randomUUID();
  watchers.set(watchId, onChange);
  call("fs/watch", { watchId, path }).catch(() => watchers.delete(watchId));
  return () => {
    if (!watchers.delete(watchId)) return;
    void call("fs/unwatch", { watchId }).catch(() => {});
  };
}

/** Find `term` in one thread, including history not loaded yet (thread/searchOccurrences). */
export async function findInThread(threadId: string, term: string, cursor?: string | null): Promise<{ hits: ThreadSearchOccurrence[]; next: string | null }> {
  const response = await optional<{ data: ThreadSearchOccurrence[]; nextCursor: string | null }>("thread/searchOccurrences", {
    threadId,
    searchTerm: term,
    cursor: cursor ?? null,
    limit: 50,
  });
  return { hits: response?.data ?? [], next: response?.nextCursor ?? null };
}

/** Page older history in until `turnId` is loaded (at most 20 pages). */
export async function revealTurn(threadId: string, turnId: string): Promise<boolean> {
  for (let page = 0; page < 20; page++) {
    const thread = getState().threads[threadId];
    if (!thread) return false;
    if (thread.turns.some((turn) => turn.id === turnId)) return true;
    if (!thread.olderCursor) return false;
    await loadTurns(threadId, true);
  }
  return getState().threads[threadId]?.turns.some((turn) => turn.id === turnId) ?? false;
}

export async function refreshAttachments(threadId: string): Promise<void> {
  try {
    const { data } = await call("thread/attachment/list", { threadId, limit: 100 });
    updateThread(threadId, (t) => ({ ...t, attachments: data }));
  } catch {
    // Older servers have no attachments: none, once asked (the rail's PR lookup waits for them).
    updateThread(threadId, (t) => ({ ...t, attachments: t.attachments ?? [] }));
  }
}

/**
 * A PR the agent reports in a <pr-created> tag joins the thread's pull_request attachments, as
 * Claude binds it to the session's PR bar by itself, under Codex desktop's key (webview Xjt).
 */
async function attachCreatedPrs(threadId: string, text: string): Promise<void> {
  const headBranch = getState().threads[threadId]?.meta.gitInfo?.branch ?? null;
  for (const pr of createdPrs(text).flatMap((url) => parsePr(url) ?? [])) {
    await call("thread/attachment/add", { threadId, attachmentType: "pull_request", identityKey: prIdentity(pr), payload: { url: pr.url, headBranch } }).catch(() => undefined);
  }
}

const DISMISSED_KEY = "codex-ui:pr-dismissed";

/** The PRs the user removed, by thread (Claude keeps a dismissed binding), which the branch lookup leaves out. */
function dismissedPrs(): Record<string, string[]> {
  return (readJson(DISMISSED_KEY) ?? {}) as Record<string, string[]>;
}

/** The rail's 移除 on a PR row (Claude's Dismiss): the attachment goes, the PR on GitHub stays. */
export async function removePullRequest(threadId: string, identityKey: string): Promise<void> {
  // Kept first, so a lookup the removal sets off already leaves it out. The 200 sessions that removed
  // one last are kept, as the pane views are.
  const dismissed = dismissedPrs();
  const removed = [...new Set([...(dismissed[threadId] ?? []), identityKey])];
  delete dismissed[threadId];
  dismissed[threadId] = removed;
  const threads = Object.keys(dismissed);
  for (const id of threads.slice(0, Math.max(0, threads.length - 200))) delete dismissed[id];
  writePref(DISMISSED_KEY, JSON.stringify(dismissed));
  await call("thread/attachment/remove", { threadId, attachmentType: "pull_request", identityKey });
}

/**
 * bind_pr: a pull request (its link, or its number in this repository) joins the session's pull
 * requests as gh reads it; an earlier 移除 of it no longer keeps it out.
 */
export async function bindPullRequest(threadId: string, selector: string): Promise<{ status: PrStatus; identityKey: string; already: boolean }> {
  const thread = getState().threads[threadId];
  if (!thread) throw new Error("This session is not loaded.");
  const cwd = thread.settings?.cwd ?? thread.meta.cwd;
  const remote = githubRemote(thread.meta.gitInfo?.originUrl);
  const number = /^#?(\d+)$/.exec(selector.trim())?.[1];
  if (number && !remote) throw new Error("This session's repository has no GitHub remote, so a bare number names no pull request; pass the pull request's full URL.");
  const link = number ? null : parsePr(selector.trim());
  if (!number && !link) throw new Error("pr must be a GitHub pull request URL (https://github.com/owner/repo/pull/123) or a number in this repository.");
  const { status, problem } = await readPr(cwd, number ?? link!.url, number ? `${remote!.host}/${remote!.repo}` : undefined);
  const found = status && parsePr(status.url);
  if (!status || !found) throw new Error(problem ? `gh could not read that pull request: ${ghProblemText(problem)}` : "gh found no such pull request.");
  const identityKey = prIdentity(found);
  if (thread.attachments === null) await refreshAttachments(threadId);
  const already = !!getState().threads[threadId]?.attachments?.some((a) => a.attachmentType === "pull_request" && a.identityKey === identityKey);
  if (!already) {
    const dismissed = dismissedPrs();
    if (dismissed[threadId]?.includes(identityKey)) {
      dismissed[threadId] = dismissed[threadId].filter((key) => key !== identityKey);
      writePref(DISMISSED_KEY, JSON.stringify(dismissed));
    }
    await call("thread/attachment/add", { threadId, attachmentType: "pull_request", identityKey, payload: { url: found.url, headBranch: status.headRef ?? null } });
    await refreshAttachments(threadId);
  }
  return { status, identityKey, already };
}

/** 就绪时自动合并 on or off, the repository's allowed way (squash first). */
export async function setPrAutoMerge(cwd: string, url: string, on: boolean, repo: string | null): Promise<GhAnswer> {
  const allowed = repo ? await runGh(cwd, mergeMethodCommand(repo)) : null;
  return runGh(cwd, autoMergeCommand(url, on, allowed?.ok ? mergeMethod(allowed.stdout) : "--squash"), true);
}

/** What gh printed, and what went wrong when it did not succeed. */
export interface GhAnswer {
  ok: boolean;
  stdout: string;
  problem: GhProblem | null;
}

/**
 * gh through command/exec, as Codex desktop's main process runs it: a read is read-only with the
 * network on; a `write` (merge, ready, auto-merge) changes GitHub, not the checkout, and runs
 * outside the sandbox, a fixed argv with no shell, only when the user asked for it.
 */
export async function runGh(cwd: string, command: string[], write = false): Promise<GhAnswer> {
  try {
    const result = await optional<CommandExecResponse>("command/exec", {
      command,
      cwd,
      timeoutMs: write ? 60_000 : 20_000,
      sandboxPolicy: write ? { type: "dangerFullAccess" } : { type: "readOnly", networkAccess: true },
    });
    if (!result) return { ok: false, stdout: "", problem: null };
    return { ok: result.exitCode === 0, stdout: result.stdout, problem: result.exitCode === 0 ? null : ghProblem(result.stderr ?? "") };
  } catch (error) {
    // command/exec could not start gh at all.
    const message = errorMessage(error);
    return { ok: false, stdout: "", problem: /not found|ENOENT|cannot find|program not found/i.test(message) ? ghProblem("", true) : ghProblem(message) };
  }
}

/**
 * A pull request as gh reads it (gh pr view --json, then the merge queue and open review threads
 * over GraphQL for an open one), or none where gh finds no PR or fails, with what went wrong (gh
 * missing or signed out, SSO, the rate limit, no network): the rail then keeps what Codex knows.
 */
export async function readPr(cwd: string, selector: string, repo?: string): Promise<{ status: PrStatus | null; problem: GhProblem | null }> {
  const view = await runGh(cwd, prViewCommand(selector, repo));
  const status = view.ok ? parsePrView(view.stdout) : null;
  if (!status) return { status: null, problem: view.problem };
  const link = parsePr(status.url);
  if (link && (status.state === "open" || status.state === "draft")) {
    const extra = await runGh(cwd, prExtraCommand(link));
    const found = extra.ok ? parsePrExtra(extra.stdout) : null;
    if (found) Object.assign(status, found, found.queued ? { look: "queued" } : {});
  }
  return { status, problem: null };
}

/**
 * An open PR the branch lookup found joins the thread's pull_request attachments, as Claude
 * binds a lookup's open PR on the session's own branch (GitHubPrManager getPrStateForBranch),
 * unless it is bound already or the user removed it; a merged or closed one stays out.
 */
export async function attachBranchPr(threadId: string, pr: PrStatus, headBranch: string): Promise<void> {
  const link = parsePr(pr.url);
  const attachments = getState().threads[threadId]?.attachments;
  if (!link || !attachments || (pr.state !== "open" && pr.state !== "draft")) return;
  const identityKey = prIdentity(link);
  if (attachments.some((a) => a.attachmentType === "pull_request" && a.identityKey === identityKey) || dismissedPrs()[threadId]?.includes(identityKey)) return;
  await call("thread/attachment/add", { threadId, attachmentType: "pull_request", identityKey, payload: { url: link.url, headBranch } });
  await refreshAttachments(threadId);
}

// ---------------------------------------------------------------------------
// MCP servers

/**
 * Load the MCP inventory into `state.mcp` (2-3 MB: call it lazily), with the subscribed thread so
 * runtimeStatus reflects its connections.
 */
export async function refreshMcp(threadId?: string | null): Promise<void> {
  const active = threadId ?? getState().activeId;
  const subscribed = active && getState().threads[active]?.subscribed ? active : null;
  try {
    setState({ mcp: (await call("mcpServerStatus/list", { limit: 100, detail: "toolsAndAuthOnly", threadId: subscribed })).data });
  } catch (error) {
    toast("warning", "读取 MCP 服务器失败", errorMessage(error));
  }
}

export async function reloadMcpServers(): Promise<void> {
  await call("config/mcpServer/reload", undefined as never);
  if (getState().mcp) await refreshMcp();
}

/** The latest login attempt per MCP server; completions of older attempts are ignored. */
const mcpLogins = new Map<string, string>();

/** Pass the session that hit the sign-in so the server reconnects it there. */
export async function loginMcpServer(name: string, threadId?: string | null): Promise<void> {
  const response = await call("mcpServer/oauth/login", { name, threadId: threadId ?? null });
  if (response.loginId) mcpLogins.set(name, response.loginId);
  window.open(response.authorizationUrl, "_blank", "noopener");
}

// ---------------------------------------------------------------------------
// Skills and hooks

export async function listSkills(cwd: string, forceReload = false): Promise<SkillsListResponse["data"]> {
  return (await call("skills/list", { cwds: cwd ? [cwd] : [], forceReload })).data;
}

/**
 * A plugin's skill goes by name: its path moves to a new version folder when the plugin updates.
 * Turning one on also clears a rule by path that older builds wrote, or it would stay off.
 */
export async function setSkillEnabled(skill: { path: string; name: string; pluginId: string | null }, enabled: boolean): Promise<void> {
  if (!skill.pluginId || enabled) await call("skills/config/write", { path: skill.path, enabled });
  if (skill.pluginId) await call("skills/config/write", { name: skill.name, enabled });
}

/** Rescan skills after files changed, and tell every list of them (skills/changed reaches only loaded sessions). */
export async function refreshSkills(): Promise<void> {
  await listSkills(getState().prefs.cwd, true);
  setState((s) => ({ skillsRev: s.skillsRev + 1 }));
}

/** 卸载: delete a skill's own folder (removableSkillDir decides which may go). */
export async function uninstallSkill(dir: string): Promise<void> {
  await call("fs/remove", { path: dir, recursive: true, force: true });
  await refreshSkills();
}

const SKILLS_REPO = "https://github.com/openai/skills.git";

function codexHome(): string {
  const home = getState().server.info?.codexHome;
  if (!home) throw new Error("未连接到 Codex");
  return home;
}

/** git on the app-server's host, with the network and no credential prompt (the Codex app's runner). */
async function runGit(args: string[], cwd: string): Promise<void> {
  const result = (await call("command/exec", { command: ["git", ...args], cwd, timeoutMs: 60_000, sandboxPolicy: { type: "dangerFullAccess" }, env: { GIT_TERMINAL_PROMPT: "0" } })) as CommandExecResponse;
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} 失败（${result.exitCode}）`);
}

async function exists(path: string): Promise<boolean> {
  return call("fs/getMetadata", { path }).then(
    () => true,
    () => false,
  );
}

/**
 * Bring <codexHome>/vendor_imports/skills up to date with openai/skills (the Codex app's `xN` / `SN`):
 * a shallow sparse clone of skills/.curated and skills/.experimental, then fetch + reset.
 */
export function syncRecommendedSkills(): Promise<void> {
  // One git run at a time on the checkout: a second click joins the one in flight.
  return (syncing ??= syncSkillsRepo().finally(() => (syncing = null)));
}
let syncing: Promise<void> | null = null;

async function syncSkillsRepo(): Promise<void> {
  const vendor = joinPath(codexHome(), "vendor_imports");
  const repo = joinPath(vendor, "skills");
  await call("fs/createDirectory", { path: vendor, recursive: true });
  if (await exists(joinPath(repo, ".git"))) {
    await runGit(["fetch", "--depth", "1", "origin", "main"], repo);
    await runGit(["reset", "--hard", "FETCH_HEAD"], repo);
  } else if (await exists(repo)) {
    throw new Error(`${repo} 已存在但不是 Git 仓库。删除后重试。`);
  } else {
    await runGit(["clone", "--depth", "1", "--filter=blob:none", "--sparse", SKILLS_REPO, "skills"], vendor);
  }
  await runGit(["sparse-checkout", "set", "skills/.curated", "skills/.experimental"], repo);
}

/** The recommended skills in the vendored checkout, and which are in <codexHome>/skills already. */
export async function listRecommendedSkills(): Promise<{ skills: RecommendedSkill[]; installed: Set<string> }> {
  const home = codexHome();
  const root = joinPath(joinPath(joinPath(home, "vendor_imports"), "skills"), "skills");
  const entries = (
    await Promise.all(
      ([".curated", ".experimental"] as const).map(async (folder) => {
        const dir = joinPath(root, folder);
        const listing = await readDirectory(dir).catch(() => []);
        return Promise.all(
          listing
            .filter((entry) => entry.isDirectory)
            .map(async (entry) => {
              const path = joinPath(dir, entry.fileName);
              const text = await readTextFile(joinPath(path, "SKILL.md")).catch(() => null);
              return { id: entry.fileName, path, experimental: folder === ".experimental", text };
            }),
        );
      }),
    )
  ).flat();
  const mine = await readDirectory(joinPath(home, "skills")).catch(() => []);
  return { skills: recommendedSkills(entries), installed: new Set(mine.filter((entry) => entry.isDirectory).map((entry) => entry.fileName)) };
}

/**
 * 安装: copy a recommended skill's folder into <codexHome>/skills/<id>; a folder already there (PDF
 * for pdf on a case-insensitive disk) is the user's and is never copied over.
 */
export async function installRecommendedSkill(skill: RecommendedSkill): Promise<void> {
  const destination = joinPath(joinPath(codexHome(), "skills"), skill.id);
  if (!(await exists(destination))) await call("fs/copy", { sourcePath: skill.path, destinationPath: destination, recursive: true });
  await refreshSkills();
}

export async function setSkillRoots(paths: string[]): Promise<void> {
  await call("skills/extraRoots/set", { extraRoots: paths });
  setState((s) => ({ skillsRev: s.skillsRev + 1 }));
}

/** Hooks for `cwd` with their trust state, into `state.hooks`. */
export async function listHooks(cwd = getState().prefs.cwd): Promise<void> {
  try {
    const { data } = await call("hooks/list", { cwds: cwd ? [cwd] : [] });
    setState({
      hooks: {
        list: data.flatMap((entry) => entry.hooks),
        warnings: data.flatMap((entry) => entry.warnings),
        errors: data.flatMap((entry) => entry.errors),
      },
    });
  } catch (error) {
    setState({ hooks: null });
    toast("warning", "读取钩子失败", errorMessage(error));
  }
}

// Hook state lives under [hooks.state."<key>"] in the user config (tui/src/hooks_rpc.rs).
async function writeHookState(state: Record<string, Record<string, unknown>>): Promise<void> {
  await writeConfig([{ keyPath: "hooks.state", value: state as never, mergeStrategy: "upsert" }]);
  await listHooks();
}

export function setHookEnabled(key: string, enabled: boolean): Promise<void> {
  return writeHookState({ [key]: { enabled } });
}

/** Trust hooks at their current content; untrusted or changed hooks do not run. */
export function trustHooks(hooks: Pick<HookMetadata, "key" | "currentHash">[]): Promise<void> {
  return writeHookState(Object.fromEntries(hooks.map((hook) => [hook.key, { trusted_hash: hook.currentHash }])));
}

// ---------------------------------------------------------------------------
// Plugins and marketplaces

/** The new-session folder, so plugin/list and plugin/installed also find the repo's own marketplaces. */
const pluginRoots = (): string[] => (getState().prefs.cwd ? [getState().prefs.cwd] : []);

/** Installed plugins (plugin/installed, ~50 KB) into `state.plugins`; [] when unsupported. */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const { marketplaces } = await call("plugin/installed", { cwds: pluginRoots() });
    const plugins = marketplaces.flatMap((market) => market.plugins.map((plugin) => ({ ...plugin, marketplaceName: market.name, marketplacePath: market.path })));
    setState({ plugins });
    return plugins;
  } catch {
    setState({ plugins: [] });
    return [];
  }
}

/** The local plugin directory (设置 › 插件's marketplaces). */
export async function pluginDirectory(): Promise<PluginListResponse> {
  return call("plugin/list", { cwds: pluginRoots(), marketplaceKinds: ["local"] });
}

/** The 插件 page's directory tabs, as the Codex app asks for them: 公开 leaves the kinds out (local
 *  marketplaces plus the account's remote catalog), 工作空间 is the workspace directory, and 个人 the
 *  local marketplaces plus, with ChatGPT signed in, what was shared or made remotely. The remote kinds
 *  need ChatGPT auth and go one per request (the app's kDt), so one failing leaves the rest. */
export type PluginDirectoryTab = "public" | "workspace" | "personal";
// Kept per tab and sign-in: a ChatGPT login brings the remote catalogs in.
const catalogs = new Map<string, Promise<PluginListResponse>>();

function listDirectory(tab: PluginDirectoryTab, refetch: boolean): Promise<PluginListResponse> {
  const ask = (kinds: PluginListMarketplaceKind[] | null) =>
    call("plugin/list", { cwds: pluginRoots(), ...(kinds ? { marketplaceKinds: kinds } : {}), ...(refetch ? { forceRefetch: true } : {}) });
  if (tab === "public") return ask(null);
  if (tab === "workspace") return ask(["workspace-directory"]);
  const remote = getState().account?.account?.type === "chatgpt" ? (["shared-with-me", "created-by-me-remote"] as const).map((kind) => ask([kind]).catch(() => null)) : [];
  return Promise.all([ask(["local"]), ...remote]).then(([local, ...rest]) => ({ ...local!, marketplaces: [...local!.marketplaces, ...rest.flatMap((list) => list?.marketplaces ?? [])] }));
}

/** One directory tab (plugin/list), kept until `refetch` asks the server for a fresh remote catalog. */
export function pluginCatalog(tab: PluginDirectoryTab, refetch = false): Promise<PluginListResponse> {
  const key = `${tab}:${getState().account?.account?.type ?? ""}`;
  let pending = refetch ? undefined : catalogs.get(key);
  if (!pending) {
    pending = listDirectory(tab, refetch);
    catalogs.set(key, pending);
    pending.catch(() => catalogs.get(key) === pending && catalogs.delete(key));
  }
  return pending;
}

/** Drops the kept directories (a marketplace added, removed or upgraded) so the next read asks again. */
export const forgetPluginCatalogs = (): void => catalogs.clear();

/** One plugin installed, removed or switched in the kept directories, as the Codex app patches its queries (rDt). */
function patchPluginCatalogs(pluginId: string, patch: Partial<Pick<PluginSummary, "installed" | "enabled">>): void {
  for (const [key, pending] of catalogs)
    catalogs.set(
      key,
      pending.then((list) => ({ ...list, marketplaces: list.marketplaces.map((market) => ({ ...market, plugins: market.plugins.map((plugin) => (plugin.id === pluginId ? { ...plugin, ...patch } : plugin)) })) })),
    );
}

/** plugin/search (experimental, 0.147+); null when the server has none, so the page filters what it holds. */
export async function searchPlugins(term: string, scope: PluginSearchScope = "global", cursor?: string | null): Promise<{ data: PluginSearchResult[]; nextCursor: string | null } | null> {
  return optional<{ data: PluginSearchResult[]; nextCursor: string | null }>("plugin/search", { searchTerm: term, scope, cwds: pluginRoots(), cursor: cursor ?? null, limit: 50 });
}

export async function readPlugin(ref: PluginRef): Promise<PluginDetail> {
  return (await call("plugin/read", ref)).plugin;
}

/** Install; apps that need sign-in come back in appsNeedingAuth (open their installUrl). */
export async function installPlugin(ref: PluginRef, pluginId?: string): Promise<PluginInstallResponse> {
  const response = await call("plugin/install", { ...ref, installAttemptId: crypto.randomUUID() });
  if (pluginId) patchPluginCatalogs(pluginId, { installed: true, enabled: true });
  void listInstalledPlugins();
  return response;
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await call("plugin/uninstall", { pluginId });
  patchPluginCatalogs(pluginId, { installed: false, enabled: false });
  void listInstalledPlugins();
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await writeConfig([{ keyPath: "plugins", value: { [pluginId]: { enabled } }, mergeStrategy: "upsert" }]);
  patchPluginCatalogs(pluginId, { enabled });
  void listInstalledPlugins();
}

/** 检查更新: sync the account's remote plugins (plugin/reconcile), then re-read the installed list. */
export async function reconcilePlugins(): Promise<PluginReconcileResponse> {
  const response = await call("plugin/reconcile", { reason: "check_for_updates" });
  await listInstalledPlugins();
  return response;
}

// Sharing to the ChatGPT workspace (plugin/share/*). The protocol has no member directory: people
// are shown, never added, and a change of general access hands them back unchanged.

/** Upload a local plugin folder as a new share; save takes PRIVATE or UNLISTED, LISTED comes later. */
export function sharePlugin(pluginPath: string, discoverability: Exclude<PluginShareDiscoverability, "LISTED">): Promise<PluginShareSaveResponse> {
  return call("plugin/share/save", { pluginPath, discoverability });
}

/** 上传新版本: upload the folder again to an existing share. Save refuses discoverability and shareTargets next to remotePluginId. */
export function uploadPluginVersion(pluginPath: string, remotePluginId: string): Promise<PluginShareSaveResponse> {
  return call("plugin/share/save", { pluginPath, remotePluginId });
}

export function setShareAccess(share: PluginShareContext, discoverability: PluginShareDiscoverability): Promise<PluginShareUpdateTargetsResponse> {
  return call("plugin/share/updateTargets", { remotePluginId: share.remotePluginId, discoverability, shareTargets: keptTargets(share.sharePrincipals) });
}

/** Plugins this account shared, each with its folder on this computer when there is one. */
export async function listPluginShares(): Promise<PluginShareListItem[]> {
  return (await call("plugin/share/list", {})).data;
}

/** Download a share into the personal marketplace so it can be edited here. */
export function checkoutPluginShare(remotePluginId: string): Promise<PluginShareCheckoutResponse> {
  return call("plugin/share/checkout", { remotePluginId });
}

export async function deletePluginShare(remotePluginId: string): Promise<void> {
  await call("plugin/share/delete", { remotePluginId });
}

/** A plugin mention for turn input (the text gets `@name`), as the TUI sends it. */
export function pluginMention(plugin: PluginSummary): Extract<UserInput, { type: "mention" }> {
  return { type: "mention", name: plugin.interface?.displayName ?? plugin.name, path: `plugin://${plugin.id}` };
}

export async function addMarketplace(source: string, refName?: string | null, sparsePaths?: string[] | null): Promise<MarketplaceAddResponse> {
  const response = await call("marketplace/add", { source, refName: refName ?? null, sparsePaths: sparsePaths?.length ? sparsePaths : null });
  forgetPluginCatalogs();
  // config.marketplaces tells 我的插件 which markets may be upgraded or removed.
  await refreshConfig();
  void listInstalledPlugins();
  return response;
}

export async function removeMarketplace(marketplaceName: string): Promise<void> {
  await call("marketplace/remove", { marketplaceName });
  forgetPluginCatalogs();
  await refreshConfig();
  void listInstalledPlugins();
}

export async function upgradeMarketplaces(marketplaceName?: string): Promise<MarketplaceUpgradeResponse> {
  const response = await call("marketplace/upgrade", { marketplaceName: marketplaceName ?? null });
  forgetPluginCatalogs();
  return response;
}

// ---------------------------------------------------------------------------
// Connectors (ChatGPT apps)

/** Installed connectors with names and icons (app/installed + app/read) into `state.connectors`. */
export async function listConnectors(threadId?: string | null, forceRefresh = false): Promise<Connector[]> {
  try {
    const { apps } = await call("app/installed", { threadId: threadId ?? null, ...(forceRefresh ? { forceRefresh } : {}) });
    const meta = apps.length ? (await call("app/read", { appIds: apps.map((app) => app.id), threadId: threadId ?? null, includeTools: false })).apps : [];
    const byId = new Map(meta.map((app) => [app.id, app]));
    const connectors = apps.map((app): Connector => {
      const info = byId.get(app.id);
      return {
        id: app.id,
        name: info?.name ?? app.runtimeName ?? app.id,
        description: info?.description ?? null,
        iconUrl: info?.iconUrl ?? null,
        iconUrlDark: info?.iconUrlDark ?? null,
        installUrl: info?.installUrl ?? null,
        enabled: app.enabled,
        callable: app.callable,
      };
    });
    setState({ connectors });
    return connectors;
  } catch {
    setState({ connectors: [] });
    return [];
  }
}

export async function setConnectorEnabled(id: string, enabled: boolean): Promise<void> {
  await writeConfig([{ keyPath: "apps", value: { [id]: { enabled } }, mergeStrategy: "upsert" }]);
  setState((s) => ({ connectors: s.connectors?.map((c) => (c.id === id ? { ...c, enabled } : c)) ?? null }));
}

/** One page of the connector directory (experimental app/list); null when the server has none. */
export function browseConnectors(cursor: string | null = null, threadId: string | null = getState().activeId): Promise<AppsListResponse | null> {
  return optional<AppsListResponse>("app/list", { cursor, limit: 50, threadId });
}

/** An app connector's tools with their read-only flag and effective enabled state (app/read includeTools). */
export async function readConnectorTools(id: string): Promise<AppToolSummary[]> {
  const { apps } = await call("app/read", { appIds: [id], threadId: getState().activeId, includeTools: true });
  return apps[0]?.toolSummaries ?? [];
}

export type ToolApproval = "auto" | "prompt" | "writes" | "approve";
export type ToolPermission = "allow" | "ask" | "blocked";

/** The parts of an `[mcp_servers.<name>]` table (or a plugin's server overlay) the connectors page reads. */
export interface McpServerToml {
  enabled?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  env_vars?: (string | { name: string })[];
  enabled_tools?: string[];
  disabled_tools?: string[];
  default_tools_approval_mode?: ToolApproval;
  tools?: Record<string, { approval_mode?: ToolApproval } | undefined>;
}

/** Where a server's settings live: `mcp_servers.<name>`, or the plugin's overlay for a plugin server. */
export function mcpServerKey(name: string, pluginId: string | null): string {
  return pluginId ? `plugins.${keySegment(pluginId)}.mcp_servers.${keySegment(name)}` : `mcp_servers.${keySegment(name)}`;
}

export function mcpServerToml(name: string, pluginId: string | null): McpServerToml | undefined {
  const config = getState().config as Record<string, unknown> | null;
  const table = (pluginId ? (config?.plugins as Record<string, { mcp_servers?: unknown }> | undefined)?.[pluginId]?.mcp_servers : config?.mcp_servers) as Record<string, McpServerToml> | undefined;
  return table?.[name];
}

/** Configured user servers: their names and settings (plugin servers live under `plugins`). */
export function configuredMcpServers(): Record<string, McpServerToml> {
  return ((getState().config as Record<string, unknown> | null)?.mcp_servers as Record<string, McpServerToml> | undefined) ?? {};
}

const approvalFor = (permission: Exclude<ToolPermission, "blocked">): ToolApproval => (permission === "allow" ? "approve" : "prompt");

/** Always allow / needs approval / blocked for some of an app connector's tools (`apps.<id>.tools.<tool>`). */
export async function setAppToolPermission(id: string, tools: string[], permission: ToolPermission): Promise<void> {
  const value = Object.fromEntries(tools.map((tool) => [tool, permission === "blocked" ? { enabled: false } : { enabled: true, approval_mode: approvalFor(permission) }]));
  await writeConfig([{ keyPath: `apps.${keySegment(id)}.tools`, value, mergeStrategy: "upsert" }]);
}

/** The same for an MCP server: blocked tools go in `disabled_tools`, the others get `tools.<tool>.approval_mode`. */
export async function setMcpToolPermission(name: string, pluginId: string | null, tools: string[], permission: ToolPermission): Promise<void> {
  const key = mcpServerKey(name, pluginId);
  const toml = mcpServerToml(name, pluginId);
  const disabled = new Set(toml?.disabled_tools ?? []);
  // An allow-list (`enabled_tools`) blocks whatever it leaves out: unblocking adds the tool to it.
  const enabled = toml?.enabled_tools ? new Set(toml.enabled_tools) : null;
  for (const tool of tools) {
    if (permission === "blocked") disabled.add(tool);
    else {
      disabled.delete(tool);
      enabled?.add(tool);
    }
  }
  const edits: ConfigBatchWriteParams["edits"] = [{ keyPath: `${key}.disabled_tools`, value: [...disabled], mergeStrategy: "replace" }];
  if (enabled) edits.push({ keyPath: `${key}.enabled_tools`, value: [...enabled], mergeStrategy: "replace" });
  if (permission !== "blocked") {
    const approval = { approval_mode: approvalFor(permission) };
    edits.push({ keyPath: `${key}.tools`, value: Object.fromEntries(tools.map((tool) => [tool, approval])), mergeStrategy: "upsert" });
  }
  await writeMcpConfig(edits);
}

/** Write MCP settings, then restart the servers so the inventory reflects them. */
export async function writeMcpConfig(edits: ConfigBatchWriteParams["edits"]): Promise<void> {
  await writeConfig(edits);
  await reloadMcpServers();
}

/** Connect / disconnect an MCP server (`enabled`). */
export const setMcpServerEnabled = (name: string, pluginId: string | null, enabled: boolean) =>
  writeMcpConfig([{ keyPath: `${mcpServerKey(name, pluginId)}.enabled`, value: enabled, mergeStrategy: "replace" }]);

/**
 * A server the user's own config.toml defines (config/read origins), the only kind the page edits or
 * removes: a project's or a managed layer's would only be shadowed by a write to the user file.
 */
export function userMcpServer(name: string): boolean {
  const origins = getState().configOrigins;
  const origin = origins[`mcp_servers.${name}.command`] ?? origins[`mcp_servers.${name}.url`];
  return origin?.name.type === "user";
}

export const removeMcpServer = (name: string) => writeMcpConfig([{ keyPath: mcpServerKey(name, null), value: null, mergeStrategy: "replace" }]);

// ---------------------------------------------------------------------------
// Memory

export async function readMemoryStatus(): Promise<MemoryStatus | null> {
  return optional<MemoryStatus>("memory/status", {});
}

/** Clear every saved memory (destructive: confirm first). */
export async function resetMemory(): Promise<void> {
  const response = await optional("memory/reset", undefined);
  if (response === null) throw new Error("当前 Codex 版本不支持清除记忆");
}

export function memoriesEnabled(): boolean {
  return featureEnabled("memories");
}

/** The memories feature: persisted in config and applied to this server right away. */
export async function setMemoriesEnabled(on: boolean): Promise<void> {
  await writeConfig([{ keyPath: "features.memories", value: on, mergeStrategy: "replace" }]);
  await setFeature("memories", on).catch(() => refreshFeatures());
}

/** use: inject memories into prompts; generate: build memories from sessions. */
export function memorySettings(): { use: boolean; generate: boolean } {
  const memories = getState().config?.memories as { use_memories?: boolean; generate_memories?: boolean } | null | undefined;
  return { use: memories?.use_memories !== false, generate: memories?.generate_memories !== false };
}

export async function setMemorySettings(patch: { use?: boolean; generate?: boolean }): Promise<void> {
  const edits: ConfigBatchWriteParams["edits"] = [];
  if (patch.use !== undefined) edits.push({ keyPath: "memories.use_memories", value: patch.use, mergeStrategy: "replace" });
  if (patch.generate !== undefined) edits.push({ keyPath: "memories.generate_memories", value: patch.generate, mergeStrategy: "replace" });
  if (!edits.length) return;
  await writeConfig(edits);
  // Like the TUI, the open session follows a change to memory generation.
  const { activeId } = getState();
  if (patch.generate !== undefined && activeId) void setMemoryMode(activeId, patch.generate ? "enabled" : "disabled").catch(() => {});
}

/** Whether this thread may feed memory generation; null updates the next new chat. */
export async function setMemoryMode(threadId: string | null, mode: "enabled" | "disabled"): Promise<void> {
  if (!threadId) {
    setState((s) => ({ prefs: { ...s.prefs, memory: mode === "enabled" } }));
    return;
  }
  updateThread(threadId, (t) => ({ ...t, memory: mode }));
  const response = await optional("thread/memoryMode/set", { threadId, mode });
  if (response === null) throw new Error("当前 Codex 版本不支持按会话设置记忆");
}

/** The pipeline `memories.version` selects: v1 writes CODEX_HOME/memories, v2 CODEX_HOME/memories_v2 (memory_version.rs). */
export function memoryDirectory(): string {
  const memories = getState().config?.memories as { version?: string } | null | undefined;
  return memories?.version === "v2" ? "memories_v2" : "memories";
}

/** Files under the active memory directory (MEMORY.md, memory_summary.md, rollout_summaries/, …). */
export async function memoryFiles(subdir = ""): Promise<FsReadDirectoryEntry[]> {
  const home = getState().server.info?.codexHome;
  if (!home) return [];
  const separator = home.includes("\\") ? "\\" : "/";
  try {
    return await readDirectory([home, memoryDirectory(), subdir].filter(Boolean).join(separator));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Background terminals (agent-started long-running processes)

let backgroundCheck: { threadId: string; delay: number; timer?: ReturnType<typeof setTimeout> } | null = null;
const backgroundReads = new Map<string, { promise: Promise<void>; again: boolean }>();

export function refreshBackground(threadId: string, changed = false): Promise<void> {
  const pending = backgroundReads.get(threadId);
  if (pending) {
    if (changed) pending.again = true;
    return pending.promise;
  }
  if (backgroundCheck?.threadId === threadId) clearTimeout(backgroundCheck.timer);
  const read = { promise: Promise.resolve(), again: false };
  backgroundReads.set(threadId, read);
  read.promise = (async () => {
    do {
      read.again = false;
      await Promise.all([refreshTerminals(threadId), loadDescendants(threadId)]);
    } while (read.again && backgroundReads.get(threadId) === read);
  })().finally(() => {
    if (backgroundReads.get(threadId) !== read) return;
    backgroundReads.delete(threadId);
    scheduleBackgroundCheck(threadId);
  });
  return read.promise;
}

async function refreshTerminals(threadId: string): Promise<void> {
  if (!getState().threads[threadId]?.subscribed) return;
  try {
    const response = await optional<{ data: BackgroundTerminal[] }>("thread/backgroundTerminals/list", { threadId, limit: 50 });
    const data = (response?.data ?? []).map((t) => ({ ...t, cpuPercent: t.cpuPercent ?? null }));
    updateThread(threadId, (t) => t.subscribed ? { ...t, background: data } : t);
  } catch {
    // A failed read must not make a running shell disappear or stop its next check.
  }
}

function needsBackgroundCheck(threadId: string): boolean {
  const { activeId, conn, threads } = getState();
  const thread = threads[threadId];
  return activeId === threadId && conn.status === "ready" && !!thread?.loaded && !isArchivedThread(threadId)
    && (typeof document === "undefined" || document.visibilityState !== "hidden")
    && (thread.meta.status.type === "active" || !!(thread.subscribed && activeTurn(thread))
      || thread.background.length > 0 || agentTasks(thread, threads).some((task) => task.status === "running"));
}

/** Nested code-mode spawns and shells have incomplete push events; check only while work runs. */
function scheduleBackgroundCheck(threadId: string, reset = false): void {
  if (getState().activeId !== threadId) return;
  if (!needsBackgroundCheck(threadId)) return stopBackgroundCheck();
  if (backgroundCheck?.threadId !== threadId) {
    stopBackgroundCheck();
    backgroundCheck = { threadId, delay: 1000 };
  }
  const check = backgroundCheck;
  if (reset) check.delay = 1000;
  clearTimeout(check.timer);
  if (backgroundReads.has(threadId)) return;
  check.timer = setTimeout(() => {
    if (backgroundCheck !== check) return;
    if (!needsBackgroundCheck(threadId)) return stopBackgroundCheck();
    void refreshBackground(threadId);
  }, check.delay);
  check.delay = Math.min(check.delay * 2, 30_000);
}

function stopBackgroundCheck(): void {
  if (backgroundCheck) clearTimeout(backgroundCheck.timer);
  backgroundCheck = null;
}

function refreshVisibleBackground(): void {
  const { activeId, conn, threads } = getState();
  if (activeId && conn.status === "ready" && threads[activeId]?.loaded
    && (typeof document === "undefined" || document.visibilityState !== "hidden")) void refreshBackground(activeId, true);
}

/** Only events in the viewed family need discovery; an event during a read gets one follow-up. */
function backgroundChanged(threadId: string, discover = true): void {
  const { activeId, threads } = getState();
  if (!activeId || getState().conn.status !== "ready" || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
  for (let at: string | null | undefined = threadId, depth = 0; at && depth < 32; at = threads[at]?.meta.parentThreadId, depth++) {
    if (at !== activeId) continue;
    if (discover) {
      if (backgroundCheck?.threadId === activeId) backgroundCheck.delay = 1000;
      void refreshBackground(activeId, true);
    } else scheduleBackgroundCheck(activeId, true);
    return;
  }
}

/** Whether app-server killed the process; false when it had already exited. */
export async function terminateBackground(threadId: string, processId: string): Promise<boolean> {
  const response = await callExperimental<{ terminated?: boolean } | null>("thread/backgroundTerminals/terminate", { threadId, processId });
  await refreshBackground(threadId, true);
  return response?.terminated === true;
}

/**
 * 停止此任务, from the rail or the pane (Claude c6b8adeaf Vo): one request per task at a time, a
 * shell app-server killed reads as stopped from then on, and a failure is one warning.
 */
/**
 * cb6930dae is → backgroundRunningTools: the commands stop being waited on and run on in the
 * background, the model getting control back (the experimental backend's
 * thread/backgroundTerminals/background).
 */
export async function backgroundCommands(threadId: string, processIds: string[]): Promise<void> {
  const results = await Promise.allSettled(processIds.map((processId) => callExperimental<{ backgrounded: boolean }>("thread/backgroundTerminals/background", { threadId, processId })));
  if (results.some((result) => result.status === "rejected")) toast("warning", "无法在后台运行此命令。");
}

export async function stopBackgroundTask(task: BackgroundTask): Promise<void> {
  if (isStopping(task.key)) return;
  setStopping(task.key, true);
  try {
    if (task.kind === "agent") await stopAgentTask(task.threadId);
    else if (task.kind === "workflow") await stopWorkflow(task.ownerId, task.workflowId);
    else if (await terminateBackground(task.ownerId, task.processId)) markStopped(task.key);
  } catch {
    toast("warning", "无法停止任务——请检查您的网络连接后重试。");
  } finally {
    setStopping(task.key, false);
  }
}

/** Stops a workflow run and its agents; one this server no longer runs ends here (c6b8adeaf Ao). */
async function stopWorkflow(threadId: string, runId: string): Promise<void> {
  const response = await callExperimental<{ stopped: boolean }>("thread/workflows/stop", { threadId, runId });
  if (!response.stopped) endRun(threadId, runId);
}

export async function stopAgentTask(threadId: string): Promise<void> {
  // An empty turn id interrupts startup too, without resuming or unloading the child.
  const interrupted = await call("turn/interrupt", { threadId, turnId: activeTurn(getState().threads[threadId])?.id ?? "" }).then(() => null, (error: unknown) => ({ error }));
  const response = await callExperimental<{ thread: Thread }>("thread/read", { threadId });
  setState((s) => ({ threads: rememberThreads([response.thread], s.threads) }));
  const history = await call("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "full" });
  updateThread(threadId, (t) => history.data.reduce((state, turn) => updateTurn(state, turn.id, (current) => ({ ...current, ...turn })), t));
  // Claude c6b8adeaf Ao: a stop that finds the task already ended is not a failure.
  if (interrupted && agentRunStatus(getState().threads[threadId]) === "running") throw interrupted.error;
}

// ---------------------------------------------------------------------------
// Auto-review (Guardian)

/** 仍然允许: let a denied action through (thread/approveGuardianDeniedAction). */
export async function approveDeniedAction(threadId: string, turnId: string, reviewId: string): Promise<void> {
  const turn = getState().threads[threadId]?.turns.find((t) => t.id === turnId);
  const review = turn?.reviews?.find((r) => r.id === reviewId);
  if (!review?.overridable) return;
  await call("thread/approveGuardianDeniedAction", { threadId, event: guardianEvent(turnId, review) as never });
  updateThread(threadId, (t) =>
    updateTurn(t, turnId, (current) => ({ ...current, reviews: current.reviews?.map((r) => (r.id === reviewId ? { ...r, overridden: true } : r)) })),
  );
}

// ---------------------------------------------------------------------------
// Remote control. Durable like the Codex app's (null params): app-server keeps the switch in its
// state DB and a plain `codex app-server` turns it back on at startup (status/changed follows).

export async function refreshRemoteControl(): Promise<void> {
  const status = await optional<RemoteControlStatusChangedNotification>("remoteControl/status/read", undefined).catch(() => null);
  setState({ remoteControl: status });
}

export async function setRemoteControl(enabled: boolean): Promise<void> {
  // A durable disable needs the ChatGPT login too; without one, switch off for this app-server only.
  const params = enabled || getState().account?.account?.type === "chatgpt" ? null : { ephemeral: true };
  const status = await optional<RemoteControlStatusChangedNotification>(enabled ? "remoteControl/enable" : "remoteControl/disable", params);
  if (!status) throw new Error("当前 Codex 版本不支持 Remote Control");
  setState({ remoteControl: status });
}

export async function startPairing(): Promise<RemotePairing> {
  const pairing = await callExperimental<RemotePairing>("remoteControl/pairing/start", { manualCode: true });
  return { ...pairing, expiresAt: Number(pairing.expiresAt) };
}

export async function pairingClaimed(codes: { pairingCode?: string | null; manualPairingCode?: string | null }): Promise<boolean> {
  return (await callExperimental<{ claimed: boolean }>("remoteControl/pairing/status", codes)).claimed;
}

export async function remoteClients(environmentId: string): Promise<RemoteClient[]> {
  const { data } = await callExperimental<{ data: RemoteClient[] }>("remoteControl/client/list", { environmentId, limit: 50 });
  return data.map((client) => ({ ...client, lastSeenAt: client.lastSeenAt === null ? null : Number(client.lastSeenAt) }));
}

export async function revokeRemoteClient(environmentId: string, clientId: string): Promise<void> {
  await callExperimental("remoteControl/client/revoke", { environmentId, clientId });
}

// ---------------------------------------------------------------------------
// Windows sandbox and external agent import

export async function windowsSandboxReadiness(): Promise<WindowsSandboxReadiness | null> {
  if (getState().server.info?.platformOs !== "windows") return null;
  try {
    return (await call("windowsSandbox/readiness", undefined)).status;
  } catch {
    return null;
  }
}

/** elevated shows a UAC prompt; the result arrives as windowsSandbox/setupCompleted. */
export async function startWindowsSandboxSetup(mode: WindowsSandboxSetupMode): Promise<boolean> {
  return (await call("windowsSandbox/setupStart", { mode, cwd: getState().prefs.cwd || null })).started;
}

export async function detectImports(cwd = getState().prefs.cwd): Promise<ExternalAgentConfigMigrationItem[]> {
  return (await call("externalAgentConfig/detect", { includeHome: true, cwds: cwd ? [cwd] : null })).items;
}

/** Start an import; progress lands in `state.imports`. */
export async function runImport(items: ExternalAgentConfigMigrationItem[]): Promise<string> {
  const { importId } = await call("externalAgentConfig/import", { migrationItems: items });
  setState({ imports: { id: importId, results: [], done: false } });
  return importId;
}

// ---------------------------------------------------------------------------
// Auto-archive (Settings → Codex → 归档不活跃的会话; c71860c77 ccAutoArchiveInactiveDays)

/**
 * Archives sessions idle for `days`; running ones, ones with background work or a waiting request,
 * the open one and ones an active heartbeat watches (archiving would pause it unasked) stay.
 */
export async function archiveInactiveThreads(days: number): Promise<void> {
  const cutoff = Date.now() / 1000 - days * 86_400;
  if (automationsState().items === null) await refreshAutomations();
  // Tasks that could not be read may watch any session: the next sweep tries again.
  const items = automationsState().items;
  if (!items) return;
  const watched = items.flatMap((task) => (task.kind === "heartbeat" && task.status === "ACTIVE" && task.targetThreadId ? [task.targetThreadId] : []));
  const { activeId, splitId, requests, threads } = getState();
  const keep = new Set([activeId, splitId, ...requests.map(requestThreadId), ...watched]);
  const stale: string[] = [];
  // Oldest first: the walk stops at the first page that reaches the cutoff.
  for (let cursor: string | null = null, more = true; more; ) {
    const page: ThreadListResponse = await call("thread/list", {
      cursor,
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "asc",
      sourceKinds: LIST_SOURCES.filter((kind) => kind !== "subAgentThreadSpawn"),
    });
    const idle = page.data.filter((thread) => thread.updatedAt <= cutoff);
    for (const thread of idle) {
      if (thread.status.type !== "active" && !keep.has(thread.id) && !threads[thread.id]?.background.length) stale.push(thread.id);
    }
    cursor = page.nextCursor;
    more = cursor !== null && idle.length === page.data.length;
  }
  for (const id of stale) await archiveThread(id);
}

// ---------------------------------------------------------------------------
// Built-in terminal (process/spawn with a PTY, no Codex sandbox)

interface TerminalCallbacks {
  onData(bytes: Uint8Array): void;
  onExit(code: number): void;
}
const terminals = new Map<string, TerminalCallbacks>();

// The shell first prints its pid as OSC 7337 (Terminal.tsx reads it for 关闭终端？), then becomes
// the chosen shell, or $SHELL, as a login shell; exec keeps the pid.
const POSIX_SHELL = 'printf "\\033]7337;%s\\007" "$$"; exec "${1:-${SHELL:-/bin/bash}}" -l';
const windowsShell = (program: string | null) =>
  !program || /(?:^|\\)(?:powershell|pwsh)\.exe$/i.test(program) ? [program ?? "powershell.exe", "-NoLogo"] : /bash\.exe$/i.test(program) ? [program, "--login", "-i"] : [program];

/** The shells a terminal may start in (c9bd7af9c Q2jUneEhyD), read once: /etc/shells, or Windows' usual ones that exist. */
let shellList: Promise<string[]> | undefined;
export function listShells(): Promise<string[]> {
  return (shellList ??= (async () => {
    const windows = getState().server.info?.platformOs === "windows";
    const candidates = windows
      ? ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Program Files\\PowerShell\\7\\pwsh.exe", "C:\\Windows\\System32\\cmd.exe", "C:\\Program Files\\Git\\bin\\bash.exe"]
      : parseShells(await readTextFile("/etc/shells").catch(() => ""));
    const found = await Promise.all(candidates.map((path) => exists(path)));
    return candidates.filter((_, i) => found[i]);
  })().catch(() => []));
}

/** Whether a command runs in the terminal whose shell has `pid` (its foreground process group is not the shell's). */
export async function terminalBusy(pid: number): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0 || getState().server.info?.platformOs === "windows") return false;
  try {
    const result = (await call("command/exec", { command: ["ps", "-o", "tpgid=,pgid=", "-p", String(pid)], cwd: "/", timeoutMs: 3000, sandboxPolicy: { type: "dangerFullAccess" } })) as CommandExecResponse;
    return result.exitCode === 0 && commandRunning(result.stdout);
  } catch {
    // Unreadable: closing goes ahead, as before this check existed.
    return false;
  }
}

/**
 * A shell in `cwd`. Returns at once; writes and resizes wait for the spawn. onData receives raw
 * PTY bytes (xterm's term.write(Uint8Array) handles UTF-8 split across chunks).
 */
export function openTerminal(
  cwd: string,
  size: { rows: number; cols: number },
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number) => void,
  /** 选择 shell (c9bd7af9c Q2jUneEhyD): a path from listShells; null for the default. */
  program: string | null = null,
): { write(data: string): void; resize(rows: number, cols: number): void; kill(): void } {
  const processHandle = crypto.randomUUID();
  terminals.set(processHandle, { onData, onExit });
  const windows = getState().server.info?.platformOs === "windows";
  const fail = (detail: string) => {
    toast("warning", "无法启动 shell", detail);
    terminals.delete(processHandle);
    onExit(-1);
    return false;
  };
  // optional(): a server without process/spawn is remembered, so supports("process/spawn") turns false.
  const spawned = optional("process/spawn", {
    command: windows ? windowsShell(program) : ["/bin/sh", "-c", POSIX_SHELL, "sh", program ?? ""],
    processHandle,
    cwd,
    tty: true,
    size,
    env: { TERM: "xterm-256color" },
    // Omitted, the server default timeout and output cap would end the session.
    timeoutMs: null,
    outputBytesCap: null,
  }).then(
    (response) => response !== null || fail("当前 Codex 版本不支持终端"),
    (error) => fail(errorMessage(error)),
  );
  const after = (method: string, params: Record<string, unknown>) =>
    void spawned.then((ok) => (ok && terminals.has(processHandle) ? callExperimental(method, { processHandle, ...params }) : undefined)).catch(() => {});
  return {
    write: (data) => after("process/writeStdin", { deltaBase64: textToBase64(data) }),
    resize: (rows, cols) => after("process/resizePty", { size: { rows, cols } }),
    kill: () => after("process/kill", {}),
  };
}

// ---------------------------------------------------------------------------
// Server -> client requests (approvals, questions, elicitations)

export function requestThreadId(request: ServerRequest): string | null {
  const params = request.params as { threadId?: string | null; conversationId?: string };
  return params.threadId ?? params.conversationId ?? null;
}

/** The session a request waits in: a sub-agent's waits in the session it runs in, where its card docks. */
export function requestSessionId(request: ServerRequest, threads: Record<string, ThreadState> = getState().threads): string | null {
  const id = requestThreadId(request);
  return id && spawnRoot(id, (at) => threads[at]?.meta.parentThreadId);
}

function onServerRequest(request: ServerRequest): void {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/permissions/requestApproval":
    case "item/tool/requestUserInput":
    case "mcpServer/elicitation/request":
      setState((s) => ({ requests: [...s.requests, request] }));
      return;
    default:
      // Experimental, so absent from the stable union: asked only when config picks the external
      // clock (features.current_time_reminder.clock_source).
      if ((request.method as string) === "currentTime/read") {
        rpc.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      // Dynamic tools, external auth refresh, attestation and v1 approvals are never opted into.
      rpc.respondError(request.id, `Codex UI does not handle ${request.method}`);
  }
}

export function resolveRequest(id: RequestId, result: unknown): void {
  rpc.respond(id, result);
  setState((s) => ({ requests: s.requests.filter((r) => r.id !== id) }));
}

// ---------------------------------------------------------------------------
// Notifications

let noticeId = 0;

/** A one-line notice in a thread's transcript (thread-scoped warnings, reroutes, …). */
function addNotice(threadId: string, turnId: string | null, notice: Omit<Notice, "id" | "turnId">): void {
  updateThread(threadId, (t) => {
    // The same warning repeated in one turn, or thread-wide across turns, shows once.
    if (t.notices.some((n) => n.kind === notice.kind && n.text === notice.text && n.turnId === turnId)) return t;
    return { ...t, notices: [...t.notices.slice(-49), { ...notice, id: ++noticeId, turnId }] };
  });
}

const sortHooks = (runs: HookRunSummary[]) => runs.slice().sort((a, b) => Number(a.displayOrder) - Number(b.displayOrder) || Number(a.startedAt) - Number(b.startedAt));

function upsertHook(threadId: string, turnId: string | null, run: HookRunSummary): void {
  updateThread(threadId, (t) =>
    turnId
      ? updateTurn(t, turnId, (turn) => ({ ...turn, hooks: sortHooks(upsertBy(turn.hooks ?? [], (r) => r.id, run)) }))
      : { ...t, hooks: sortHooks(upsertBy(t.hooks, (r) => r.id, run)) },
  );
}

function upsertReview(threadId: string, turnId: string, review: Omit<AutoReview, "summary" | "overridable" | "overridden">): void {
  updateThread(threadId, (t) =>
    updateTurn(t, turnId, (turn) => {
      const previous = turn.reviews?.find((r) => r.id === review.id);
      const next: AutoReview = {
        ...review,
        summary: reviewSummary(review.action),
        overridable: review.review.status === "denied" && overridable(review.action),
        overridden: previous?.overridden,
      };
      return { ...turn, reviews: upsertBy(turn.reviews ?? [], (r) => r.id, next) };
    }),
  );
}

function onNotification(notification: ServerNotification): void {
  // An away recap's ephemeral fork (maybeRecap) is no session: only its answer is read.
  const recapId = (notification.params as { threadId?: unknown } | undefined)?.threadId;
  if (typeof recapId === "string" && recapForks.has(recapId)) {
    const fork = recapForks.get(recapId)!;
    if (notification.method === "item/completed" && notification.params.item.type === "agentMessage") fork.text = notification.params.item.text;
    if (notification.method === "turn/completed") fork.done(notification.params.turn.status === "completed" ? fork.text : null);
    return;
  }
  switch (notification.method) {
    case "thread/started":
      if (notification.params.thread.ephemeral) return;
      joinList([notification.params.thread]);
      backgroundChanged(notification.params.thread.id);
      return;
    case "thread/status/changed": {
      const { threadId, status } = notification.params;
      updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, status }, agentTurn: status.type === "active" ? undefined : t.agentTurn }));
      backgroundChanged(threadId, status.type !== "active");
      return;
    }
    case "thread/name/updated": {
      const { threadId, threadName } = notification.params;
      updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, name: threadName ?? null } }));
      return;
    }
    case "thread/deleted":
      setKeepAwake(notification.params.threadId, false);
      setTitleSource(notification.params.threadId, undefined);
      forgetAsked(notification.params.threadId);
      forgetTodos(notification.params.threadId);
      forgetSession(notification.params.threadId);
      forgetLazyWorktree(notification.params.threadId);
      forgetFromList(notification.params.threadId);
      automationThreadEvent(notification.params.threadId, "deleted");
      return;
    case "thread/archived":
      // Archiving lets go of the session's 保持计算机唤醒, as Claude's does (manualKeepAwake cleared).
      setKeepAwake(notification.params.threadId, false);
      // Codex shuts an archived thread down with no thread/closed: opening it again resumes it.
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false, background: [] }));
      endRunningRuns(notification.params.threadId);
      // The archived list already has it; elsewhere markArchived flips or drops the row.
      if (getState().list.status !== "archived") markArchived(notification.params.threadId, true);
      else archivedIds.add(notification.params.threadId);
      automationThreadEvent(notification.params.threadId, "archived");
      return;
    case "thread/unarchived": {
      const { threadId } = notification.params;
      const { status } = getState().list;
      automationThreadEvent(threadId, "unarchived");
      if (status === "active") {
        archivedIds.delete(threadId);
        void refreshThreads();
      } else markArchived(threadId, false);
      return;
    }
    case "thread/closed":
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false, background: [] }));
      // Shutting the thread down stopped its workflows.
      endRunningRuns(notification.params.threadId);
      backgroundReads.delete(notification.params.threadId);
      if (backgroundCheck?.threadId === notification.params.threadId) stopBackgroundCheck();
      return;
    case "thread/environment/connected":
    case "thread/environment/disconnected": {
      const { threadId, environmentId } = notification.params;
      const connected = notification.method === "thread/environment/connected";
      if (getState().threads[threadId]) addNotice(threadId, null, { kind: "environment", text: connected ? `已连接到环境 ${environmentId}` : `已断开与环境 ${environmentId} 的连接` });
      return;
    }
    case "thread/reverted": {
      const { threadId } = notification.params;
      if (ownReverts.delete(threadId)) return;
      // Another window rewound this thread: reload what is left.
      const thread = getState().threads[threadId];
      if (!thread?.loaded) return;
      updateThread(threadId, (t) => ({ ...t, turns: [], olderCursor: null, loaded: false }));
      // The revert shut the thread down: a kept run reloaded as running has stopped.
      void loadTurns(threadId, false).then(() => endRunningRuns(threadId)).catch(() => {});
      return;
    }
    case "thread/readState/changed": {
      const { threadId, readState } = notification.params;
      updateThread(threadId, (t) => ({ ...t, readState }));
      return;
    }
    case "thread/tokenUsage/updated": {
      const { threadId, tokenUsage } = notification.params;
      updateThread(threadId, (t) => ({ ...t, tokenUsage }));
      return;
    }
    case "thread/settings/updated": {
      const { threadId, threadSettings: s } = notification.params;
      const previous = getState().threads[threadId];
      const moved = previous && (previous.settings?.cwd ?? previous.meta.cwd) !== s.cwd;
      updateThread(threadId, (t) => ({
        ...t,
        meta: moved ? liveGitMeta(t.meta, s.cwd) : t.meta,
        planMode: s.collaborationMode ? s.collaborationMode.mode === "plan" : t.planMode,
        settings: {
          model: s.model,
          effort: s.effort,
          approvalPolicy: s.approvalPolicy,
          sandbox: s.sandboxPolicy,
          cwd: s.cwd,
          serviceTier: s.serviceTier,
          approvalsReviewer: reviewerOf(s.approvalsReviewer),
          permissionProfile: s.activePermissionProfile?.id ?? null,
        },
      }));
      if (moved) void refreshThreadGit(threadId, true);
      return;
    }
    case "thread/goal/updated": {
      const { threadId, goal } = notification.params;
      updateThread(threadId, (t) => ({ ...t, goal }));
      return;
    }
    case "thread/goal/cleared":
      updateThread(notification.params.threadId, (t) => ({ ...t, goal: null }));
      return;
    case "thread/queue/changed":
      void refreshQueue(notification.params.threadId);
      return;
    case "thread/attachment/updated":
      if (getState().threads[notification.params.threadId]?.attachments) void refreshAttachments(notification.params.threadId);
      return;
    case "thread/project/updated": {
      const { threadId, projectId } = notification.params;
      updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, projectId } }));
      return;
    }
    case "project/changed":
      void refreshProjects();
      return;
    case "turn/started": {
      const { threadId, turn } = notification.params;
      const steerable = nonSteerableNext.delete(threadId) ? { steerable: false as const } : {};
      updateThread(threadId, (t) =>
        updateTurn(t, turn.id, (current) => ({ ...current, ...turn, ...steerable, items: current.items.length ? current.items : turn.items })),
      );
      reconcilePendingMessage(threadId);
      backgroundChanged(threadId);
      return;
    }
    case "turn/completed": {
      const { threadId, turn } = notification.params;
      updateThread(threadId, (t) => {
        const next = updateTurn(t, turn.id, (current) => ({
          ...current,
          status: turn.status,
          error: turn.error,
          startedAt: turn.startedAt ?? current.startedAt,
          completedAt: turn.completedAt,
          durationMs: turn.durationMs,
          items: current.items.length ? current.items : turn.items,
          retrying: null,
          stopping: false,
          buffering: null,
        }));
        // Turns run one at a time, so an empty in-progress sibling is an orphan: inline reviews
        // announce turn/started under an id that never receives items or completion.
        const settled = turn.status !== "interrupted";
        return {
          ...next,
          turns: next.turns.filter((x) => x.id === turn.id || x.status !== "inProgress" || x.items.length > 0),
          // Sub-agents keep no read state (their row has no 标记为未读); a quiet scheduled turn marks nothing.
          unread: t.unread || (settled && !isShown(getState(), threadId) && !t.meta.parentThreadId && !quietCompletion(next, turn.id)),
        };
      });
      reconcilePendingMessage(threadId);
      for (const resolve of idleWaiters.get(threadId) ?? []) resolve();
      idleWaiters.delete(threadId);
      void refreshThreadGit(threadId, true);
      // The user is looking at it: keep the server's receipt read.
      if (isShown(getState(), threadId)) void markRead(threadId);
      backgroundChanged(threadId);
      // A routed turn just spent its provider's quota; opencodex has no push for it.
      if (getState().providerQuotas.length) void refreshProviderQuotas();
      // A sub-agent's failure shows on its row and task, not as a toast (Claude has none for it); a scheduled one names its task.
      if (turn.status === "failed" && turn.error && !isShown(getState(), threadId) && getState().threads[threadId] && !getState().threads[threadId].meta.parentThreadId && !automationOf(getState().threads[threadId], turn.id)) toast("warning", "轮次失败", turn.error.message);
      void automationTurnCompleted(threadId, turn.id);
      const resume = resumes.get(threadId);
      if (resume?.turnId === turn.id) {
        resumes.delete(threadId);
        const s = getState();
        const thread = s.threads[threadId];
        // Stopped or failed, left plan mode, or something of yours comes first: nothing starts.
        if (turn.status === "completed" && (resume.text !== PLAN_RESUME || thread?.planMode) && !thread?.queue.length && !s.pendingMessages[threadId] && !s.requests.some((request) => requestSessionId(request, s.threads) === threadId))
          void sendMessage(threadId, [{ type: "text", text: resume.text, text_elements: [] }]).catch((error) => toast("warning", "发送失败", errorMessage(error)));
      }
      turnEnded(threadId);
      return;
    }
    case "turn/plan/updated": {
      const { threadId, turnId, plan } = notification.params;
      recordTodo(threadId, turnId, plan);
      return;
    }
    case "turn/diff/updated": {
      const { threadId, turnId, diff } = notification.params;
      updateThread(threadId, (t) => updateTurn(t, turnId, (turn) => ({ ...turn, diff })));
      return;
    }
    case "hook/started":
    case "hook/completed": {
      const { threadId, turnId, run } = notification.params;
      upsertHook(threadId, turnId, run);
      return;
    }
    case "item/autoApprovalReview/started": {
      const { threadId, turnId, reviewId, targetItemId, startedAtMs, review, action } = notification.params;
      upsertReview(threadId, turnId, { id: reviewId, targetItemId, startedAtMs, completedAtMs: null, review, action });
      return;
    }
    case "item/autoApprovalReview/completed": {
      const { threadId, turnId, reviewId, targetItemId, startedAtMs, completedAtMs, review, action } = notification.params;
      upsertReview(threadId, turnId, { id: reviewId, targetItemId, startedAtMs, completedAtMs, review, action });
      return;
    }
    case "autoApprovalReview/strictReviewRequired": {
      const { threadId, turnId } = notification.params;
      addNotice(threadId, turnId, { kind: "strictReview", text: STRICT_REVIEW_TEXT });
      return;
    }
    case "item/started":
    case "item/completed": {
      const { threadId, turnId, item } = notification.params;
      const at = "startedAtMs" in notification.params ? notification.params.startedAtMs : notification.params.completedAtMs;
      updateThread(threadId, (t) => {
        // A run keeps reporting under the turn that launched it; one not loaded here must not
        // make a placeholder turn, which would read as running and take the stop button.
        if (item.type === "workflow" && !t.turns.some((turn) => turn.id === turnId)) return t;
        const previous = t.timing[item.id];
        const timing: [number, number?] =
          notification.method === "item/started" ? [previous?.[0] ?? at] : [previous?.[0] ?? at, at];
        const settle = (turn: TurnState) => (notification.method === "item/started" ? refuseStreamed(turn, item.id, t.timing) : turn);
        return { ...updateTurn(t, turnId, (turn) => {
          const previousItem = turn.items.find((entry) => entry.id === item.id);
          // A confirmed background transition updates the same item without erasing streamed output.
          const incoming = notification.method === "item/started" && item.type === "commandExecution" && previousItem?.type === "commandExecution"
            ? { ...item, aggregatedOutput: previousItem.aggregatedOutput ?? item.aggregatedOutput } : item;
          const next = upsertItem(settle(turn), incoming);
          return item.type === "agentMessage" || item.type === "reasoning" || item.type === "plan" ? { ...next, retrying: null } : next;
        }), timing: { ...t.timing, [item.id]: timing } };
      });
      if (item.type === "userMessage") reconcilePendingMessage(threadId);
      if (notification.method === "item/completed" && (item.type === "commandExecution" || item.type === "fileChange")) void refreshThreadGit(threadId);
      if (notification.method === "item/completed") openWritten(threadId, item);
      if ((item.type === "commandExecution" && item.processId) || item.type === "collabAgentToolCall" || item.type === "subAgentActivity") backgroundChanged(threadId);
      if (notification.method === "item/completed" && item.type === "agentMessage") void attachCreatedPrs(threadId, item.text);
      if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") void joinSpawned(item.receiverThreadIds);
      if (item.type === "subAgentActivity" && item.kind === "started") void joinSpawned([item.agentThreadId]);
      return;
    }
    case "item/agentMessage/delta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => ({
          ...updateItem(turn, itemId, (item) => (item.type === "agentMessage" ? { ...item, text: item.text + delta } : item)),
          retrying: null,
          buffering: null,
        })),
      );
      return;
    }
    case "item/plan/delta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => ({
          ...updateItem(turn, itemId, (item) => (item.type === "plan" ? { ...item, text: item.text + delta } : item)),
          retrying: null,
        })),
      );
      return;
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta": {
      const params = notification.params;
      updateThread(params.threadId, (t) =>
        updateTurn(t, params.turnId, (turn) => ({
          ...updateItem(turn, params.itemId, (item) => {
            if (item.type !== "reasoning") return item;
            if ("contentIndex" in params) {
              const content = item.content.slice();
              content[params.contentIndex] = (content[params.contentIndex] ?? "") + params.delta;
              return { ...item, content };
            }
            const summary = item.summary.slice();
            summary[params.summaryIndex] = (summary[params.summaryIndex] ?? "") + ("delta" in params ? params.delta : "");
            return { ...item, summary };
          }),
          retrying: null,
        })),
      );
      return;
    }
    case "item/commandExecution/outputDelta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) =>
          updateItem(turn, itemId, (item) =>
            item.type === "commandExecution" ? { ...item, aggregatedOutput: (item.aggregatedOutput ?? "") + delta } : item,
          ),
        ),
      );
      return;
    }
    case "item/fileChange/patchUpdated": {
      // The patch as the model writes it, under the paths it names, before Codex verifies and
      // applies it (item/started; the bridge turns apply_patch_streaming_events on), so its file
      // row counts +N −N as it grows. The first update adds the item, as the Codex app does; a
      // started item keeps its own changes. An update's hunks get their context back
      // (streamedChange), or the counts would take the context for changed lines.
      const { threadId, turnId, itemId, changes } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => ({
          ...(t.timing[itemId] ? turn : upsertItem(turn, { type: "fileChange", id: itemId, changes: changes.map(streamedChange), status: "inProgress" })),
          retrying: null,
        })),
      );
      return;
    }
    case "item/mcpToolCall/progress": {
      const { threadId, itemId, message } = notification.params;
      updateThread(threadId, (t) => ({ ...t, progress: { ...t.progress, [itemId]: message } }));
      return;
    }
    case "error": {
      const { threadId, turnId, error, willRetry } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => (willRetry ? { ...turn, retrying: error } : { ...turn, error, retrying: null })),
      );
      return;
    }
    case "serverRequest/resolved": {
      const { requestId } = notification.params;
      setState((s) => ({ requests: s.requests.filter((r) => r.id !== requestId) }));
      return;
    }
    case "mcpServer/startupStatus/updated": {
      const { threadId, name, status, error, failureReason } = notification.params;
      const runtimeStatus = mcpRuntimeStatus(status, failureReason);
      setState((s) => ({ mcp: s.mcp?.map((server) => (server.name === name ? { ...server, runtimeStatus } : server)) ?? null }));
      // As in the Codex app, only an expired sign-in speaks up; other failures stay in 设置 › 连接器 (失败 and the tools error).
      const reauth = status === "failed" && failureReason === "reauthenticationRequired";
      if (!threadId) {
        if (reauth) toast("warning", `MCP 服务器“${name}”需要重新登录`);
        return;
      }
      updateThread(threadId, (t) => ({ ...t, mcp: { ...t.mcp, [name]: { status, error, failureReason } } }));
      if (reauth) addNotice(threadId, null, { kind: "mcpReauth", text: `MCP 服务器“${name}”需要重新登录`, detail: error ?? undefined, server: name });
      return;
    }
    case "mcpServer/oauthLogin/completed": {
      const { name, success, error, loginId } = notification.params;
      const expected = mcpLogins.get(name);
      if (loginId && expected && loginId !== expected) return;
      mcpLogins.delete(name);
      if (success) toast("neutral", `MCP 服务器 ${name} 登录成功`);
      else toast("warning", `MCP 服务器 ${name} 登录失败`, error);
      if (getState().mcp) void refreshMcp();
      return;
    }
    case "skills/changed":
      setState((s) => ({ skillsRev: s.skillsRev + 1 }));
      return;
    case "account/updated":
      void refreshAccount();
      void refreshRequirements();
      return;
    case "account/login/completed": {
      const { success, error, loginId } = notification.params;
      // A superseded attempt reports a failure of its own: only the current attempt counts.
      const current = getState().login;
      if (loginId && current && loginId !== current.loginId) return;
      if (success) {
        setState({ login: null });
        toast("neutral", "已登录。");
        void refreshAccount();
        void refreshModels();
      } else {
        setState((s) => ({ login: s.login && { ...s.login, error: error ?? "登录失败" } }));
      }
      return;
    }
    case "account/rateLimits/updated": {
      // A sparse snapshot of one metered bucket (limitId, "codex" when absent): merge it into that
      // bucket only, keep values it leaves null, and re-read after a workspace hard stop.
      const update = notification.params.rateLimits;
      const id = update.limitId ?? "codex";
      const merge = <T extends object>(previous: T | undefined): T => {
        const merged = { ...previous } as Record<string, unknown>;
        for (const [key, value] of Object.entries(update)) if (value !== null) merged[key] = value;
        return merged as T;
      };
      setState((s) => {
        if (!s.rateLimits) return {};
        const { rateLimits: single, rateLimitsByLimitId: buckets } = s.rateLimits;
        return {
          rateLimits: {
            ...s.rateLimits,
            rateLimits: (single.limitId ?? "codex") === id ? merge(single) : single,
            rateLimitsByLimitId: buckets ? { ...buckets, [id]: merge(buckets[id]) } : buckets,
          },
        };
      });
      readCredits();
      if (update.spendControlReached || update.rateLimitReachedType?.startsWith("workspace_")) void refreshRateLimits();
      return;
    }
    case "remoteControl/status/changed":
      setState({ remoteControl: notification.params });
      return;
    case "model/rerouted": {
      const { threadId, turnId, fromModel, toModel, reason } = notification.params;
      addNotice(threadId, turnId, { kind: "reroute", ...rerouteText(fromModel, toModel, reason) });
      return;
    }
    case "model/verification": {
      const { threadId, turnId, verifications } = notification.params;
      if (verifications.includes("trustedAccessForCyber")) addNotice(threadId, turnId, { kind: "verification", text: VERIFICATION_TEXT, url: VERIFICATION_URL });
      return;
    }
    case "model/safetyBuffering/updated": {
      const { threadId, turnId, showBufferingUi, fasterModel } = notification.params;
      updateThread(threadId, (t) => updateTurn(t, turnId, (turn) => ({ ...turn, buffering: showBufferingUi ? { fasterModel } : null })));
      return;
    }
    case "modelProvider/authRecoveryStarted":
    case "modelProvider/authRecoveryCompleted": {
      const { threadId, turnId, message } = notification.params;
      addNotice(threadId, turnId, { kind: notification.method === "modelProvider/authRecoveryStarted" ? "authRecovery" : "authRecovered", text: message });
      return;
    }
    // A session's own Codex warnings stay out of its transcript (Guardian's are opted out); the rest toast.
    case "warning": {
      const { threadId, message } = notification.params;
      if (!threadId || !getState().threads[threadId]) toast("warning", message);
      return;
    }
    case "deprecationNotice":
      toast("warning", notification.params.summary, notification.params.details ?? undefined);
      return;
    case "configWarning": {
      const { summary, details, path } = notification.params;
      toast("warning", summary, [details, path].filter(Boolean).join(" · ") || undefined);
      return;
    }
    case "windows/worldWritableWarning": {
      const { title, detail } = worldWritableText(notification.params);
      toast("warning", title, detail);
      return;
    }
    case "windowsSandbox/setupCompleted": {
      const { success, error } = notification.params;
      if (success) toast("neutral", "Windows 沙盒已就绪");
      else toast("warning", "Windows 沙盒设置失败", error ?? undefined);
      return;
    }
    case "externalAgentConfig/import/progress":
    case "externalAgentConfig/import/completed": {
      const { importId, itemTypeResults } = notification.params;
      const done = notification.method === "externalAgentConfig/import/completed";
      setState({ imports: { id: importId, results: itemTypeResults, done } });
      if (done) {
        toast("neutral", "导入完成");
        void refreshConfig();
        setState((s) => ({ skillsRev: s.skillsRev + 1 }));
      }
      return;
    }
    case "fs/changed":
      watchers.get(notification.params.watchId)?.();
      return;
    case "process/outputDelta":
      terminals.get(notification.params.processHandle)?.onData(base64ToBytes(notification.params.deltaBase64));
      return;
    case "process/exited": {
      const { processHandle, exitCode } = notification.params;
      terminals.get(processHandle)?.onExit(exitCode);
      terminals.delete(processHandle);
      return;
    }
    default:
      if (notification.method.startsWith("thread/realtime/")) onRealtimeNotification(notification);
      // The bridge's own: a scheduled task changed (server/bridge.mjs).
      else if ((notification.method as string) === "codexUi/automations/changed") void refreshAutomations();
      return;
  }
}

/** For callers that need to tell RPC errors apart. */
export { RpcError };
/** A dot's durable host speaks the same notifications: they fold into its threads the same way. */
export { onNotification as applyNotification };
