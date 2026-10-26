// ChatGPT Dots, the Pro plans' always-on agents (orbit / aeon / tbo inside ChatGPT): the account's
// dot, its messaging room and its recent tasks, called through the bridge's /api/cloud under this
// session's ChatGPT login (server/cloud.mjs). Calls and shapes follow the Codex desktop app 26.1021
// (webview assets: the dot page, native-api and side-panel chunks); every field is read
// defensively. A dot's work threads run on ChatGPT's durable app-server host, which this page does
// not reach: it shows the dot's Messages view and its activity list.
import { useSyncExternalStore } from "react";
import { cloudCall, query } from "./cloud";
import { connectionId, errorMessage } from "./codex";

export interface Dot {
  id: string;
  /** Its own name; the page says 你的 Dot without one. */
  name: string | null;
  paused: boolean;
  roomId: string | null;
}

export interface DotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  /** As the service stamps it (the read marker takes it back). */
  createdAt: string;
}

export interface DotTask {
  id: string;
  title: string;
  emoji: string | null;
  status: "running" | "succeeded" | "failed" | "interrupted";
  /** Seconds, as the service counts them (side-panel `updated_at*1e3`). */
  updatedAt: number;
}

interface DotsState {
  /** The account has Dots (accounts/check `tbo_config`); null until asked. */
  available: boolean | null;
  /** undefined until loaded; null when the account has none yet. */
  dot: Dot | null | undefined;
  dotError: string | null;
  messages: DotMessage[] | null;
  messagesError: string | null;
  activity: DotTask[] | null;
  creating: boolean;
  createError: string | null;
}

const EMPTY: DotsState = { available: null, dot: undefined, dotError: null, messages: null, messagesError: null, activity: null, creating: false, createError: null };
let state = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<DotsState>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

/** `pick` must return a part of the state as it is (no new objects). */
export function useDots<T>(pick: (s: DotsState) => T): T {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, () => pick(state));
}

export const dotsState = () => state;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const obj = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const call = <T>(method: string, path: string, body?: unknown) => cloudCall<T>(method, path, body, "ChatGPT");
const dotPath = (id: string) => `/tbo/${encodeURIComponent(id)}`;
const roomPath = (id: string) => `/messaging/rooms/${encodeURIComponent(id)}`;

function parseDot(raw: unknown): Dot {
  const profile = obj(raw);
  return {
    id: str(profile.id),
    name: str(profile.display_name).trim() || null,
    paused: profile.is_paused === true,
    roomId: str(profile.messaging_room_id) || null,
  };
}

/** The primary dot (`/tbo/primary` names its root thread or id), else the first one standing. */
export function pickDot(items: unknown[], selection: unknown): Dot | null {
  const dots = items.map(obj).filter((profile) => str(profile.id) && profile.status !== "deleting" && (!profile.aeon_kind || profile.aeon_kind === "orbit"));
  const primary = obj(selection);
  const chosen = dots.find((profile) => (str(primary.thread_id) && profile.active_root_thread_id === primary.thread_id) || (str(primary.aeon_id) && profile.id === primary.aeon_id)) ?? dots[0];
  return chosen ? parseDot(chosen) : null;
}

/** A dot reply's visible assistant text: no hidden or analysis-channel messages (native-api `kn`). */
const replyText = (message: Record<string, unknown>) => {
  const meta = obj(message.metadata);
  const content = obj(message.content);
  if (str(obj(message.author).role) !== "assistant" || meta.is_hidden === true || meta.hidden === true || message.channel === "analysis") return "";
  if (content.content_type !== "text" && content.content_type !== "multimodal_text") return "";
  return list(content.parts).map((part) => (typeof part === "string" ? part : str(obj(part).text))).filter((text) => text.trim()).join("\n\n");
};

/** A room message: the dot's reply (`raw_messages`), the user's (`account_user_id`) or a system note. */
export function parseDotMessage(raw: unknown): DotMessage | null {
  const message = obj(raw);
  const content = obj(message.content);
  if (!str(message.id) || message.deleted_at) return null;
  let role: DotMessage["role"];
  let text: string;
  if ("raw_messages" in message) {
    role = "assistant";
    text = list(message.raw_messages).map(obj).map(replyText).filter(Boolean).join("\n\n");
  } else if ("account_user_id" in message) {
    role = "user";
    text = str(content.text);
  } else {
    if (content.type === "message_error") return null;
    role = "system";
    text = "text" in content ? str(content.text) : str(message.preview);
  }
  return text.trim() ? { id: str(message.id), role, text, createdAt: str(message.created_at) } : null;
}

function parseDotTask(raw: unknown): DotTask {
  const task = obj(raw);
  const status = task.status === "in_progress" ? "running" : task.outcome === "failed" ? "failed" : task.outcome === "interrupted" ? "interrupted" : "succeeded";
  return {
    id: str(task.thread_id),
    title: str(task.title).trim() || str(obj(task.preview).text).trim() || "未命名任务",
    emoji: str(task.emoji) || null,
    status,
    updatedAt: typeof task.updated_at === "number" ? task.updated_at : 0,
  };
}

