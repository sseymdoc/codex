// ChatGPT's scheduled tasks in the cloud (云端定时任务): the user's own tasks at chatgpt.com, which
// ChatGPT runs on its own schedule, called through the bridge's /api/cloud under this session's
// ChatGPT login (server/cloud.mjs). Calls, bodies and the schedule text follow the Codex desktop
// app 26.1023 (app-initial cDt / NDt / ADt / PDt / tEt / eEt / oEt / dEt / fEt / GTt / cEt / mb,
// run-results-state, detail-panel, share-dialog, shared-task-dialog, recommendations,
// configuration-schedule ri); every field is read defensively. A run is a ChatGPT conversation:
// running a task now and opening a run go to chatgpt.com in the browser, never through the bridge.

import { DEFAULT_SCHEDULE, builderRrule, rruleOf, rruleProblem, scheduleOf, type Schedule } from "../../context/rrule.mjs";
import { useSyncExternalStore } from "react";
import { CloudError, cloudCall, list, obj, query, str } from "./cloud";
import { errorMessage } from "./codex";
import { defaultName } from "./scheduled-view";
import { getState, type AppState } from "./store";

/**
 * Whether this login has cloud tasks: unknown until asked; unavailable (no ChatGPT login of the
 * first party's models, or the service answers 404), signin, blocked (a browser-mode page: ChatGPT
 * turns Node's fetch away with Cloudflare's HTML), error (asked and failed; still offered, as there).
 */
export type CloudAccess = "unknown" | "ok" | "unavailable" | "signin" | "blocked" | "error";

/** timing_mode: a string in answers, its number (hb) in a save. */
export type TimingMode = "exact_schedule" | "flexible_schedule" | "condition_watch";
export const TIMING: Readonly<Record<TimingMode, number>> = { exact_schedule: 0, flexible_schedule: 1, condition_watch: 2 };
const MODES = Object.keys(TIMING) as TimingMode[];
/** A timing mode as either side writes it (unknown reads as flexible, the personal default). */
export const timingModeOf = (value: unknown): TimingMode =>
  MODES.includes(value as TimingMode) ? (value as TimingMode) : MODES[typeof value === "number" ? value : 1] ?? "flexible_schedule";

export interface CloudAutomation {
  id: string;
  title: string;
  prompt: string;
  /** The VEVENT text as saved (scheduleParts reads it). */
  schedule: string;
  /** The zone its times read on: UTC when Intl does not know the saved one (knownZone). */
  timezone: string;
  /** default_timezone as the server keeps it, sent back by an edit that leaves the schedule. */
  savedTimezone: string;
  timingMode: TimingMode;
  enabled: boolean;
  emailEnabled: boolean;
  notificationsEnabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  /** As the server stamps it. */
  updatedAt: string;
  threadMode: "new_chat" | "existing_chat";
  model: string | null;
  effort: string | null;
  emoji: string | null;
  /** mb: completed once a scheduled task has no next run, else by is_enabled. */
  status: "active" | "paused" | "completed";
  /** Runs on events (webhook triggers, an unscheduled condition watch): no run now, no schedule. */
  triggered: boolean;
  /** A one-time task's time (WTt); a paused one past it cannot resume (expiredResume). */
  onceAt: number | null;
  canManage: boolean;
  canDelete: boolean;
  /** The share entry's conditions: managed, not completed, under an account that shares (shareable). */
  canShare: boolean;
}

export interface CloudRun {
  id: string;
  /** Any other status reads as completed (automations.runs.status). */
  status: "in_progress" | "failed" | "no_update" | "completed";
  /** The ChatGPT conversation it wrote, when it has one. */
  chatId: string | null;
  unread: boolean;
  summary: string;
  startedAt: number | null;
  /** As the server stamps it: a read mark sends it back. */
  updatedAt: string;
}

/** A task's runs as far as they are read: newest first, `cursor` where older ones start. */
export interface CloudRunsPage {
  items: CloudRun[];
  cursor: string | null;
  pages: number;
  error: string | null;
}

export interface CloudAutomationsState {
  access: CloudAccess;
  /** Null until the first list. */
  items: CloudAutomation[] | null;
  error: string | null;
  /** By task id, once a task's page reads them (cloudRuns). */
  runs: Record<string, CloudRunsPage>;
}

