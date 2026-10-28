// ChatGPT Dots, the Pro plans' always-on agents (orbit / aeon / tbo inside ChatGPT): the account's
// dot, its messaging room and its recent tasks, called through the bridge's /api/cloud under this
// session's ChatGPT login (server/cloud.mjs). Calls and shapes follow the Codex desktop app 26.1023
// (webview assets: native-api, normalize, native-room, message-row, side-panel); every field is
// read defensively. A dot's work threads run on ChatGPT's durable app-server host, which this page
// does not reach: it shows the dot's Messages view and its activity list.
import { useSyncExternalStore } from "react";
import { CloudError, cloudAnswer, cloudCall, list, obj, query, str, type CloudAnswer } from "./cloud";
import { connectionId, errorMessage } from "./codex";

export interface Dot {
  id: string;
  /** Its own name; the page says 你的 Dot without one. */
  name: string | null;
  paused: boolean;
  roomId: string | null;
  rootThreadId: string | null;
  /** Why the service paused it (a safety pause names its monitor). */
  pauseReason: string | null;
  /** Its picture (an https URL or a file pointer), its kind and the character it was made from. */
  avatar: { url: string; type: string; manifest: Record<string, unknown> | null };
  /** The color of its default ring (gray, cyan, …). */
  color: string | null;
  /** Its deletion was asked for and has not finished. */
  deleting: boolean;
}

export interface DotMember {
  id: string;
  /** Set on a dot that sits in the room. */
  aeonId: string | null;
  name: string;
  avatarUrl: string;
}

/** The room snapshot: who is who (the dot is the member whose aeon_id is the room's), read marks. */
export interface DotRoom {
  id: string;
  aeonId: string | null;
  /** The dot's account user id in this room. */
  dotUserId: string | null;
  /** This login's account user id (the token's, else the DM's member that is no dot). */
  selfId: string | null;
  members: Record<string, DotMember>;
  lastReadAt: string;
  /** Account user id → the last time that member read the room. */
  receipts: Record<string, string>;
}

export type DotSender = "self" | "dot" | "member" | "system";

export interface DotAttachment {
  kind: "file" | "call" | "thread" | "link" | "other";
  fileId: string;
  name: string;
  mime: string;
  size: number | null;
  callId: string;
  /** `juno` is a voice call in ChatGPT, anything else a phone call. */
  callType: string;
  durationMs: number | null;
  outcome: string;
  threadId: string;
  title: string;
  conversationId: string;
}

export interface DotOptions {
  options: string[];
  selected?: number;
}

export interface DotMessage {
  id: string;
  sender: DotSender;
  senderId: string;
  text: string;
  /** As the service stamps it (the read marker takes it back). */
  createdAt: string;
  deleted: boolean;
  /** Where a message came in from outside ChatGPT (imessage, sms, rcs, phone). */
  channel: string | null;
  attachments: DotAttachment[];
  replyTo: { id: string; text: string; author: string } | null;
  /** The message a reply belongs under. */
  rootId: string | null;
  /** A question with choices the dot asks. */
  options: DotOptions | null;
  /** The choice an answer picked (`option_picker.selection`). */
  selection: number | undefined;
  /** The dot asks for something this page answers through the elicitation endpoints. */
  elicitation: boolean;
  /** The call summary (or another body) is still being written. */
  generating: boolean;
  requestId: string;
  /** A message of this page's that the room has not confirmed yet. */
  state?: "sending" | "failed" | "unknown";
  error?: string;
}

export interface DotTask {
  id: string;
  title: string;
  emoji: string | null;
  status: "running" | "succeeded" | "failed" | "interrupted";
  /** Seconds, as the service counts them (side-panel `updated_at*1e3`). */
  updatedAt: number;
}

/** A message on its way: its request id makes every retry the same message to the room. */
interface PendingSend {
  requestId: string;
  text: string;
  files: DotAttachment[];
  replyTo: DotMessage["replyTo"];
  metadata?: Record<string, unknown>;
  createdAt: string;
  /** `sent`: the room took it; it shows until the room's list has it. */
  state: "sending" | "sent" | "failed" | "unknown";
  error?: string;
}

interface DotsState {
  /** The account has Dots (accounts/check `tbo_config`); null until asked. */
  available: boolean | null;
  /** This login's account user id (the token's `chatgpt_account_user_id`). */
  accountUserId: string | null;
  /** The account's dots (the primary one first chosen). */
  dots: Dot[];
  /** The dot on the page: undefined until loaded; null when the account has none yet. */
  dot: Dot | null | undefined;
  dotError: string | null;
  room: DotRoom | null;
  messages: DotMessage[] | null;
  messagesError: string | null;
  /** Where earlier messages start (`before`); null when there are none, undefined while unknown. */
  olderCursor: string | null | undefined;
  loadingOlder: boolean;
  olderError: boolean;
  pending: PendingSend[];
  /** Messages after this one are new to the user (the read mark as the room opened). */
  unreadAfter: string | null;
  /** The dot says it is responding until this time (ms). */
  typingUntil: number;
  /** The pubsub socket is up, so polling can slow down. */
  live: boolean;
  /** Replies under a message, once asked for. */
  replies: Record<string, DotMessage[]>;
  activity: DotTask[] | null;
  creating: boolean;
  createError: string | null;
}

