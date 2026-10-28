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
    if (specifier === "./codex" && /\/(cloud|dots|dot-profile)\.ts$/.test(context.parentURL ?? "")) return { url: STUB, shortCircuit: true };
    return next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context);
  },
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const dots = await import("./dots.ts");
const profile = await import("./dot-profile.ts");

/**
 * A fake ChatGPT: `routes` maps "METHOD path" to a body or (body) => [status, body] (a status of
 * 0 is the bridge failing); every call is logged.
 */
function chatgpt(t, routes, { available = true, accountUserId } = {}) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/dots/available?c=conn-1") return new Response(JSON.stringify({ available, ...(accountUserId ? { accountUserId } : {}) }), { status: 200 });
    if (url.startsWith("/api/dots/upload?")) {
      const params = new URL(url, "http://x").searchParams;
      calls.push({ method: "UPLOAD", path: params.get("path"), body: { fields: JSON.parse(params.get("fields") ?? "{}"), type: params.get("type"), size: init.body.size } });
      const route = routes[`UPLOAD ${params.get("path")}`];
      return new Response(JSON.stringify({ status: 200, body: route ?? {} }), { status: 200 });
    }
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body, threadRoute, idempotencyKey } = JSON.parse(init.body);
    calls.push({ method, path, body, threadRoute, ...(idempotencyKey ? { idempotencyKey } : {}) });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? route(body) : [200, route];
    if (status === 0) return new Response("无法连接 Codex Cloud（socket hang up）", { status: 502 });
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

/** A dot's identity and state, without its avatar and the rest. */
const brief = (dot) => dot && { id: dot.id, name: dot.name, paused: dot.paused, roomId: dot.roomId };

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
  assert.deepEqual(brief(dots.dotsState().dot), { id: "tbo_1", name: null, paused: true, roomId: null });
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
  assert.deepEqual(brief(dots.dotsState().dot), { id: "tbo_1", name: null, paused: false, roomId: "room_1" });
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
  assert.deepEqual(brief(dots.pickDot(items, { thread_id: "th_b" })), { id: "tbo_b", name: "Nova", paused: true, roomId: "room_b" });
  assert.equal(dots.pickDot(items, { thread_id: "th_x", aeon_id: "tbo_b" }).id, "tbo_b");
  assert.deepEqual(brief(dots.pickDot(items, null)), { id: "tbo_a", name: null, paused: false, roomId: null });
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
  assert.deepEqual(dots.dotsState().dots.map((dot) => dot.id), ["tbo_new"]);
  assert.deepEqual(brief(dots.dotsState().dot), { id: "tbo_new", name: null, paused: false, roomId: "room_new" });
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

// ---------------------------------------------------------------------------
// The profile panel (dot-profile.ts)