const EMPTY: CloudAutomationsState = { access: "unknown", items: null, error: null, runs: {} };
let state = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<CloudAutomationsState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useCloudAutomations<T>(pick: (s: CloudAutomationsState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const cloudAutomationsState = () => state;

/**
 * Every call: a 401 (the bridge has refreshed the token and tried again) holds as signin for the
 * account object it came under, whichever call met it, so no poll keeps having the token refreshed.
 */
async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const mine = owner, account = getState().account;
  try {
    return await cloudCall<T>(method, path, body, "ChatGPT");
  } catch (error) {
    if (owner === mine && accessOf(error) === "signin") {
      signinFor = account;
      set({ access: "signin", error: errorMessage(error) });
    }
    throw error;
  }
}
const enc = encodeURIComponent;
const time = (value: unknown): number | null => {
  const at = Date.parse(str(value));
  return Number.isFinite(at) ? at : null;
};

export const chatgptRunUrl = (chatId: string) => `https://chatgpt.com/c/${enc(chatId)}`;
/** ponytail: the web's scheduled page by the desktop app's own route (z2n); chatgpt.com still opens if it is gone. */
export const chatgptTaskUrl = (id: string) => `https://chatgpt.com/scheduled?${new URLSearchParams({ automationId: id, automationSource: "cloud" })}`;

// ---------------------------------------------------------------------------
// Reading answers

/** A personal plan's (share-dialog / menu-items: structure !== "workspace", not quorum). */
const PERSONAL_PLANS: readonly string[] = ["free", "go", "plus", "pro", "prolite", "promax"];

/**
 * Whether the account shares tasks: the desktop app's entry reads the account, not the task (not
 * a quorum plan; a workspace only with its workspace_share_links feature, behind gate 1431301099).
 * ponytail: the app-server names neither a workspace's features nor that gate, and reads quorum as
 * unknown, so only a personal plan shares; read the workspace's features should one want its links.
 */
export const shareable = (account: AppState["account"]): boolean =>
  account?.account?.type === "chatgpt" && PERSONAL_PLANS.includes(account.account.planType);

/**
 * `tz` when Intl knows it, else `fallback`: the server's tzdata may be newer than this ICU's, and a
 * custom rule's TZID becomes default_timezone as typed. Intl throws on any other name.
 */
export function knownZone(tz: string, fallback: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

export function parseCloudAutomation(raw: unknown): CloudAutomation | null {
  const a = obj(raw);
  // A team's task, or the desktop app's own local one kept by ChatGPT (Habitat): neither is this page's.
  if (!str(a.id) || a.executor === "local" || (a.team_id != null && a.team_id !== "")) return null;
  const timingMode = timingModeOf(a.timing_mode);
  // ponytail: a zone Intl does not know reads as UTC (its times shown on UTC's clock, labeled so).
  const timezone = knownZone(str(a.default_timezone), "UTC");
  const schedule = str(a.schedule);
  const next = list(a.next_run_times).map(time).filter((at): at is number => at !== null);
  const status = timingMode !== "condition_watch" && !next.length ? "completed" : a.is_enabled === true ? "active" : "paused";
  const components = obj(a.schedule_components);
  const start = str(components.start_time);
  const onceAt = components.frequency !== "once" || timingMode === "condition_watch" || !Number.isFinite(Date.parse(start)) ? NaN
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(start) ? Date.parse(start) : zonedTime(start.slice(0, 10), start.slice(11, 16), timezone, Number(start.slice(17, 19)) || 0);
  const role = str(a.current_user_role) || "owner";
  const canManage = role === "owner" || role === "editor";
  return {
    id: str(a.id),
    title: str(a.display_title).trim() || str(a.title).trim(),
    prompt: str(a.prompt),
    schedule,
    timezone,
    savedTimezone: str(a.default_timezone) || timezone,
    timingMode,
    enabled: a.is_enabled === true,
    emailEnabled: a.email_enabled === true,
    notificationsEnabled: a.notifications_enabled !== false,
    nextRunAt: next[0] ?? null,
    lastRunAt: time(a.last_run_time),
    updatedAt: str(a.updated_at),
    threadMode: a.thread_mode === "new_chat" ? "new_chat" : "existing_chat",
    model: str(a.model) || null,
    effort: str(a.reasoning_effort) || null,
    emoji: str(a.display_emoji) || null,
    status,
    triggered: list(a.webhook_triggers).length > 0 || /^X-UNSCHEDULED:1/m.test(schedule),
    // A start with a date but no time reads as no time.
    onceAt: Number.isFinite(onceAt) ? onceAt : null,
    canManage,
    canDelete: typeof a.can_delete === "boolean" ? a.can_delete : role === "owner",
    // The account's own (refreshCloud starts afresh under another plan).
    canShare: canManage && status !== "completed" && shareable(getState().account),
  };
}

const RUN_STATUSES = ["in_progress", "failed", "no_update"] as const;
export function parseCloudRun(raw: unknown): CloudRun {
  const run = obj(raw);
  const ref = obj(run.chat_ref);
  return {
    id: str(run.id),
    status: RUN_STATUSES.find((status) => status === run.status) ?? "completed",
    chatId: ref.type === "chatgpt" && str(ref.id) ? str(ref.id) : null,
    unread: run.is_unread === true,
    summary: str(run.summary),
    startedAt: time(run.started_at ?? run.scheduled_for),
    updatedAt: str(run.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Access

/**
 * What needs no request: no account read yet, another model provider (requiresFirstPartyInference
 * hides the feature whatever the login), or not a ChatGPT login.
 */
export function gateOf(s: Pick<AppState, "account" | "config">): CloudAccess | null {
  if (!s.account) return "unknown";
  const provider = s.config?.model_provider;
  if (provider && provider !== "openai") return "unavailable";
  return s.account.account?.type !== "chatgpt" ? "signin" : null;
}

/** A failed list's meaning (lDt: 404 is no cloud tasks for this account). */
export function accessOf(error: unknown): CloudAccess {
  if (!(error instanceof CloudError)) return "error";
  if (error.status === 404) return "unavailable";
  if (error.status === 401) return "signin";
  if (error.status === 403 && str(obj(error.body).detail).trimStart().startsWith("<")) return "blocked";
  return "error";
}

// ---------------------------------------------------------------------------
// The list

/** The account the store holds, so another login starts afresh. */
let owner: string | null = null;
let reads = 0;
/** Bumped by every change to a task in the list, so a list read under way meanwhile is read again. */
let writes = 0;
/** Changes on their way, laid over what a list reads meanwhile (null: removed). */
const pending = new Map<string, CloudAutomation | null>();
const overlay = (items: CloudAutomation[]) => items.flatMap((a) => (pending.has(a.id) ? (pending.get(a.id) ? [pending.get(a.id)!] : []) : [a]));

/** What holds for the account. */
const STICKY: CloudAccess[] = ["unavailable", "blocked"];
/**
 * The account object a 401 came under (call): asked again once the store holds another (signing in
 * anew keeps the same email), not every minute, as each 401 has the bridge refresh the login's token.
 */
let signinFor: AppState["account"] = null;

/**
 * The tasks, read anew. The account is asked once (GET /automations?filter=scheduled&limit=25,
 * as the desktop app checks); a 404 or Cloudflare's page holds for the account.
 */
export async function refreshCloud(): Promise<void> {
  const s = getState();
  const gate = gateOf(s);
  // Another login (or plan: a workspace of the same email), or another provider, starts afresh.
  const who = gate ?? `chatgpt:${s.account?.account?.type === "chatgpt" ? `${s.account.account.email}:${s.account.account.planType}` : ""}`;
  if (who !== owner) {
    owner = who;
    pending.clear();
    set({ ...EMPTY, access: gate ?? "unknown" });
  }
  if (gate || STICKY.includes(state.access) || (state.access === "signin" && s.account === signinFor)) return;
  const read = ++reads;
  const wrote = writes;
  try {
    if (state.access !== "ok") await call("GET", `/automations${query({ filter: "scheduled", limit: 25 })}`);
    const items = await listAll();
    if (read !== reads || who !== owner) return;
    // A save, pause, delete or task read landed while the list was read: what it read predates that.
    if (writes !== wrote) return refreshCloud();
    set({ access: "ok", items: overlay(items), error: null });
  } catch (error) {
    if (read !== reads || who !== owner) return;
    set({ access: accessOf(error), error: errorMessage(error) });
  }
}

async function listAll(): Promise<CloudAutomation[]> {
  const items: CloudAutomation[] = [];
  let cursor: string | undefined;
  // ponytail: ten pages of 100 at most (the desktop app reads until the cursor runs out).
  for (let page = 0; page < 10; page++) {
    const answer = obj(await call("GET", `/automations${query({ cursor, limit: 100 })}`));
    items.push(...list(answer.items).flatMap((raw) => parseCloudAutomation(raw) ?? []));
    cursor = str(answer.cursor) || undefined;
    if (!cursor) break;
  }
  return items;
}

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** A page shown again or focused reads at once (react-query's refetchOnWindowFocus), this often at most. */
const WAKE_MS = 5_000;

/**
 * Runs `run` now and again every `ms()` while the page shows, and at once when it shows again or
 * takes focus; the returned function stops it.
 */
function every(run: () => Promise<unknown>, ms: () => number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false, busy = false, last = -Infinity;
  const loop = async () => {
    clearTimeout(timer);
    // A read under way sets the next one going when it is done.
    if (busy || stopped) return;
    if (visible()) {
      busy = true;
      last = Date.now();
      await run().catch(() => {});
      busy = false;
    }
    if (!stopped) timer = setTimeout(loop, ms());
  };
  const wake = () => void (visible() && Date.now() - last >= WAKE_MS && loop());
  const browser = typeof window !== "undefined";
  if (browser) {
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
  }
  void loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (!browser) return;
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("focus", wake);
  };
}

/** The 定时任务 page's list poll: now and every minute (the desktop app's refetchInterval). */
export const watchCloud = () => every(refreshCloud, () => 60_000);

/** In place, else at `at` (the top for a new one); the list's first entry when none was read (a failed list). */
const upsert = (a: CloudAutomation, at = 0) => {
  writes++;
  set({ items: !state.items ? [a] : state.items.some((b) => b.id === a.id) ? state.items.map((b) => (b.id === a.id ? a : b)) : state.items.toSpliced(at, 0, a) });
};
const drop = (id: string) => {
  writes++;
  set({ items: state.items?.filter((a) => a.id !== id) ?? null });
};

/** Shows `next` at once (null: gone) while the change is on its way. */
function optimistic(id: string, next: CloudAutomation | null) {
  pending.set(id, next);
  if (next) upsert(next);
  else drop(id);
}

/** The change is in (the server's answer) or failed (what there was before, where it was). */
function settle(id: string, value: CloudAutomation | null | undefined, at?: number) {
  pending.delete(id);
  if (value) upsert(value, at);
  else drop(id);
}

/**
 * One task read anew (a task's page); null and out of the list once the server has none (404, 410).
 * Each change below lands in the list only while the account that made it still holds it.
 */
export async function readCloudAutomation(id: string): Promise<CloudAutomation | null> {
  const mine = owner;
  try {
    const a = parseCloudAutomation(await call("GET", `/automation/${enc(id)}`));
    if (owner !== mine) return a;
    if (a) upsert(a);
    else drop(id);
    return a;
  } catch (error) {
    if (!(error instanceof CloudError && (error.status === 404 || error.status === 410))) throw error;
    if (owner === mine) drop(id);
    return null;
  }
}

/** 暂停 / 启用 (set_status), shown at once and taken back when it fails. */
export async function setCloudStatus(id: string, enabled: boolean): Promise<CloudAutomation> {
  const before = state.items?.find((a) => a.id === id);
  if (!before) throw new Error("找不到此定时任务");
  const mine = owner;
  optimistic(id, { ...before, enabled, status: before.status === "completed" ? "completed" : enabled ? "active" : "paused" });
  try {
    const saved = parseCloudAutomation(await call("POST", "/automations/set_status", { jawbone_id: id, is_enabled: enabled })) ?? { ...before, enabled };
    if (owner === mine) settle(id, saved);
    return saved;
  } catch (error) {
    if (owner === mine) settle(id, before);
    throw error;
  }
}

/** 删除, gone at once and back when it fails. */
export async function removeCloudAutomation(id: string): Promise<void> {
  const at = state.items?.findIndex((a) => a.id === id) ?? -1;
  const before = state.items?.[at];
  const mine = owner;
  optimistic(id, null);
  try {
    await call("POST", "/automations/remove", { automation_id: id });
    if (owner === mine) settle(id, null);
  } catch (error) {
    if (owner === mine) settle(id, before, at);
    throw error;
  }
}

/** A new task, or an edit of `existing`; the list holds the saved one. */
export async function saveCloudAutomation(d: CloudDraft, existing?: CloudAutomation | null): Promise<CloudAutomation> {
  const mine = owner;
  const saved = parseCloudAutomation(await call("POST", "/automations/save", saveBody(d, existing)));
  if (!saved) throw new Error("ChatGPT 没有返回保存的定时任务。");
  if (owner === mine) upsert(saved);
  return saved;
}

// ---------------------------------------------------------------------------
// Runs and updates

/** While a run is under way its list is read every 5 s, else every minute (run-results-state). */
export const runsPollMs = (runs: readonly CloudRun[]) => (runs.some((run) => run.status === "in_progress") ? 5_000 : 60_000);

/**
 * A task's runs: the newest page read anew (what is below it kept), or with `more` the next older
 * page. Each lands on the runs as they are by then; a newest page read before another page or a
 * read mark landed is read again.
 */
export async function cloudRuns(id: string, more = false): Promise<CloudRunsPage> {
  const held: CloudRunsPage | undefined = state.runs[id];
  const cursor = more ? held?.cursor ?? undefined : undefined;
  if (held && more && !cursor) return held;
  let next: CloudRunsPage;
  try {
    const answer = obj(await call("GET", `/automation/${enc(id)}/runs${query({ cursor, limit: 25, include_chat_ref: "true" })}`));
    const now: CloudRunsPage | undefined = state.runs[id];
    if (!more && now !== held) return cloudRuns(id);
    const items = list(answer.runs).map(parseCloudRun).filter((run) => run.id);
    const seen = new Set(items.map((run) => run.id));
    const kept = (now?.items ?? []).filter((run) => !seen.has(run.id));
    const answerCursor = str(answer.cursor) || null;
    const deep = !!now && now.pages > 1;
    next = cursor
      ? { items: [...kept, ...items], cursor: answerCursor, pages: (now?.pages ?? 1) + 1, error: null }
      : { items: [...items, ...(deep ? kept : [])], cursor: deep ? now.cursor : answerCursor, pages: Math.max(1, now?.pages ?? 1), error: null };
  } catch (error) {
    const now: CloudRunsPage | undefined = state.runs[id];
    next = { items: now?.items ?? [], cursor: now?.cursor ?? null, pages: now?.pages ?? 0, error: errorMessage(error) };
  }
  set({ runs: { ...state.runs, [id]: next } });
  return next;
}

/** A task's page keeps its runs fresh (runsPollMs); the returned function stops it. */
export const watchCloudRuns = (id: string) => every(() => cloudRuns(id), () => runsPollMs(state.runs[id]?.items ?? []));

const patchRun = (id: string, runId: string, patch: Partial<CloudRun>) => {
  const page = state.runs[id];
  if (page) set({ runs: { ...state.runs, [id]: { ...page, items: page.items.map((run) => (run.id === runId ? { ...run, ...patch } : run)) } } });
};

/** A run read: unread no more at once, its stamp sent back (y). */
export async function readCloudRun(id: string, run: CloudRun): Promise<void> {
  patchRun(id, run.id, { unread: false });
  try {
    await call("POST", `/automation/${enc(id)}/runs/${enc(run.id)}/read`, { read_at: run.updatedAt });
  } catch (error) {
    patchRun(id, run.id, { unread: run.unread });
    throw error;
  }
}

/**
 * A run's conversation in ChatGPT, read first (the mark goes out before the window opens, in the
 * click's own turn so no popup blocker stops it). False when the run wrote none: the page says so.
 */
export function openCloudRun(id: string, run: CloudRun): boolean {
  if (run.unread) void readCloudRun(id, run).catch(() => {});
  if (run.chatId) window.open(chatgptRunUrl(run.chatId), "_blank", "noopener");
  return run.chatId !== null;
}

/**
 * 立即运行: a personal run is a ChatGPT message (its anti-abuse tokens are ChatGPT's own page's to
 * make), so the task opens in ChatGPT, where it runs.
 */
export const runCloudNow = (id: string) => void window.open(chatgptTaskUrl(id), "_blank", "noopener");

export interface CloudUpdate {
  /** The latest snapshot (Markdown); empty when there is none. */
  markdown: string;
  at: number | null;
  /** 此任务需要您处理 */
  requiresAction: boolean;
  /** 上次运行未成功 */
  failed: boolean;
}

/** 最新动态: the latest run's snapshot (detail-panel K / be). */
export async function latestBackingRun(id: string): Promise<CloudUpdate> {
  const raw = obj(await call("GET", `/automation/${enc(id)}/latest_backing_run${query({ include_snapshot: "true" })}`));
  const update = obj("latest_update" in raw ? raw.latest_update : raw);
  const meta = obj(update.metadata);
  return {
    markdown: str(update.content_text),
    at: time(update.created_at),
    requiresAction: meta.automation_requires_user_action === true,
    failed: obj(raw.last_backing_run).status === "failed" || meta.automation_last_backing_run_failed === true,
  };
}

// ---------------------------------------------------------------------------
// The form's lists

/** schedule_policy: whether minute intervals are open and how many runs an hour may hold (-1: any). */
export interface SchedulePolicy {
  minutes: boolean;
  maxPerHour: number;
}

export async function schedulePolicy(): Promise<SchedulePolicy> {
  const raw = obj(await call("GET", "/automations/schedule_policy"));
  return { minutes: raw.minute_schedule_available === true, maxPerHour: typeof raw.max_iterations_per_hour === "number" ? raw.max_iterations_per_hour : 0 };
}

/** ri: the minute intervals the policy allows, shortest first (none without minute schedules). */
export function minuteOptions(policy: SchedulePolicy): number[] {
  const max = policy.maxPerHour;
  if (!policy.minutes || (max !== -1 && max <= 1)) return [];
  const step = max === -1 ? 1 : Math.max(1, Math.ceil(60 / max));
  return Array.from({ length: Math.floor(59 / step) }, (_, i) => (i + 1) * step).filter((minutes) => max === -1 || Math.ceil(60 / minutes) <= max);
}

export interface CloudSuggestion {
  id: string;
  emoji: string | null;
  title: string;
  description: string;
  /** What the suggestion asks to set up (user_message). */
  prompt: string;
}

/** The scheduled page's suggestions (recommendations Y); locked ones left out. */
export async function cloudSuggestions(): Promise<CloudSuggestion[]> {
  const raw = await call("GET", "/suggested_automations");
  return (Array.isArray(raw) ? raw : list(obj(raw).items)).map(obj).filter((s) => str(s.user_message) && obj(s.locked).is_locked !== true).map((s) => ({
    id: str(s.announcement_id) || str(s.suggested_automation_type),
    emoji: str(s.emoji) || null,
    title: str(s.title),
    description: str(s.description),
    prompt: str(s.user_message),
  }));
}

// ---------------------------------------------------------------------------
// Sharing

export interface CloudShare {
  postId: string;
  permalink: string;
}

const shareOf = (raw: unknown): CloudShare | null => {
  const share = obj(raw);
  return str(share.post_id) && str(share.permalink) ? { postId: str(share.post_id), permalink: str(share.permalink) } : null;
};
const made = (share: CloudShare | null) => {
  if (!share) throw new Error("ChatGPT 没有返回分享链接。");
  return share;
};

/** The task's link, when it has one. */
export const shareCurrent = async (id: string) => shareOf(obj(await call("GET", `/share/automation/${enc(id)}/current`)).current_share);
export const createShare = async (id: string) => made(shareOf(await call("POST", "/share/automation", { automation_id: id })));
/** A link that has been out a while shows the task as it is now. */
export const refreshShare = async (id: string) => made(shareOf(await call("POST", `/share/automation/${enc(id)}/refresh`)));
export const removeShare = async (id: string) => void (await call("DELETE", `/share/automation/${enc(id)}`));

/** A task someone shared (GET /share/post/{id}/automation), as its form starts from it. */
export interface SharedAutomation {
  postId: string;
  isOwner: boolean;
  /** The task it was shared from (the owner's own goes to it). */
  sourceId: string | null;
  title: string;
  prompt: string;
  schedule: string;
  timezone: string;
  timingMode: TimingMode;
  model: string | null;
  effort: string | null;
  /** False: it can be seen but not scheduled (此任务可以查看，但无法安排). */
  importable: boolean;
}

export async function readSharedPost(postId: string): Promise<SharedAutomation> {
  const raw = obj(await call("GET", `/share/post/${enc(postId)}/automation`));
  const post = obj(raw.post), a = obj(raw.automation), model = obj(a.model_selection);
  return {
    postId: str(post.id) || postId,
    isOwner: post.is_owner === true,
    sourceId: str(a.source_automation_id) || null,
    title: str(a.title),
    prompt: str(a.prompt),
    schedule: str(a.schedule),
    timezone: knownZone(str(a.source_timezone), Intl.DateTimeFormat().resolvedOptions().timeZone),
    timingMode: timingModeOf(a.timing_mode),
    model: str(model.model_slug) || null,
    effort: str(model.thinking_effort) || null,
    importable: a.importable !== false,
  };
}

const POST_ID = /^[A-Za-z0-9_-]+$/;

/** A share link's post id (its shared_task or post_id, else the path's last part), or the id itself. */
export function sharePostId(text: string): string | null {
  const value = text.trim();
  if (POST_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const id = url.searchParams.get("shared_task") ?? url.searchParams.get("post_id") ?? url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  return POST_ID.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Schedules: a VEVENT holding one RRULE line (with UNTIL when it ends), or a DTSTART for one run.

const wallClock = (tz: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** GTt: the moment a date (YYYY-MM-DD) and time (HH:MM) on `tz`'s wall clock is, two corrections from reading it as UTC. */
export function zonedTime(date: string, clock: string, tz: string, second = 0): number {
  const target = Date.parse(`${date}T${clock}:${String(second).padStart(2, "0")}Z`);
  if (Number.isNaN(target)) return NaN;
  const format = wallClock(tz);
  let at = target;
  for (let i = 0; i < 2; i++) at += target - Date.parse(`${format.format(new Date(at)).replace(" ", "T")}Z`);
  return at;
}

/** uEt: a moment as a date and time on `tz`'s wall clock. */
export function wallTime(at: number, tz: string): { date: string; time: string } {
  const text = wallClock(tz).format(new Date(at));
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}

/** fEt: an end date's last second (23:59:59 in `tz`) as RRULE's UTC UNTIL. */
export const untilUtc = (date: string, tz: string) => new Date(zonedTime(date, "23:59", tz, 59)).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const stamp = (text: string) => `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;

/**
 * A saved schedule's parts on `tz`'s clock: the recurring rule (its UNTIL and a BYSECOND=0 taken
 * out, as the desktop app's editor reads it) and the date UNTIL ends it on, or the one run's time.
 * A date that does not read (20271399), or a TZID Intl does not know (read as `tz`), is no end or run.
 * An UNTIL with a time is the last moment a run may start (RFC 5545): the end date is that moment's
 * day when the day's first run (lowest BYHOUR and BYMINUTE) is not after it, else the day before.
 */
export function scheduleParts(schedule: string, tz: string): { rrule: string | null; until: string | null; once: { date: string; time: string } | null } {
  const lines = schedule.split(/\r?\n/).map((line) => line.trim());
  const rule = lines.find((line) => /^RRULE:/i.test(line));
  const wall = (at: number) => (Number.isFinite(at) ? wallTime(at, tz) : null);
  if (rule) {
    const parts = rule.slice(6).split(";").filter(Boolean);
    const until = /^UNTIL=(\d{8})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/i.exec(parts.find((part) => /^UNTIL=/i.test(part)) ?? "");
    // ponytail: a run's time of day from BYHOUR / BYMINUTE only (00:00 without them, so a DTSTART-timed custom rule may keep one run past UNTIL on its last day).
    const lowest = (key: string) => Math.min(...(parts.find((part) => part.toUpperCase().startsWith(`${key}=`))?.slice(key.length + 1).split(",").map(Number).filter(Number.isFinite) ?? [0]));
    const last = !until?.[2] ? null : wall(until[5] ? Date.parse(`${stamp(until[1])}T${until[2]}:${until[3]}:${until[4]}Z`) : zonedTime(stamp(until[1]), `${until[2]}:${until[3]}`, tz, Number(until[4])));
    const end = !until ? null : !until[2] ? (Number.isFinite(Date.parse(`${stamp(until[1])}T00:00:00Z`)) ? stamp(until[1]) : null)
      : !last ? null
      : lowest("BYHOUR") * 60 + lowest("BYMINUTE") <= Number(last.time.slice(0, 2)) * 60 + Number(last.time.slice(3)) ? last.date
      : new Date(Date.parse(`${last.date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return { rrule: `RRULE:${parts.filter((part) => !/^UNTIL=/i.test(part) && !/^BYSECOND=0$/i.test(part)).join(";")}`, until: end, once: null };
  }
  const start = lines.map((line) => /^DTSTART(?:;TZID="?([^:";]+)"?)?:(\d{8})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(line)).find(Boolean);
  if (!start) return { rrule: null, until: null, once: null };
  const at = zonedTime(stamp(start[2]), `${start[3]}:${start[4]}`, start[6] ? "UTC" : knownZone(start[1] ?? tz, tz), Number(start[5]));
  return { rrule: null, until: null, once: wall(at) };
}

/** The cloud form's draft: a rule as the local form keeps one (context/rrule.mjs), or one run at `date` `time`. */
export interface CloudDraft {
  /** The edited task's id; null for a new one. */
  id: string | null;
  name: string;
  prompt: string;
  emoji: string | null;
  /** 重复执行任务: by `rrule`, else once at `date` `time` (YYYY-MM-DD, HH:MM on `timezone`'s clock). */
  repeat: boolean;
  rrule: string;
  /** The editor that shows the rule (custom sends it as typed). */
  mode: Schedule["mode"];
  /** 结束重复: the last day it runs, on `timezone`'s clock. */
  until: string | null;
  date: string;
  time: string;
  timezone: string;
  /** 每次运行时都开启新会话 (thread_mode new_chat; a new task's only). */
  newChat: boolean;
  model: string | null;
  effort: string | null;
}

/**
 * The form's first state: a task's, a shared one's (to schedule as one's own), else a new daily
 * 09:00 task on this machine's time zone (a one-time run defaults to tomorrow). ChatGPT's personal
 * tasks default to the same conversation each run (configuration-schedule S).
 */
export function cloudDraftOf(source: CloudAutomation | SharedAutomation | null, now = Date.now()): CloudDraft {
  const timezone = source?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const parts = source ? scheduleParts(source.schedule, timezone) : { rrule: null, until: null, once: null };
  const rrule = parts.rrule ?? rruleOf(DEFAULT_SCHEDULE);
  const schedule = scheduleOf(rrule);
  const task = source && !("postId" in source) ? source : null;
  return {
    id: task?.id ?? null,
    name: source?.title ?? "",
    prompt: source?.prompt ?? "",
    emoji: task?.emoji ?? null,
    repeat: !parts.once,
    rrule,
    mode: schedule.mode,
    until: parts.until,
    date: parts.once?.date ?? wallTime(now + 86_400_000, timezone).date,
    time: parts.once?.time ?? schedule.time,
    timezone,
    newChat: task?.threadMode === "new_chat",
    model: source?.model ?? null,
    effort: source?.effort ?? null,
  };
}

/**
 * A rule as cloud_task_update takes one (RRULE text, a DTSTART line allowed) onto the draft: the
 * whole schedule, its UNTIL the end date on the draft's zone (none without one), as the form keeps it.
 */
export function setCloudRule(d: CloudDraft, rrule: string): void {
  const { until } = scheduleParts(rrule.split(/\r?\n/).map((line) => (line.includes(":") ? line : `RRULE:${line}`)).join("\n"), d.timezone);
  const rule = rrule.replace(/;UNTIL=[^;\r\n]*|UNTIL=[^;\r\n]*;/gi, "");
  Object.assign(d, { repeat: true, rrule: rule, mode: scheduleOf(rule).mode, until });
}

/**
 * oEt / dEt: the draft's schedule text. Hours and days go as the desktop app's builder writes them
 * (rwt), the other editors as its form does (sb), custom as typed (a DTSTART line kept); an end
 * date adds UNTIL to the RRULE line.
 */
export function cloudSchedule(d: CloudDraft): string {
  if (!d.repeat) return `BEGIN:VEVENT\nDTSTART;TZID=${d.timezone}:${d.date.replaceAll("-", "")}T${d.time.replaceAll(":", "")}00\nEND:VEVENT`;
  const s = scheduleOf(d.rrule);
  const builder = { weekdays: [...s.weekdays], month: 1, monthDays: [s.monthDay], time: s.time, minute: 0 };
  const rule = d.mode === "custom" ? d.rrule
    : d.mode === "hourly" && s.intervalMinutes == null ? builderRrule({ ...builder, frequency: "hourly", interval: s.intervalHours })
    : d.mode === "daily" ? builderRrule({ ...builder, frequency: "daily", interval: 1 })
    : rruleOf({ ...s, mode: d.mode });
  const lines = rule.split(/\r?\n/).filter((line) => line.trim()).map((line) => (line.includes(":") ? line : `RRULE:${line}`))
    .map((line) => (!line.startsWith("RRULE:") || !d.until ? line : `${line.replace(/;UNTIL=[^;\r\n]+/i, "")};UNTIL=${untilUtc(d.until, d.timezone)}`));
  return `BEGIN:VEVENT\n${lines.join("\n")}\nEND:VEVENT`;
}

/** cEt: exact for hourly and custom rules and a one-time run, flexible for the rest; a condition watch stays one. */
function timingOf(d: CloudDraft, previous?: TimingMode): number {
  if (previous === "condition_watch") return TIMING.condition_watch;
  if (!d.repeat) return previous === "flexible_schedule" ? TIMING.flexible_schedule : TIMING.exact_schedule;
  return d.mode === "hourly" || d.mode === "custom" ? TIMING.exact_schedule : TIMING.flexible_schedule;
}

/**
 * The save request (tEt for a new task, eEt for an edit). A new recurring task is flexible, as a
 * personal one is there. An edit keeps the switches the form has none of, sends no thread_mode,
 * leaves out a model and effort it did not change, and keeps the saved schedule unless the draft's
 * differs from what the task's own would write.
 */
export function saveBody(d: CloudDraft, existing?: CloudAutomation | null): Record<string, unknown> {
  const prompt = d.prompt.trim(), title = defaultName(d.name, d.prompt), schedule = cloudSchedule(d);
  if (!existing) {
    return {
      default_timezone: d.timezone, email_enabled: false, is_enabled: true, jawbone_id: null, model: d.model, reasoning_effort: d.effort,
      notifications_enabled: true, prompt, emoji: d.emoji, thread_mode: d.newChat ? "new_chat" : "existing_chat", schedule,
      timing_mode: d.repeat ? TIMING.flexible_schedule : timingOf(d), title,
    };
  }
  const dirty = d.timezone !== existing.timezone || schedule !== cloudSchedule(cloudDraftOf(existing));
  return {
    default_timezone: dirty ? d.timezone : existing.savedTimezone,
    email_enabled: existing.emailEnabled,
    is_enabled: existing.enabled,
    jawbone_id: existing.id,
    model: d.model === existing.model ? undefined : d.model,
    reasoning_effort: d.effort === existing.effort ? undefined : d.effort,
    notifications_enabled: existing.notificationsEnabled,
    prompt,
    emoji: d.emoji,
    schedule: dirty ? schedule : existing.schedule,
    timing_mode: dirty ? timingOf(d, existing.timingMode) : TIMING[existing.timingMode],
    title,
  };
}

/** The server's prompt limit (instructionsCharacterLimit). */
const MAX_PROMPT = 100_000;

/**
 * Why the draft cannot be saved yet, the first reason only (the desktop app's checks: the prompt,
 * a one-time run in the future within two years, an end date from today, the policy's shortest
 * interval, a rule that reads). `policy` null: not read yet, minutes go unchecked.
 */
export function cloudProblem(d: CloudDraft, policy: SchedulePolicy | null, now: number): string | null {
  if (!d.prompt.trim()) return "添加指令。";
  if (d.prompt.length > MAX_PROMPT) return "请使用不超过 100,000 个字符";
  if (!d.repeat) {
    const at = zonedTime(d.date, d.time, d.timezone);
    const limit = new Date(now);
    limit.setFullYear(limit.getFullYear() + 2);
    if (!Number.isFinite(at) || at <= now) return "请选择未来的日期和时间";
    return at > limit.getTime() ? "请选择未来两年内的日期" : null;
  }
  if (d.until && d.until < wallTime(now, d.timezone).date) return "请选择今天或之后的日期作为结束日期";
  const minutes = d.mode === "hourly" ? scheduleOf(d.rrule).intervalMinutes : null;
  const shortest = policy && minuteOptions(policy)[0];
  if (minutes != null && policy && (shortest == null || minutes < shortest)) return `请选择 ${shortest ?? 60} 分钟或更长的时间间隔`;
  // The server reads more of RRULE than context/rrule.mjs runs: only text that does not read is refused.
  if (d.mode === "custom" && (!d.rrule.trim() || rruleProblem(d.rrule, now)?.code === "invalid")) return "请输入有效的 RRULE";
  return null;
}