export async function refreshDotsAvailable(): Promise<void> {
  const id = connectionId();
  if (!id) return;
  try {
    const response = await fetch(`/api/dots/available?c=${encodeURIComponent(id)}`);
    set({ available: response.ok && (await response.json() as { available?: unknown }).available === true });
  } catch {
    set({ available: false });
  }
}

export async function loadDot(): Promise<void> {
  try {
    // A 404 from /tbo/primary means no primary dot is chosen.
    const [listed, primary] = await Promise.all([
      call<unknown>("GET", `/tbo${query({ limit: 25, include_room_preview: "false" })}`),
      call<unknown>("GET", "/tbo/primary").catch(() => null),
    ]);
    set({ dot: pickDot(list(obj(listed).items), obj(primary).selection), dotError: null });
  } catch (error) {
    set({ dotError: errorMessage(error) });
  }
}

async function refreshDot(): Promise<void> {
  const id = state.dot?.id;
  if (!id) return;
  const dot = parseDot(await call<unknown>("GET", dotPath(id)));
  if (state.dot?.id === id) set({ dot });
}

/** The dot with its messaging room, made when it has none yet (composer-send). */
async function withRoom(dot: Dot): Promise<Dot & { roomId: string }> {
  if (dot.roomId) return dot as Dot & { roomId: string };
  const fresh = parseDot(await call<unknown>("POST", `${dotPath(dot.id)}/messaging-room`));
  if (!fresh.roomId) throw new Error("ChatGPT 没有返回 Dot 的消息会话。");
  set({ dot: fresh });
  return fresh as Dot & { roomId: string };
}

/** The desktop app's create, without its connector and notification steps. */
export async function createDot(): Promise<void> {
  set({ creating: true, createError: null });
  try {
    const created = parseDot(await call<unknown>("POST", "/tbo", { display_name: "", create_thread: true, should_initialize: true }));
    if (!created.id) throw new Error("ChatGPT 没有返回新建的 Dot。");
    set({ dot: created, messages: [] });
    await withRoom(created);
  } catch (error) {
    set({ createError: errorMessage(error) });
  } finally {
    set({ creating: false });
  }
}

export async function loadDotMessages(): Promise<void> {
  const roomId = state.dot?.roomId;
  if (!roomId) {
    // No room yet: nothing has been said.
    if (state.dot && !state.messages) set({ messages: [] });
    return;
  }
  try {
    const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages${query({ limit: 20 })}`));
    const messages = list(answer.items).map(parseDotMessage).filter((message): message is DotMessage => !!message)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    // A poll that brings nothing new leaves the transcript as it is.
    if (state.dot?.roomId === roomId && JSON.stringify(messages) !== JSON.stringify(state.messages)) set({ messages, messagesError: null });
    else if (state.messagesError) set({ messagesError: null });
  } catch (error) {
    set({ messagesError: errorMessage(error) });
  }
}

/** A paused dot is resumed first, as the desktop app's composer does. */
export async function sendDotMessage(text: string): Promise<void> {
  if (!state.dot) throw new Error("还没有 Dot。");
  if (state.dot.paused) await setDotPaused(false);
  const dot = await withRoom(state.dot);
  const requestId = crypto.randomUUID();
  await call("POST", `${roomPath(dot.roomId)}/messages`, {
    content: { text, attachments: [] },
    request_id: requestId,
    idempotency_token: requestId,
    timezone_offset_min: new Date().getTimezoneOffset(),
  });
  await loadDotMessages();
}

export async function setDotPaused(paused: boolean): Promise<void> {
  if (!state.dot) return;
  await call("POST", `${dotPath(state.dot.id)}/runtime/${paused ? "pause" : "resume"}`);
  await refreshDot();
}

export async function loadDotActivity(): Promise<void> {
  if (!state.dot) return;
  try {
    const answer = obj(await call<unknown>("GET", `${dotPath(state.dot.id)}/activity${query({ limit: 5 })}`));
    // Running first, then the latest (side-panel `Ta`).
    const activity = list(answer.data).map(parseDotTask).filter((task) => task.id)
      .sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.updatedAt - a.updatedAt);
    set({ activity });
  } catch {
    // The list is a side note: it stays as it was.
  }
}

export function markDotRead(): void {
  const roomId = state.dot?.roomId;
  const last = state.messages?.at(-1)?.createdAt;
  if (roomId && last) void call("POST", `${roomPath(roomId)}/read`, { last_read_at: last }).catch(() => {});
}

/** Signed out or switched accounts: nothing of the old account's dot stays on screen. */
export function resetDots(): void {
  set(EMPTY);
}
