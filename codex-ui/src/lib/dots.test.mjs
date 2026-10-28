// Run with `pnpm test`. dots.ts against a fake ChatGPT behind a fake bridge: fetch answers
// /api/cloud as server/bridge.mjs does ({ status, body }) and /api/dots/available with its
// boolean, and "./codex" is a stub, so no app-server, login or network is involved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";
import { cloudAllowed } from "../../server/cloud.mjs";

globalThis.__dotsCodexStub = {
  connectionId: () => "conn-1",
  callExperimental: async () => {},
  errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
};
const STUB = `data:text/javascript,${encodeURIComponent("const s = globalThis.__dotsCodexStub; export const connectionId = s.connectionId, callExperimental = s.callExperimental, errorMessage = s.errorMessage;")}`;
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === "./codex" && /\/(cloud|dots)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const dots = await import("./dots.ts");

/**
 * A fake ChatGPT: `routes` maps "METHOD path" to a body or (body) => [status, body] (a status of
 * 0 is the bridge failing); every call is logged.
 */
function chatgpt(t, routes, { available = true, accountUserId } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/dots/available?c=conn-1") return new Response(JSON.stringify({ available, ...(accountUserId ? { accountUserId } : {}) }), { status: 200 });
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body, threadRoute } = JSON.parse(init.body);
    calls.push({ method, path, body, threadRoute });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? route(body) : [200, route];
    if (status === 0) return new Response("无法连接 Codex Cloud（socket hang up）", { status: 502 });
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const reply = (parts, extra = {}) => ({ author: { role: "assistant" }, content: { content_type: "text", parts }, ...extra });

/** A dot's DM room as the desktop app reads it: the user, and the dot with its aeon_id. */
const ROOM = {
  id: "room_1",
  type: "DM",
  app_source: "chatgpt:messaging",
  aeon_id: "tbo_1",
  members: [
    { account_user_id: "user-me", aeon_id: null, name: "" },
    { account_user_id: "user-dot", aeon_id: "tbo_1", name: "", avatar_url: "https://chatgpt.com/backend-api/files/download/file_dot" },
  ],
  member_profile_snapshots: [{ account_user_id: "user-dot", name: "Nova" }],
  read_receipts: [{ account_user_id: "user-dot", last_read_at: "2026-10-26T08:00:03Z" }],
  last_read_at: "2026-10-26T07:00:00Z",
};

test("a room tells the dot from the user by its members: the dot is the one with the room's aeon_id", () => {
  const room = dots.parseRoom(ROOM);
  assert.equal(room.dotUserId, "user-dot");
  assert.equal(room.selfId, "user-me");
  assert.equal(room.members["user-dot"].name, "Nova");
  assert.equal(room.members["user-dot"].avatarUrl, "https://chatgpt.com/backend-api/files/download/file_dot");
  assert.deepEqual(room.receipts, { "user-dot": "2026-10-26T08:00:03Z" });
  // The token's own account user id wins over the guess.
  assert.equal(dots.parseRoom(ROOM, "user-token").selfId, "user-token");
});

test("the dot's replies carry its account user id too, and still read as the dot's", () => {
  const room = dots.parseRoom(ROOM);
  const read = (raw) => dots.parseDotMessage({ id: "m", created_at: "t", ...raw }, room);
  // The bug this fixes: every message with an account_user_id read as the user's own.
  assert.equal(read({ account_user_id: "user-dot", content: { text: "好的。" } }).sender, "dot");
  assert.equal(read({ account_user_id: "user-me", content: { text: "你好" } }).sender, "self");
  assert.equal(read({ account_user_id: "user-other", content: { text: "我也在" } }).sender, "member");
  assert.equal(read({ account_user_id: "user-me", is_task_update: true, content: { text: "任务更新" } }).sender, "dot");
  assert.equal(read({ account_user_id: "user-x", is_self: true, content: { text: "另一台设备" } }).sender, "self");
  // A text in from outside says which way it went.
  assert.equal(read({ account_user_id: "user-dot", external_message_channel: "imessage", external_message_metadata: { direction: "from_user" }, content: { text: "短信" } }).sender, "self");
  assert.equal(read({ account_user_id: "user-dot", external_message_metadata: { direction: "to_user" }, content: { text: "回短信" } }).sender, "dot");
  // Without the room, the token's id alone still tells them apart.
  assert.equal(dots.parseDotMessage({ id: "m", account_user_id: "user-dot", content: { text: "x" } }, { ...dots.parseRoom({}), selfId: "user-me" }).sender, "member");
});

