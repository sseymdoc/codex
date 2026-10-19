import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBridge, installedCodex, resolveCodexCommand } from "./bridge.mjs";

// Stands in for `codex app-server`: answers every request line with a result.
const fakeCodex = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-")), "fake-codex.mjs");
writeFileSync(
  fakeCodex,
  `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, result: { echoed: true } }) + "\\n");
});
`,
);

function request(port, { method = "GET", path: target = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: target, headers }, (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

// Reads SSE frames until `until` matches one, then drops the connection.
function readEvents(port, headers, until) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const req = http.get({ host: "127.0.0.1", port, path: "/api/events", headers }, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith(":")) continue;
          const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
          const data = JSON.parse(/^data: (.*)$/m.exec(frame)[1]);
          frames.push({ event, data });
          if (until(frames.at(-1), frames)) {
            req.destroy();
            return resolve(frames);
          }
        }
      });
    });
    req.on("error", (error) => (error.code === "ECONNRESET" ? undefined : reject(error)));
  });
}

async function withBridge(fn) {
  const bridge = createBridge({ codex: fakeCodex, token: "s3cret", log: { error() {} } });
  const server = http.createServer((req, res) => bridge.handle(req, res, () => res.writeHead(200).end("static")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(port, { host: `127.0.0.1:${port}`, cookie: `codex_ui_${port}=s3cret` });
  } finally {
    bridge.closeAll();
    server.close();
  }
}

test("finds installed codex binaries, newest first, when nothing else is configured", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-installed-"));
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const place = (dir, seconds) => {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, exe);
    writeFileSync(file, "");
    utimesSync(file, seconds, seconds);
    return file;
  };
  const env = { LOCALAPPDATA: path.join(root, "local"), PATH: "" };
  const home = path.join(root, "home");
  // Desktop app: one hash folder holds only rg.exe, another the newest codex.
  mkdirSync(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "ce4759538b7f2f1a"), { recursive: true });
  const desktop = place(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "896a0166b774037a"), 2_000_000_000);
  const extension = place(path.join(home, ".vscode", "extensions", "openai.chatgpt-26.1007.21434-win32-x64", "bin", "windows-x86_64"), 1_900_000_000);
  place(path.join(home, ".vscode", "extensions", "someone.else-1.0.0", "bin", "x"), 2_100_000_000);

  assert.deepEqual(installedCodex({ env, home }), [desktop, extension]);
  assert.equal(resolveCodexCommand(undefined, { env, home }).command, desktop);
  // An explicit name that is not found does not fall back to an installed copy.
  assert.equal(resolveCodexCommand("codex-nope", { env, home }), null);
  // Nor does a missing explicit path, even with a codex on PATH.
  const onPath = place(path.join(root, "path-bin"), 1_000_000_000);
  const withPath = { env: { ...env, PATH: path.dirname(onPath) }, home };
  assert.equal(resolveCodexCommand(undefined, withPath).command, onPath);
  assert.equal(resolveCodexCommand(path.join(root, "missing", exe), withPath), null);
  assert.equal(resolveCodexCommand(undefined, { env: { PATH: "" }, home: path.join(root, "nobody") }), null);
});

test("guards the API by host, origin and token", async () => {
  await withBridge(async (port, auth) => {
    assert.equal((await request(port, { path: "/api/events", headers: { ...auth, host: "evil.test" } })).status, 403);
    assert.equal((await request(port, { path: "/api/events", headers: { host: auth.host } })).status, 401);
    const foreign = { ...auth, origin: "http://evil.test" };
    assert.equal((await request(port, { path: "/api/events", headers: foreign })).status, 403);
    assert.equal((await request(port, { path: "/?token=wrong", headers: { host: auth.host } })).status, 401);
    assert.equal((await request(port, { path: "/", headers: { host: auth.host } })).text, "static");
  });
});

test("trades the URL token for a cookie", async () => {
  await withBridge(async (port, auth) => {
    const res = await request(port, { path: "/chat?token=s3cret", headers: { host: auth.host } });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/chat");
    assert.match(res.headers["set-cookie"][0], new RegExp(`^codex_ui_${port}=s3cret; HttpOnly; SameSite=Strict`));
  });
});