const EMPTY: DotsState = {
  available: null, accountUserId: null, dots: [], dot: undefined, dotError: null, room: null, messages: null, messagesError: null,
  olderCursor: undefined, loadingOlder: false, olderError: false, pending: [], unreadAfter: null, typingUntil: 0, live: false,
  replies: {}, activity: null, creating: false, createError: null,
};
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

/** The room's prepared thread route, sent back with the next message (prewarm-runtime). */
const route: { value?: string } = {};
const call = <T>(method: string, path: string, body?: unknown) => cloudCall<T>(method, path, body, "ChatGPT", route);
const dotPath = (id: string) => `/tbo/${encodeURIComponent(id)}`;
const roomPath = (id: string) => `/messaging/rooms/${encodeURIComponent(id)}`;
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function parseDot(raw: unknown): Dot {
  const profile = obj(raw);
  const manifest = obj(profile.avatar_manifest);
  return {
    id: str(profile.id),
    name: str(profile.display_name).trim() || null,
    paused: profile.is_paused === true,
    roomId: str(profile.messaging_room_id) || null,
    rootThreadId: str(profile.active_root_thread_id) || str(profile.root_thread_id) || null,
    pauseReason: str(profile.pause_reason) || str(obj(profile.pause).reason) || null,
    avatar: {
      url: str(profile.avatar_url) || str(obj(manifest.snapshot).asset_pointer),
      type: str(profile.avatar_type),
      manifest: Object.keys(manifest).length ? manifest : null,
    },
    color: str(profile.color) || null,
    deleting: profile.status === "deleting",
  };
}

const standing = (items: unknown[]) =>
  items.map(obj).filter((profile) => str(profile.id) && profile.status !== "deleting" && (!profile.aeon_kind || profile.aeon_kind === "orbit"));

/** The primary dot (`/tbo/primary` names its root thread or id), else the first one standing. */
export function pickDot(items: unknown[], selection: unknown): Dot | null {
  const dots = standing(items);
  const primary = obj(selection);
  const chosen = dots.find((profile) => (str(primary.thread_id) && profile.active_root_thread_id === primary.thread_id) || (str(primary.aeon_id) && profile.id === primary.aeon_id)) ?? dots[0];
  return chosen ? parseDot(chosen) : null;
}

/** The room, its messages and what goes with them, as a dot is first shown. */
const ROOM_EMPTY = {
  room: null, messages: null, messagesError: null, olderCursor: undefined, loadingOlder: false, olderError: false,
  pending: [], unreadAfter: null, typingUntil: 0, replies: {}, activity: null,
} satisfies Partial<DotsState>;

/** A dot's profile changed: in the list and, when it is the one shown, on the page. */
export function putDot(dot: Dot): void {
  const known = state.dots.some((item) => item.id === dot.id);
  set({
    dots: known ? state.dots.map((item) => (item.id === dot.id ? dot : item)) : [...state.dots, dot],
    ...(state.dot?.id === dot.id ? { dot } : {}),
  });
}

/** Shows another of the account's dots: its room starts afresh. */
export function selectDot(id: string): void {
  const dot = state.dots.find((item) => item.id === id);
  if (!dot || state.dot?.id === id) return;
  route.value = undefined;
  fileUrls.clear();
  set({ dot, ...ROOM_EMPTY });
}

/** A deleted dot leaves the list; the page moves on to the next one standing. */
export function dropDot(id: string): void {
  const dots = state.dots.filter((item) => item.id !== id);
  set({ dots, ...(state.dot?.id === id ? { dot: dots[0] ?? null, ...ROOM_EMPTY } : {}) });
}

/**
 * The room snapshot (native-api `pe`): members with their profile snapshots filling in names and
 * avatars, the dot among them by its aeon_id, and who read up to when.
 */
export function parseRoom(raw: unknown, accountUserId: string | null = null): DotRoom {
  const room = obj(raw);
  const aeonId = str(room.aeon_id) || null;
  const snapshots = list(room.member_profile_snapshots).map(obj);
  const members: Record<string, DotMember> = {};
  for (const entry of list(room.members).map(obj)) {
    const id = str(entry.account_user_id);
    if (!id) continue;
    const snapshot = snapshots.find((item) => str(item.account_user_id) === id) ?? {};
    members[id] = {
      id,
      aeonId: str(entry.aeon_id) || null,
      name: str(entry.name).trim() || str(snapshot.name).trim() || str(entry.username) || str(snapshot.username),
      avatarUrl: str(entry.avatar_url) || str(snapshot.avatar_url),
    };
  }
  const all = Object.values(members);
  const dot = all.find((member) => member.aeonId && member.aeonId === aeonId) ?? (aeonId ? undefined : all.find((member) => member.aeonId));
  const receipts: Record<string, string> = {};
  for (const receipt of list(room.read_receipts).map(obj)) {
    if (str(receipt.account_user_id) && str(receipt.last_read_at)) receipts[str(receipt.account_user_id)] = str(receipt.last_read_at);
  }
  return {
    id: str(room.id),
    aeonId,
    dotUserId: dot?.id ?? null,
    selfId: accountUserId ?? (room.type === "DM" ? all.find((member) => !member.aeonId)?.id ?? null : null),
    members,
    lastReadAt: str(room.last_read_at),
    receipts,
  };
}