test("room messages: ChatGPT's own replies, system notes, attachments, questions, quotes", () => {
  assert.deepEqual(dots.parseDotMessage({
    id: "m1",
    created_at: "2026-10-26T08:00:00Z",
    raw_messages: [
      reply(["先看一下日程。"]),
      reply(["思考过程"], { channel: "analysis" }),
      reply(["隐藏"], { metadata: { is_hidden: true } }),
      { author: { role: "tool" }, content: { content_type: "text", parts: ["工具输出"] } },
      { author: { role: "assistant" }, content: { content_type: "multimodal_text", parts: [{ text: "已经" }, "安排好了。"] } },
    ],
  }), {
    id: "m1", sender: "dot", senderId: "", text: "先看一下日程。\n\n已经\n\n安排好了。", createdAt: "2026-10-26T08:00:00Z", deleted: false, channel: null,
    attachments: [], replyTo: null, rootId: null, options: null, selection: undefined, elicitation: false, generating: false, requestId: "",
  });
  assert.equal(dots.parseDotMessage({ id: "m3", content: { text: "Dot 已重启" } }).sender, "system");
  assert.equal(dots.parseDotMessage({ id: "m4", content: { type: "notice" }, preview: "已连接日历" }).text, "已连接日历");
  const deleted = dots.parseDotMessage({ id: "m6", account_user_id: "u", content: { text: "删掉了" }, deleted_at: "t" });
  assert.deepEqual([deleted.deleted, deleted.text], [true, ""]);
  for (const skipped of [
    { id: "m5", content: { type: "message_error", text: "failed" } },
    { id: "m7", raw_messages: [reply(["只有分析"], { channel: "analysis" })] },
    { account_user_id: "u", content: { text: "没有 id" } },
  ]) assert.equal(dots.parseDotMessage(skipped), null);

  const room = dots.parseRoom(ROOM);
  const full = dots.parseDotMessage({
    id: "m8", account_user_id: "user-dot", created_at: "t", request_id: "r8",
    external_message_channel: "sms",
    content: { text: "通话摘要", attachments: [
      { type: "call", call_id: "call_1", call_type: "juno", duration_ms: 125000, outcome: "completed" },
      { type: "thread", thread_id: "th_9", title: "订机票" },
      { type: "file", file_id: "file_1", name: "a.png", mime_type: "Image/PNG", size_bytes: 10 },
    ] },
    message_metadata: { option_picker: { options: ["好", "", "不"], selected: 1 } },
    reply_to: { message_id: "m2", message: { content: { text: "原话" }, sender: { name: "我" } } },
    reply_root_message_id: "m2",
    generation: { status: "in_progress" },
  }, room);
  assert.equal(full.channel, "sms");
  assert.deepEqual(full.attachments.map((item) => [item.kind, item.callId || item.threadId || item.fileId]), [["call", "call_1"], ["thread", "th_9"], ["file", "file_1"]]);
  assert.equal(full.attachments[2].mime, "image/png");
  assert.deepEqual(full.options, { options: ["好", "不"], selected: 1 });
  assert.deepEqual(full.replyTo, { id: "m2", text: "原话", author: "我" });
  assert.equal(full.rootId, "m2");
  assert.equal(full.generating, true);
  assert.equal(full.requestId, "r8");
});

const msg = (id, sender, minute, extra = {}) => ({
  id, sender, senderId: sender === "dot" ? "user-dot" : sender === "self" ? "user-me" : "user-x", text: id, createdAt: new Date(Date.UTC(2026, 9, 26, 8, minute)).toISOString(),
  deleted: false, channel: null, attachments: [], replyTo: null, rootId: null, options: null, selection: undefined, elicitation: false, generating: false, requestId: "", ...extra,
});