test("relays JSON-RPC between the browser and app-server", async () => {
  await withBridge(async (port, auth) => {
    const frames = await readEvents(port, auth, (frame) => {
      if (frame.event === "hello") {
        const body = `${JSON.stringify({ id: 7, method: "initialize", params: {} })}\n`;
        const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
        request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body }).then((res) =>
          assert.equal(res.status, 204),
        );
      }
      return frame.event === "message";
    });
    assert.deepEqual(frames.at(-1).data, { id: 7, result: { echoed: true } });
  });
});

test("reads opencodex provider quotas with a signed one-shot read capability", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-opencodex-"));
  const secret = randomBytes(32).toString("base64url");
  const sign = (...lines) => createHmac("sha256", secret).update(lines.join("\n")).digest("base64url");
  let signsBack = true;
  // Stands in for opencodex: admits the request only with its local read capability, and signs
  // the nonce back unless it is playing a stranger on a stale port.
  const opencodex = http.createServer((req, res) => {
    const h = req.headers;
    const port = req.socket.localPort;
    const admitted =
      h["x-opencodex-local-expected-pid"] === "4242" &&
      h["x-opencodex-local-capability"] === sign("opencodex-local-management-read-v1", h["x-opencodex-local-nonce"], req.method, req.url, 4242, port, h["x-opencodex-local-expires-at"]);
    const report = { provider: "anthropic", label: "Anthropic Claude", source: "anthropic:oauth-usage", quota: { fiveHourPercent: 7, updatedAt: 2 }, updatedAt: 2, aggregation: {} };
    const proof = signsBack ? { "x-opencodex-attestation-proof": sign("opencodex-local-management-v1", h["x-opencodex-local-nonce"], 4242, port) } : {};
    res.writeHead(admitted ? 200 : 401, { "content-type": "application/json", ...proof }).end(JSON.stringify(admitted ? { generatedAt: 3, reports: [report] } : { error: "denied" }));
  });
  await new Promise((resolve) => opencodex.listen(0, "127.0.0.1", resolve));
  writeFileSync(path.join(home, "runtime-port.json"), JSON.stringify({ pid: 4242, port: opencodex.address().port, attestationSecret: secret }));
  process.env.OPENCODEX_HOME = home;
  try {
    await withBridge(async (port, auth) => {
      const read = async () => JSON.parse((await request(port, { path: "/api/opencodex/quotas", headers: auth })).text);
      // Only the quota fields reach the page.
      assert.deepEqual(await read(), { reports: [{ provider: "anthropic", label: "Anthropic Claude", quota: { fiveHourPercent: 7, updatedAt: 2 }, updatedAt: 2 }] });
      signsBack = false;
      assert.deepEqual(await read(), { reports: [] });
      process.env.OPENCODEX_HOME = path.join(home, "none");
      assert.deepEqual(await read(), { reports: [] });
    });
  } finally {
    delete process.env.OPENCODEX_HOME;
    opencodex.close();
  }
});

test("reads a thread's context parts from its rollout and from no other file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-rollout-"));
  const rollout = path.join(dir, "rollout-2026-10-19T00-00-00-t.jsonl");
  const line = (type, payload) => JSON.stringify({ type, payload });
  writeFileSync(
    rollout,
    [
      line("session_meta", { base_instructions: { text: "x".repeat(40) } }),
      line("event_msg", { type: "token_count", info: { last_token_usage: { input_tokens: 30, total_tokens: 40 }, model_context_window: 100 } }),
    ].join("\n"),
  );
  await withBridge(async (port, auth) => {
    const read = (file) => request(port, { path: `/api/context-usage?path=${encodeURIComponent(file)}`, headers: auth });
    const ok = await read(rollout);
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.text), { usedTokens: 40, windowTokens: 100, mcpDeferred: false, system: 10, tools: 20, skills: 0, agents: 0, memory: 0, mcp: 0, apps: 0 });
    assert.equal((await read(path.join(dir, "notes.jsonl"))).status, 400);
    assert.equal((await read("rollout-relative.jsonl")).status, 400);
    assert.equal((await read(path.join(dir, "rollout-gone.jsonl"))).status, 404);
  });
});