/** A ChatGPT reply's visible assistant text: no hidden or analysis-channel messages (native-api `kn`). */
const replyText = (message: Record<string, unknown>) => {
  const meta = obj(message.metadata);
  const content = obj(message.content);
  if (str(obj(message.author).role) !== "assistant" || meta.is_hidden === true || meta.hidden === true || message.channel === "analysis") return "";
  if (content.content_type !== "text" && content.content_type !== "multimodal_text") return "";
  return list(content.parts).map((part) => (typeof part === "string" ? part : str(obj(part).text))).filter((text) => text.trim()).join("\n\n");
};

/** One attachment (normalize `_`): a file, a call's record, a task the dot made, a link. */
export function parseAttachment(raw: unknown): DotAttachment {
  const item = obj(raw);
  const file = obj(item.file);
  const type = str(item.type) || str(item.kind) || "file";
  return {
    kind: type === "file" || type === "call" || type === "thread" || type === "link" ? type : "other",
    fileId: str(item.file_id) || str(file.file_id) || str(file.id) || (type === "file" ? str(item.id) : ""),
    name: str(item.name) || str(file.name) || str(item.filename),
    mime: (str(item.mime_type) || str(file.mime_type)).toLowerCase(),
    size: num(item.size_bytes) ?? num(file.size_bytes),
    callId: str(item.call_id),
    callType: str(item.call_type),
    durationMs: num(item.duration_ms),
    outcome: str(item.outcome),
    threadId: str(item.thread_id),
    title: str(item.title),
    conversationId: str(item.conversation_id),
  };
}

function parseOptions(metadata: Record<string, unknown>): DotOptions | null {
  const picker = obj(metadata.option_picker);
  const options = list(picker.options).filter((option): option is string => typeof option === "string" && !!option.trim());
  if (!options.length) return null;
  const selected = num(picker.selected);
  return selected !== null && selected >= 0 && selected < options.length ? { options, selected } : { options };
}

/**
 * A room message as the desktop app tells its senders apart (native-api, normalize `S`): a reply
 * of ChatGPT's own (`raw_messages`) counts as the dot's; a member's message is the user's own when
 * its direction says so, else when it is flagged `is_self` or comes from this login's account user;
 * otherwise it is the dot's when that member is the dot (a dot is a room member: its replies carry
 * its own account_user_id). Anything else is a system note.
 */
export function parseDotMessage(raw: unknown, room: DotRoom | null = null): DotMessage | null {
  const message = obj(raw);
  const content = obj(message.content);
  const metadata = obj(message.message_metadata);
  const id = str(message.id);
  if (!id) return null;
  const deleted = !!message.deleted_at;
  let sender: DotSender;
  let senderId = "";
  let text: string;
  let attachments: unknown[];
  if ("raw_messages" in message) {
    sender = "dot";
    text = list(message.raw_messages).map(obj).map(replyText).filter(Boolean).join("\n\n");
    attachments = list(message.attachments);
  } else if ("account_user_id" in message) {
    senderId = str(message.account_user_id);
    const direction = str(obj(message.external_message_metadata).direction);
    const self = message.is_task_update !== true && (direction === "from_user" || direction === "to_user"
      ? direction === "from_user"
      : message.is_self === true || (room?.selfId ? senderId === room.selfId : !!room?.dotUserId && senderId !== room.dotUserId));
    const dot = message.is_task_update === true || !!room?.members[senderId]?.aeonId || (!!senderId && senderId === room?.dotUserId);
    sender = self ? "self" : dot ? "dot" : "member";
    text = str(content.text);
    attachments = list(content.attachments);
  } else {
    if (content.type === "message_error") return null;
    sender = "system";
    text = "text" in content ? str(content.text) : str(message.preview);
    attachments = [];
  }
  const parsed = attachments.map(parseAttachment);
  const options = parseOptions(metadata);
  const elicitation = !!content.elicitation && typeof content.elicitation === "object";
  if (!deleted && !text.trim() && !parsed.length && !elicitation) return null;
  const reply = obj(message.reply_to);
  const replied = obj(reply.message);
  const channel = str(message.external_message_channel);
  const selection = num(obj(metadata.option_picker).selection);
  return {
    id,
    sender,
    senderId,
    text: deleted ? "" : text,
    createdAt: str(message.created_at),
    deleted,
    channel: channel && channel !== "chatgpt" ? channel : null,
    attachments: deleted ? [] : parsed,
    replyTo: str(reply.message_id) ? {
      id: str(reply.message_id),
      text: str(reply.text) || str(obj(replied.content).text) || str(replied.preview),
      author: str(reply.author) || str(obj(replied.sender).name),
    } : null,
    rootId: str(message.reply_root_message_id) || null,
    options: deleted ? null : options,
    selection: selection ?? undefined,
    elicitation: !deleted && elicitation,
    generating: str(obj(message.generation).status) === "in_progress",
    requestId: str(message.request_id),
  };
}