test("rows: time dividers past 30 minutes, the new-messages mark, groups by sender, replies under their message", () => {
  const messages = [
    msg("a", "self", 0), msg("b", "dot", 1), msg("c", "dot", 2), msg("d", "self", 45),
    msg("e", "dot", 46), msg("f", "dot", 47, { rootId: "e" }), msg("g", "dot", 48, { channel: "sms" }),
  ];
  const rows = dots.layoutRows(messages, { unreadAfter: messages[3].createdAt });
  assert.deepEqual(rows.map((row) => row.kind === "message" ? `${row.message.id}${row.first ? "*" : ""}${row.replies ? `+${row.replies}` : ""}` : row.kind), [
    "time", "a*", "b*", "c", "time", "d*", "unread", "e*+1", "g*",
  ]);
});

test("the receipt: on your last message only while nobody has written since", () => {
  const room = dots.parseRoom(ROOM);
  const sent = msg("a", "self", 0);
  assert.deepEqual(dots.receiptOf([sent], room), { id: "a", receipt: { kind: "read", at: "2026-10-26T08:00:03Z" } });
  assert.deepEqual(dots.receiptOf([{ ...sent, createdAt: "2026-10-26T09:00:00Z" }], room).receipt, { kind: "delivered" });
  assert.equal(dots.receiptOf([sent, msg("b", "dot", 1)], room), null);
  assert.deepEqual(dots.receiptOf([{ ...sent, state: "failed", error: "x" }], room).receipt, { kind: "failed", error: "x" });
  assert.equal(dots.receiptOf([{ ...sent, state: "sending" }], room), null);
});

test("merging keeps ids unique and the order by time; a question's choice comes from its answer", () => {
  const merged = dots.mergeMessages([msg("b", "dot", 1), msg("a", "self", 0)], [{ ...msg("b", "dot", 1), text: "改过" }, msg("c", "self", 2)]);
  assert.deepEqual(merged.map((message) => `${message.id}:${message.text}`), ["a:a", "b:改过", "c:c"]);
  const question = msg("q", "dot", 0, { options: { options: ["A", "B"] } });
  assert.equal(dots.optionState(question, [question]), undefined);
  assert.equal(dots.optionState(question, [question, msg("r", "self", 1, { replyTo: { id: "q", text: "", author: "" }, selection: 1 })]), 1);
  assert.equal(dots.optionState({ ...question, options: { options: ["A", "B"], selected: 0 } }, [question]), 0);
});

test("a message to a paused dot without a room resumes it, opens the room, then sends", async (t) => {
  dots.resetDots();
  let paused = true;
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit", is_paused: true, active_root_thread_id: "th_1" }], cursor: null },
    "GET /tbo/primary": () => [404, { detail: "Not Found" }],
    "POST /tbo/tbo_1/runtime/resume": () => { paused = false; return [200, { thread_id: "th_1", status: "applied" }]; },
    "GET /tbo/tbo_1": () => [200, { id: "tbo_1", is_paused: paused }],
    "POST /tbo/tbo_1/messaging-room": { id: "tbo_1", messaging_room_id: "room_1" },
    "POST /messaging/rooms/room_1/messages": { id: "msg_1" },
    "GET /messaging/rooms/room_1/messages?limit=20": { items: [
      { id: "msg_1", account_user_id: "user-me", request_id: "x", content: { text: "你好" }, created_at: "2026-10-26T08:00:00Z" },
      { id: "msg_2", account_user_id: "user-dot", content: { text: "好的。" }, created_at: "2026-10-26T08:00:05Z" },
    ], prev_cursor: null, next_cursor: null },
  });
  await dots.loadDot();
  assert.deepEqual(dots.dotsState().dot, { id: "tbo_1", name: null, paused: true, roomId: null });
  await dots.openDotRoom();
  assert.deepEqual(dots.dotsState().messages, []);
  await dots.sendDotMessage({ text: "你好" });
  assert.deepEqual(calls.slice(2).map(({ method, path }) => `${method} ${path}`), [
    "POST /tbo/tbo_1/runtime/resume",
    "GET /tbo/tbo_1",
    "POST /tbo/tbo_1/messaging-room",
    "POST /messaging/rooms/room_1/messages",
    "GET /messaging/rooms/room_1/messages?limit=20",
  ]);
  const sent = calls[5].body;
  assert.deepEqual(sent.content, { text: "你好", attachments: [] });
  assert.equal(sent.idempotency_token, sent.request_id);
  assert.equal(typeof sent.timezone_offset_min, "number");
  assert.deepEqual(dots.dotsState().dot, { id: "tbo_1", name: null, paused: false, roomId: "room_1" });
  assert.deepEqual(dots.dotsState().pending, []);
  // Oldest first; a poll that brings nothing new keeps the same list.
  const messages = dots.dotsState().messages;
  assert.deepEqual(messages.map((message) => message.text), ["你好", "好的。"]);
  await dots.loadDotMessages();
  assert.equal(dots.dotsState().messages, messages);
  dots.markDotRead();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1), { method: "POST", path: "/messaging/rooms/room_1/read", body: { last_read_at: "2026-10-26T08:00:05Z" }, threadRoute: undefined });
});

