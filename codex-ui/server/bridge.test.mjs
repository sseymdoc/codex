import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBridge, installedCodex, resolveCodexCommand, transcribeError } from "./bridge.mjs";

// ChatGPT access tokens as getAuthStatus hands them out: a stale one, then a refreshed one.
const jwt = (sub) => ["e30", Buffer.from(JSON.stringify({ sub, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })).toString("base64url"), "sig"].join(".");
const STALE = jwt("stale");
const FRESH = jwt("fresh");

// Stands in for `codex app-server`: answers every request line with a result, getAuthStatus with
// the ChatGPT login.
const fakeCodex = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-")), "fake-codex.mjs");
writeFileSync(
  fakeCodex,
  `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  const result = method === "getAuthStatus" ? { authMethod: "chatgpt", authToken: params.refreshToken ? ${JSON.stringify(FRESH)} : ${JSON.stringify(STALE)} } : { echoed: true };
  process.stdout.write(JSON.stringify({ id, result }) + "\\n");
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

async function withBridge(fn, codex = fakeCodex) {
  const bridge = createBridge({ codex, token: "s3cret", log: { error() {} } });
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

test("transcribes dictation under the session's ChatGPT login, which never reaches the page", async () => {
  const seen = [];
  // Stands in for ChatGPT's /transcribe: the stale token is turned away.
  const backend = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const h = req.headers;
      seen.push({ url: req.url, auth: h.authorization, account: h["chatgpt-account-id"], originator: h.originator, sku: h["oai-product-sku"], body: Buffer.concat(chunks).toString("latin1") });
      if (h.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: "你好" }));
    });
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api/`;
  try {
    await withBridge(async (port, auth) => {
      const answers = [];
      const headers = { ...auth, origin: `http://${auth.host}` };
      const frames = await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") {
          const c = frame.data.connectionId;
          const transcribe = (type, body) => request(port, { method: "POST", path: `/api/transcribe?c=${c}`, headers: { ...headers, "content-type": type }, body });
          void (async () => {
            answers.push(await transcribe("audio/webm;codecs=opus", Buffer.from("OggS-clip")));
            answers.push(await transcribe("text/plain", "not audio"));
            // Something for the page after the bridge's own requests: the stream ends there.
            await request(port, { method: "POST", path: `/api/send?c=${c}`, headers, body: `${JSON.stringify({ id: 9, method: "ping" })}\n` });
          })();
        }
        return frame.event === "message" && frame.data.id === 9;
      });
      assert.equal(answers[0].status, 200);
      assert.deepEqual(JSON.parse(answers[0].text), { text: "你好" });
      assert.equal(answers[1].status, 415);
      assert.ok(frames.every((frame) => !JSON.stringify(frame.data).includes("authToken")));
    });
    assert.deepEqual(
      seen.map(({ url, auth, account, originator, sku }) => ({ url, auth, account, originator, sku })),
      [STALE, FRESH].map((token) => ({ url: "/backend-api/transcribe", auth: `Bearer ${token}`, account: "acct-1", originator: "codex_ui", sku: "CODEX" })),
    );
    assert.match(seen[1].body, /name="file"; filename="codex\.webm"\r\nContent-Type: audio\/webm;codecs=opus\r\n\r\nOggS-clip/);
    assert.equal(transcribeError(400, { detail: { code: "audio_too_short" } }), "没听清楚。请重试");
  } finally {
    delete process.env.CODEX_API_BASE_URL;
    backend.close();
  }
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

test("adds the untracked files app-server leaves out of gitDiffToRemote", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "codex-ui-untracked-"));
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout;
  git("init", "-q");
  git("config", "core.quotePath", "true");
  writeFileSync(path.join(repo, "new.txt"), "ascii\n");
  writeFileSync(path.join(repo, "新文件.txt"), "第一行\n");
  const added = (name) => git("diff", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", name);
  // codex 0.163 answers with new.txt alone: `"\346\226\260...txt"` names no file.
  const left = added("new.txt");
  const full = left + added("新文件.txt");
  // Stands in for app-server: answers gitDiffToRemote with the diff the request carries.
  const codex = path.join(path.dirname(fakeCodex), "diff-codex.mjs");
  writeFileSync(
    codex,
    `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, params } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, result: { sha: "abc", diff: params.diff } }) + "\\n");
});
`,
  );
  await withBridge(async (port, auth) => {
    const answers = (frames) => frames.filter((frame) => frame.event === "message").map((frame) => frame.data);
    const frames = await readEvents(port, auth, (frame, frames) => {
      if (frame.event === "hello") {
        const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
        const body = [left, full].map((diff, i) => JSON.stringify({ id: i + 1, method: "gitDiffToRemote", params: { cwd: repo, diff } })).join("\n");
        request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body });
      }
      return answers(frames).length === 2;
    });
    // 新文件.txt once in each: added to the first, already in the second (a codex that lists it).
    const sorted = answers(frames).sort((a, b) => a.id - b.id);
    assert.deepEqual(sorted, [1, 2].map((id) => ({ id, result: { sha: "abc", diff: full } })));
  }, codex);
});
