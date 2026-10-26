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

/** A fake ChatGPT: `routes` maps "METHOD path" to a body or (body) => [status, body]; every call is logged. */
function chatgpt(t, routes, available = true) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/api/dots/available?c=conn-1") return new Response(JSON.stringify({ available }), { status: 200 });
    assert.equal(url, "/api/cloud?c=conn-1");
    const { method, path, body } = JSON.parse(init.body);
    calls.push({ method, path, body });
    assert.ok(cloudAllowed(method, path), `the bridge refuses ${method} ${path}`);
    const route = routes[`${method} ${path}`];
    const [status, answer] = route === undefined ? [404, { detail: "Not Found" }] : typeof route === "function" ? route(body) : [200, route];
    return new Response(JSON.stringify({ status, body: answer }), { status: 200 });
  });
  return calls;
}

const reply = (parts, extra = {}) => ({ author: { role: "assistant" }, content: { content_type: "text", parts }, ...extra });

test("room messages read as the desktop app reads them: replies, the user's words, system notes", () => {
  assert.deepEqual(dots.parseDotMessage({
    id: "m1",
    created_at: "2026-10-26T08:00:00Z",
    raw_messages: [
      reply(["先看一下日程。"]),
      reply(["思考过程"], { channel: "analysis" }),
      reply(["隐藏"], { metadata: { is_hidden: true } }),
      { author: { role: "tool" }, content: { content_type: "text", parts: ["工具输出"] } },
      { author: { role: "assistant" }, content: { content_type: "code", text: "print(1)" } },
      { author: { role: "assistant" }, content: { content_type: "multimodal_text", parts: [{ text: "已经" }, "安排好了。"] } },
    ],
  }), { id: "m1", role: "assistant", text: "先看一下日程。\n\n已经\n\n安排好了。", createdAt: "2026-10-26T08:00:00Z" });
  assert.deepEqual(dots.parseDotMessage({ id: "m2", account_user_id: "user-1", content: { text: "明天提醒我开会", attachments: [] }, created_at: "t" }),
    { id: "m2", role: "user", text: "明天提醒我开会", createdAt: "t" });
  assert.equal(dots.parseDotMessage({ id: "m3", content: { text: "Dot 已重启" } }).role, "system");
  assert.equal(dots.parseDotMessage({ id: "m4", content: { type: "notice" }, preview: "已连接日历" }).text, "已连接日历");
  for (const skipped of [
    { id: "m5", content: { type: "message_error", text: "failed" } },
    { id: "m6", account_user_id: "u", content: { text: "删掉了" }, deleted_at: "t" },
    { id: "m7", raw_messages: [reply(["只有分析"], { channel: "analysis" })] },
    { account_user_id: "u", content: { text: "没有 id" } },
  ]) assert.equal(dots.parseDotMessage(skipped), null);
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
      { id: "msg_2", raw_messages: [reply(["好的。"])], created_at: "2026-10-26T08:00:05Z" },
      { id: "msg_1", account_user_id: "u", content: { text: "你好" }, created_at: "2026-10-26T08:00:00Z" },
    ], prev_cursor: null, next_cursor: null },
  });
  await dots.loadDot();
  assert.deepEqual(dots.dotsState().dot, { id: "tbo_1", name: null, paused: true, roomId: null });
  await dots.sendDotMessage("你好");
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
  // Oldest first; a poll that brings nothing new keeps the same list.
  const messages = dots.dotsState().messages;
  assert.deepEqual(messages.map((message) => [message.role, message.text]), [["user", "你好"], ["assistant", "好的。"]]);
  await dots.loadDotMessages();
  assert.equal(dots.dotsState().messages, messages);
  dots.markDotRead();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls.at(-1), { method: "POST", path: "/messaging/rooms/room_1/read", body: { last_read_at: "2026-10-26T08:00:05Z" } });
});

test("availability, creation and the activity list", async (t) => {
  dots.resetDots();
  chatgpt(t, {}, false);
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