/** A dot with a room, its snapshot and a first page loaded. */
async function openRoom(t, routes, accountUserId = "user-me") {
  dots.resetDots();
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit", display_name: "Nova", messaging_room_id: "room_1" }] },
    "GET /tbo/primary": () => [404, {}],
    "GET /messaging/rooms/room_1": ROOM,
    ...routes,
  }, { accountUserId });
  await dots.refreshDotsAvailable();
  await dots.loadDot();
  await dots.openDotRoom();
  return calls;
}

test("opening the room: the snapshot names who is who, the read mark stays as the room opened", async (t) => {
  const page = Array.from({ length: 20 }, (_, i) => ({ id: `m${i + 10}`, account_user_id: i % 2 ? "user-dot" : "user-me", content: { text: `第 ${i + 10} 条` }, created_at: new Date(Date.UTC(2026, 9, 26, 8, i + 10)).toISOString() }));
  const older = Array.from({ length: 5 }, (_, i) => ({ id: `m${i + 5}`, account_user_id: "user-dot", content: { text: `第 ${i + 5} 条` }, created_at: new Date(Date.UTC(2026, 9, 26, 8, i + 5)).toISOString() }));
  await openRoom(t, {
    "GET /messaging/rooms/room_1/messages?limit=20": { items: page, prev_cursor: "cur_9" },
    "GET /messaging/rooms/room_1/messages?limit=20&before=cur_9": { items: older, prev_cursor: null },
  });
  const state = dots.dotsState();
  assert.equal(state.accountUserId, "user-me");
  assert.equal(state.room.dotUserId, "user-dot");
  assert.equal(state.unreadAfter, ROOM.last_read_at);
  assert.equal(state.olderCursor, "cur_9");
  assert.deepEqual(state.messages.slice(0, 2).map((message) => message.sender), ["self", "dot"]);
  await dots.loadOlderDotMessages();
  assert.equal(dots.dotsState().messages.length, 25);
  assert.equal(dots.dotsState().messages[0].id, "m5");
  assert.equal(dots.dotsState().olderCursor, null);
});

test("a send ChatGPT refuses fails; one the bridge lost is unconfirmed; both retry as the same message", async (t) => {
  let answer = [400, { detail: "Message too long" }];
  const calls = await openRoom(t, {
    "GET /messaging/rooms/room_1/messages?limit=20": { items: [] },
    "POST /messaging/rooms/room_1/messages": () => answer,
  });
  await assert.rejects(dots.sendDotMessage({ text: "一" }));
  let [pending] = dots.dotsState().pending;
  assert.equal(pending.state, "failed");
  assert.match(pending.error, /Message too long/);
  const shown = dots.shownMessages([], dots.dotsState().pending);
  assert.deepEqual(shown.map((message) => [message.sender, message.state]), [["self", "failed"]]);
  answer = [0];
  await assert.rejects(dots.retryDotMessage(pending.requestId));
  assert.equal(dots.dotsState().pending[0].state, "unknown");
  answer = [200, { id: "msg_9" }];
  await dots.retryDotMessage(pending.requestId);
  const sends = calls.filter((call) => call.method === "POST" && call.path.endsWith("/messages"));
  assert.equal(sends.length, 3);
  assert.equal(new Set(sends.map((call) => call.body.request_id)).size, 1);
  assert.deepEqual(dots.dotsState().pending, []);
});