test("a character's appearance survives its bytes, and a plain ring saves as the studio donut", () => {
  const ring = profile.appearanceBytes(profile.ringAppearance("pink"));
  assert.deepEqual([...ring.subarray(0, 8)], [...Buffer.from("ORBAST1\0")]);
  assert.deepEqual(profile.appearanceOf(ring), {
    schemaVersion: 1, shape: "circle", color: "pink", eyes: "oval", eyewear: "none", accessories: [], accessoryColors: {}, depth: 0.5, studioShape: "donut",
  });
  // A saved donut opens as the ring it was made from.
  assert.deepEqual(profile.appearanceBytes({ shape: "circle", color: "pink", eyes: "oval", eyewear: "none", accessories: [], studioShape: "donut", depth: 0.5 }), ring);
  const character = {
    schemaVersion: 3, shape: "rounded_triangle", color: "teal", eyes: "oval", eyewear: "round_sunglasses", accessories: ["beanie", "halo"],
    accessoryColors: { beanie: "red", halo: "gold" }, depth: 0.75,
    model: {
      body: { variant: "tall", scale: [1, 1.25, 1], upperStart: 0.5, upperScale: 0.75, volume: { halfDepth: 0.5, shoulderFullness: 1, lobes: [{ center: [0.25, 0.5], radius: [0.5, 0.25], strength: 0.5 }] } },
      eyes: [{ position: [0.25, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], reflectX: false, surfaceRelative: true }, { position: [-0.25, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], reflectX: true, surfaceRelative: true }],
      eyeMount: "body", closedLidScale: [1, 1, 1], pupilScale: [0.5, 0.5, 0.5], eyewear: { offset: [0, 0.25, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, eyewearBridge: true,
      accessories: { beanie: { offset: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }, materials: { body: { albedo: [0.5, 0.25, 0.75], roughness: 0.5 } },
      headphones: { top: 0.5, cushionScale: [1, 1, 1], bandThicknessScale: 1.5 }, eyewearVariant: "round_sunglasses_no_sidecaps", restingEyeClosure: 0.25, eyewearSurfaceAlignment: 1, eyeGazeScale: [1, 0.5],
    },
    hereCharacter: { id: "here_1", name: "Pip" },
  };
  assert.deepEqual(profile.appearanceOf(profile.appearanceBytes(character)), character);
  assert.equal(profile.appearanceBytes({ shape: "circle" }), null);
  assert.throws(() => profile.appearanceOf(Buffer.from("ORBAST2")), /header/);
});

test("the status line, the nickname rule and what counts as a safety pause", () => {
  const now = Date.UTC(2026, 9, 29, 12);
  assert.equal(profile.statusLine({ paused: false }, undefined, null, now), "活跃");
  assert.equal(profile.statusLine({ paused: false }, undefined, now - 3 * 3600_000, now), "上次活跃：3 小时前");
  assert.equal(profile.statusLine({ paused: true }, undefined, null, now), "已暂停");
  assert.equal(profile.statusLine({ paused: true }, now - 30_000, null, now), "刚刚已暂停");
  assert.equal(profile.statusLine({ paused: true }, now - 5 * 60_000, null, now), "已于 5 分钟前 暂停");
  assert.ok(profile.validName("一二三四五六七八九十一二三四五六七八九十一二三四"));
  assert.ok(!profile.validName("一二三四五六七八九十一二三四五六七八九十一二三四五"));
  assert.ok(!profile.validName("a\\b"));
  const dot = dots.parseDot({ id: "tbo_1", is_paused: true, pause_reason: "guardian_circuit_breaker" });
  assert.ok(profile.safetyPause(dot));
  assert.ok(!profile.safetyPause({ ...dot, pauseReason: null }));
  assert.equal(profile.meetingUrl(" https://meet.google.com/abc-defg-hij "), "https://meet.google.com/abc-defg-hij");
  assert.equal(profile.meetingUrl("http://meet.google.com/abc-defg-hij"), null);
});

test("pausing reads the dot back by the thread the runtime names; an unconfirmed pause says so", async (t) => {
  dots.resetDots();
  profile.resetProfiles();
  let paused = false;
  chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit", active_root_thread_id: "th_1" }] },
    "GET /tbo/primary": () => [404, {}],
    "POST /tbo/tbo_1/runtime/pause": () => { paused = true; return [200, { status: "applied", thread_id: "th_2" }]; },
    "GET /tbo/by-thread/th_2": () => [200, { id: "tbo_1", aeon_kind: "orbit", active_root_thread_id: "th_2", is_paused: paused }],
  });
  await dots.loadDot();
  await profile.setPaused(dots.dotsState().dot, true);
  assert.equal(dots.dotsState().dot.rootThreadId, "th_2");
  assert.equal(dots.dotsState().dot.paused, true);
  assert.ok(profile.useDotProfile);
  t.mock.restoreAll();
  chatgpt(t, {
    "POST /tbo/tbo_1/runtime/resume": [200, { status: "applied", thread_id: "th_2" }],
    "GET /tbo/by-thread/th_2": [200, { id: "tbo_1", is_paused: true }],
  });
  await assert.rejects(profile.setPaused(dots.dotsState().dot, false), /无法确认你的 Dot 是否已恢复运行/);
});

test("deleting: a 503 means it began; another failure keeps the dot; creating again recovers first", async (t) => {
  dots.resetDots();
  let answer = [503, { detail: "deleting" }];
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit" }, { id: "tbo_2", aeon_kind: "orbit", display_name: "Two" }] },
    "GET /tbo/primary": () => [404, {}],
    "DELETE /tbo/tbo_2": () => answer,
    "DELETE /tbo/tbo_1": () => [500, { detail: "boom" }],
    "POST /tbo/deletion-recovery": {},
    "POST /tbo": { id: "tbo_3", aeon_kind: "orbit" },
    "POST /tbo/tbo_3/messaging-room": { id: "tbo_3", messaging_room_id: "room_3" },
  });
  await dots.loadDot();
  dots.selectDot("tbo_2");
  await profile.deleteDot(dots.dotsState().dot);
  assert.deepEqual(dots.dotsState().dots.map((dot) => dot.id), ["tbo_1"]);
  assert.equal(dots.dotsState().dot.id, "tbo_1");
  await assert.rejects(profile.deleteDot(dots.dotsState().dot));
  assert.equal(dots.dotsState().dot.deleting, false);
  dots.putDot({ ...dots.dotsState().dot, deleting: true });
  await dots.createDot();
  const order = calls.map(({ method, path }) => `${method} ${path}`);
  assert.ok(order.indexOf("POST /tbo/deletion-recovery") < order.indexOf("POST /tbo"));
  assert.deepEqual(calls.find((call) => call.path === "/tbo" && call.method === "POST").body.create_additional, true);
  assert.equal(dots.dotsState().dot.id, "tbo_3");
});