const parseItems = (items: unknown[], room: DotRoom | null) =>
  items.map((item) => parseDotMessage(item, room)).filter((message): message is DotMessage => !!message);

const time = (value: string) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

const byTime = (a: DotMessage, b: DotMessage) => time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `incoming` over `current` by id, oldest first. */
export function mergeMessages(current: DotMessage[], incoming: DotMessage[]): DotMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(byTime);
}

/** A sent message the room now has: its request id is in the list. */
const landed = (messages: DotMessage[], requestId: string) => messages.some((message) => message.requestId === requestId);

/** Messages a sender sends within this long of each other read as one group (message-row `Pe`). */
const GROUP_MS = 30 * 60_000;

export type DotRow =
  | { kind: "time"; key: string; at: string }
  | { kind: "unread"; key: string }
  | { kind: "message"; key: string; message: DotMessage; first: boolean; replies: number };

/**
 * The transcript's rows: a time divider before the first message and wherever 30 minutes pass, a
 * 新消息 divider before the first message of someone else's after the read mark, each message
 * marked first of its group (same sender, same channel, within 30 minutes). Replies whose message
 * is here sit under it, counted, not in the flow.
 */
export function layoutRows(messages: DotMessage[], { unreadAfter = null }: { unreadAfter?: string | null } = {}): DotRow[] {
  const ids = new Set(messages.map((message) => message.id));
  const replies = new Map<string, number>();
  for (const message of messages) if (message.rootId && ids.has(message.rootId)) replies.set(message.rootId, (replies.get(message.rootId) ?? 0) + 1);
  const rows: DotRow[] = [];
  let previous: DotMessage | null = null;
  let unreadShown = false;
  const mark = unreadAfter ? time(unreadAfter) : 0;
  for (const message of messages) {
    if (message.rootId && ids.has(message.rootId)) continue;
    const at = time(message.createdAt);
    const gap = !previous || at - time(previous.createdAt) > GROUP_MS;
    if (gap && message.createdAt) rows.push({ kind: "time", key: `time:${message.id}`, at: message.createdAt });
    if (!unreadShown && mark && message.sender !== "self" && message.sender !== "system" && !message.state && at > mark) {
      unreadShown = true;
      rows.push({ kind: "unread", key: "unread" });
    }
    const first = gap || !previous || previous.sender !== message.sender || previous.senderId !== message.senderId || previous.channel !== message.channel;
    rows.push({ kind: "message", key: message.id, message, first, replies: replies.get(message.id) ?? 0 });
    previous = message;
  }
  return rows;
}

export type DotReceipt =
  | { kind: "failed" | "unknown"; error?: string }
  | { kind: "read"; at: string }
  | { kind: "delivered" };

/**
 * The receipt under the user's last message, when nobody has written since (native-room `Sc`):
 * failed or unconfirmed first, else read (with the dot's read time) or delivered.
 */
export function receiptOf(messages: DotMessage[], room: DotRoom | null): { id: string; receipt: DotReceipt } | null {
  const last = messages.at(-1);
  if (!last || last.sender !== "self") return null;
  if (last.state === "failed" || last.state === "unknown") return { id: last.id, receipt: { kind: last.state, error: last.error } };
  if (last.state === "sending") return null;
  const read = room?.dotUserId ? room.receipts[room.dotUserId] : undefined;
  return { id: last.id, receipt: read && time(read) >= time(last.createdAt) ? { kind: "read", at: read } : { kind: "delivered" } };
}

/** The choice already made for a dot's question: its own `selected`, else an answer's selection. */
export function optionState(message: DotMessage, messages: DotMessage[]): number | undefined {
  if (message.options?.selected !== undefined) return message.options.selected;
  return messages.find((other) => other.sender === "self" && other.replyTo?.id === message.id && other.selection !== undefined && other.state !== "failed")?.selection;
}

/** The messages to show: the room's, then this page's not yet confirmed ones. */
export function shownMessages(messages: DotMessage[], pending: PendingSend[]): DotMessage[] {
  const waiting = pending.filter((send) => !landed(messages, send.requestId)).map((send): DotMessage => ({
    id: `pending:${send.requestId}`, sender: "self", senderId: "", text: send.text, createdAt: send.createdAt, deleted: false, channel: null,
    attachments: send.files, replyTo: send.replyTo, rootId: null, options: null, selection: undefined, elicitation: false, generating: false,
    requestId: send.requestId, state: send.state === "sent" ? undefined : send.state, error: send.error,
  }));
  return waiting.length ? [...messages, ...waiting] : messages;
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
    const answer = response.ok ? (await response.json()) as { available?: unknown; accountUserId?: unknown } : {};
    set({ available: answer.available === true, accountUserId: str(answer.accountUserId) || null });
  } catch {
    set({ available: false });
  }
}

/**
 * The account's dots (one page of 25; ponytail: more than that are not listed, page with the
 * list's cursor if anyone has that many) and the one to show: the one shown so far while it
 * stands, else the primary one.
 */
