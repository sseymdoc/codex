// Controller: owns the app-server connection, turns server notifications into
// state, and exposes the actions the UI calls.

import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { FuzzyFileSearchResponse } from "@protocol/FuzzyFileSearchResponse";
import type { RequestId } from "@protocol/RequestId";
import type { ServerNotification } from "@protocol/ServerNotification";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AppsInstalledResponse } from "@protocol/v2/AppsInstalledResponse";
import type { AppsReadResponse } from "@protocol/v2/AppsReadResponse";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
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
import type { PluginSearchResult } from "@protocol/v2/PluginSearchResult";
import type { Project } from "@protocol/v2/Project";
import type { QueuedSubmission } from "@protocol/v2/QueuedSubmission";
import type { RemoteControlStatusChangedNotification } from "@protocol/v2/RemoteControlStatusChangedNotification";
import type { ReviewStartResponse } from "@protocol/v2/ReviewStartResponse";
import type { ReviewTarget } from "@protocol/v2/ReviewTarget";
import type { SandboxMode } from "@protocol/v2/SandboxMode";
import type { SandboxPolicy } from "@protocol/v2/SandboxPolicy";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import type { Thread } from "@protocol/v2/Thread";
import type { ThreadAttachmentListResponse } from "@protocol/v2/ThreadAttachmentListResponse";
import type { ThreadForkResponse } from "@protocol/v2/ThreadForkResponse";
import type { ThreadGoalGetResponse } from "@protocol/v2/ThreadGoalGetResponse";
import type { ThreadGoalSetResponse } from "@protocol/v2/ThreadGoalSetResponse";
import type { ThreadGoalStatus } from "@protocol/v2/ThreadGoalStatus";
import type { ThreadListResponse } from "@protocol/v2/ThreadListResponse";
import type { ThreadMetadataUpdateResponse } from "@protocol/v2/ThreadMetadataUpdateResponse";
import type { ThreadReadResponse } from "@protocol/v2/ThreadReadResponse";
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
  guardianWarningShown,
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
import { Rpc, RpcError, type ConnKind, type Hello, type Method, type ParamsOf } from "./rpc";
import type { SessionSort } from "./session";
import {
  emptyThreadState,
  getState,
  setState,
  toast,
  updateItem,
  updateThread,
  updateTurn,
  upsertItem,
  type AutoReview,
  type BackgroundTerminal,
  type Connector,
  type InstalledPlugin,
  type Notice,
  type PermissionPreset,
  type Reviewer,
  type ServiceTierPick,
  type ThreadSettings,
  type ThreadState,
  type TurnState,
} from "./store";
import { onRealtimeNotification, resetVoice } from "./voice";

export const VERSION = "0.1.0";

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
  "review/start": ReviewStartResponse;
  "skills/list": SkillsListResponse;
  "skills/config/write": unknown;
  "skills/extraRoots/set": unknown;
  "thread/list": ThreadListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/read": ThreadReadResponse;
  "thread/revert": ThreadRevertResponse;
  "thread/unsubscribe": unknown;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/name/set": unknown;
  "thread/metadata/update": ThreadMetadataUpdateResponse;
  "thread/attachment/list": ThreadAttachmentListResponse;
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
    description: "可以读取工作区文件；修改文件或访问网络前需要你批准。",
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
    label: "完全访问",
    description: "无需批准即可修改任意文件并访问网络，请谨慎使用。",
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