test("saving a character: the profile is checked, the snapshot goes up with its manifest, a lost write is read back", async (t) => {
  dots.resetDots();
  const state = profile.appearanceBytes(profile.ringAppearance("teal"));
  let stored = { id: "tbo_1", aeon_kind: "orbit", display_name: "Nova", avatar_type: "", avatar_manifest: null };
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit", display_name: "Nova" }] },
    "GET /tbo/primary": () => [404, {}],
    "GET /tbo/tbo_1": () => [200, stored],
    "UPLOAD /cloud-aeons/avatar-snapshots": { snapshot: { asset_pointer: "sediment://file_s1", file_id: "file_s1" } },
    // The write lands but its answer is lost.
    "PATCH /tbo/tbo_1": (body) => { stored = { ...stored, ...body }; return [0]; },
  });
  await dots.loadDot();
  await profile.saveAppearance(dots.dotsState().dot, { name: "Nova Prime", character: { state, png: new Uint8Array([0x89, 0x50]) }, bundleId: "b".repeat(64) });
  const upload = calls.find((call) => call.method === "UPLOAD");
  const manifest = JSON.parse(upload.body.fields.avatar_manifest);
  assert.deepEqual(manifest, { schema_version: 1, resource_bundle_id: "b".repeat(64), appearance: profile.appearanceOf(state) });
  assert.equal(upload.body.type, "image/png");
  const patch = calls.find((call) => call.method === "PATCH").body;
  assert.equal(patch.avatar_type, "rendered-interactive");
  assert.deepEqual(patch.avatar_manifest.snapshot, { asset_pointer: "sediment://file_s1", file_id: "file_s1" });
  const dot = dots.dotsState().dot;
  assert.deepEqual([dot.name, dot.avatar.type, dot.avatar.url], ["Nova Prime", "rendered-interactive", "sediment://file_s1"]);
  // The editor opens on the saved character next time.
  assert.deepEqual(profile.startingAppearance(dot), state);
  // Changed elsewhere meanwhile: nothing is written.
  stored = { ...stored, avatar_type: "codex-pet" };
  await assert.rejects(profile.saveAppearance(dot, { name: "X", bundleId: null }), /其他设备/);
});

test("channels: an email claim's refusal in words, texting set up for this dot, a meeting invite with its key", async (t) => {
  dots.resetDots();
  const calls = chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit" }] },
    "GET /tbo/primary": () => [404, {}],
    "POST /tbo/tbo_1/channels/email/claim": (body) => body.local_part === "taken" ? [409, { detail: { type: "address_unavailable", message: "taken" } }] : [200, { status: "linked", email_address: "nova@dots.example.com" }],
    "POST /aeon-messaging/phone": { challenge_id: "ch_1" },
    "POST /aeon-messaging/phone/verify": { binding: { generation: 7 } },
    "POST /aeon-messaging/texting/activate": {},
    "GET /aeon-messaging/phone?include_texting=true": { binding: { phone_number: "+15550100199", generation: 7, texting: { orbit_phone_number: "+15550104242" } }, texting_can_setup: true },
    "POST /tbo/tbo_1/meeting-sessions": { id: "m1" },
  });
  await dots.loadDot();
  const dot = dots.dotsState().dot;
  await assert.rejects(profile.claimEmail("tbo_1", "taken", "dots.example.com"), /此电子邮箱地址已被占用。请换一个地址/);
  await profile.claimEmail("tbo_1", "nova", "dots.example.com");
  assert.deepEqual(profile.profileOf("tbo_1").email, { linked: true, address: "nova@dots.example.com" });
  assert.deepEqual(calls.at(-1).body, { local_part: "nova", domain: "dots.example.com", narrow_email_consent_version: 1 });
  assert.equal(await profile.startPhone("+1 555 010 0199"), "ch_1");
  await profile.verifyPhone(dot, "ch_1", "123456");
  assert.deepEqual(calls.find((call) => call.path === "/aeon-messaging/texting/activate").body, { consent: true, expected_aeon_id: "tbo_1", phone_generation: 7 });
  assert.equal(profile.profileOf("tbo_1").phone.dotNumber, "+15550104242");
  await profile.inviteToMeeting(dot, "https://meet.google.com/abc-defg-hij", "key-1");
  assert.deepEqual(calls.at(-1), { method: "POST", path: "/tbo/tbo_1/meeting-sessions", body: { meeting_url: "https://meet.google.com/abc-defg-hij" }, threadRoute: undefined, idempotencyKey: "key-1" });
});

test("the activity stream: an upsert adds or updates a task in order, a removal drops it", async (t) => {
  dots.resetDots();
  chatgpt(t, {
    "GET /tbo?limit=25&include_room_preview=false": { items: [{ id: "tbo_1", aeon_kind: "orbit" }] },
    "GET /tbo/primary": () => [404, {}],
    "GET /tbo/tbo_1/activity?limit=5": { data: [{ thread_id: "th_done", title: "整理收件箱", status: "completed", outcome: "succeeded", updated_at: 200 }] },
  });
  await dots.loadDot();
  await dots.loadDotActivity();
  dots.applyActivityEvent("upsert", { thread_id: "th_run", title: "订机票", status: "in_progress", updated_at: 100 });
  dots.applyActivityEvent("upsert", { thread_id: "th_done", title: "整理收件箱", status: "completed", outcome: "failed", updated_at: 300 });
  assert.deepEqual(dots.dotsState().activity.map(({ id, status }) => [id, status]), [["th_run", "running"], ["th_done", "failed"]]);
  dots.applyActivityEvent("remove", { thread_id: "th_run" });
  assert.deepEqual(dots.dotsState().activity.map(({ id }) => id), ["th_done"]);
});