export async function loadDot(): Promise<void> {
  try {
    // A 404 from /tbo/primary means no primary dot is chosen.
    const [listed, primary] = await Promise.all([
      call<unknown>("GET", `/tbo${query({ limit: 25, include_room_preview: "false" })}`),
      call<unknown>("GET", "/tbo/primary").catch(() => null),
    ]);
    const items = list(obj(listed).items);
    const dots = standing(items).map(parseDot);
    const kept = state.dot ? dots.find((dot) => dot.id === state.dot?.id) : undefined;
    const dot = kept ?? pickDot(items, obj(primary).selection);
    set({ dots, dot, dotError: null, ...(dot?.id !== state.dot?.id ? ROOM_EMPTY : {}) });
  } catch (error) {
    set({ dotError: errorMessage(error) });
  }
}

/** The dot's profile as the service has it now. */
export async function refreshDot(id = state.dot?.id): Promise<Dot | null> {
  if (!id) return null;
  const dot = parseDot(await call<unknown>("GET", dotPath(id)));
  putDot(dot);
  return dot;
}

/** The dot with its messaging room, made when it has none yet (composer-send). */
async function withRoom(dot: Dot): Promise<Dot & { roomId: string }> {
  if (dot.roomId) return dot as Dot & { roomId: string };
  const fresh = parseDot(await call<unknown>("POST", `${dotPath(dot.id)}/messaging-room`));
  if (!fresh.roomId) throw new Error("ChatGPT 没有返回 Dot 的消息会话。");
  putDot(fresh);
  return fresh as Dot & { roomId: string };
}

/**
 * The desktop app's create, without its connector and notification steps: a deletion that did
 * not finish is recovered first, and another dot than the first asks for one more.
 */
export async function createDot(): Promise<void> {
  set({ creating: true, createError: null });
  try {
    if (state.dots.some((dot) => dot.deleting)) await call("POST", "/tbo/deletion-recovery").catch(() => {});
    const created = parseDot(await call<unknown>("POST", "/tbo", { display_name: "", create_thread: true, should_initialize: true, ...(state.dots.length ? { create_additional: true } : {}) }));
    if (!created.id) throw new Error("ChatGPT 没有返回新建的 Dot。");
    set({ dots: [...state.dots.filter((dot) => dot.id !== created.id), created], dot: created, ...ROOM_EMPTY, messages: [], olderCursor: null });
    await withRoom(created);
  } catch (error) {
    set({ createError: errorMessage(error) });
  } finally {
    set({ creating: false });
  }
}

const PAGE = 20;

/** Where the page before `items` starts: the answer's cursor, else its oldest id on a full page. */
const olderFrom = (answer: Record<string, unknown>, items: unknown[]) =>
  str(answer.prev_cursor) || (items.length >= PAGE ? str(obj(items[0]).id) || null : null);

async function loadRoom(roomId: string): Promise<DotRoom | null> {
  try {
    const room = parseRoom(await call<unknown>("GET", roomPath(roomId)), state.accountUserId);
    if (state.dot?.roomId === roomId) set({ room });
    return room;
  } catch {
    // The snapshot only names who is who; the token's account user id still tells the user apart.
    return null;
  }
}

/** The room as it opens: its snapshot and latest page together; the read mark stays as it was. */
export async function openDotRoom(): Promise<void> {
  const roomId = state.dot?.roomId;
  if (!roomId) {
    // No room yet: nothing has been said.
    if (state.dot && !state.messages) set({ messages: [], olderCursor: null });
    return;
  }
  const [room] = await Promise.all([loadRoom(roomId), loadDotMessages()]);
  if (state.dot?.roomId === roomId && room && state.unreadAfter === null) set({ unreadAfter: room.lastReadAt || "" });
}

/**
 * The latest page. Merged into what is shown when the two meet; when they don't (many messages
 * came meanwhile) it replaces it, so no gap hides in the middle.
 */
export async function loadDotMessages(): Promise<void> {
  const roomId = state.dot?.roomId;
  if (!roomId) {
    if (state.dot && !state.messages) set({ messages: [], olderCursor: null });
    return;
  }
  try {
    const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages${query({ limit: PAGE })}`));
    if (state.dot?.roomId !== roomId) return;
    const items = list(answer.items);
    const latest = parseItems(items, state.room).sort(byTime);
    const current = state.messages;
    const meets = !current || !latest.length || latest.length < PAGE || latest.some((message) => current.some((known) => known.id === message.id));
    const messages = current && meets ? mergeMessages(current, latest) : latest;
    const pending = state.pending.filter((send) => !landed(messages, send.requestId));
    // A poll that brings nothing new leaves the transcript as it is.
    if (JSON.stringify(messages) !== JSON.stringify(current) || pending.length !== state.pending.length) {
      set({ messages, pending, messagesError: null, ...(current && meets ? {} : { olderCursor: olderFrom(answer, items) }) });
    } else if (state.messagesError) set({ messagesError: null });
  } catch (error) {
    set({ messagesError: errorMessage(error) });
  }
}

/** The page before the oldest message shown. */
export async function loadOlderDotMessages(): Promise<void> {
  const roomId = state.dot?.roomId;
  const before = state.olderCursor;
  if (!roomId || !before || state.loadingOlder) return;
  set({ loadingOlder: true, olderError: false });
  try {
    const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages${query({ limit: PAGE, before })}`));
    if (state.dot?.roomId !== roomId) return;
    const items = list(answer.items);
    set({ messages: mergeMessages(state.messages ?? [], parseItems(items, state.room)), olderCursor: olderFrom(answer, items) });
  } catch {
    set({ olderError: true });
  } finally {
    set({ loadingOlder: false });
  }
}

