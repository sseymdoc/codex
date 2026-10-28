// Codex Cloud (chatgpt.com/codex): cloud environments and tasks, called through the bridge's
// /api/cloud under this session's ChatGPT login (server/cloud.mjs). /wham is ChatGPT's private
// API; the shapes follow codex-rs backend-client and the Codex VS Code extension, and every field
// is read defensively. Cloud tasks are not app-server threads: they live in this module's store.
import type { Project } from "@protocol/v2/Project";
import { useSyncExternalStore } from "react";
import { callExperimental, connectionId, errorMessage } from "./codex";
import { environmentOf } from "./environments";

export type TurnStatus = "pending" | "in_progress" | "completed" | "cancelled" | "failed";

export interface CloudEnvironment {
  id: string;
  label: string;
  /** The environment's repository id (`github-123`) and its name and default branch, when known. */
  repo: string | null;
  repoName: string | null;
  defaultBranch: string | null;
}

export interface CloudTask {
  id: string;
  title: string;
  status: TurnStatus;
  /** ms */
  updatedAt: number;
  environmentLabel: string | null;
  files: number;
  added: number;
  removed: number;
  unread: boolean;
}

export interface CloudTurn {
  id: string;
  role: "user" | "assistant";
  status: TurnStatus;
  text: string;
  diff: string | null;
  error: string | null;
  /** A cancel was asked for while it still ran (the extension shows it as interrupted). */
  cancelling: boolean;
}

export interface CloudTaskDetail {
  task: CloudTask & { environmentId: string | null };
  turns: CloudTurn[];
}

interface CloudState {
  environments: CloudEnvironment[] | null;
  environmentsError: string | null;
  tasks: CloudTask[] | null;
  tasksError: string | null;
  details: Record<string, CloudTaskDetail>;
  detailErrors: Record<string, string>;
}

