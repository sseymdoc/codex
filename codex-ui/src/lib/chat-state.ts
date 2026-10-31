export interface ChatIssue { code: string; message: string }
export interface ChatAccount {
  status: "disconnected" | "connecting" | "connected" | "reauth_required";
  sharing: boolean;
  profileId?: string;
  profileLabel?: string;
  identity?: { name?: string; email?: string };
  error?: ChatIssue;
}
export interface ChatProfile { id: string; label: string; status: ChatAccount["status"]; sharing: boolean; identity?: ChatAccount["identity"] }
export interface ChatModel { slug: string; displayName: string }
export interface ChatTurn { id: string; user: string; assistant: string; model: string; status: "running" | "completed" | "cancelled" | "failed"; error?: ChatIssue }
export interface ChatSummary { id: string; title: string; model: string; updatedAt: number; unreadable?: boolean }
export interface ChatSession extends ChatSummary { profileId: string; turns: ChatTurn[] }
export interface ChatDelta { profileId: string; id: string; turnId: string; offset: number; text: string }

/** A slower HTTP snapshot must not undo text or completion already delivered over SSE. */
export function mergeChat(previous: ChatSession | undefined, next: ChatSession): ChatSession {
  if (!previous || previous.id !== next.id || previous.profileId !== next.profileId) return next;
  if (previous.turns.length > next.turns.length) return previous;
  return { ...next, turns: next.turns.map((turn) => {
    const before = previous.turns.find((item) => item.id === turn.id);
    return before && turn.status === "running" && (before.status !== "running" || before.assistant.length > turn.assistant.length) ? before : turn;
  }) };
}

/** Offsets make reconnect snapshots and queued deltas safe to receive in either order. */
export function applyChatDelta(chat: ChatSession, delta: ChatDelta): ChatSession {
  if (chat.id !== delta.id || chat.profileId !== delta.profileId) return chat;
  return { ...chat, turns: chat.turns.map((turn) => turn.id === delta.turnId && turn.status === "running" && turn.assistant.length === delta.offset
    ? { ...turn, assistant: turn.assistant + delta.text } : turn) };
}