/** The replies under a message (the same list, by its root). */
export async function loadDotReplies(rootId: string): Promise<void> {
  const roomId = state.dot?.roomId;
  if (!roomId) return;
  const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages${query({ limit: PAGE, reply_root_message_id: rootId })}`));
  set({ replies: { ...state.replies, [rootId]: parseItems(list(answer.items), state.room).sort(byTime) } });
}

/** One message around `id`, for an update to a message older than the latest page. */
async function loadDotMessage(roomId: string, id: string): Promise<void> {
  const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages${query({ limit: 1, around: id })}`));
  if (state.dot?.roomId === roomId && state.messages) set({ messages: mergeMessages(state.messages, parseItems(list(answer.items), state.room)) });
}

export interface DotSend {
  text: string;
  files?: DotAttachment[];
  replyTo?: DotMessage | null;
  metadata?: Record<string, unknown>;
}

const quoteOf = (message: DotMessage | null | undefined, room: DotRoom | null): DotMessage["replyTo"] =>
  message ? { id: message.id, text: message.text, author: senderName(message, room) } : null;

/**
 * Sends as the desktop app does: a paused dot is resumed first, the message carries its request id
 * twice (the room drops a repeat of it). The message shows at once as being sent; a refusal marks
 * it failed, an answer that never came marks it unconfirmed (it may have arrived): either retries
 * with the same request id.
 */
export async function sendDotMessage({ text, files = [], replyTo = null, metadata }: DotSend): Promise<void> {
  if (!state.dot) throw new Error("还没有 Dot。");
  const send: PendingSend = {
    requestId: crypto.randomUUID(), text, files, replyTo: quoteOf(replyTo, state.room), metadata,
    createdAt: new Date().toISOString(), state: "sending",
  };
  set({ pending: [...state.pending, send] });
  await deliver(send);
}

/** Sends a failed or unconfirmed message again, as the same message. */
export async function retryDotMessage(requestId: string): Promise<void> {
  const send = state.pending.find((item) => item.requestId === requestId);
  if (send && (send.state === "failed" || send.state === "unknown")) await deliver(send);
}

const updatePending = (requestId: string, patch: Partial<PendingSend>) =>
  set({ pending: state.pending.map((send) => (send.requestId === requestId ? { ...send, ...patch } : send)) });

async function deliver(send: PendingSend): Promise<void> {
  updatePending(send.requestId, { state: "sending", error: undefined });
  try {
    if (!state.dot) throw new Error("还没有 Dot。");
    if (state.dot.paused) await setDotPaused(false);
    const dot = await withRoom(state.dot);
    const answer = await call<unknown>("POST", `${roomPath(dot.roomId)}/messages`, {
      content: { text: send.text, attachments: send.files.map((file) => ({ type: "file", file_id: file.fileId })) },
      request_id: send.requestId,
      idempotency_token: send.requestId,
      timezone_offset_min: new Date().getTimezoneOffset(),
      ...(send.replyTo ? { reply_to: { message_id: send.replyTo.id } } : {}),
      ...(send.metadata ? { message_metadata: send.metadata } : {}),
    });
    // The answer is the message itself; when it is, it replaces the one being sent at once.
    const sent = parseDotMessage({ request_id: send.requestId, ...obj(answer) }, state.room);
    if (sent && state.messages) set({ messages: mergeMessages(state.messages, [sent]) });
    updatePending(send.requestId, { state: "sent" });
    await loadDotMessages();
    set({ pending: state.pending.filter((item) => item.requestId !== send.requestId) });
  } catch (error) {
    // ChatGPT refused it (4xx): it did not land. Anything else may have.
    const refused = error instanceof CloudError && error.upstream && error.status < 500;
    updatePending(send.requestId, { state: refused ? "failed" : "unknown", error: errorMessage(error) });
    throw error;
  }
}

/** The dot's question answered with a choice: its text, in reply to the question (native-room). */
export async function answerDotOption(message: DotMessage, index: number): Promise<void> {
  const option = message.options?.options[index];
  if (option === undefined) return;
  await sendDotMessage({ text: option, replyTo: message, metadata: { option_picker: { selection: index } } });
}

export interface DotElicitation {
  fingerprint: string;
  /** The question (MCP elicitation `message`). */
  message: string;
  /** Flat fields a form can ask for, from `requestedSchema`. */
  fields: { name: string; title: string; type: "string" | "number" | "integer" | "boolean"; options: string[] | null; required: boolean }[];
  /** A request this page cannot answer (sign-ins, locations, user verification). */
  unsupported: boolean;
  /** Still waiting for an answer. */
  open: boolean;
}

