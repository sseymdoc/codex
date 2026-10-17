// Global UI state. Updates are immutable so React can compare by reference;
// subscribers are notified once per animation frame, which keeps token streams cheap.

import { useSyncExternalStore } from "react";
import type { InitializeResponse } from "@protocol/InitializeResponse";
import type { ServerRequest } from "@protocol/ServerRequest";
import type { AskForApproval } from "@protocol/v2/AskForApproval";
import type { CollaborationModeMask } from "@protocol/v2/CollaborationModeMask";
import type { Config } from "@protocol/v2/Config";
import type { ExperimentalFeature } from "@protocol/v2/ExperimentalFeature";
import type { GetAccountRateLimitsResponse } from "@protocol/v2/GetAccountRateLimitsResponse";
import type { GetAccountResponse } from "@protocol/v2/GetAccountResponse";
import type { Model } from "@protocol/v2/Model";
import type { SandboxPolicy } from "@protocol/v2/SandboxPolicy";
import type { Thread } from "@protocol/v2/Thread";
import type { ThreadGoal } from "@protocol/v2/ThreadGoal";
import type { ThreadItem } from "@protocol/v2/ThreadItem";
import type { ThreadSection } from "@protocol/v2/ThreadSection";
import type { ThreadTokenUsage } from "@protocol/v2/ThreadTokenUsage";
import type { Turn } from "@protocol/v2/Turn";
import type { TurnPlanStep } from "@protocol/v2/TurnPlanStep";

export type PermissionPreset = "read-only" | "auto" | "full-access";

export interface TurnState extends Turn {
  plan?: { explanation: string | null; steps: TurnPlanStep[] };
  diff?: string;
  retrying?: string | null;
}

/** Effective per-thread settings as last reported by the server, plus local picks for the next turn. */
export interface ThreadSettings {
  model: string | null;
  effort: string | null;
  approvalPolicy: AskForApproval | null;
  sandbox: SandboxPolicy | null;
  cwd: string;
}

export interface ThreadState {
  meta: Thread;
  turns: TurnState[];
  olderCursor: string | null;
  loading: boolean;
  loaded: boolean;
  subscribed: boolean;
  settings: ThreadSettings | null;
  /** Picks made in the composer that ride along with the next turn/start. */
  overrides: Partial<{ model: string; effort: string; permission: PermissionPreset }>;
  planMode: boolean;
  tokenUsage: ThreadTokenUsage | null;
  /** item id -> [startedAtMs, completedAtMs] */
  timing: Record<string, [number, number?]>;
  goal: ThreadGoal | null;
  /** A turn finished while another thread was on screen. */
  unread: boolean;
  /** When the last turn completed; the composer plays its arrival light on change. */
  arrivedAt: number;
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

export type SettingsTab = "general" | "account" | "mcp" | "skills" | "labs" | "about";

export type DialogState =
  | { type: "review"; threadId: string | null }
  | { type: "rename"; threadId: string }
  | { type: "delete"; threadId: string }
  | { type: "folder" }
  | { type: "section"; sectionId: string | null; threadId?: string }
  | null;

export interface NewChatPrefs {
  cwd: string;
  model: string | null;
  effort: string | null;
  permission: PermissionPreset | null;
  planMode: boolean;
}

export interface AppState {
  conn: { status: "connecting" | "ready" | "closed"; error?: string; detail?: string };
  server: { cwd: string; command: string; info: InitializeResponse | null };
  account: GetAccountResponse | null;
  rateLimits: GetAccountRateLimitsResponse | null;
  login: LoginState | null;
  models: Model[];
  modes: CollaborationModeMask[];
  features: ExperimentalFeature[];
  config: Config | null;
  threads: Record<string, ThreadState>;
  sections: ThreadSection[];
  list: { ids: string[]; cursor: string | null; loading: boolean; search: string; archived: boolean };
  activeId: string | null;
  requests: ServerRequest[];
  toasts: Toast[];
  prefs: NewChatPrefs;
  panel: "diff" | null;
  settings: SettingsTab | null;
  dialog: DialogState;
  palette: boolean;
  /** Image shown full-window, as a URL. */
  lightbox: string | null;
  sidebarOpen: boolean;
}

const initialState: AppState = {
  conn: { status: "connecting" },
  server: { cwd: "", command: "", info: null },
  account: null,
  rateLimits: null,
  login: null,
  models: [],
  modes: [],
  features: [],
  config: null,
  threads: {},
  sections: [],
  list: { ids: [], cursor: null, loading: false, search: "", archived: false },
  activeId: null,
  requests: [],
  toasts: [],
  prefs: { cwd: "", model: null, effort: null, permission: null, planMode: false },
  panel: null,
  settings: null,
  dialog: null,
  palette: false,
  lightbox: null,
  sidebarOpen: true,
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
    arrivedAt: 0,
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