/** Managed requirements may forbid some approval policies or sandbox modes; null lists allow all. */
export function presetAllowed(preset: PermissionPreset): boolean {
  const requirements = getState().requirements;
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
const OPT_OUT = ["item/fileChange/outputDelta", "thread/compacted", "turn/moderationMetadata", "rawResponseItem/completed", "rawResponse/completed", "app/list/updated"];
// Automatic reconnects: right away, after 15s, then every 30s until 180s have passed.
const RETRY_DELAYS = [0, 15_000, 30_000];
const RETRY_WINDOW_MS = 180_000;
let retryAttempt = 0;
let failingSince = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

/** Connect now and restart the automatic retry window (startup, or the user's 重试 button). */
export function connect(): void {
  retryAttempt = 0;
  failingSince = 0;
  reconnect();
}

function reconnect(): void {
  clearTimeout(retryTimer);
  setState((s) => ({ conn: { status: "connecting", kind: s.conn.kind, exits: s.conn.exits } }));
  void rpc.connect();
}

async function onOpen(hello: Hello): Promise<void> {
  missing.clear();
  setState((s) => ({
    server: { ...s.server, cwd: hello.cwd, command: hello.command },
    prefs: { ...s.prefs, cwd: s.prefs.cwd || hello.cwd },
  }));
  try {
    const info = await call("initialize", {
      clientInfo: { name: "codex_ui", title: "Codex UI", version: VERSION },
      capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: OPT_OUT },
    });
    rpc.notify("initialized");
    retryAttempt = 0;
    failingSince = 0;
    setState((s) => ({ conn: { status: "ready", exits: 0 }, server: { ...s.server, info, version: parseVersion(info.userAgent) } }));
  } catch (error) {
    setState({ conn: { status: "closed", error: `初始化失败：${errorMessage(error)}`, kind: "fatal", retryAt: null } });
    return;
  }
  await Promise.allSettled([
    refreshAccount(),
    refreshModels(),
    refreshConfig(),
    refreshThreads(),
    refreshSections(),
    refreshFeatures(),
    loadModes(),
    refreshRequirements(),
    refreshProjects(),
    refreshRemoteControl(),
    refreshPermissionProfiles(),
  ]);
  const { activeId } = getState();
  if (activeId) await openThread(activeId, true);
}

function onClose(reason: string, detail?: string, kind: ConnKind = "network"): void {
  for (const terminal of terminals.values()) terminal.onExit(-1);
  terminals.clear();
  watchers.clear();
  stopBackgroundPoll();
  resetVoice();
  const exits = (getState().conn.exits ?? 0) + (kind === "exited" ? 1 : 0);
  let retryAt: number | null = null;
  if (kind === "network" || kind === "exited") {
    failingSince ||= Date.now();
    const delay = RETRY_DELAYS[Math.min(retryAttempt, RETRY_DELAYS.length - 1)];
    if (Date.now() + delay - failingSince <= RETRY_WINDOW_MS) {
      retryAttempt++;
      retryAt = Date.now() + delay;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(reconnect, delay);
    }
  }
  setState((s) => ({
    conn: { status: "closed", error: reason, detail, kind, exits, retryAt },
    requests: [],
    threads: Object.fromEntries(Object.entries(s.threads).map(([id, t]) => [id, { ...t, subscribed: false, background: [] }])),
  }));
}

// ---------------------------------------------------------------------------
// Account, models, config

export async function refreshAccount(): Promise<void> {
  try {
    const account = await call("account/read", { refreshToken: false });
    setState({ account });
    if (account.account) void refreshRateLimits();
  } catch (error) {
    toast("error", "读取账户信息失败", errorMessage(error));
  }
}

export async function refreshRateLimits(): Promise<void> {
  try {
    setState({ rateLimits: await call("account/rateLimits/read", undefined as never) });
  } catch {
    // Not every provider reports rate limits.
  }
}