test("answers: a choice replies to its question; files go by id; the thread route comes back", async (t) => {
  const calls = await openRoom(t, {
    "GET /messaging/rooms/room_1/messages?limit=20": { items: [] },
    "POST /messaging/rooms/room_1/messages": { id: "msg_2" },
  });
  const question = dots.parseDotMessage({ id: "q1", account_user_id: "user-dot", content: { text: "选哪个？" }, message_metadata: { option_picker: { options: ["周一", "周二"] } } }, dots.dotsState().room);
  await dots.answerDotOption(question, 1);
  const sent = calls.at(-2).body;
  assert.deepEqual([sent.content.text, sent.reply_to, sent.message_metadata], ["周二", { message_id: "q1" }, { option_picker: { selection: 1 } }]);
  await dots.sendDotMessage({ text: "", files: [dots.parseAttachment({ type: "file", file_id: "file_7", name: "a.pdf" })] });
  assert.deepEqual(calls.at(-2).body.content.attachments, [{ type: "file", file_id: "file_7" }]);
});

test("pubsub events: receipts and typing update at once, new messages refresh, other rooms are ignored", async (t) => {
  const calls = await openRoom(t, { "GET /messaging/rooms/room_1/messages?limit=20": { items: [{ id: "m1", account_user_id: "user-me", content: { text: "在吗" }, created_at: "2026-10-26T09:00:00Z" }] } });
  dots.applyDotEvent({ type: "calpico-room-read-receipt", payload: { room_id: "room_1", account_user_id: "user-dot", last_read_at: "2026-10-26T09:00:01Z" } });
  assert.deepEqual(dots.receiptOf(dots.dotsState().messages, dots.dotsState().room).receipt, { kind: "read", at: "2026-10-26T09:00:01Z" });
  dots.applyDotEvent({ type: "calpico-is-responding-heartbeat", payload: { room_id: "room_1", typing: true, source: { role: "user", account_user_id: "user-dot" } } });
  assert.ok(dots.dotsState().typingUntil > Date.now());
  dots.applyDotEvent({ type: "calpico-is-responding-heartbeat", payload: { room_id: "room_1", typing: true, source: { role: "user", account_user_id: "user-me" } } });
  dots.applyDotEvent({ type: "calpico-message-add", payload: { room_id: "room_1", message: { role: "user" } } });
  assert.equal(dots.dotsState().typingUntil, 0);
  const before = calls.length;
  dots.applyDotEvent({ type: "calpico-message-add", payload: { room_id: "room_other" } });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(calls.slice(before).map((call) => call.path), ["/messaging/rooms/room_1/messages?limit=20"]);
});

test("a call's transcript, and what an unavailable one says", async (t) => {
  let status = 200;
  await openRoom(t, {
    "GET /messaging/rooms/room_1/messages?limit=20": { items: [] },
    "GET /tbo/tbo_1/voice/calls/call_1/transcript": () => [status, { transcript_status: "ready", messages: [{ id: "t1", account_user_id: "user-dot", content: { text: "你好，我是 Nova" } }] }],
  });
  const ready = await dots.loadDotTranscript("call_1");
  assert.deepEqual([ready.state, ready.messages[0].sender], ["ready", "dot"]);
  status = 409;
  assert.equal((await dots.loadDotTranscript("call_1")).state, "notReady");
  status = 404;
  assert.equal((await dots.loadDotTranscript("call_1")).state, "unavailable");
});

