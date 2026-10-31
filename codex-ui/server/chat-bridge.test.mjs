import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createOrchestrator } from "./orchestrator.mjs";
import { createBridge } from "./bridge.mjs";

async function fixture(t, { enabled = true, capability = true, desktop = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "siwc-bridge-")), fake = path.join(dir, "backend.mjs");
  writeFileSync(fake, `import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
 const m=JSON.parse(line);
 if (m.id !== undefined) console.log(JSON.stringify({id:m.id,result:{codexUiSiwcChat:m.method==='pretend' || (${capability} && process.env.CODEX_UI_EXPERIMENTAL_BACKEND==='1')}}));
}).on('close',()=>process.exit(0));`);
  let created = 0;
  const service = createOrchestrator({ codex: fake, cwd: dir, dataDir: dir, experimentalBackend: enabled, desktopUi: desktop,
    createSiwcClient: async () => { created++; return {
      subscribe: () => () => {}, cancelSignIn() {}, getSession: async () => ({ status: "connected", sharing: true, profileId: "profile" }),
      listProfiles: async () => [], listModels: async () => [{ slug: "model", displayName: "模型" }],
      streamResponse: async ({ onDelta }) => { onDelta("回复"); return { text: "回复" }; },
    }; },
  });
  const bridge = createBridge(service, { token: "synthetic-bridge-secret" });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, host = `127.0.0.1:${port}`, replies = [];
  const id = service.connect(host, { event() {}, message: (line) => replies.push(JSON.parse(line)), end() {} });
  let sequence = 0;
  async function rpc(method) {
    const requestId = ++sequence;
    service.send(id, [{ id: requestId, method, params: {} }]);
    for (let i = 0; i < 500 && !replies.some((reply) => reply.id === requestId); i++) await delay(10);
    assert.ok(replies.some((reply) => reply.id === requestId), "backend reply missing");
  }
  t.after(async () => { await service.closeChat(); service.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const headers = { Cookie: `codex_ui_${port}=synthetic-bridge-secret`, "Content-Type": "application/json" };
  const request = (action, body = {}, extra = {}) => fetch(`http://${host}/api/chat/${action}?c=${id}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  return { service, id, rpc, request, get created() { return created; } };
}

for (const options of [{ enabled: false }, { capability: false }, { desktop: false }]) {
  test(`disabled direct requests cannot initialize SDK: ${JSON.stringify(options)}`, async (t) => {
    const f = await fixture(t, options);
    await f.rpc("initialize");
    assert.deepEqual(await (await f.request("status")).json(), { available: false });
    for (const action of ["login", "models", "list", "create", "send", "account", "logout"]) {
      assert.equal((await f.request(action)).status, 403);
    }
    assert.equal(f.created, 0);
  });
}

test("only the matching initialize reply enables chat; bridge auth and account isolation stay enforced", async (t) => {
  const f = await fixture(t);
  await f.rpc("pretend");
  assert.equal(f.service.chatAvailable(f.id), false);
  await f.rpc("initialize");
  assert.equal(f.service.chatAvailable(f.id), true);
  assert.equal((await f.request("status", {}, { Origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await f.request("status", {}, { Cookie: "" })).status, 401);
  assert.equal(f.created, 0);
  assert.equal((await (await f.request("status")).json()).session.profileId, "profile");
  const { chat } = await (await f.request("create", { model: "model" })).json();
  assert.equal((await f.request("read", { id: "../../outside" })).status, 409);
  assert.equal((await (await f.request("read", { id: chat.id })).json()).chat.id, chat.id);
  assert.equal(f.created, 1);
  f.service.disconnect(f.id);
  assert.equal(f.service.chatAvailable(f.id), false);
});