let state: CloudState = { environments: null, environmentsError: null, tasks: null, tasksError: null, details: {}, detailErrors: {} };
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useCloud<T>(pick: (s: CloudState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const cloudState = () => state;

/** `upstream`: ChatGPT itself answered with this status (else the bridge or the network failed). */
export class CloudError extends Error {
  constructor(readonly status: number, message: string, readonly type?: string, readonly upstream = false) {
    super(message);
  }
}

/**
 * One /wham (or Dots) call through the bridge; an upstream error status throws with its `detail`.
 * `route` carries a dot room's thread route both ways (sent when set, updated from the answer).
 */
export async function cloudCall<T>(method: string, path: string, body?: unknown, service = "Codex Cloud", route?: { value?: string }): Promise<T> {
  const id = connectionId();
  if (!id) throw new Error("未连接到 app-server");
  const response = await fetch(`/api/cloud?c=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, ...(body === undefined ? {} : { body }), ...(route?.value ? { threadRoute: route.value } : {}) }),
  });
  if (!response.ok) throw new CloudError(response.status, (await response.text()) || `无法连接 ${service}（${response.status}）`);
  return cloudAnswer<T>((await response.json()) as CloudAnswer, service, route);
}

export interface CloudAnswer {
  status: number;
  body: unknown;
  threadRoute?: string;
}

/** The bridge's `{status, body}`: the body, or the upstream error it carries. */
export function cloudAnswer<T>(answer: CloudAnswer, service: string, route?: { value?: string }): T {
  if (route && answer.threadRoute) route.value = answer.threadRoute;
  if (answer.status < 400) return answer.body as T;
  // FastAPI's { detail } or the gateway's { error: { message, type } }.
  const failure = obj(answer.body);
  const detail = failure.detail ?? failure.error;
  const text = typeof detail === "string" ? detail : str((detail as { message?: unknown } | undefined)?.message);
  throw new CloudError(answer.status, `${service} 返回错误（${answer.status}）${text ? `：${text}` : ""}`, str((detail as { type?: unknown } | undefined)?.type) || undefined, true);
}

/** A query string /api/cloud lets through: every reserved character percent-encoded. */
export const query = (params: Record<string, string | number | undefined>) =>
  "?" + Object.entries(params).filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`).join("&");

export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const cloudTaskUrl = (id: string) => `https://chatgpt.com/codex/tasks/${encodeURIComponent(id)}`;
export const CLOUD_HOME = "https://chatgpt.com/codex";

// ---------------------------------------------------------------------------
// Environments

function parseEnvironment(raw: unknown): CloudEnvironment[] {
  const env = obj(raw);
  if (!str(env.id)) return [];
  const repo = str(list(env.repos)[0]) || null;
  const info = obj(repo ? obj(env.repo_map)[repo] : undefined);
  return [{ id: str(env.id), label: str(env.label) || str(env.id), repo, repoName: str(info.repository_full_name) || null, defaultBranch: str(info.default_branch) || null }];
}

export async function refreshCloudEnvironments(): Promise<void> {
  try {
    const environments = list(await cloudCall<unknown>("GET", "/wham/environments")).flatMap(parseEnvironment);
    set({ environments, environmentsError: null });
  } catch (error) {
    set({ environmentsError: errorMessage(error) });
  }
}

/** Claude's network levels (c73f2f585), kept as Codex's agent_network_access. */
export type NetworkLevel = "none" | "trusted" | "full" | "custom";

export interface CloudEnvironmentForm {
  name: string;
  network: NetworkLevel;
  domains: string[];
  /** Custom access also allows the common package managers (Codex's "codex" preset). */
  packages: boolean;
  setup: string;
  env: Record<string, string>;
}

/** off → none; the "all" preset (or on without one) → full; "codex" alone → trusted; else custom. */
export function networkOf(access: unknown): Pick<CloudEnvironmentForm, "network" | "domains" | "packages"> {
  const value = obj(access);
  const raw = value.allowlist_domains;
  const domains = (Array.isArray(raw) ? raw.map(str) : str(raw).split(/[\s,]+/)).map((domain) => domain.trim()).filter(Boolean);
  const preset = str(value.preset_allowlist);
  if (value.mode !== "on" && value.mode !== "custom") return { network: "none", domains: [], packages: false };
  if (value.mode === "on" && (preset === "all" || !preset)) return { network: "full", domains: [], packages: false };
  if (preset === "codex" && !domains.length) return { network: "trusted", domains: [], packages: false };
  return { network: "custom", domains, packages: preset === "codex" };
}

/** The level over what the record had: rules, deny lists and read-only methods stay as they were. */
function accessOf(form: CloudEnvironmentForm, previous: unknown) {
  const keep = obj(previous);
  switch (form.network) {
    case "none": return { ...keep, mode: "off" };
    case "full": return { ...keep, mode: "on", preset_allowlist: "all" };
    case "trusted": return { ...keep, mode: "on", preset_allowlist: "codex", allowlist_domains: null };
    case "custom": return { ...keep, mode: "on", preset_allowlist: form.packages ? "codex" : "none", allowlist_domains: form.domains.join(", ") };
  }
}

/** Newer settings than the extension's form knows, sent back as read so a full-record PATCH keeps them. */
const PASSED_THROUGH = ["codex_github_direct", "devcontainer", "enable_docker_in_docker", "enable_gitlab_webhooks"];

const script = (value: unknown) => (Array.isArray(value) ? value.map(str).join("\n") : str(value));

/** A cloud environment's editable settings, and the record they came from (PATCH needs its etag). */
export async function readCloudEnvironment(id: string): Promise<{ form: CloudEnvironmentForm; raw: Record<string, unknown> }> {
  const raw = obj(await cloudCall<unknown>("GET", `/wham/environments/${encodeURIComponent(id)}/with-creator-and-machine`));
  const env = Object.fromEntries(Object.entries(obj(raw.env_vars)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return { form: { name: str(raw.label), ...networkOf(raw.agent_network_access), setup: script(raw.setup), env }, raw };
}

/** ChatGPT's GitHub connector, which the extension falls back to when it finds none. */
const GITHUB_CONNECTOR = "connector_76869538009648d5b282a4bb21c3d157";
const UNIVERSAL = "wham-public/wham-universal";

/** A new private environment on the universal image, as the extension makes one (c014 Kzt). */
export async function createCloudEnvironment(form: CloudEnvironmentForm, repo: string): Promise<CloudEnvironment> {
  const created = await cloudCall<unknown>("POST", "/wham/environments", {
    label: form.name.trim(),
    description: "",
    machine_id: UNIVERSAL,
    repos: [repo],
    github_connector_id: GITHUB_CONNECTOR,
    workspace_dir: "/workspace",
    agent_network_access: accessOf(form, undefined),
    setup: form.setup,
    maintenance_setup: "",
    env_vars: form.env,
    secrets_with_domains: [],
    share_settings: "private",
    share_targets: [],
    auto_setup_settings: { use_auto_setup: form.setup.trim() === "" },
    cache_settings: { post_setup_cache_enabled: true },
    enable_authtranslator: false,
  });
  const [environment] = parseEnvironment(created);
  if (!environment) throw new Error("Codex Cloud 没有返回新环境。");
  await refreshCloudEnvironments();
  return environment;
}

/** PATCH sends the whole record back (c014 Jzt): what the form does not edit is kept as read. */
export async function updateCloudEnvironment(id: string, form: CloudEnvironmentForm, raw: Record<string, unknown>): Promise<void> {
  const setupChanged = form.setup !== script(raw.setup);
  await cloudCall("PATCH", `/wham/environments/${encodeURIComponent(id)}`, {
    label: form.name.trim(),
    description: str(raw.description),
    machine_id: str(raw.machine_id) || UNIVERSAL,
    workspace_dir: str(raw.workspace_dir) || "/workspace",
    agent_network_access: accessOf(form, raw.agent_network_access),
    setup: form.setup,
    maintenance_setup: script(raw.maintenance_setup),
    env_vars: form.env,
    // An empty change list keeps every secret as it is.
    secrets_with_domains: [],
    share_settings: raw.share_settings === "workspace" || raw.share_settings === "public" ? "workspace" : "private",
    share_targets: list(raw.share_targets),
    auto_setup_settings: setupChanged || !raw.auto_setup_settings ? { use_auto_setup: form.setup.trim() === "" } : raw.auto_setup_settings,
    cache_settings: raw.cache_settings ?? { post_setup_cache_enabled: true },
    enable_authtranslator: raw.enable_authtranslator === true,
    ...Object.fromEntries(PASSED_THROUGH.filter((key) => key in raw).map((key) => [key, raw[key]])),
    ...(raw.etag !== undefined && { etag: raw.etag }),
  });
  await refreshCloudEnvironments();
}

export interface CloudRepository {
  id: string;
  name: string;
}

/** GitHub repositories the connector reaches; `needsConnect` when ChatGPT has no GitHub link yet. */
export async function cloudRepositories(search: string): Promise<{ repositories: CloudRepository[]; needsConnect: boolean }> {
  const q = search.trim();
  try {
    const answer = obj(await cloudCall<unknown>("GET", q
      ? `/wham/github/repositories/search/all-installations${query({ query: q, limit: 20, page: 1, connector_id: GITHUB_CONNECTOR })}`
      : `/wham/github/list-repositories${query({ page: 1, per_page: 20, connector_id: GITHUB_CONNECTOR })}`));
    const repositories = list(answer.repositories).flatMap((raw) => {
      const repo = obj(raw);
      const id = str(repo.id) || (typeof repo.id === "number" ? `github-${repo.id}` : "");
      return id ? [{ id, name: str(repo.repository_full_name) || id }] : [];
    });
    return { repositories, needsConnect: false };
  } catch (error) {
    if (error instanceof CloudError && error.type === "missing_github_connector_link") return { repositories: [], needsConnect: true };
    throw error;
  }
}

export async function cloudBranches(repo: string, search: string): Promise<string[]> {
  const answer = obj(await cloudCall<unknown>("GET", `/wham/github/branches/${encodeURIComponent(repo)}/search${query({ query: search.trim(), page_size: 20 })}`));
  return list(answer.items).map((item) => str(obj(item).branch)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Tasks

const STATUSES: TurnStatus[] = ["pending", "in_progress", "completed", "cancelled", "failed"];
const statusOf = (value: unknown): TurnStatus => (STATUSES.includes(value as TurnStatus) ? (value as TurnStatus) : "pending");
export const runningStatus = (status: TurnStatus) => status === "pending" || status === "in_progress";

function parseTask(raw: unknown): CloudTask & { environmentId: string | null } {
  const task = obj(raw);
  const display = obj(task.task_status_display);
  const latest = obj(display.latest_turn_status_display);
  const stats = obj(latest.diff_stats);
  return {
    id: str(task.id),
    title: str(task.title) || "云端任务",
    status: statusOf(latest.turn_status ?? ({ ready: "completed", error: "failed" } as Record<string, TurnStatus>)[str(display.state)]),
    updatedAt: num(task.updated_at ?? task.created_at) * 1000,
    environmentLabel: str(display.environment_label) || null,
    files: num(stats.files_modified),
    added: num(stats.lines_added),
    removed: num(stats.lines_removed),
    unread: task.has_unread_turn === true,
    environmentId: str(task.environment_id) || null,
  };
}

export async function refreshCloudTasks(): Promise<void> {
  try {
    // The service caps a page at 20; the sidebar shows the newest page.
    const answer = obj(await cloudCall<unknown>("GET", `/wham/tasks/list${query({ task_filter: "current", limit: 20 })}`));
    const tasks = list(answer.items).map(parseTask).filter((task) => task.id).map(({ environmentId: _, ...task }) => task);
    set({ tasks, tasksError: null });
  } catch (error) {
    set({ tasksError: errorMessage(error) });
  }
}

const texts = (items: unknown[], type: string) =>
  items.map(obj).filter((item) => item.type === type).flatMap((item) => list(item.content))
    .map((part) => (typeof part === "string" ? part : obj(part).content_type === "text" ? str(obj(part).text) : ""))
    .filter((text) => text.trim());

/** backend-client Turn: the prompt, or the reply (output messages, then the worklog's); its diff and error. */
function parseTurn(raw: unknown, role?: CloudTurn["role"]): CloudTurn & { createdAt: number; previous: string | null; placement: number } {
  const turn = obj(raw);
  const inputs = list(turn.input_items);
  const outputs = list(turn.output_items);
  // In /turns, the prompts are the turns with input items.
  const user = role ? role === "user" : inputs.length > 0 && outputs.length === 0;
  const worklog = list(obj(turn.worklog).messages).map(obj).filter((message) => str(obj(message.author).role) === "assistant")
    .flatMap((message) => list(obj(message.content).parts)).map((part) => (typeof part === "string" ? part : str(obj(part).text))).filter((text) => text.trim());
  const diff = outputs.map(obj).map((item) => (item.type === "output_diff" ? str(item.diff) : item.type === "pr" ? str(obj(item.output_diff).diff) : "")).find(Boolean) || null;
  const error = obj(turn.error);
  const status = statusOf(turn.turn_status);
  return {
    id: str(turn.id),
    role: user ? "user" : "assistant",
    status,
    text: (user ? texts(inputs, "message") : [...texts(outputs, "message"), ...worklog]).join("\n\n"),
    diff,
    error: [str(error.code), str(error.message)].filter(Boolean).join(": ") || null,
    cancelling: !!turn.cancellation_requested_at && runningStatus(status),
    createdAt: num(turn.created_at),
    previous: str(turn.previous_turn_id) || null,
    placement: num(turn.attempt_placement),
  };
}

/**
 * A task's conversation: /turns holds every turn (a reply hangs off its prompt by previous_turn_id,
 * the first of several attempts shown); without it, the current prompt and reply of the details.
 */
export async function readCloudTask(id: string): Promise<void> {
  const path = `/wham/tasks/${encodeURIComponent(id)}`;
  try {
    const [detailsRaw, turnsRaw] = await Promise.all([cloudCall<unknown>("GET", path), cloudCall<unknown>("GET", `${path}/turns`).catch(() => null)]);
    const details = obj(detailsRaw);
    const reply = details.current_assistant_turn ? parseTurn(details.current_assistant_turn, "assistant") : null;
    const current = [...(details.current_user_turn ? [parseTurn(details.current_user_turn, "user")] : []), ...(reply ? [reply] : [])];
    const all = turnsRaw ? Object.values(obj(obj(turnsRaw).turn_mapping)).map((entry) => parseTurn(obj(entry).turn ?? entry)) : current;
    const sorted = all.filter((turn) => turn.id).sort((a, b) => a.createdAt - b.createdAt || a.placement - b.placement);
    // Attempts answer the same prompt: show the current one, else the first.
    const shown = new Map<string, string>();
    for (const turn of sorted) if (turn.role === "assistant" && turn.previous && !shown.has(turn.previous)) shown.set(turn.previous, turn.id);
    if (reply?.previous && sorted.some((turn) => turn.id === reply.id)) shown.set(reply.previous, reply.id);
    const turns = sorted.filter((turn) => turn.role === "user" || !turn.previous || shown.get(turn.previous) === turn.id);
    // The diff turn holds the latest diff when the reply itself carries none (backend-client unified_diff).
    const diffTurn = details.current_diff_task_turn ? parseTurn(details.current_diff_task_turn) : null;
    const last = turns.findLast((turn) => turn.role === "assistant");
    if (last && !last.diff && diffTurn?.diff) last.diff = diffTurn.diff;
    const task = parseTask({ ...obj(details.task), task_status_display: obj(details.task).task_status_display ?? details.task_status_display });
    if (last) task.status = last.status;
    const { [id]: _, ...errors } = state.detailErrors;
    // The open task's row takes the state just read rather than the last list poll's.
    const tasks = state.tasks?.map((row) => (row.id === id ? { ...row, status: task.status } : row)) ?? null;
    set({ details: { ...state.details, [id]: { task, turns: turns.map(({ createdAt: _c, previous: _p, placement: _a, ...turn }) => turn) } }, detailErrors: errors, tasks });
  } catch (error) {
    set({ detailErrors: { ...state.detailErrors, [id]: errorMessage(error) } });
  }
}

const message = (text: string) => ({ type: "message", role: "user", content: [{ content_type: "text", text }] });

/** A new task on `branch` of the environment's repository (backend-client create); resolves to its id. */
export async function createCloudTask(environmentId: string, branch: string, prompt: string): Promise<string> {
  const answer = obj(await cloudCall<unknown>("POST", "/wham/tasks", {
    new_task: { environment_id: environmentId, branch, run_environment_in_qa_mode: false },
    input_items: [message(prompt)],
  }));
  const id = str(obj(answer.task).id) || str(answer.id);
  if (!id) throw new Error("Codex Cloud 没有返回任务 ID。");
  void refreshCloudTasks();
  return id;
}

/** The new-session page's send in a cloud environment: a task on its branch, else the repository's default. */
export async function startCloudTask(project: Pick<Project, "metadata">, prompt: string): Promise<string> {
  const target = environmentOf(project).cloud;
  if (!target) throw new Error("此环境尚未选择云环境。");
  if (!state.environments) await refreshCloudEnvironments();
  const environment = state.environments?.find((env) => env.id === target.environmentId);
  if (state.environments && !environment) throw new Error("找不到此环境的云环境，它可能已被删除。");
  return createCloudTask(target.environmentId, target.branch || environment?.defaultBranch || "main", prompt);
}

/** A follow-up continues from the latest reply (the extension's follow_up, in code mode). */
export async function followUpCloudTask(id: string, prompt: string): Promise<void> {
  const turn = state.details[id]?.turns.findLast((t) => t.role === "assistant");
  if (!turn) throw new Error("任务还没有回复，暂时无法追问。");
  await cloudCall("POST", "/wham/tasks", { follow_up: { task_id: id, turn_id: turn.id, environment_mode: "code" }, input_items: [message(prompt)] });
  await Promise.all([readCloudTask(id), refreshCloudTasks()]);
}

export async function cancelCloudTask(id: string): Promise<void> {
  await cloudCall("POST", `/wham/tasks/${encodeURIComponent(id)}/cancel`);
  await Promise.all([readCloudTask(id), refreshCloudTasks()]);
}

export async function archiveCloudTask(id: string): Promise<void> {
  await cloudCall("POST", `/wham/tasks/${encodeURIComponent(id)}/archive`);
  set({ tasks: state.tasks?.filter((task) => task.id !== id) ?? null });
}

export function markCloudTaskRead(id: string): void {
  if (!state.tasks?.find((task) => task.id === id)?.unread) return;
  set({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, unread: false } : task)) });
  void cloudCall("POST", `/wham/tasks/${encodeURIComponent(id)}/mark_read`).catch(() => {});
}

/** `codex apply`: the task's diff onto a local checkout, whole or not at all (server/git.mjs applyPatch). */
export function applyCloudDiff(cwd: string, diff: string): Promise<unknown> {
  return callExperimental("codexUi/git/apply", { cwd, diff });
}

/** Signed out or switched accounts: nothing of the old account's cloud stays on screen. */
export function resetCloud(): void {
  set({ environments: null, environmentsError: null, tasks: null, tasksError: null, details: {}, detailErrors: {} });
}