test("an elicitation's form comes from its schema; sign-ins and the like are not answered here", async (t) => {
  const calls = await openRoom(t, {
    "GET /messaging/rooms/room_1/messages?limit=20": { items: [] },
    "GET /messaging/rooms/room_1/messages/m1/elicitation?inspect=true": { request_fingerprint: "fp1", can_respond: true, runtime_status: "pending", elicitation: { params: {
      message: "要订哪天？", requestedSchema: { properties: { day: { type: "string", enum: ["周一", "周二"], title: "日期" }, seats: { type: "integer" } }, required: ["day"] },
    } } },
    "GET /messaging/rooms/room_1/messages/m2/elicitation?inspect=true": { request_fingerprint: "fp2", can_respond: true, runtime_status: "pending", elicitation: { params: { mode: "openai/userVerification", message: "验证身份" } } },
    "POST /messaging/rooms/room_1/messages/m1/elicitation/response": { status: "applied" },
  });
  const form = await dots.readDotElicitation("m1");
  assert.deepEqual(form.fields.map((field) => [field.name, field.type, field.options, field.required]), [["day", "string", ["周一", "周二"], true], ["seats", "integer", null, false]]);
  assert.equal(form.open, true);
  assert.equal((await dots.readDotElicitation("m2")).unsupported, true);
  assert.equal(await dots.answerDotElicitation("m1", "fp1", "accept", { day: "周二", seats: 2 }), true);
  assert.deepEqual(calls.at(-1).body, { request_fingerprint: "fp1", result: { action: "accept", content: { day: "周二", seats: 2 } } });
});

test("the primary dot is the one /tbo/primary names, else the first one standing", () => {
  const items = [
    { id: "tbo_gone", status: "deleting", active_root_thread_id: "th_0" },
    { id: "tbo_other", aeon_kind: "assistant" },
    { id: "tbo_a", status: "active", aeon_kind: "orbit", display_name: " ", active_root_thread_id: "th_a" },
    { id: "tbo_b", status: "active", aeon_kind: "orbit", display_name: "Nova", active_root_thread_id: "th_b", messaging_room_id: "room_b", is_paused: true },
  ];
  assert.deepEqual(dots.pickDot(items, { thread_id: "th_b" }), { id: "tbo_b", name: "Nova", paused: true, roomId: "room_b" });
  assert.equal(dots.pickDot(items, { thread_id: "th_x", aeon_id: "tbo_b" }).id, "tbo_b");
  assert.deepEqual(dots.pickDot(items, null), { id: "tbo_a", name: null, paused: false, roomId: null });
  assert.equal(dots.pickDot(items, { thread_id: "th_0" }).id, "tbo_a");
  assert.equal(dots.pickDot(items.slice(0, 2), null), null);
});

test("availability, creation and the activity list", async (t) => {
  dots.resetDots();
  chatgpt(t, {}, { available: false });
  await dots.refreshDotsAvailable();
  assert.equal(dots.dotsState().available, false);
  t.mock.restoreAll();
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [], cursor: null },
    "POST /tbo": { id: "tbo_new", display_name: "", root_thread_id: "th_new" },
    "POST /tbo/tbo_new/messaging-room": { id: "tbo_new", messaging_room_id: "room_new" },
    "GET /tbo/tbo_new/activity?limit=5": { data: [
      { thread_id: "th_done", title: "整理收件箱", emoji: "📬", status: "completed", outcome: "succeeded", updated_at: 200 },
      { thread_id: "th_run", title: null, preview: { text: "正在订机票" }, status: "in_progress", outcome: null, updated_at: 100 },
      { thread_id: "th_fail", title: "", status: "completed", outcome: "failed", updated_at: 300 },
    ], next_cursor: null },
  });
  await dots.refreshDotsAvailable();
  assert.equal(dots.dotsState().available, true);
  await dots.loadDot();
  assert.equal(dots.dotsState().dot, null);
  await dots.createDot();
  assert.deepEqual(calls.find((call) => call.path === "/tbo" && call.method === "POST").body, { display_name: "", create_thread: true, should_initialize: true });
  assert.deepEqual(dots.dotsState().dot, { id: "tbo_new", name: null, paused: false, roomId: "room_new" });
  assert.equal(dots.dotsState().creating, false);
  await dots.loadDotActivity();
  assert.deepEqual(dots.dotsState().activity.map(({ id, title, status, updatedAt }) => [id, title, status, updatedAt]), [
    ["th_run", "正在订机票", "running", 100],
    ["th_fail", "未命名任务", "failed", 300],
    ["th_done", "整理收件箱", "succeeded", 200],
  ]);
  t.mock.restoreAll();
  chatgpt(t, { "POST /tbo": () => [403, { detail: "Dots require a Pro plan" }] });
  dots.resetDots();
  await dots.createDot();
  assert.match(dots.dotsState().createError, /^ChatGPT 返回错误（403）：Dots require a Pro plan$/);
});
