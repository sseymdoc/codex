// Controller: owns the app-server connection, turns server notifications into
// state, and exposes the actions the UI calls.

import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { FuzzyFileSearchResponse } from "@protocol/FuzzyFileSearchResponse";
import type { RequestId } from "@protocol/RequestId";
import type { ServerNotification } from "@protocol/ServerNotification";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
import type { ConfigBatchWriteParams } from "@protocol/v2/ConfigBatchWriteParams";
import type { ConfigReadResponse } from "@protocol/v2/ConfigReadResponse";
import type { ConfigWriteResponse } from "@protocol/v2/ConfigWriteResponse";
import type { FsReadDirectoryResponse } from "@protocol/v2/FsReadDirectoryResponse";
import type { GetAccountRateLimitsResponse } from "@protocol/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@protocol/v2/GetAccountResponse";
import type { ListMcpServerStatusResponse } from "@protocol/v2/ListMcpServerStatusResponse";
import type { LoginAccountResponse } from "@protocol/v2/LoginAccountResponse";
import type { McpServerOauthLoginResponse } from "@protocol/v2/McpServerOauthLoginResponse";
import type { Model } from "@protocol/v2/Model";
import type { ModelListResponse } from "@protocol/v2/ModelListResponse";
import type { ReviewStartResponse } from "@protocol/v2/ReviewStartResponse";
import type { ReviewTarget } from "@protocol/v2/ReviewTarget";
import type { SandboxMode } from "@protocol/v2/SandboxMode";
import type { SandboxPolicy } from "@protocol/v2/SandboxPolicy";
import type { SkillsListResponse } from "@protocol/v2/SkillsListResponse";
import type { Thread } from "@protocol/v2/Thread";
import type { ThreadForkResponse } from "@protocol/v2/ThreadForkResponse";
import type { ThreadListResponse } from "@protocol/v2/ThreadListResponse";
import type { ThreadResumeResponse } from "@protocol/v2/ThreadResumeResponse";
import type { ThreadStartResponse } from "@protocol/v2/ThreadStartResponse";
import type { ThreadTurnsListResponse } from "@protocol/v2/ThreadTurnsListResponse";
import type { TurnStartParams } from "@protocol/v2/TurnStartParams";
import type { TurnStartResponse } from "@protocol/v2/TurnStartResponse";
import type { UserInput } from "@protocol/v2/UserInput";
import { Rpc, type Hello, type Method, type ParamsOf } from "./rpc";
import {
  emptyThreadState,
  getState,
  setState,
  toast,
  updateItem,
  updateThread,
  updateTurn,
  upsertItem,
  type PermissionPreset,
  type ThreadSettings,
  type ThreadState,
  type TurnState,
} from "./store";

export const VERSION = "0.1.0";