/** What the dot asks in an elicitation message (`inspect`): fingerprint, question, form. */
export async function readDotElicitation(messageId: string): Promise<DotElicitation> {
  const roomId = state.dot?.roomId;
  if (!roomId) throw new Error("还没有 Dot。");
  const answer = obj(await call<unknown>("GET", `${roomPath(roomId)}/messages/${encodeURIComponent(messageId)}/elicitation${query({ inspect: "true" })}`));
  const params = obj(obj(answer.elicitation).params ?? answer.elicitation);
  const schema = obj(params.requestedSchema);
  const required = new Set(list(schema.required).filter((name): name is string => typeof name === "string"));
  const fields: DotElicitation["fields"] = [];
  let unsupported = !!str(params.mode) && str(params.mode) !== "form";
  for (const [name, raw] of Object.entries(obj(schema.properties))) {
    const field = obj(raw);
    const type = str(field.type);
    if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") {
      unsupported = true;
      continue;
    }
    const options = list(field.enum).filter((value): value is string => typeof value === "string");
    fields.push({ name, title: str(field.title) || str(field.description) || name, type, options: options.length ? options : null, required: required.has(name) });
  }
  return {
    fingerprint: str(answer.request_fingerprint),
    message: str(params.message),
    fields,
    unsupported,
    open: answer.can_respond === true && str(answer.runtime_status) === "pending",
  };
}

/** The answer to an elicitation; false when the room could not confirm it took it. */
export async function answerDotElicitation(messageId: string, fingerprint: string, action: "accept" | "decline", content?: Record<string, unknown>): Promise<boolean> {
  const roomId = state.dot?.roomId;
  if (!roomId) return false;
  const answer = obj(await call<unknown>("POST", `${roomPath(roomId)}/messages/${encodeURIComponent(messageId)}/elicitation/response`, {
    request_fingerprint: fingerprint,
    result: { action, ...(content ? { content } : {}) },
  }));
  return str(answer.status) === "applied";
}

export interface DotTranscript {
  state: "ready" | "empty" | "unavailable" | "notReady" | "error";
  messages: DotMessage[];
}

/** A call's transcript (transcript-panel): room messages, or why there are none. */
export async function loadDotTranscript(callId: string): Promise<DotTranscript> {
  const dot = state.dot;
  if (!dot) return { state: "unavailable", messages: [] };
  try {
    const answer = obj(await call<unknown>("GET", `${dotPath(dot.id)}/voice/calls/${encodeURIComponent(callId)}/transcript`));
    const messages = parseItems(list(answer.messages), state.room);
    return { state: answer.transcript_status === "unavailable" ? "unavailable" : messages.length ? "ready" : "empty", messages };
  } catch (error) {
    const status = error instanceof CloudError && error.upstream ? error.status : 0;
    return { state: status === 403 || status === 404 ? "unavailable" : status === 409 ? "notReady" : "error", messages: [] };
  }
}

export async function setDotPaused(paused: boolean): Promise<void> {
  if (!state.dot) return;
  await call("POST", `${dotPath(state.dot.id)}/runtime/${paused ? "pause" : "resume"}`);
  await refreshDot();
}

/** Calls of the profile panel (lib/dot-profile.ts): the same login, the same bridge. */
export const dotCall = call;
export { dotPath };

/** Running first, then the latest (side-panel `Ta`). */
const byActivity = (a: DotTask, b: DotTask) => Number(b.status === "running") - Number(a.status === "running") || b.updatedAt - a.updatedAt;

export async function loadDotActivity(): Promise<void> {
  if (!state.dot) return;
  try {
    const answer = obj(await call<unknown>("GET", `${dotPath(state.dot.id)}/activity${query({ limit: 5 })}`));
    set({ activity: list(answer.data).map(parseDotTask).filter((task) => task.id).sort(byActivity) });
  } catch {
    // The list is a side note: it stays as it was.
  }
}

/** One event of the activity stream (side-panel): `snapshot` reloads the list, `upsert` and `remove` change one task. */
export function applyActivityEvent(type: string, data: unknown): void {
  if (type === "snapshot") return void loadDotActivity();
  if (!state.activity) return;
  if (type === "upsert") {
    const task = parseDotTask(data);
    if (task.id) set({ activity: [task, ...state.activity.filter((item) => item.id !== task.id)].sort(byActivity) });
  } else if (type === "remove") {
    const id = str(obj(data).thread_id);
    set({ activity: state.activity.filter((item) => item.id !== id) });
  }
}

/** The read mark at the latest message the room has. */
export function markDotRead(): void {
  const roomId = state.dot?.roomId;
  const last = state.messages?.at(-1)?.createdAt;
  if (roomId && last && last !== state.room?.lastReadAt) {
    if (state.room) set({ room: { ...state.room, lastReadAt: last } });
    void call("POST", `${roomPath(roomId)}/read`, { last_read_at: last }).catch(() => {});
  }
}

let typingSentAt = 0;
let prepareAfter = 0;

/**
 * The user is typing: the room hears it (a responding heartbeat, at most every 5 s, as the desktop
 * app's sendTyping) and gets the dot's context ready once (aeon/prepare); a busy or conflicting
 * room is asked again after 30 s.
 */