/** Redeem one rate-limit reset credit (the backend picks one when creditId is omitted). */
export async function consumeRateLimitResetCredit(creditId?: string): Promise<ConsumeAccountRateLimitResetCreditOutcome> {
  const { outcome } = await call("account/rateLimitResetCredit/consume", { idempotencyKey: crypto.randomUUID(), creditId: creditId ?? null });
  await refreshRateLimits();
  return outcome;
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
  setState({ rateLimits: null });
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
    setState({
      models: all.filter((model) => !model.hidden),
      hiddenModels: all.filter((model) => model.hidden && !model.id.startsWith("codex-auto-review")),
    });
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

function mergeMeta(previous: Thread, next: Thread): Thread {
  // Early notifications carry an empty preview; keep the one shown optimistically.
  return { ...previous, ...next, preview: next.preview || previous.preview, turns: [] };
}

/** readStates: null/undefined = the server has none; a missing entry = that thread is ineligible. */
function rememberThreads(threads: Thread[], current = getState().threads, readStates?: Record<string, ThreadReadState | undefined> | null): Record<string, ThreadState> {
  const merged = { ...current };
  for (const thread of threads) {
    const base = merged[thread.id] ? { ...merged[thread.id], meta: mergeMeta(merged[thread.id].meta, thread) } : emptyThreadState(thread);
    merged[thread.id] = readStates ? { ...base, readState: readStates[thread.id] ?? null } : base;
  }
  return merged;
}

const readStatesOf = (response: ThreadListResponse) => (response as ThreadListResponse & { readStates?: Record<string, ThreadReadState | undefined> | null }).readStates;

/** Title search over every session (the search dialog); the list itself is not filtered. */
export async function searchThreads(term: string): Promise<Thread[]> {
  const response = await call("thread/list", { limit: 20, sortKey: "recency_at", searchTerm: term, sourceKinds: LIST_SOURCES });
  setState((s) => ({ threads: rememberThreads(response.data, s.threads, readStatesOf(response)) }));
  return response.data;
}

/** Content search with a snippet per thread (thread/search); falls back to title search. */
export async function searchThreadContent(term: string): Promise<{ thread: Thread; snippet: string | null }[]> {
  const response = await optional<{ data: ThreadSearchResult[] }>("thread/search", { searchTerm: term, limit: 20, sortKey: "recency_at" });
  if (!response) return (await searchThreads(term)).map((thread) => ({ thread, snippet: null }));
  setState((s) => ({ threads: rememberThreads(response.data.map((r) => r.thread), s.threads) }));
  return response.data;
}

export async function refreshThreads(more = false): Promise<void> {
  const { list } = getState();
  if (more && !list.cursor) return;
  setState({ list: { ...list, loading: true } });
  try {
    const response = await call("thread/list", {
      cursor: more ? list.cursor : null,
      limit: 40,
      sortKey: list.sort === "created" ? "created_at" : "recency_at",
      archived: list.archived,
      sourceKinds: LIST_SOURCES,
    });
    setState((s) => {
      const ids = response.data.map((thread) => thread.id);
      return {
        threads: rememberThreads(response.data, s.threads, readStatesOf(response)),
        list: {
          ...s.list,
          ids: more ? [...s.list.ids, ...ids.filter((id) => !s.list.ids.includes(id))] : ids,
          cursor: response.nextCursor,
          loading: false,
          error: undefined,
        },
      };
    });
  } catch (error) {
    setState((s) => ({ list: { ...s.list, loading: false, error: errorMessage(error) } }));
    toast("error", "读取会话列表失败", errorMessage(error));
  }
}

export function setListFilter(filter: Partial<{ archived: boolean; sort: SessionSort }>): void {
  setState((s) => ({ list: { ...s.list, ...filter, cursor: null } }));
  void refreshThreads();
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
  const response = await optional<{ data: Project[] }>("project/list", { sortKey: "position", limit: 100 }).catch(() => null);
  setState({ projects: response?.data ?? [] });
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
}

export async function createProject(name: string, roots: string[]): Promise<Project | null> {
  const response = await optional<{ project: Project }>("project/create", { name, roots: roots.map((path) => ({ path })), idempotencyKey: crypto.randomUUID() });
  if (response) setState((s) => ({ projects: [...s.projects, response.project] }));
  return response?.project ?? null;
}

/** Move a thread into a project, or out of every project with null. */
export async function setThreadProject(threadId: string, projectId: string | null): Promise<void> {
  await call("thread/metadata/update", { threadId, projectId } as never);
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
  setState((s) => ({ activeId: null, panel: null, draftEpoch: s.draftEpoch + 1 }));
  if (previous) void releaseThread(previous);
}

export async function openThread(id: string, force = false): Promise<void> {
  const previous = getState().activeId;
  setState({ activeId: id, panel: null });
  if (previous && previous !== id) void releaseThread(previous);
  const thread = getState().threads[id];
  if (thread && (thread.unread || thread.readState?.firstUnread)) void markRead(id);
  if (!thread || (thread.subscribed && thread.loaded && !force)) {
    if (thread?.subscribed) startBackgroundPoll(id);
    return;
  }
  updateThread(id, (t) => ({ ...t, loading: true }));
  try {
    if (!getState().list.archived) {
      const response = await call("thread/resume", { threadId: id, excludeTurns: true });
      const mode = (response.collaborationMode as { mode?: string } | null)?.mode;
      updateThread(id, (t) => ({
        ...t,
        meta: mergeMeta(t.meta, response.thread),
        settings: settingsFrom(response),
        planMode: mode === "plan",
        subscribed: true,
      }));
    }
    await loadTurns(id, false);
    void loadGoal(id);
    void refreshQueue(id);
    void refreshAttachments(id);
    if (getState().threads[id]?.subscribed) {
      void refreshBackground(id);
      startBackgroundPoll(id);
    }
  } catch (error) {
    updateThread(id, (t) => ({ ...t, loading: false }));
    toast("error", "打开会话失败", errorMessage(error));
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
  if (older) updateThread(id, (t) => ({ ...t, loading: true }));
  const response = await call("thread/turns/list", {
    threadId: id,
    cursor: older ? thread.olderCursor : null,
    limit: 20,
    sortDirection: "desc",
    itemsView: "full",
  });
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
}

/** Drop idle threads we navigated away from so app-server can unload them. */
async function releaseThread(id: string): Promise<void> {
  if (backgroundPoll?.threadId === id) stopBackgroundPoll();
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

export async function startThread(): Promise<string> {
  const { prefs } = getState();
  const preset = prefs.permission ? PRESETS[prefs.permission] : null;
  const projectId = prefs.projectId ?? projectFor(prefs.cwd)?.id ?? null;
  const params: Record<string, unknown> = {
    cwd: prefs.cwd || null,
    model: prefs.model,
    approvalPolicy: preset?.approval ?? null,
    sandbox: preset?.sandbox ?? null,
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
    threads: {
      ...s.threads,
      [id]: {
        ...emptyThreadState(response.thread),
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
  if (!prefs.memory) void setMemoryMode(id, "disabled").catch(() => {});
  startBackgroundPoll(id);
  return id;
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
  // Thinking views need summaries the config turned off.
  if ((thread.view ?? getState().defaultView) !== "normal" && summariesOff(thread)) params.summary = "auto";
  const { modes } = getState();
  if (modes.length) {
    const effective = effectiveSettings(thread);
    const mask = modes.find((m) => m.mode === (thread.planMode ? "plan" : "default"));
    (params as Record<string, unknown>).collaborationMode = {
      mode: thread.planMode ? "plan" : "default",
      settings: {
        model: overrides.model ?? mask?.model ?? effective.model ?? defaultModel(getState().models)?.id ?? "",
        reasoning_effort: overrides.effort ?? mask?.reasoning_effort ?? effective.effort ?? null,
        developer_instructions: null,
      },
    };
  }
  return params;
}

/**
 * Sends user input. Idle: starts a turn (and the thread if needed). Busy: steers the running
 * turn (Enter), or queues it with `queue` (Ctrl+Enter) and whenever the turn cannot be steered.
 * Throws when queueing is needed but the server has no queue.
 */
export async function sendMessage(threadId: string | null, input: UserInput[], opts: { queue?: boolean } = {}): Promise<void> {
  const id = threadId ?? (await startThread());
  let thread = getState().threads[id];
  if (!thread.subscribed) {
    await openThread(id, true);
    thread = getState().threads[id];
  }
  const running = activeTurn(thread);
  if (running) {
    if (opts.queue || !canSteer(thread)) return queueMessage(id, input);
    try {
      await call("turn/steer", { threadId: id, input, expectedTurnId: running.id, clientUserMessageId: crypto.randomUUID() });
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
  if (text && !thread.meta.preview) updateThread(id, (t) => ({ ...t, meta: { ...t.meta, preview: text } }));
  updateThread(id, (t) => ({ ...t, sending: true }));
  let response;
  try {
    response = await call("turn/start", { threadId: id, input, ...turnOverrides(getState().threads[id]) });
  } finally {
    updateThread(id, (t) => ({ ...t, sending: false }));
  }
  updateThread(id, (t) => ({
    ...updateTurn(t, response.turn.id, (turn) => ({
      ...response.turn,
      ...turn,
      status: turn.status === "inProgress" ? response.turn.status : turn.status,
    })),
    overrides: {},
    settings: t.settings && {
      ...t.settings,
      model: t.overrides.model ?? t.settings.model,
      effort: t.overrides.effort ?? t.settings.effort,
      serviceTier: t.overrides.serviceTier ?? t.settings.serviceTier,
      approvalsReviewer: t.overrides.reviewer ?? t.settings.approvalsReviewer,
      permissionProfile: t.overrides.permission
        ? null
        : t.overrides.permissionProfile !== undefined
          ? t.overrides.permissionProfile
          : t.settings.permissionProfile,
      ...(t.overrides.permission
        ? { approvalPolicy: PRESETS[t.overrides.permission].approval, sandbox: PRESETS[t.overrides.permission].policy }
        : {}),
    },
  }));
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
      await call("turn/steer", { threadId, input: queued.input, expectedTurnId: running.id, clientUserMessageId: queued.clientUserMessageId });
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
  if (!threadId) {
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
  updateThread(threadId, (t) => {
    const overrides = { ...t.overrides, ...rest };
    if (presetPicked) overrides.permissionProfile = null;
    if (profilePicked) delete overrides.permission;
    return { ...t, overrides, planMode: planMode ?? t.planMode };
  });
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

export async function renameThread(id: string, name: string): Promise<void> {
  updateThread(id, (t) => ({ ...t, meta: { ...t.meta, name } }));
  await call("thread/name/set", { threadId: id, name });
}

function forgetFromList(id: string): void {
  setState((s) => ({
    list: { ...s.list, ids: s.list.ids.filter((x) => x !== id) },
    activeId: s.activeId === id ? null : s.activeId,
  }));
}

export async function archiveThread(id: string): Promise<void> {
  await call("thread/archive", { threadId: id });
  forgetFromList(id);
}

export async function unarchiveThread(id: string): Promise<void> {
  await call("thread/unarchive", { threadId: id });
  forgetFromList(id);
}

export async function deleteThread(id: string): Promise<void> {
  await call("thread/delete", { threadId: id });
  forgetFromList(id);
}

export async function forkThread(id: string, lastTurnId?: string): Promise<void> {
  const response = await call("thread/fork", { threadId: id, lastTurnId: lastTurnId ?? null, excludeTurns: true });
  const forkId = response.thread.id;
  setState((s) => ({
    threads: {
      ...s.threads,
      [forkId]: { ...emptyThreadState(response.thread), subscribed: true, settings: settingsFrom(response) },
    },
    list: { ...s.list, ids: [forkId, ...s.list.ids.filter((x) => x !== forkId)] },
  }));
  await openThread(forkId, true);
  toast("success", "已创建会话副本");
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
    // Older servers have no attachments.
  }
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
    toast("error", "读取 MCP 服务器失败", errorMessage(error));
  }
}

export async function reloadMcpServers(): Promise<void> {
  await call("config/mcpServer/reload", undefined as never);
  if (getState().mcp) void refreshMcp();
}

export async function loginMcpServer(name: string): Promise<void> {
  const response = await call("mcpServer/oauth/login", { name });
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
    toast("error", "读取 Hooks 失败", errorMessage(error));
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

/** A connector mention for turn input (the text gets `@name`), as the TUI sends it. */
export function connectorMention(connector: Connector): Extract<UserInput, { type: "mention" }> {
  return { type: "mention", name: connector.name, path: `app://${connector.id}` };
}

// ---------------------------------------------------------------------------
// Memory

export async function readMemoryStatus(): Promise<MemoryStatus | null> {
  return optional<MemoryStatus>("memory/status", {});
}

/** Clear every saved memory (destructive: confirm first). */
export async function resetMemory(): Promise<void> {
  const response = await optional("memory/reset", undefined);
  if (response === null) throw new Error("当前 Codex 版本不支持清空记忆");
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

/** Files under CODEX_HOME/memories (MEMORY.md, memory_summary.md, rollout_summaries/, …). */
export async function memoryFiles(subdir = ""): Promise<FsReadDirectoryEntry[]> {
  const home = getState().server.info?.codexHome;
  if (!home) return [];
  const separator = home.includes("\\") ? "\\" : "/";
  try {
    return await readDirectory([home, "memories", subdir].filter(Boolean).join(separator));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Background terminals (agent-started long-running processes)

let backgroundPoll: { threadId: string; timer: ReturnType<typeof setInterval> } | null = null;

export async function refreshBackground(threadId: string): Promise<void> {
  if (!getState().threads[threadId]?.subscribed) return;
  try {
    const response = await optional<{ data: BackgroundTerminal[] }>("thread/backgroundTerminals/list", { threadId, limit: 50 });
    const data = (response?.data ?? []).map((t) => ({ ...t, osPid: t.osPid ?? null, cpuPercent: t.cpuPercent ?? null, rssKb: t.rssKb === null ? null : Number(t.rssKb) }));
    updateThread(threadId, (t) => ({ ...t, background: data }));
  } catch {
    updateThread(threadId, (t) => ({ ...t, background: [] }));
  }
}

/** While the active thread has background terminals, refresh them every 5s. */
function startBackgroundPoll(threadId: string): void {
  if (backgroundPoll?.threadId === threadId) return;
  stopBackgroundPoll();
  const timer = setInterval(() => {
    const thread = getState().threads[threadId];
    if (getState().activeId !== threadId || !thread?.subscribed) return stopBackgroundPoll();
    if (thread.background.length) void refreshBackground(threadId);
  }, 5000);
  backgroundPoll = { threadId, timer };
}

function stopBackgroundPoll(): void {
  if (backgroundPoll) clearInterval(backgroundPoll.timer);
  backgroundPoll = null;
}

export async function terminateBackground(threadId: string, processId: string): Promise<void> {
  await callExperimental("thread/backgroundTerminals/terminate", { threadId, processId });
  await refreshBackground(threadId);
}

export async function cleanBackground(threadId: string): Promise<void> {
  await callExperimental("thread/backgroundTerminals/clean", { threadId });
  await refreshBackground(threadId);
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
// Remote control (ephemeral: lasts as long as this window's app-server)

export async function refreshRemoteControl(): Promise<void> {
  const status = await optional<RemoteControlStatusChangedNotification>("remoteControl/status/read", undefined).catch(() => null);
  setState({ remoteControl: status });
}

export async function setRemoteControl(enabled: boolean): Promise<void> {
  const status = await optional<RemoteControlStatusChangedNotification>(enabled ? "remoteControl/enable" : "remoteControl/disable", { ephemeral: true });
  if (!status) throw new Error("当前 Codex 版本不支持远程控制");
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
    toast("error", "无法启动终端", detail);
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
    case "thread/started": {
      const { thread } = notification.params;
      const spawned = typeof thread.source === "object" && "subAgent" in thread.source && typeof thread.source.subAgent === "object" && "thread_spawn" in thread.source.subAgent;
      setState((s) => {
        const listed = !s.list.archived && !thread.ephemeral && (!thread.parentThreadId || spawned);
        return {
          threads: rememberThreads([thread], s.threads),
          list: listed && !s.list.ids.includes(thread.id) ? { ...s.list, ids: [thread.id, ...s.list.ids] } : s.list,
        };
      });
      return;
    }
    case "thread/status/changed": {
      const { threadId, status } = notification.params;
      updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, status } }));
      return;
    }
    case "thread/name/updated": {
      const { threadId, threadName } = notification.params;
      updateThread(threadId, (t) => ({ ...t, meta: { ...t.meta, name: threadName ?? null } }));
      return;
    }
    case "thread/archived":
    case "thread/deleted":
      if (!getState().list.archived || notification.method === "thread/deleted") forgetFromList(notification.params.threadId);
      return;
    case "thread/unarchived":
      if (getState().list.archived) forgetFromList(notification.params.threadId);
      else void refreshThreads();
      return;
    case "thread/closed":
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false, background: [] }));
      return;
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
      // Plan mode stays a local pick until the next turn carries it.
      updateThread(threadId, (t) => ({
        ...t,
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
          unread: t.unread || (settled && threadId !== getState().activeId),
        };
      });
      for (const resolve of idleWaiters.get(threadId) ?? []) resolve();
      idleWaiters.delete(threadId);
      // The user is looking at it: keep the server's receipt read.
      if (threadId === getState().activeId) void markRead(threadId);
      if (getState().threads[threadId]?.background.length) void refreshBackground(threadId);
      if (turn.status === "failed" && turn.error && threadId !== getState().activeId) toast("error", "本轮执行失败", turn.error.message);
      return;
    }
    case "turn/plan/updated": {
      const { threadId, turnId, explanation, plan } = notification.params;
      updateThread(threadId, (t) => updateTurn(t, turnId, (turn) => ({ ...turn, plan: { explanation, steps: plan } })));
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
          notification.method === "item/started" ? [at] : [previous?.[0] ?? at, at];
        return { ...updateTurn(t, turnId, (turn) => upsertItem(turn, item)), timing: { ...t.timing, [item.id]: timing } };
      });
      if (item.type === "commandExecution" && item.processId) void refreshBackground(threadId);
      return;
    }
    case "item/agentMessage/delta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => ({
          ...updateItem(turn, itemId, (item) => (item.type === "agentMessage" ? { ...item, text: item.text + delta } : item)),
          buffering: null,
        })),
      );
      return;
    }
    case "item/plan/delta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) =>
          updateItem(turn, itemId, (item) => (item.type === "plan" ? { ...item, text: item.text + delta } : item)),
        ),
      );
      return;
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta": {
      const params = notification.params;
      updateThread(params.threadId, (t) =>
        updateTurn(t, params.turnId, (turn) =>
          updateItem(turn, params.itemId, (item) => {
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
        ),
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
    case "item/commandExecution/terminalInteraction": {
      const { threadId, itemId, stdin } = notification.params;
      updateThread(threadId, (t) => ({ ...t, stdin: { ...t.stdin, [itemId]: [...(t.stdin[itemId] ?? []), stdin] } }));
      return;
    }
    case "item/fileChange/patchUpdated": {
      const { threadId, turnId, itemId, changes } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => updateItem(turn, itemId, (item) => (item.type === "fileChange" ? { ...item, changes } : item))),
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
      if (!threadId) {
        if (status === "failed") toast("error", `MCP 服务器「${name}」启动失败`, error ?? undefined);
        return;
      }
      updateThread(threadId, (t) => ({ ...t, mcp: { ...t.mcp, [name]: { status, error, failureReason } } }));
      if (status === "failed") {
        const reauth = failureReason === "reauthenticationRequired";
        addNotice(threadId, null, {
          kind: reauth ? "mcpReauth" : "mcpFailed",
          text: reauth ? `MCP 服务器「${name}」需要重新登录` : `MCP 服务器「${name}」启动失败`,
          detail: error ?? undefined,
          server: name,
        });
      }
      return;
    }
    case "mcpServer/oauthLogin/completed": {
      const { name, success, error } = notification.params;
      if (success) toast("success", `MCP 服务器 ${name} 登录成功`);
      else toast("error", `MCP 服务器 ${name} 登录失败`, error);
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
      const { success, error } = notification.params;
      if (success) {
        setState({ login: null });
        toast("success", "登录成功");
        void refreshAccount();
        void refreshModels();
      } else {
        setState((s) => ({ login: s.login && { ...s.login, error: error ?? "登录失败" } }));
      }
      return;
    }
    case "account/rateLimits/updated": {
      const update = notification.params.rateLimits;
      setState((s) => {
        if (!s.rateLimits) return {};
        const merged = { ...s.rateLimits.rateLimits };
        for (const [key, value] of Object.entries(update)) {
          if (value !== null) (merged as Record<string, unknown>)[key] = value;
        }
        return { rateLimits: { ...s.rateLimits, rateLimits: merged } };
      });
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
    case "warning": {
      const { threadId, message } = notification.params;
      if (threadId && getState().threads[threadId]) addNotice(threadId, null, { kind: "warning", text: message });
      else toast("warning", message);
      return;
    }
    case "guardianWarning": {
      const { threadId, message } = notification.params;
      if (guardianWarningShown(message)) addNotice(threadId, null, { kind: "guardian", text: message });
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
      if (success) toast("success", "Windows 沙箱已就绪");
      else toast("error", "Windows 沙箱设置失败", error ?? undefined);
      return;
    }
    case "externalAgentConfig/import/progress":
    case "externalAgentConfig/import/completed": {
      const { importId, itemTypeResults } = notification.params;
      const done = notification.method === "externalAgentConfig/import/completed";
      setState({ imports: { id: importId, results: itemTypeResults, done } });
      if (done) {
        toast("success", "导入完成");
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
