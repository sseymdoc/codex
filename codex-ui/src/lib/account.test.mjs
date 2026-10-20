import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

registerHooks({
  resolve: (specifier, context, next) => next(/^\.\.?\/[^.]+$/.test(specifier) && context.parentURL?.endsWith(".ts") ? `${specifier}.ts` : specifier, context),
  load: (url, context, next) => url.startsWith("file:") && url.endsWith(".ts")
    ? { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }) } : next(url, context),
});
globalThis.requestAnimationFrame ??= (callback) => setTimeout(callback, 0);
const { Rpc } = await import("./rpc.ts");
const { getState, setState } = await import("./store.ts");
const { refreshAccount } = await import("./codex.ts");
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("profile refresh cannot restore a previous account after switching, logout or reconnect", async (t) => {
  let connection = "session-a";
  let account = { type: "chatgpt", email: "a@example.com", planType: "plus" };
  t.mock.getter(Rpc.prototype, "connection", () => connection);
  t.mock.method(Rpc.prototype, "request", async (method) => {
    if (method === "account/read") return { account, requiresOpenaiAuth: true };
    throw new Error("unavailable");
  });
  const requests = [];
  t.mock.method(globalThis, "fetch", (url, options) => new Promise((resolve) => requests.push({ url, options, resolve })));
  const answer = (at, displayName) => requests[at].resolve({ ok: true, json: async () => ({ profile: { displayName, avatarUrl: null } }) });
  await refreshAccount();
  assert.equal(requests[0].url, "/api/account/profile?c=session-a");
  account = { ...account, email: "b@example.com" };
  await refreshAccount();
  assert.equal(requests[0].options.signal.aborted, true);
  answer(1, "新昵称");
  await settle();
  assert.equal(getState().accountProfile.displayName, "新昵称");
  answer(0, "旧昵称");
  await settle();
  assert.equal(getState().accountProfile.displayName, "新昵称");
  await refreshAccount();
  account = null;
  await refreshAccount();
  assert.equal(getState().accountProfile, null);
  answer(2, "退出后迟到的昵称");
  await settle();
  assert.equal(getState().accountProfile, null);
  account = { type: "apiKey" };
  await refreshAccount();
  assert.equal(requests.length, 3);
  account = { type: "chatgpt", email: "b@example.com", planType: "plus" };
  await refreshAccount();
  connection = "session-b";
  answer(3, "重连前的昵称");
  await settle();
  assert.equal(getState().accountProfile, null);
  setState({ account: null });
});

test("profile network failures preserve the signed-in account and use fallback identity", async (t) => {
  t.mock.getter(Rpc.prototype, "connection", () => "session");
  const account = { type: "chatgpt", email: "fallback@example.com", planType: "plus" };
  t.mock.method(Rpc.prototype, "request", async (method) => {
    if (method === "account/read") return { account, requiresOpenaiAuth: true };
    throw new Error("unavailable");
  });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("offline"); });
  await refreshAccount();
  await settle();
  assert.equal(getState().account.account, account);
  assert.equal(getState().accountProfile, null);
});