interface Responses {
  initialize: InitializeResponse;
  "account/read": GetAccountResponse;
  "account/rateLimits/read": GetAccountRateLimitsResponse;
  "account/login/start": LoginAccountResponse;
  "account/login/cancel": unknown;
  "account/logout": unknown;
  "model/list": ModelListResponse;
  "config/read": ConfigReadResponse;
  "config/batchWrite": ConfigWriteResponse;
  "thread/list": ThreadListResponse;
  "thread/start": ThreadStartResponse;
  "thread/resume": ThreadResumeResponse;
  "thread/fork": ThreadForkResponse;
  "thread/unsubscribe": unknown;
  "thread/turns/list": ThreadTurnsListResponse;
  "thread/name/set": unknown;
  "thread/archive": unknown;
  "thread/unarchive": unknown;
  "thread/delete": unknown;
  "thread/compact/start": unknown;
  "thread/shellCommand": unknown;
  "turn/start": TurnStartResponse;
  "turn/steer": unknown;
  "turn/interrupt": unknown;
  "review/start": ReviewStartResponse;
  fuzzyFileSearch: FuzzyFileSearchResponse;
  "fs/readDirectory": FsReadDirectoryResponse;
  "mcpServerStatus/list": ListMcpServerStatusResponse;
  "config/mcpServer/reload": unknown;
  "mcpServer/oauth/login": McpServerOauthLoginResponse;
  "skills/list": SkillsListResponse;
  "skills/config/write": unknown;
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
function callExperimental<R>(method: string, params: unknown): Promise<R> {
  return rpc.request<R>(method as Method, params);
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

export function defaultModel(models: Model[]): Model | undefined {
  return models.find((model) => model.isDefault) ?? models[0];
}

export function modelLabel(id: string | null | undefined): string {
  if (!id) return "默认模型";
  return getState().models.find((model) => model.id === id || model.model === id)?.displayName ?? id;
}

/** Model / effort / preset the composer should show for a thread or the new-chat screen. */
export function effectiveSettings(thread: ThreadState | null) {
  const { prefs, config, models } = getState();
  if (!thread) {
    const model = prefs.model ?? config?.model ?? defaultModel(models)?.id ?? null;
    return {
      model,
      effort: prefs.effort ?? config?.model_reasoning_effort ?? models.find((m) => m.id === model)?.defaultReasoningEffort ?? null,
      permission: prefs.permission ?? presetOf(config?.approval_policy, config?.sandbox_mode),
      planMode: prefs.planMode,
    };
  }
  const settings = thread.settings;
  const model = thread.overrides.model ?? settings?.model ?? thread.meta.model;
  return {
    model,
    effort:
      thread.overrides.effort ??
      settings?.effort ??
      thread.meta.reasoningEffort ??
      models.find((m) => m.id === model)?.defaultReasoningEffort ??
      null,
    permission: thread.overrides.permission ?? presetOf(settings?.approvalPolicy, settings?.sandbox),
    planMode: thread.planMode,
  };
}

export function activeTurn(thread: ThreadState | undefined): TurnState | undefined {
  return thread?.turns.findLast((turn) => turn.status === "inProgress");
}

// ---------------------------------------------------------------------------
// Connection lifecycle

export function connect(): void {
  setState({ conn: { status: "connecting" } });
  void rpc.connect();
}

async function onOpen(hello: Hello): Promise<void> {
  setState((s) => ({
    server: { ...s.server, cwd: hello.cwd, command: hello.command },
    prefs: { ...s.prefs, cwd: s.prefs.cwd || hello.cwd },
  }));
  try {
    const info = await call("initialize", {
      clientInfo: { name: "codex_ui", title: "Codex UI", version: VERSION },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    rpc.notify("initialized");
    setState((s) => ({ conn: { status: "ready" }, server: { ...s.server, info } }));
  } catch (error) {
    setState({ conn: { status: "closed", error: `初始化失败：${errorMessage(error)}` } });
    return;
  }
  await Promise.allSettled([refreshAccount(), refreshModels(), refreshConfig(), refreshThreads(), loadModes()]);
  const { activeId } = getState();
  if (activeId) await openThread(activeId, true);
}

function onClose(reason: string, detail?: string): void {
  setState((s) => ({
    conn: { status: "closed", error: reason, detail },
    requests: [],
    threads: Object.fromEntries(Object.entries(s.threads).map(([id, t]) => [id, { ...t, subscribed: false }])),
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

async function refreshModels(): Promise<void> {
  const models: Model[] = [];
  let cursor: string | null = null;
  try {
    do {
      const page: ModelListResponse = await call("model/list", { cursor, limit: 100, includeHidden: false });
      models.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    setState({ models });
  } catch (error) {
    toast("warning", "读取模型列表失败", errorMessage(error));
  }
}

async function loadModes(): Promise<void> {
  try {
    const response = await callExperimental<{ data: CollaborationModeMask[] }>("collaborationMode/list", {});
    setState({ modes: response.data });
  } catch {
    setState({ modes: [] });
  }
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

// ---------------------------------------------------------------------------
// Thread list

function mergeMeta(previous: Thread, next: Thread): Thread {
  // Early notifications carry an empty preview; keep the one shown optimistically.
  return { ...previous, ...next, preview: next.preview || previous.preview, turns: [] };
}

function rememberThreads(threads: Thread[], current = getState().threads): Record<string, ThreadState> {
  const merged = { ...current };
  for (const thread of threads) {
    merged[thread.id] = merged[thread.id]
      ? { ...merged[thread.id], meta: mergeMeta(merged[thread.id].meta, thread) }
      : emptyThreadState(thread);
  }
  return merged;
}

export async function refreshThreads(more = false): Promise<void> {
  const { list } = getState();
  if (more && !list.cursor) return;
  setState({ list: { ...list, loading: true } });
  try {
    const response = await call("thread/list", {
      cursor: more ? list.cursor : null,
      limit: 40,
      sortKey: "recency_at",
      archived: list.archived,
      searchTerm: list.search.trim() || null,
    });
    setState((s) => {
      const ids = response.data.map((thread) => thread.id);
      return {
        threads: rememberThreads(response.data, s.threads),
        list: {
          ...s.list,
          ids: more ? [...s.list.ids, ...ids.filter((id) => !s.list.ids.includes(id))] : ids,
          cursor: response.nextCursor,
          loading: false,
        },
      };
    });
  } catch (error) {
    setState((s) => ({ list: { ...s.list, loading: false } }));
    toast("error", "读取会话列表失败", errorMessage(error));
  }
}

export function setListFilter(filter: Partial<{ search: string; archived: boolean }>): void {
  setState((s) => ({ list: { ...s.list, ...filter, cursor: null } }));
  void refreshThreads();
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
  };
}

export function newChat(): void {
  const previous = getState().activeId;
  setState({ activeId: null, panel: null });
  if (previous) void releaseThread(previous);
}

export async function openThread(id: string, force = false): Promise<void> {
  const previous = getState().activeId;
  setState({ activeId: id, panel: null });
  if (previous && previous !== id) void releaseThread(previous);
  const thread = getState().threads[id];
  if (!thread || (thread.subscribed && thread.loaded && !force)) return;
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
  } catch (error) {
    updateThread(id, (t) => ({ ...t, loading: false }));
    toast("error", "打开会话失败", errorMessage(error));
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
  const thread = getState().threads[id];
  if (!thread?.subscribed || activeTurn(thread) || getState().requests.some((r) => requestThreadId(r) === id)) return;
  updateThread(id, (t) => ({ ...t, subscribed: false, loaded: false }));
  await call("thread/unsubscribe", { threadId: id }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Starting work

export async function startThread(): Promise<string> {
  const { prefs } = getState();
  const preset = prefs.permission ? PRESETS[prefs.permission] : null;
  const response = await call("thread/start", {
    cwd: prefs.cwd || null,
    model: prefs.model,
    approvalPolicy: preset?.approval ?? null,
    sandbox: preset?.sandbox ?? null,
  });
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
  }
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

/** Sends user input: starts a thread if needed, steers a running turn, or starts a new turn. */
export async function sendMessage(threadId: string | null, input: UserInput[]): Promise<void> {
  const id = threadId ?? (await startThread());
  let thread = getState().threads[id];
  if (!thread.subscribed) {
    await openThread(id, true);
    thread = getState().threads[id];
  }
  const running = activeTurn(thread);
  if (running) {
    await call("turn/steer", { threadId: id, input, expectedTurnId: running.id });
    return;
  }
  // The server fills `preview` from the first message only once it is persisted; show it right away.
  const text = input.find((part): part is Extract<UserInput, { type: "text" }> => part.type === "text")?.text;
  if (text && !thread.meta.preview) updateThread(id, (t) => ({ ...t, meta: { ...t.meta, preview: text } }));
  const response = await call("turn/start", { threadId: id, input, ...turnOverrides(thread) });
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
      ...(t.overrides.permission
        ? { approvalPolicy: PRESETS[t.overrides.permission].approval, sandbox: PRESETS[t.overrides.permission].policy }
        : {}),
    },
  }));
}

export async function runShellCommand(threadId: string | null, command: string): Promise<void> {
  const id = threadId ?? (await startThread());
  if (!getState().threads[id].subscribed) await openThread(id, true);
  await call("thread/shellCommand", { threadId: id, command });
}

export async function interrupt(threadId: string): Promise<void> {
  const turn = activeTurn(getState().threads[threadId]);
  if (turn) await call("turn/interrupt", { threadId, turnId: turn.id });
}

export function setOverride(threadId: string | null, patch: Partial<{ model: string; effort: string; permission: PermissionPreset; planMode: boolean }>): void {
  if (!threadId) {
    setState((s) => ({ prefs: { ...s.prefs, ...patch } }));
    return;
  }
  const { planMode, ...rest } = patch;
  updateThread(threadId, (t) => ({ ...t, overrides: { ...t.overrides, ...rest }, planMode: planMode ?? t.planMode }));
}

export async function startReview(threadId: string | null, target: ReviewTarget): Promise<void> {
  const id = threadId ?? (await startThread());
  if (!getState().threads[id].subscribed) await openThread(id, true);
  // The review turn arrives through turn/started; its id need not match the response's turn id.
  await call("review/start", { threadId: id, target, delivery: "inline" });
}

export async function compactThread(id: string): Promise<void> {
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

export async function listMcpServers(): Promise<ListMcpServerStatusResponse["data"]> {
  return (await call("mcpServerStatus/list", { limit: 100, detail: "toolsAndAuthOnly" })).data;
}

export async function reloadMcpServers(): Promise<void> {
  await call("config/mcpServer/reload", undefined as never);
}

export async function loginMcpServer(name: string): Promise<void> {
  const response = await call("mcpServer/oauth/login", { name });
  window.open(response.authorizationUrl, "_blank", "noopener");
}

export async function listSkills(cwd: string, forceReload = false): Promise<SkillsListResponse["data"]> {
  return (await call("skills/list", { cwds: cwd ? [cwd] : [], forceReload })).data;
}

export async function setSkillEnabled(path: string, enabled: boolean): Promise<void> {
  await call("skills/config/write", { path, enabled });
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

function onNotification(notification: ServerNotification): void {
  switch (notification.method) {
    case "thread/started": {
      const { thread } = notification.params;
      setState((s) => {
        const listed = !s.list.archived && !thread.parentThreadId && !thread.ephemeral;
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
      updateThread(notification.params.threadId, (t) => ({ ...t, subscribed: false }));
      return;
    case "thread/tokenUsage/updated": {
      const { threadId, tokenUsage } = notification.params;
      updateThread(threadId, (t) => ({ ...t, tokenUsage }));
      return;
    }
    case "turn/started": {
      const { threadId, turn } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turn.id, (current) => ({ ...current, ...turn, items: current.items.length ? current.items : turn.items })),
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
        }));
        // Turns run one at a time, so an empty in-progress sibling is an orphan: inline reviews
        // announce turn/started under an id that never receives items or completion.
        return { ...next, turns: next.turns.filter((x) => x.id === turn.id || x.status !== "inProgress" || x.items.length > 0) };
      });
      if (turn.status === "failed" && turn.error) toast("error", "本轮执行失败", turn.error.message);
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
      return;
    }
    case "item/agentMessage/delta": {
      const { threadId, turnId, itemId, delta } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) =>
          updateItem(turn, itemId, (item) => (item.type === "agentMessage" ? { ...item, text: item.text + delta } : item)),
        ),
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
    case "item/fileChange/patchUpdated": {
      const { threadId, turnId, itemId, changes } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => updateItem(turn, itemId, (item) => (item.type === "fileChange" ? { ...item, changes } : item))),
      );
      return;
    }
    case "error": {
      const { threadId, turnId, error, willRetry } = notification.params;
      updateThread(threadId, (t) =>
        updateTurn(t, turnId, (turn) => (willRetry ? { ...turn, retrying: error.message } : { ...turn, error, retrying: null })),
      );
      return;
    }
    case "serverRequest/resolved": {
      const { requestId } = notification.params;
      setState((s) => ({ requests: s.requests.filter((r) => r.id !== requestId) }));
      return;
    }
    case "account/updated":
      void refreshAccount();
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
    case "mcpServer/oauthLogin/completed": {
      const { name, success, error } = notification.params;
      if (success) toast("success", `MCP 服务器 ${name} 登录成功`);
      else toast("error", `MCP 服务器 ${name} 登录失败`, error);
      return;
    }
    case "model/rerouted": {
      const { fromModel, toModel } = notification.params;
      toast("info", "模型已切换", `${fromModel} → ${toModel}`);
      return;
    }
    case "warning":
      toast("warning", notification.params.message);
      return;
    case "configWarning":
      toast("warning", notification.params.summary, notification.params.details ?? undefined);
      return;
    case "guardianWarning":
    case "windows/worldWritableWarning":
      toast("warning", "安全提示", JSON.stringify(notification.params));
      return;
    default:
      return;
  }
}
