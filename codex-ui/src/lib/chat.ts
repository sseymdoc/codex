import { useSyncExternalStore } from "react";
import { connectionId, openSiwcChat } from "./codex";
import { applyChatDelta, mergeChat, type ChatAccount, type ChatDelta, type ChatModel, type ChatProfile, type ChatSession, type ChatSummary } from "./chat-state";

interface ChatState {
  available: boolean; session: ChatAccount | null; profiles: ChatProfile[]; models: ChatModel[];
  chats: ChatSummary[]; documents: Record<string, ChatSession>; selectedId: string | null; model: string;
  drafts: Record<string, string>;
  busy: boolean; error: string | null;
}
const empty = (): ChatState => ({ available: false, session: null, profiles: [], models: [], chats: [], documents: {}, drafts: {}, selectedId: null, model: "", busy: false, error: null });
let state = empty(), epoch = 0;
let pendingSend: { profileId: string | undefined; id: string; text: string; model: string; turnId: string } | undefined;
const listeners = new Set<() => void>();
const set = (patch: Partial<ChatState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
export const chatState = () => state;
export function useChat<T>(pick: (state: ChatState) => T): T {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => pick(state));
}
async function call<T>(action: string, body: unknown = {}): Promise<T> {
  const id = connectionId();
  if (!id) throw new Error("未连接到本地服务。");
  const response = await fetch(`/api/chat/${action}?c=${encodeURIComponent(id)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message || "聊天服务暂不可用。");
  return result as T;
}
function accept(chat: ChatSession) {
  if (chat.profileId !== state.session?.profileId) return;
  set({ documents: { ...state.documents, [chat.id]: mergeChat(state.documents[chat.id], chat) } });
}
function account(session: ChatAccount) {
  if (state.session?.profileId !== session.profileId) set({ session, models: [], chats: [], documents: {}, selectedId: null, model: "" });
  else set({ session });
}
export async function refreshChat(models = false): Promise<void> {
  const generation = epoch, profileId = state.session?.profileId;
  if (!state.available || !profileId) return;
  try {
    const { chats } = await call<{ chats: ChatSummary[] }>("list");
    if (generation !== epoch || profileId !== state.session?.profileId) return;
    set({ chats });
    if (state.selectedId) {
      const { chat } = await call<{ chat: ChatSession }>("read", { id: state.selectedId });
      if (generation !== epoch) return;
      accept(chat);
    }
    if (models && state.session?.sharing) {
      const answer = await call<{ models: ChatModel[] }>("models");
      if (generation !== epoch || profileId !== state.session?.profileId) return;
      set({ models: answer.models, model: answer.models.some((item) => item.slug === state.model) ? state.model : answer.models[0]?.slug ?? "" });
    }
  } catch (error) { if (generation === epoch && profileId === state.session?.profileId) set({ error: String((error as Error).message) }); }
}
export function connectChat(): () => void {
  const generation = ++epoch;
  let events: EventSource | undefined;
  set(empty());
  void call<{ available: boolean; session?: ChatAccount; profiles?: ChatProfile[] }>("status").then((result) => {
    if (generation !== epoch || !result.available || !result.session) return;
    set({ available: true, profiles: result.profiles ?? [] }); account(result.session);
    events = new EventSource(`/api/chat/events?c=${encodeURIComponent(connectionId()!)}`);
    events.addEventListener("ready", () => { if (generation === epoch) { set({ error: null }); void refreshChat(true); } });
    events.addEventListener("changed", () => { if (generation === epoch) void refreshChat(); });
    events.addEventListener("account", (event) => {
      if (generation !== epoch) return;
      const next = JSON.parse((event as MessageEvent).data) as ChatAccount;
      const changed = next.profileId !== state.session?.profileId || next.sharing !== state.session?.sharing;
      account(next);
      if (changed && !state.busy) void refreshChat(true);
    });
    events.addEventListener("chat", (event) => { if (generation === epoch) accept(JSON.parse((event as MessageEvent).data) as ChatSession); });
    events.addEventListener("delta", (event) => {
      if (generation !== epoch) return;
      const delta = JSON.parse((event as MessageEvent).data) as ChatDelta, chat = state.documents[delta.id];
      if (chat && delta.profileId === state.session?.profileId) set({ documents: { ...state.documents, [chat.id]: applyChatDelta(chat, delta) } });
    });
    events.onerror = () => { if (generation === epoch) set({ error: "聊天状态连接中断，正在重新连接；不会自动重发消息。" }); };
  }).catch(() => { if (generation === epoch) set({ available: false }); });
  return () => { if (generation === epoch) { epoch++; set(empty()); } events?.close(); };
}
export function selectChat(id: string | null): void {
  set({ selectedId: id, error: null });
  openSiwcChat();
  if (id) void call<{ chat: ChatSession }>("read", { id }).then(({ chat }) => {
    accept(chat);
    if (state.selectedId === id && state.models.some((item) => item.slug === chat.model)) set({ model: chat.model });
  }).catch((error: Error) => set({ error: error.message }));
}
export const selectChatModel = (model: string): void => set({ model });
export const clearChatError = (): void => set({ error: null });
export const setChatDraft = (id: string, text: string): void => set({ drafts: { ...state.drafts, [id]: text } });
export async function chatAccountAction(action: "login" | "login/cancel" | "logout" | "account", body = {}): Promise<void> {
  if (action === "login/cancel") { await call(action); return; }
  set({ busy: true, error: null });
  try {
    const result = await call<{ session: ChatAccount; profiles: ChatProfile[] }>(action, body);
    account(result.session); set({ profiles: result.profiles });
    await refreshChat(true);
  } catch (error) { set({ error: (error as Error).message }); }
  finally { set({ busy: false }); }
}
export async function sendChat(text: string): Promise<boolean> {
  const generation = epoch, profileId = state.session?.profileId;
  const draftKey = `${profileId ?? ""}/${state.selectedId ?? "new"}`;
  set({ busy: true, error: null });
  try {
    let id = state.selectedId;
    if (!id) {
      const { chat } = await call<{ chat: ChatSession }>("create", { model: state.model });
      if (generation !== epoch || profileId !== state.session?.profileId) return false;
      accept(chat); id = chat.id;
      set({ selectedId: id, drafts: { ...state.drafts, [`${profileId}/${id}`]: text } });
    }
    if (!pendingSend || pendingSend.profileId !== profileId || pendingSend.id !== id || pendingSend.text !== text || pendingSend.model !== state.model) {
      pendingSend = { profileId, id, text, model: state.model, turnId: crypto.randomUUID() };
    }
    const result = await call<{ chat: ChatSession }>("send", pendingSend);
    if (generation !== epoch || profileId !== state.session?.profileId) return false;
    accept(result.chat);
    set({ drafts: { ...state.drafts, [draftKey]: "", [`${profileId}/${id}`]: "" } });
    pendingSend = undefined;
    void refreshChat();
    return true;
  } catch (error) { if (generation === epoch) set({ error: (error as Error).message }); return false; }
  finally { if (generation === epoch) set({ busy: false }); }
}
export async function stopChat(id: string): Promise<void> {
  try { await call("cancel", { id }); } catch (error) { set({ error: (error as Error).message }); }
}
export async function deleteChat(id: string): Promise<void> {
  try {
    await call("delete", { id });
    const documents = { ...state.documents }; delete documents[id];
    set({ documents, selectedId: state.selectedId === id ? null : state.selectedId });
    await refreshChat();
  } catch (error) { set({ error: (error as Error).message }); }
}
