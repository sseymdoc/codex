// Controller: owns the app-server connection, turns server notifications into
// state, and exposes the actions the UI calls.

import { hostContext, planningConfig } from "../../context/index.mjs";

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
import { agentTasks, agentThreadIds } from "./background";
import { openWritten } from "./browser";
import { requestTitle } from "./titles";
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
import type { PluginListResponse } from "@protocol/v2/PluginListResponse";
import type { PluginReadResponse } from "@protocol/v2/PluginReadResponse";
import type { PluginReconcileResponse } from "@protocol/v2/PluginReconcileResponse";
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { PluginShareCheckoutResponse } from "@protocol/v2/PluginShareCheckoutResponse";
import type { PluginShareContext } from "@protocol/v2/PluginShareContext";
import type { PluginShareDeleteResponse } from "@protocol/v2/PluginShareDeleteResponse";
import type { PluginShareDiscoverability } from "@protocol/v2/PluginShareDiscoverability";
import type { PluginShareListItem } from "@protocol/v2/PluginShareListItem";
import type { PluginShareListResponse } from "@protocol/v2/PluginShareListResponse";
import type { PluginShareSaveResponse } from "@protocol/v2/PluginShareSaveResponse";
import type { PluginShareUpdateTargetsResponse } from "@protocol/v2/PluginShareUpdateTargetsResponse";
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
import { meterBalances, meterCredits, type BalanceTracks, type ProviderQuotaReport } from "./format";
import { streamedChange } from "./panes";
import { keptTargets } from "./plugins";
import { createdPrs, parsePr, parsePrView, prIdentity, prViewCommand, type PrStatus } from "./pr";
import { Rpc, RpcError, type ConnKind, type Hello, type Method, type ParamsOf } from "./rpc";
import { outliving, spawnOf, withLineage, type SessionSort } from "./session";
import {
  emptyThreadState,
  getState,
  NEW_SESSION_PICKS,
  offeredPicks,
  recordRoute,
  refuseStreamed,
  setKeepAwake,
  setState,
  toast,
  updateItem,
  updateThread,
  updateTurn,
  upsertItem,
  writePref,
  type AutoReview,
  type BackgroundTerminal,
  type Connector,
  type InstalledPlugin,
  type Notice,
  type PermissionPreset,
  type Reviewer,
  type ServiceTierPick,
  type StatusFilter,
  type ThreadSettings,
  type ThreadState,
  type TurnState,
} from "./store";
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
  "account/login/cancel": unknown;
  "account/logout": unknown;
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
  "fs/unwatch": unknown;
  fuzzyFileSearch: FuzzyFileSearchResponse;
  "hooks/list": HooksListResponse;
  "marketplace/add": MarketplaceAddResponse;
  "marketplace/remove": MarketplaceRemoveResponse;
  "marketplace/upgrade": MarketplaceUpgradeResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "config/mcpServer/reload": unknown;
  "mcpServer/oauth/login": McpServerOauthLoginResponse;
  "model/list": ModelListResponse;
  "permissionProfile/list": PermissionProfileListResponse;
  "plugin/installed": PluginInstalledResponse;
  "plugin/list": PluginListResponse;
  "plugin/read": PluginReadResponse;
  "plugin/install": PluginInstallResponse;
  "plugin/uninstall": unknown;
  "plugin/reconcile": PluginReconcileResponse;
  "plugin/share/save": PluginShareSaveResponse;
  "plugin/share/updateTargets": PluginShareUpdateTargetsResponse;
  "plugin/share/list": PluginShareListResponse;
  "plugin/share/checkout": PluginShareCheckoutResponse;
  "plugin/share/delete": PluginShareDeleteResponse;
  "review/start": ReviewStartResponse;
  "skills/list": SkillsListResponse;
  "skills/config/write": unknown;
  "skills/extraRoots/set": unknown;
  "thread/list": ThreadListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/revert": ThreadRevertResponse;
  "thread/unsubscribe": unknown;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/name/set": unknown;
  "thread/metadata/update": ThreadMetadataUpdateResponse;
  "thread/attachment/list": ThreadAttachmentListResponse;
  "thread/attachment/add": unknown;
  "thread/attachment/remove": unknown;
  "thread/approveGuardianDeniedAction": unknown;
  "thread/goal/get": ThreadGoalGetResponse;
  "thread/goal/set": ThreadGoalSetResponse;
  "thread/goal/clear": unknown;
  "threadSection/list": ThreadSectionListResponse;
  "threadSection/create": ThreadSectionCreateResponse;
  "threadSection/update": unknown;
  "threadSection/delete": unknown;
  "thread/section/move": unknown;
  "thread/archive": unknown;
  "thread/unarchive": unknown;
  "thread/delete": unknown;
  "thread/compact/start": unknown;
  "thread/shellCommand": unknown;
  "turn/start": TurnStartResponse;
  "turn/steer": unknown;
  "turn/interrupt": unknown;
  "windowsSandbox/readiness": WindowsSandboxReadinessResponse;
  "windowsSandbox/setupStart": WindowsSandboxSetupStartResponse;
}