export function noteDotTyping(): void {
  const roomId = state.dot?.roomId;
  if (!roomId) return;
  const now = Date.now();
  if (now - typingSentAt >= 5_000) {
    typingSentAt = now;
    void call("POST", `${roomPath(roomId)}/responding_heartbeat`).catch(() => {});
  }
  if (!route.value && now >= prepareAfter) {
    prepareAfter = now + 30_000;
    void call("POST", `${roomPath(roomId)}/aeon/prepare`).catch(() => {});
  }
}

const TYPING_MS = 8_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Refreshes the latest page soon, once for a burst of events. */
function refreshSoon(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadDotMessages();
  }, 150);
}

/**
 * One event from the pubsub socket (server/celsius.mjs), as the desktop app reacts to it (fHt):
 * new or changed messages refresh the room, read receipts and the dot's typing update at once,
 * room changes reload its snapshot, a reconnect resynchronizes everything.
 */
export function applyDotEvent(event: { type?: unknown; payload?: unknown }): void {
  const roomId = state.dot?.roomId;
  if (!roomId) return;
  const payload = obj(event.payload);
  const type = str(event.type);
  if (type === "resync") {
    void loadRoom(roomId);
    refreshSoon();
    return;
  }
  const room = str(payload.room_id) || str(obj(payload.room).id);
  if (room !== roomId) return;
  switch (type) {
    case "calpico-message-add":
    case "calpico-message-task-associated":
      set({ typingUntil: 0 });
      refreshSoon();
      break;
    case "calpico-message-update": {
      const id = str(payload.message_id);
      if (id && state.messages?.length && !state.messages.some((message) => message.id === id) && time(state.messages[0].createdAt)) void loadDotMessage(roomId, id).catch(() => {});
      else refreshSoon();
      break;
    }
    case "calpico-room-read-receipt":
      if (state.room && str(payload.account_user_id) && str(payload.last_read_at)) {
        set({ room: { ...state.room, receipts: { ...state.room.receipts, [str(payload.account_user_id)]: str(payload.last_read_at) } } });
      }
      break;
    case "calpico-is-responding-heartbeat": {
      const from = str(obj(payload.source).account_user_id);
      if (from && from === state.room?.selfId) break;
      set({ typingUntil: payload.typing === false ? 0 : Date.now() + TYPING_MS });
      break;
    }
    case "calpico-room-update":
    case "calpico-room-metadata-update":
      void loadRoom(roomId);
      break;
  }
}

/** Whether the socket is up (polling slows down while it is). */
export const setDotsLive = (live: boolean) => set({ live });

/** Who wrote a message, in words: 你, the dot's or a member's name. */
export function senderName(message: DotMessage, room: DotRoom | null, dotName: string | null = state.dot?.name ?? null): string {
  if (message.sender === "self") return "你";
  if (message.sender === "dot") return dotName ?? (room?.members[message.senderId]?.name || "你的 Dot");
  return room?.members[message.senderId]?.name || "参与者";
}

/** A file for the dot's room: uploaded through the bridge, then attached by its id. */
export async function uploadDotFile(file: File): Promise<DotAttachment> {
  const id = connectionId();
  if (!id || !state.dot) throw new Error("还没有 Dot。");
  const dot = await withRoom(state.dot);
  const params = new URLSearchParams({ c: id, path: `${roomPath(dot.roomId)}/files`, name: file.name, type: file.type || "application/octet-stream" });
  const response = await fetch(`/api/dots/upload?${params}`, { method: "POST", body: file });
  if (!response.ok) throw new CloudError(response.status, (await response.text()) || "无法上传此文件");
  const answer = obj(cloudAnswer<unknown>((await response.json()) as CloudAnswer, "ChatGPT"));
  if (!str(answer.id)) throw new Error("无法上传此文件");
  return { ...parseAttachment({ type: "file", file_id: str(answer.id), name: file.name, mime_type: file.type, size_bytes: file.size }) };
}

/** The bridge's stream of a ChatGPT file URL (`name` names a download). */
export const dotContentUrl = (url: string, name = "") => {
  const id = connectionId();
  return id && url ? `/api/dots/content?${new URLSearchParams({ c: id, url, name })}` : "";
};

const fileUrls = new Map<string, Promise<{ url: string; name: string; mime: string }>>();

/** A room file's bytes, through the bridge (the room hands out a download URL for it). */
export function dotFile(fileId: string): Promise<{ url: string; name: string; mime: string }> {
  const roomId = state.dot?.roomId;
  if (!roomId) return Promise.reject(new Error("还没有 Dot。"));
  const key = `${roomId}/${fileId}`;
  let found = fileUrls.get(key);
  if (!found) {
    found = call<unknown>("GET", `${roomPath(roomId)}/files/${encodeURIComponent(fileId)}`).then((raw) => {
      const file = obj(raw);
      const name = str(file.name) || "attachment";
      return { url: dotContentUrl(str(file.download_url), name), name, mime: str(file.mime_type).toLowerCase() };
    });
    found.catch(() => fileUrls.delete(key));
    fileUrls.set(key, found);
  }
  return found;
}

/** Signed out or switched accounts: nothing of the old account's dot stays on screen. */
export function resetDots(): void {
  route.value = undefined;
  typingSentAt = 0;
  prepareAfter = 0;
  fileUrls.clear();
  set(EMPTY);
}
