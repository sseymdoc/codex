import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createChatService, chatError } from "./chat.mjs";
import { createChatStore } from "./chat-store.mjs";
import { chatCredentials } from "../desktop/chat-credentials.mjs";

function fixture(t, stream) {
  const root = mkdtempSync(path.join(tmpdir(), "siwc-service-")), requests = [], events = [];
  let session = { status: "connected", sharing: true, profileId: "account-a" };
  const client = {
    subscribe: () => () => {}, cancelSignIn() {},
    getSession: async () => ({ ...session }), listProfiles: async () => [],
    listModels: async () => [{ slug: "model", displayName: "测试模型" }],
    selectProfile: async (id) => { session.profileId = id; },
    disconnect: async () => { session.status = "disconnected"; session.sharing = false; },
    streamResponse: async (options) => { requests.push(options); return stream ? stream(options) : { text: "回答" }; },
  };
  const service = createChatService({ root, client });
  service.subscribe((event, data) => events.push({ event, data }));
  t.after(() => service.close());
  return { service, root, requests, events, client, setSession: (s) => { session = s; } };
}
async function settled(service, id) {
  for (let i = 0; i < 100; i++) {
    const { chat } = await service.request("read", { id });
    if (chat.turns.at(-1)?.status !== "running") return chat;
    await delay(5);
  }
  throw new Error("response did not settle");
}

test("multi-turn requests use local completed context and never duplicate acknowledged user IDs", async (t) => {
  const { service, requests } = fixture(t);
  const { chat } = await service.request("create", { model: "model" });
  const body = { id: chat.id, turnId: randomUUID(), model: "model", text: "第一轮" };
  await Promise.all([service.request("send", body), service.request("send", body)]);
  await settled(service, chat.id);
  assert.equal(requests.length, 1);
  await service.request("send", { ...body, turnId: randomUUID(), text: "第二轮" });
  const saved = await settled(service, chat.id);
  assert.equal(saved.turns.length, 2);
  assert.deepEqual(requests[1].input, [
    { role: "user", content: "第一轮" }, { role: "assistant", content: "回答" }, { role: "user", content: "第二轮" },
  ]);
  assert.deepEqual(Object.keys(requests[1]).sort(), ["input", "model", "onDelta", "signal"]);
});

test("cancellation retains partial text and process restart never resends an interrupted turn", async (t) => {
  const { service, root } = fixture(t, async ({ onDelta, signal }) => {
    onDelta("已收到的部分");
    await delay(10000, undefined, { signal });
    return { text: "不应完成" };
  });
  const { chat } = await service.request("create", { model: "model" });
  await service.request("send", { id: chat.id, turnId: randomUUID(), model: "model", text: "测试" });
  await service.request("cancel", { id: chat.id });
  const cancelled = await settled(service, chat.id);
  assert.equal(cancelled.turns[0].status, "cancelled");
  assert.equal(cancelled.turns[0].assistant, "已收到的部分");
  const store = createChatStore(root);
  cancelled.turns[0].status = "running";
  store.write(cancelled);
  const restart = createChatService({ root, client: { subscribe: () => () => {}, cancelSignIn() {}, getSession: async () => ({ profileId: "account-a" }) } });
  t.after(() => restart.close());
  assert.equal((await restart.request("read", { id: chat.id })).chat.turns[0].status, "cancelled");
});

test("account changes cancel generation and cannot expose another account's history", async (t) => {
  const { service } = fixture(t, async ({ signal }) => { await delay(10000, undefined, { signal }); return { text: "" }; });
  const { chat } = await service.request("create", { model: "model" });
  await service.request("send", { id: chat.id, turnId: randomUUID(), model: "model", text: "私有" });
  await service.request("account", { profileId: "account-b" });
  assert.deepEqual((await service.request("list")).chats, []);
  await assert.rejects(service.request("read", { id: chat.id }), { code: "chat_not_found" });
  await service.request("account", { profileId: "account-a" });
  assert.equal((await settled(service, chat.id)).turns[0].status, "cancelled");
});

test("failed streams preserve partial output without leaking upstream diagnostic text", async (t) => {
  const { service } = fixture(t, async ({ onDelta }) => {
    onDelta("部分内容");
    throw Object.assign(new Error("Authorization: secret-and-user-input"), { code: "stream_interrupted" });
  });
  const { chat } = await service.request("create", { model: "model" });
  await service.request("send", { id: chat.id, turnId: randomUUID(), model: "model", text: "测试" });
  const answer = await settled(service, chat.id);
  assert.equal(answer.turns[0].status, "failed");
  assert.equal(answer.turns[0].assistant, "部分内容");
  assert.ok(!JSON.stringify(answer).includes("secret-and-user-input"));
  assert.ok(!JSON.stringify(chatError(new Error("secret"))).includes("secret"));
});

test("unapproved models and missing subscription consent never send inference", async (t) => {
  const { service, requests, setSession } = fixture(t);
  await assert.rejects(service.request("create", { model: "unknown" }), { code: "model_unavailable" });
  const { chat } = await service.request("create", { model: "model" });
  await assert.rejects(service.request("send", { id: chat.id, model: "model", text: "不能转换数组 ID", turnId: [randomUUID()] }), { code: "invalid_input" });
  setSession({ profileId: "account-a", status: "connected", sharing: false });
  await assert.rejects(service.request("create", { model: "model" }), { code: "sign_in_required" });
  assert.equal(requests.length, 0);
});

test("a follow-up retains the user's stopped question and visible partial reply", async (t) => {
  let first = true;
  const { service, requests } = fixture(t, async ({ onDelta, signal }) => {
    if (first) { first = false; onDelta("部分上下文"); await delay(10000, undefined, { signal }); }
    return { text: "继续回答" };
  });
  const { chat } = await service.request("create", { model: "model" });
  await service.request("send", { id: chat.id, turnId: randomUUID(), model: "model", text: "最初的问题" });
  await service.request("cancel", { id: chat.id });
  await settled(service, chat.id);
  await service.request("send", { id: chat.id, turnId: randomUUID(), model: "model", text: "继续" });
  await settled(service, chat.id);
  assert.deepEqual(requests[1].input.map((item) => item.content), ["最初的问题", "部分上下文", "继续"]);
});

test("Windows credential adapter uses async OS storage and refuses unavailable protection", async () => {
  let available = true;
  const provider = chatCredentials({
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (text) => Buffer.from(`encrypted:${text}`),
    decryptStringAsync: async (bytes) => ({ result: bytes.toString().slice(10), shouldReEncrypt: false }),
  });
  assert.equal(await provider.decrypt(await provider.encrypt("synthetic")), "synthetic");
  available = false;
  await assert.rejects(provider.encrypt("synthetic"), /unavailable/);
  await assert.rejects(provider.decrypt(Buffer.from("encrypted:synthetic")), /unavailable/);
});