const rpc = new Rpc({
  open: (hello) => void onOpen(hello),
  close: onClose,
  notification: onNotification,
  request: onServerRequest,
});

export function call<M extends keyof Responses & Method>(method: M, params: ParamsOf<M>): Promise<Responses[M]> {
  return rpc.request<Responses[M]>(method, params);
}

/** Experimental methods are absent from the stable generated union. */
export function callExperimental<R>(method: string, params: unknown): Promise<R> {
  return rpc.request<R>(method as Method, params);
}

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

/** Reasoning summaries are switched off in config, so thinking views need summary: "auto". */
export function summariesOff(_thread?: ThreadState | null): boolean {
  return getState().config?.model_reasoning_summary === "none";
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

async function onOpen(hello: Hello): Promise<void> {
  missing.clear();
  gitSnapshots.clear();
  setState((s) => ({
    server: { ...s.server, cwd: hello.cwd, command: hello.command },
    prefs: { ...s.prefs, cwd: s.prefs.cwd || hello.cwd },
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
  void Promise.allSettled([
    refreshAccount(),
    refreshModels(),
    refreshConfig(),
    refreshSections(),
    refreshFeatures(),
    loadModes(),
    refreshRequirements(),
    refreshProjects(),
    refreshRemoteControl(),
    refreshPermissionProfiles(),
    refreshProviderQuotas(),
  ]);
  await refreshThreads();
  if (restoringId && getState().activeId === restoringId) await openThread(restoringId, true);
}

function onClose(reason: string, detail?: string, kind: ConnKind = "network"): void {
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
  try {
    return JSON.parse(localStorage.getItem(BALANCE_TRACKS) ?? "{}") ?? {};
  } catch {
    return {};
  }
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

export async function refreshConfig(): Promise<void> {
  try {
    const response = await call("config/read", { includeLayers: false, cwd: getState().prefs.cwd || null });
    setState({ config: response.config });
  } catch (error) {
    toast("warning", "读取配置失败", errorMessage(error));
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

/** Custom permission profiles beyond the built-in :read-only / :workspace / :danger-full-access. */
export async function listPermissionProfiles(cwd = getState().prefs.cwd): Promise<PermissionProfileSummary[]> {
  try {
    return (await call("permissionProfile/list", { cwd: cwd || null })).data;
  } catch {
    return [];
  }
}

/** Custom permissions profiles into state.permissionProfiles (the composer lists them only when non-empty). */
export async function refreshPermissionProfiles(cwd = getState().prefs.cwd): Promise<void> {
  const profiles = await listPermissionProfiles(cwd);
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
  // Early notifications carry an empty preview; keep the one shown optimistically.
  return { ...previous, ...withLineage(liveGitMeta(next, cwd)), preview: next.preview || previous.preview, turns: [] };
}

/** readStates: null/undefined = the server has none; a missing entry = that thread is ineligible. */
function rememberThreads(threads: Thread[], current = getState().threads, readStates?: Record<string, ThreadReadState | undefined> | null): Record<string, ThreadState> {
  const merged = { ...current };
  for (const thread of threads) {
    const base = merged[thread.id] ? { ...merged[thread.id], meta: mergeMeta(merged[thread.id].meta, thread, merged[thread.id].settings?.cwd ?? thread.cwd) } : emptyThreadState(liveGitMeta(thread));
    if (base.agentTurn && thread.status?.type === "active") base.agentTurn = undefined;
    merged[thread.id] = readStates ? { ...base, readState: readStates[thread.id] ?? null } : base;
  }
  return merged;
}

const readStatesOf = (response: ThreadListResponse) => (response as ThreadListResponse & { readStates?: Record<string, ThreadReadState | undefined> | null }).readStates;

/** Title search over every session (the search dialog); the list itself is not filtered. */
export async function searchThreads(term: string, archived = false): Promise<Thread[]> {
  const response = await call("thread/list", { limit: 25, sortKey: "recency_at", searchTerm: term || undefined, sourceKinds: LIST_SOURCES, archived });
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
 * Sessions joining the list as they appear: a started session, or the sub-agents a session
 * spawned. No thread/started announces a spawned sub-agent and thread/list leaves out sessions
 * with no preview (every MultiAgentV2 sub-agent), so those come by id or by ancestor.
 */
function joinList(threads: Thread[], archived = false): void {
  if (!threads.length) return;
  for (const thread of threads) {
    if (archived) archivedIds.add(thread.id);
    else archivedIds.delete(thread.id);
  }
  setState((s) => {
    const shown = s.list.status === "all" || s.list.archived === archived;
    const fresh = shown ? threads.filter((t) => !t.ephemeral && (!t.parentThreadId || spawnOf(t)) && !s.list.ids.includes(t.id)).map((t) => t.id) : [];
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
      const ids = pages.flatMap((page) => page?.data.map((thread) => thread.id) ?? []);
      // Sub-agents that joined by id or ancestor stay under a family the new page lists.
      const listed = new Set(ids);
      const underListed = (id: string) => {
        for (let at = threads[id]?.meta.parentThreadId, depth = 0; at && depth < 32; at = threads[at]?.meta.parentThreadId, depth++) if (listed.has(at)) return true;
        return false;
      };
      return {
        threads,
        list: {
          ...s.list,
          ids: more ? [...s.list.ids, ...ids.filter((id) => !s.list.ids.includes(id))] : [...new Set([...ids, ...s.list.ids.filter(underListed)])],
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

function liveGitMeta(meta: Thread, cwd = meta.cwd): Thread {
  const snapshot = gitSnapshots.get(cwd)?.known;
  return snapshot ? { ...meta, gitInfo: snapshot.info } : cwd !== meta.cwd ? { ...meta, gitInfo: null } : meta;
}

async function folderGit(cwd: string, force = false): Promise<GitSnapshot> {
  let entry = gitSnapshots.get(cwd);
  if (entry?.pending) { if (force) entry.again = true; return entry.pending; }
  if (!force && entry?.snapshot && Date.now() - entry.at < 5000) return entry.snapshot;
  entry ??= { at: 0 };
  gitSnapshots.set(cwd, entry);
  const current = entry;
  current.pending = readGitSnapshot(cwd, (params) => optional<CommandExecResponse>("command/exec", params)).then((snapshot) => {
    // A reconnect discards reads from the old server.
    if (gitSnapshots.get(cwd) !== current) return snapshot;
    current.pending = undefined;
    // A change during the probe invalidates its result, just like Claude's GitState subscription.
    if (current.again) { current.again = false; return folderGit(cwd, true); }
    current.snapshot = snapshot;
    current.at = Date.now();
    if (snapshot.state !== "unavailable") current.known = snapshot;
    if (snapshot.state !== "unavailable") setState((s) => ({ threads: Object.fromEntries(Object.entries(s.threads).map(([id, thread]) =>
      [id, (thread.settings?.cwd ?? thread.meta.cwd) === cwd ? { ...thread, meta: { ...thread.meta, gitInfo: snapshot.info } } : thread],
    )) }));
    return snapshot;
  });
  return current.pending;
}

export async function refreshThreadGit(id: string, force = false): Promise<GitSnapshot | null> {
  const thread = getState().threads[id];
  const cwd = thread?.settings?.cwd ?? thread?.meta.cwd;
  if (!cwd) return null;
  const snapshot = await folderGit(cwd, force);
  const current = getState().threads[id];
  if (!current) return null;
  return (current.settings?.cwd ?? current.meta.cwd) !== cwd ? refreshThreadGit(id, force) : snapshot;
}

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

const normalizePath = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();

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

export async function createProject(name: string, roots: string[], idempotencyKey = crypto.randomUUID()): Promise<Project | null> {
  name = name.trim();
  if (!name) throw new Error("请输入环境名称");
  if (!roots.length) throw new Error("请添加至少一个源文件夹");
  const response = await optional<{ project: Project }>("project/create", { name, roots: roots.map((path) => ({ path })), idempotencyKey });
  if (response) setState((s) => ({ projects: upsertBy(s.projects, (project) => project.id, response.project) }));
  return response?.project ?? null;
}

export async function updateProject(projectId: string, name: string, roots?: string[]): Promise<void> {
  name = name.trim();
  if (!name) throw new Error("请输入环境名称");
  if (roots && !roots.length) throw new Error("请添加至少一个源文件夹");
  const response = await optional<{ project: Project }>("project/update", { projectId, name, ...(roots && { roots: roots.map((path) => ({ path })) }) });
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

export function newChat(): void {
  const previous = getState().activeId;
  recordRoute(previous, null);
  // Panes stay per view (state.panes): the draft page shows its own.
  setState((s) => ({ activeId: null, draftEpoch: s.draftEpoch + 1 }));
  if (previous) void releaseThread(previous);
}

export async function openThread(id: string, force = false): Promise<void> {
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
  const previous = getState().activeId;
  recordRoute(previous, id);
  setState({ activeId: id });
  if (previous && previous !== id) void releaseThread(previous);
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
  updateThread(id, (t) => ({ ...t, loading: true, loadError: null }));
  try {
    // A MultiAgentV2 sub-agent resumes only through its loaded parent; otherwise it reads like an
    // archived session (the server's own advice: thread/read to inspect it).
    const response = isArchivedThread(id)
      ? null
      : await call("thread/resume", {
          threadId: id,
          excludeTurns: true,
          // Only a thread the server has to load takes them: resuming a loaded idle one with
          // overrides shuts it down and loads it again, background terminals and all.
          config: thread.meta.status.type === "notLoaded" ? threadConfig() : null,
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

async function loadGoal(id: string): Promise<void> {
  if (!featureEnabled("goals")) return;
  try {
    const { goal } = await call("thread/goal/get", { threadId: id });
    updateThread(id, (t) => ({ ...t, goal }));
  } catch {
    // Goals are experimental; a server that refuses simply shows none.
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

/** Drop idle threads we navigated away from so app-server can unload them. */
async function releaseThread(id: string): Promise<void> {
  if (backgroundCheck?.threadId === id) stopBackgroundCheck();
  const thread = getState().threads[id];
  if (!thread?.subscribed || activeTurn(thread) || getState().requests.some((r) => requestThreadId(r) === id)) return;
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
const threadConfig = () => {
  const { planCard, config } = getState();
  if (!hostContextSupported()) return planningConfig(planCard, config?.developer_instructions);
  return {
    "tools.update_plan.enabled": planCard,
    ...(typeof config?.developer_instructions === "string" ? { developer_instructions: config.developer_instructions } : {}),
  };
};

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
    }) });
  });
  hostContextPending.set(id, next);
  void next.finally(() => { if (hostContextPending.get(id) === next) hostContextPending.delete(id); }).catch(() => {});
  return next;
}

export async function syncHostContexts(): Promise<void> {
  await Promise.all(Object.values(getState().threads).filter((thread) => thread.subscribed).map((thread) => syncHostContext(thread.meta.id)));
}

export async function startThread(pendingMessageId?: string): Promise<string> {
  const { prefs } = getState();
  const preset = prefs.permission ? PRESETS[prefs.permission] : null;
  const projectId = prefs.projectId ?? projectFor(prefs.cwd)?.id ?? null;
  const params: Record<string, unknown> = {
    cwd: prefs.cwd || null,
    model: prefs.model,
    approvalPolicy: preset?.approval ?? null,
    sandbox: preset?.sandbox ?? null,
    config: threadConfig(),
  };
  // A custom profile replaces the sandbox (the server rejects the two together).
  if (!preset && prefs.permissionProfile) {
    delete params.sandbox;
    params.permissions = prefs.permissionProfile;
  }
  if (prefs.serviceTier) params.serviceTier = prefs.serviceTier;
  if (prefs.reviewer) params.approvalsReviewer = prefs.reviewer;
  if (projectId) params.projectId = projectId;
  const response = await call("thread/start", params as never);
  const id = response.thread.id;
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
        planMode: prefs.planMode,
        overrides: prefs.effort ? { effort: prefs.effort } : {},
      },
    },
    list: s.list.archived ? s.list : { ...s.list, ids: [id, ...s.list.ids.filter((x) => x !== id)] },
    activeId: id,
  }));
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
 * request's model / effort, so a preset value would stick after leaving plan mode too.
 */
function collaborationModeFor(thread: ThreadState, planMode: boolean): Record<string, unknown> | null {
  if (!getState().modes.length) return null;
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
  // The Codex app (its concurrent_reasoning_summaries override) asks every turn for detailed
  // summaries unless config.toml picks a level. The models default to none, and then a reasoning
  // item arrives only once it is done, so the working line never sees it open (思考中). Thinking
  // views need summaries a configured none turned off.
  if (!getState().config?.model_reasoning_summary) params.summary = "detailed";
  else if ((thread.view ?? getState().defaultView) !== "normal" && summariesOff(thread)) params.summary = "auto";
  const collaborationMode = collaborationModeFor(thread, thread.planMode);
  if (collaborationMode) (params as Record<string, unknown>).collaborationMode = collaborationMode;
  return params;
}

/** Fold the composer's pending picks into the thread's settings once the server has them. */
function settleOverrides(t: ThreadState): ThreadState {
  const { overrides } = t;
  return {
    ...t,
    overrides: {},
    settings: t.settings && {
      ...t.settings,
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
 * Sends user input. Idle: starts a turn (and the thread if needed). Busy: steers the running
 * turn (Enter), or queues it with `queue` (Ctrl+Enter) and whenever the turn cannot be steered.
 * Throws when queueing is needed but the server has no queue.
 */
export async function sendMessage(threadId: string | null, input: UserInput[], opts: { queue?: boolean } = {}): Promise<void> {
  const key = threadId ?? "";
  if (getState().pendingMessages[key]) throw new Error("请先处理上一条待发送的消息。");
  // Keep busy-turn steering/queueing on its existing path; only idle sends need a local echo.
  if (!threadId || !activeTurn(getState().threads[threadId])) {
    const clientId = crypto.randomUUID();
    setState((s) => ({ pendingMessages: { ...s.pendingMessages, [key]: { item: { type: "userMessage", id: clientId, clientId, content: input } } } }));
    return submitPendingMessage(threadId);
  }
  return sendToThread(threadId, input, opts);
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

async function submitPendingMessage(threadId: string | null): Promise<void> {
  let id = threadId;
  const newlyStarted = id === null;
  const pending = getState().pendingMessages[id ?? ""]!;
  const clientId = pending.item.id;
  const update = (patch: Partial<typeof pending>) => setState((s) => {
    const key = id ?? "";
    const current = s.pendingMessages[key];
    return current?.item.id === clientId ? { pendingMessages: { ...s.pendingMessages, [key]: { ...current, ...patch } } } : {};
  });
  update({ error: undefined, accepted: false, turnId: undefined });
  try {
    id ??= await startThread(clientId);
    await sendToThread(id, pending.item.content, {}, clientId, newlyStarted);
    reconcilePendingMessage(id);
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

async function sendToThread(id: string, input: UserInput[], opts: { queue?: boolean }, clientUserMessageId?: string, newlyStarted = false): Promise<void> {
  let thread = getState().threads[id];
  if (!thread.subscribed) {
    await openThread(id, true);
    thread = getState().threads[id];
    if (thread.loadError) throw new Error(thread.loadError);
  }
  await syncHostContext(id);
  const running = activeTurn(thread);
  if (running) {
    if (clientUserMessageId) throw new Error("会话仍在运行，请等待完成后再重试。");
    if (opts.queue || !canSteer(thread)) return queueMessage(id, input);
    try {
      const snapshot = await refreshThreadGit(id, true);
      await call("turn/steer", { threadId: id, input, ...(snapshot ? { additionalContext: gitContext(snapshot) } : {}), expectedTurnId: running.id, clientUserMessageId: crypto.randomUUID() });
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
  const text = input.find((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")?.text;
  const needsTitle = newlyStarted && text && !thread.meta.preview && !thread.meta.name;
  if (text && !thread.meta.preview) updateThread(id, (t) => ({ ...t, meta: { ...t.meta, preview: text } }));
  updateThread(id, (t) => ({ ...t, sending: true }));
  let response;
  try {
    const snapshot = await refreshThreadGit(id);
    response = await call("turn/start", { threadId: id, input, ...(snapshot ? { additionalContext: gitContext(snapshot) } : {}), ...(clientUserMessageId ? { clientUserMessageId } : {}), ...turnOverrides(getState().threads[id]) });
  } finally {
    updateThread(id, (t) => ({ ...t, sending: false }));
  }
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

/** Threads whose next thread/reverted is our own revert. */
const ownReverts = new Set<string>();

/** Drop `turnId` and every later turn from the thread's history. Files the agent changed stay changed. */
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
}

/** Rewind to `turnId` and send `input` in its place: edit-and-resend and regenerate. */
export async function rewindAndSend(threadId: string, turnId: string, input: UserInput[]): Promise<void> {
  await rewindThread(threadId, turnId);
  await sendMessage(threadId, input);
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
  await rewindAndSend(threadId, turn.id, prompt.content);
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
  updateThread(threadId, (t) => ({ ...t, landed: { id: queued.clientUserMessageId, at: Date.now() } }));
  const running = activeTurn(thread);
  if (running && canSteer(thread)) {
    try {
      await syncHostContext(threadId);
      const snapshot = await refreshThreadGit(threadId, true);
      await call("turn/steer", { threadId, input: queued.input, ...(snapshot ? { additionalContext: gitContext(snapshot) } : {}), expectedTurnId: running.id, clientUserMessageId: queued.clientUserMessageId });
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
): void {
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
    return;
  }
  const { planMode, ...rest } = patch;
  const before = getState().threads[threadId];
  updateThread(threadId, (t) => {
    const overrides = { ...t.overrides, ...rest };
    if (presetPicked) overrides.permissionProfile = null;
    if (profilePicked) delete overrides.permission;
    return { ...t, overrides, planMode: planMode ?? t.planMode };
  });
  if (before?.subscribed) void applyThreadSettings(threadId, patch, before);
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
async function applyThreadSettings(threadId: string, patch: Parameters<typeof setOverride>[1], before: ThreadState): Promise<void> {
  const thread = getState().threads[threadId];
  if (!thread) return;
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
    const collaborationMode = collaborationModeFor(thread, patch.planMode);
    if (collaborationMode) params.collaborationMode = collaborationMode;
  }
  if (Object.keys(params).length === 1) return;
  try {
    const response = await optional("thread/settings/update", params);
    if (response === null) return;
    updateThread(threadId, settleOverrides);
    const running = activeTurn(getState().threads[threadId]);
    const turnParams: Record<string, unknown> = { threadId, turnId: running?.id };
    for (const key of ["model", "effort", "serviceTier", "approvalsReviewer"]) if (key in params) turnParams[key] = params[key];
    if (running && Object.keys(turnParams).length > 2) void optional("turn/settings/update", turnParams).catch(() => {});
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

/** Generation uses a private backend channel; applying a title uses the normal metadata RPC. */
async function generateThreadTitle(id: string, description: string): Promise<void> {
  const thread = getState().threads[id];
  if (!description.trim() || !thread || thread.meta.name?.trim() || thread.meta.ephemeral || thread.meta.parentThreadId || spawnOf(thread.meta) || namingJobs.has(id)) return;
  const job = new AbortController();
  namingJobs.set(id, job);
  try {
    const title = await requestTitle(description, effectiveSettings(thread).model, job.signal);
    const current = getState().threads[id];
    if (title && !job.signal.aborted && current && !current.meta.name?.trim()) {
      await call("thread/name/set", { threadId: id, name: title });
      updateThread(id, (t) => t.meta.name?.trim() ? t : { ...t, meta: { ...t.meta, name: title } });
    }
  } catch (error) {
    if (!job.signal.aborted) console.warn("codex-ui: title generation failed", errorMessage(error));
  } finally {
    if (namingJobs.get(id) === job) namingJobs.delete(id);
  }
}

export async function renameThread(id: string, name: string): Promise<void> {
  updateThread(id, (t) => ({ ...t, meta: { ...t.meta, name } }));
  await call("thread/name/set", { threadId: id, name });
}

function forgetFromList(...ids: string[]): void {
  setState((s) => ({
    list: { ...s.list, ids: s.list.ids.filter((x) => !ids.includes(x)) },
    landing: s.landing && s.landing.filter((x) => !ids.includes(x)),
    activeId: s.activeId && ids.includes(s.activeId) ? null : s.activeId,
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

export async function forkThread(id: string, lastTurnId?: string): Promise<void> {
  const response = await call("thread/fork", { threadId: id, lastTurnId: lastTurnId ?? null, excludeTurns: true, config: threadConfig() });
  const forkId = response.thread.id;
  setState((s) => ({
    threads: {
      ...s.threads,
      [forkId]: { ...emptyThreadState(response.thread), subscribed: true, settings: settingsFrom(response) },
    },
    list: { ...s.list, ids: [forkId, ...s.list.ids.filter((x) => x !== forkId)] },
  }));
  // The fork opens with no success toast (caec4a2d4 Wn).
  await openThread(forkId, true);
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
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

/** The rail's 移除 on a PR row (Claude's Dismiss): the attachment goes, the PR on GitHub stays. */
export async function removePullRequest(threadId: string, identityKey: string): Promise<void> {
  // Kept first, so a lookup the removal sets off already leaves it out.
  // ponytail: one key per removed PR, never pruned; trim like the pane views if it ever grows.
  const dismissed = dismissedPrs();
  dismissed[threadId] = [...new Set([...(dismissed[threadId] ?? []), identityKey])];
  writePref(DISMISSED_KEY, JSON.stringify(dismissed));
  await call("thread/attachment/remove", { threadId, attachmentType: "pull_request", identityKey });
}

/**
 * A pull request as gh reads it (gh pr view --json through command/exec, read-only with the
 * network on, as Codex desktop's main process asks gh), or null where gh is missing or signed
 * out, finds no PR or cannot reach GitHub: the rail then keeps what Codex knows.
 */
export async function readPr(cwd: string, selector: string, repo?: string): Promise<PrStatus | null> {
  const result = await optional<CommandExecResponse>("command/exec", {
    command: prViewCommand(selector, repo),
    cwd,
    timeoutMs: 20_000,
    sandboxPolicy: { type: "readOnly", networkAccess: true },
  }).catch(() => null);
  return result?.exitCode === 0 ? parsePrView(result.stdout) : null;
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

/** MCP inventory; pass the subscribed thread so runtimeStatus reflects its connections. */
export async function listMcpServers(threadId?: string | null): Promise<ListMcpServerStatusResponse["data"]> {
  return (await call("mcpServerStatus/list", { limit: 100, detail: "toolsAndAuthOnly", threadId: threadId ?? null })).data;
}

/** Load the MCP inventory into `state.mcp` (2-3 MB: call it lazily). */
export async function refreshMcp(threadId?: string | null): Promise<void> {
  const active = threadId ?? getState().activeId;
  const subscribed = active && getState().threads[active]?.subscribed ? active : null;
  try {
    setState({ mcp: await listMcpServers(subscribed) });
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

export async function setSkillEnabled(path: string, enabled: boolean): Promise<void> {
  await call("skills/config/write", { path, enabled });
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

/** Installed plugins (plugin/installed, ~50 KB) into `state.plugins`; [] when unsupported. */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const { marketplaces } = await call("plugin/installed", {});
    const plugins = marketplaces.flatMap((market) => market.plugins.map((plugin) => ({ ...plugin, marketplaceName: market.name })));
    setState({ plugins });
    return plugins;
  } catch {
    setState({ plugins: [] });
    return [];
  }
}

/** The local plugin directory; remote catalogs (15 MB) are reached through searchPlugins. */
export async function pluginDirectory(): Promise<PluginListResponse> {
  return call("plugin/list", { marketplaceKinds: ["local"] });
}

export async function searchPlugins(term: string, cursor?: string | null): Promise<{ data: PluginSearchResult[]; nextCursor: string | null }> {
  const response = await optional<{ data: PluginSearchResult[]; nextCursor: string | null }>("plugin/search", { searchTerm: term, cursor: cursor ?? null, limit: 20 });
  return response ?? { data: [], nextCursor: null };
}

type PluginRef = { pluginName: string; marketplacePath?: string | null; remoteMarketplaceName?: string | null };

export async function readPlugin(ref: PluginRef): Promise<PluginDetail> {
  return (await call("plugin/read", ref)).plugin;
}

/** Install; apps that need sign-in come back in appsNeedingAuth (open their installUrl). */
export async function installPlugin(ref: PluginRef): Promise<PluginInstallResponse> {
  const response = await call("plugin/install", { ...ref, installAttemptId: crypto.randomUUID() });
  void listInstalledPlugins();
  return response;
}

export async function uninstallPlugin(pluginId: string): Promise<void> {
  await call("plugin/uninstall", { pluginId });
  void listInstalledPlugins();
}

export async function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  await writeConfig([{ keyPath: "plugins", value: { [pluginId]: { enabled } }, mergeStrategy: "upsert" }]);
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
export function pluginMention(plugin: InstalledPlugin): Extract<UserInput, { type: "mention" }> {
  return { type: "mention", name: plugin.interface?.displayName ?? plugin.name, path: `plugin://${plugin.id}` };
}

export async function addMarketplace(source: string, refName?: string): Promise<MarketplaceAddResponse> {
  const response = await call("marketplace/add", { source, refName: refName ?? null });
  void listInstalledPlugins();
  return response;
}

export async function removeMarketplace(marketplaceName: string): Promise<void> {
  await call("marketplace/remove", { marketplaceName });
  void listInstalledPlugins();
}

export async function upgradeMarketplaces(marketplaceName?: string): Promise<MarketplaceUpgradeResponse> {
  return call("marketplace/upgrade", { marketplaceName: marketplaceName ?? null });
}

// ---------------------------------------------------------------------------
// Connectors (ChatGPT apps)

/** Installed connectors with names and icons (app/installed + app/read) into `state.connectors`. */
export async function listConnectors(threadId?: string | null): Promise<Connector[]> {
  try {
    const { apps } = await call("app/installed", { threadId: threadId ?? null });
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

/** One config/batchWrite keyPath segment, quoted so a name with dots or quotes stays one segment. */
const keySegment = (name: string) => `"${name.replace(/[\\"]/g, "\\$&")}"`;

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
async function writeMcpConfig(edits: ConfigBatchWriteParams["edits"]): Promise<void> {
  await writeConfig(edits);
  await reloadMcpServers();
}

/** Connect / disconnect an MCP server (`enabled`). */
export const setMcpServerEnabled = (name: string, pluginId: string | null, enabled: boolean) =>
  writeMcpConfig([{ keyPath: `${mcpServerKey(name, pluginId)}.enabled`, value: enabled, mergeStrategy: "replace" }]);

/** A streamable-HTTP server in config.toml (Claude's custom connector); sign-in, if it needs one, comes after. */
export const addMcpServer = (name: string, url: string) => writeMcpConfig([{ keyPath: mcpServerKey(name, null), value: { url }, mergeStrategy: "replace" }]);

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
    const data = (response?.data ?? []).map((t) => ({ ...t, osPid: t.osPid ?? null, cpuPercent: t.cpuPercent ?? null, rssKb: t.rssKb === null ? null : Number(t.rssKb) }));
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

export async function terminateBackground(threadId: string, processId: string): Promise<void> {
  await callExperimental("thread/backgroundTerminals/terminate", { threadId, processId });
  await refreshBackground(threadId, true);
}

export async function cleanBackground(threadId: string): Promise<void> {
  const thread = getState().threads[threadId];
  const agents = agentTasks(thread, getState().threads).filter((task) => task.status === "running");
  const results = await Promise.allSettled([
    ...(thread.background.length ? [callExperimental("thread/backgroundTerminals/clean", { threadId })] : []),
    ...agents.map((task) => stopAgentTask(task.threadId)),
  ]);
  await refreshBackground(threadId, true);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
}

export async function stopAgentTask(threadId: string): Promise<void> {
  // An empty turn id interrupts startup too, without resuming or unloading the child.
  await call("turn/interrupt", { threadId, turnId: activeTurn(getState().threads[threadId])?.id ?? "" });
  const response = await callExperimental<{ thread: Thread }>("thread/read", { threadId });
  setState((s) => ({ threads: rememberThreads([response.thread], s.threads) }));
  const history = await call("thread/turns/list", { threadId, limit: 1, sortDirection: "desc", itemsView: "full" });
  updateThread(threadId, (t) => history.data.reduce((state, turn) => updateTurn(state, turn.id, (current) => ({ ...current, ...turn })), t));
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

/** Archives sessions idle for `days`; running ones, ones with background work or a waiting request, and the open one stay. */
export async function archiveInactiveThreads(days: number): Promise<void> {
  const cutoff = Date.now() / 1000 - days * 86_400;
  const { activeId, requests, threads } = getState();
  const keep = new Set([activeId, ...requests.map(requestThreadId)]);
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

/**
 * A shell in `cwd`. Returns at once; writes and resizes wait for the spawn. onData receives raw
 * PTY bytes (xterm's term.write(Uint8Array) handles UTF-8 split across chunks).
 */
export function openTerminal(
  cwd: string,
  size: { rows: number; cols: number },
  onData: (bytes: Uint8Array) => void,
  onExit: (code: number) => void,
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
    command: windows ? ["powershell.exe", "-NoLogo"] : ["/bin/sh", "-c", 'exec "${SHELL:-/bin/bash}" -l'],
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
      forgetFromList(notification.params.threadId);
      return;
    case "thread/archived":
      // Archiving lets go of the session's 保持计算机唤醒, as Claude's does (manualKeepAwake cleared).
      setKeepAwake(notification.params.threadId, false);
      // Codex shuts an archived thread down with no thread/closed: opening it again resumes it.
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false, background: [] }));
      // The archived list already has it; elsewhere markArchived flips or drops the row.
      if (getState().list.status !== "archived") markArchived(notification.params.threadId, true);
      else archivedIds.add(notification.params.threadId);
      return;
    case "thread/unarchived": {
      const { threadId } = notification.params;
      const { status } = getState().list;
      if (status === "active") {
        archivedIds.delete(threadId);
        void refreshThreads();
      } else markArchived(threadId, false);
      return;
    }
    case "thread/closed":
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false, background: [] }));
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
      void loadTurns(threadId, false).catch(() => {});
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
          // Sub-agents keep no read state (their row has no 标记为未读).
          unread: t.unread || (settled && threadId !== getState().activeId && !t.meta.parentThreadId),
        };
      });
      reconcilePendingMessage(threadId);
      for (const resolve of idleWaiters.get(threadId) ?? []) resolve();
      idleWaiters.delete(threadId);
      void refreshThreadGit(threadId, true);
      // The user is looking at it: keep the server's receipt read.
      if (threadId === getState().activeId) void markRead(threadId);
      backgroundChanged(threadId);
      // A routed turn just spent its provider's quota; opencodex has no push for it.
      if (getState().providerQuotas.length) void refreshProviderQuotas();
      if (turn.status === "failed" && turn.error && threadId !== getState().activeId) toast("warning", "轮次失败", turn.error.message);
      return;
    }
    case "turn/plan/updated": {
      const { threadId, turnId, plan } = notification.params;
      updateThread(threadId, (t) => updateTurn(t, turnId, (turn) => ({ ...turn, plan: { steps: plan, at: turn.items.length } })));
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
      return;
  }
}

/** For callers that need to tell RPC errors apart. */
export { RpcError };
