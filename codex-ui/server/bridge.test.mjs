import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createBridge } from "./bridge.mjs";
import { createOrchestrator, installedCodex, profileFields, resolveCodexCommand, transcribeError, withPackageTools } from "./orchestrator.mjs";

// ChatGPT access tokens as getAuthStatus hands them out: a stale one, then a refreshed one.
const jwt = (sub) => ["e30", Buffer.from(JSON.stringify({ sub, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" } })).toString("base64url"), "sig"].join(".");
const STALE = jwt("stale");
const FRESH = jwt("fresh");

// Codex's warning at session start (features::unstable_features_warning_event).
const unstable = (keys) =>
  `Under-development features enabled: ${keys}. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set \`suppress_unstable_features_warning = true\` in C:\\Users\\me\\.codex\\config.toml.`;

// Stands in for `codex app-server`: answers every request line with a result, getAuthStatus with
// the ChatGPT login, and "warn" with the unstable-feature warnings first and its arguments.
const fakeCodex = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-")), "fake-codex.mjs");
writeFileSync(
  fakeCodex,
  `import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const { id, method, params } = JSON.parse(line);
  if (method === "oversizeStderr") return void process.stderr.write(Buffer.alloc(2 * 1024 * 1024, "x"));
  if (method === "privateReply") process.stdout.write(JSON.stringify({ id: "codex-ui-bridge:expired", result: { authToken: "late-secret" } }) + "\\n");
  if (method === "warn")
    for (const keys of ["apply_patch_streaming_events", "apply_patch_streaming_events, local_thread_store_compression"])
      process.stdout.write(JSON.stringify({ method: "warning", params: { threadId: "t", message: ${JSON.stringify(unstable("KEYS"))}.replace("KEYS", keys) } }) + "\\n");
  const result = method === "getAuthStatus" ? { authMethod: "chatgpt", authToken: params.refreshToken ? ${JSON.stringify(FRESH)} : ${JSON.stringify(STALE)} } : method === "experimentalBackend" ? { enabled: process.env.CODEX_UI_EXPERIMENTAL_BACKEND, access: process.env.CODEX_UI_TOOL_ACCESS_MODE, search: process.env.CODEX_UI_CONNECTOR_SEARCH, ponytailMap: process.env.PONYTAIL_MAP } : method === "warn" ? { argv: process.argv.slice(2) } : { echoed: true };
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

async function withBridge(fn, codex = fakeCodex, options = {}) {
  const orchestrator = createOrchestrator({ codex, log: { error() {} }, ...options });
  const bridge = createBridge(orchestrator, { token: "s3cret", ...options });
  const server = http.createServer((req, res) => bridge.handle(req, res, () => res.writeHead(200).end("static")));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await fn(port, { host: `127.0.0.1:${port}`, cookie: `codex_ui_${port}=s3cret` });
  } finally {
    orchestrator.close();
    server.close();
  }
}

test("oversized backend output becomes a fatal SSE event and the connection rejects further sends", async () => {
  await withBridge(async (port, auth) => {
    let sent;
    const frames = await readEvents(port, auth, (frame) => {
      if (frame.event === "hello") sent = request(port, {
        method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers: auth,
        body: JSON.stringify({ id: 1, method: "oversizeStderr" }) + "\n",
      });
      return frame.event === "fatal";
    });
    assert.equal((await sent).status, 204);
    assert.deepEqual(frames.map((frame) => frame.event), ["hello", "fatal"]);
    assert.match(frames[1].data.message, /stderr.*1 MiB/);
    assert.equal(frames[1].data.code, "OUTPUT_TOO_LARGE");
    const rejected = await request(port, {
      method: "POST", path: `/api/send?c=${frames[0].data.connectionId}`, headers: auth, body: "{}\n",
    });
    assert.equal(rejected.status, 410);
  });
});

test("experimental backend selection overrides inherited flags even for a custom binary", async () => {
  const previous = process.env.CODEX_UI_EXPERIMENTAL_BACKEND;
  process.env.CODEX_UI_EXPERIMENTAL_BACKEND = "1";
  try {
    for (const experimentalBackend of [undefined, false, true]) {
      await withBridge(async (port, auth) => {
        const frames = await readEvents(port, auth, (frame) => {
          if (frame.event === "hello") {
            const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
            request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body: JSON.stringify({ id: 19, method: "experimentalBackend" }) + "\n" });
          }
          return frame.data.id === 19;
        });
        assert.equal(frames.at(-1).data.result.enabled, experimentalBackend === true ? "1" : "0");
      }, fakeCodex, { experimentalBackend });
    }
  } finally {
    if (previous === undefined) delete process.env.CODEX_UI_EXPERIMENTAL_BACKEND;
    else process.env.CODEX_UI_EXPERIMENTAL_BACKEND = previous;
  }
});

test("only the experimental backend disables the synchronous Ponytail repository map", async () => {
  const previous = process.env.PONYTAIL_MAP;
  try {
    for (const inherited of [undefined, "1"]) {
      if (inherited === undefined) delete process.env.PONYTAIL_MAP;
      else process.env.PONYTAIL_MAP = inherited;
      for (const experimentalBackend of [undefined, false, "true", true]) {
        await withBridge(async (port, auth) => {
          const frames = await readEvents(port, auth, (frame) => {
            if (frame.event === "hello") {
              const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
              void request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body: JSON.stringify({ id: 21, method: "experimentalBackend" }) + "\n" });
            }
            return frame.data.id === 21;
          });
          assert.equal(frames.at(-1).data.result.ponytailMap, experimentalBackend === true ? "0" : inherited);
        }, fakeCodex, { experimentalBackend });
      }
    }
  } finally {
    if (previous === undefined) delete process.env.PONYTAIL_MAP;
    else process.env.PONYTAIL_MAP = previous;
  }
});

test("tool access preferences are startup-owned and require the experimental backend", async () => {
  const names = ["CODEX_UI_TOOL_ACCESS_MODE", "CODEX_UI_CONNECTOR_SEARCH"];
  const previous = names.map((name) => process.env[name]);
  for (const name of names) process.env[name] = "inherited";
  try {
    for (const options of [
      {},
      { experimentalBackend: false, toolAccessMode: "all", connectorSearch: true },
      { experimentalBackend: true },
      { experimentalBackend: true, toolAccessMode: "all", connectorSearch: false },
      { experimentalBackend: true, toolAccessMode: "invalid", connectorSearch: true },
    ]) {
      await withBridge(async (port, auth) => {
        const frames = await readEvents(port, auth, (frame) => {
          if (frame.event === "hello") {
            const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
            void request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body: JSON.stringify({ id: 20, method: "experimentalBackend" }) + "\n" });
          }
          return frame.data.id === 20;
        });
        const { access, search } = frames.at(-1).data.result;
        assert.equal(access, options.experimentalBackend && options.toolAccessMode === "all" ? "all" : "on-demand");
        assert.equal(search, options.experimentalBackend && options.connectorSearch !== false ? "1" : "0");
      }, fakeCodex, options);
    }
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});

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
  const repoRoot = path.join(root, "repo");
  // Desktop app: one hash folder holds only rg.exe, another the newest codex.
  mkdirSync(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "ce4759538b7f2f1a"), { recursive: true });
  const desktop = place(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "896a0166b774037a"), 2_000_000_000);
  const extension = place(path.join(home, ".vscode", "extensions", "openai.chatgpt-26.1007.21434-win32-x64", "bin", "windows-x86_64"), 1_900_000_000);
  place(path.join(home, ".vscode", "extensions", "someone.else-1.0.0", "bin", "x"), 2_100_000_000);

  assert.deepEqual(installedCodex({ env, home }), [desktop, extension]);
  assert.equal(resolveCodexCommand(undefined, { env, home, repoRoot }).command, desktop);
  assert.equal(resolveCodexCommand("codex-nope", { env, home, repoRoot }).command, desktop);
  const onPath = place(path.join(root, "path-bin"), 1_000_000_000);
  const withPath = { env: { ...env, PATH: path.dirname(onPath) }, home, repoRoot };
  assert.equal(resolveCodexCommand(undefined, withPath).command, onPath);
  assert.equal(resolveCodexCommand(path.join(root, "missing", exe), withPath).command, onPath);
  assert.equal(resolveCodexCommand(undefined, { env: { PATH: "" }, home: path.join(root, "nobody"), repoRoot }), null);
});

test("falls back when the configured binary or a local build's code-mode host is missing", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-fallback-"));
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const host = process.platform === "win32" ? "codex-code-mode-host.exe" : "codex-code-mode-host";
  const place = (file) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, ""); return file; };
  const repoRoot = path.join(root, "repo");
  const home = path.join(root, "home");
  const onPath = place(path.join(root, "path-bin", exe));
  const env = { PATH: path.dirname(onPath), LOCALAPPDATA: path.join(root, "local") };
  const where = { env, home, repoRoot };
  const missing = path.join(root, "missing", exe);
  assert.equal(resolveCodexCommand(missing, where)?.command, onPath);
  assert.equal(resolveCodexCommand("codex-nope", where)?.command, onPath);
  const outsideBuild = place(path.join(root, "other-checkout", "target", "debug", exe));
  assert.equal(resolveCodexCommand(outsideBuild, where)?.command, onPath);
  place(path.join(path.dirname(outsideBuild), host));
  assert.equal(resolveCodexCommand(outsideBuild, where)?.command, outsideBuild);

  const debug = place(path.join(repoRoot, "codex-rs", "target", "debug", exe));
  assert.equal(resolveCodexCommand(debug, where)?.command, onPath);
  place(path.join(path.dirname(debug), host));
  assert.equal(resolveCodexCommand(missing, where)?.command, debug);

  const release = place(path.join(repoRoot, "codex-rs", "target", "release", exe));
  assert.equal(resolveCodexCommand(undefined, where)?.command, debug);
  place(path.join(path.dirname(release), host));
  assert.equal(resolveCodexCommand(missing, where)?.command, release);
  assert.equal(resolveCodexCommand(debug, where)?.command, debug);
  assert.equal(resolveCodexCommand(onPath, where)?.command, onPath);

  const installed = place(path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin", "hash", exe));
  const installedOnly = { env: { ...env, PATH: "" }, home, repoRoot: path.join(root, "empty") };
  assert.equal(resolveCodexCommand(missing, installedOnly)?.command, installed);
  assert.equal(resolveCodexCommand(missing, { env: { PATH: "" }, home, repoRoot: installedOnly.repoRoot }), null);
});

test("puts a backend package's codex-path first on app-server's PATH, when the package has one", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-ui-package-"));
  const codex = path.join(root, "bin", process.platform === "win32" ? "codex.exe" : "codex");
  mkdirSync(path.dirname(codex));
  writeFileSync(codex, "");
  const where = { env: { PATH: "" }, home: root, localBuilds: false };
  const command = resolveCodexCommand(codex, where);
  // Windows keeps the variable as Path; a second PATH key would leave the choice to Node.
  assert.deepEqual(withPackageTools(command, { Path: "inherited", OTHER: "kept" }), { Path: "inherited", OTHER: "kept" });
  mkdirSync(path.join(root, "codex-path"));
  const tools = path.join(root, "codex-path");
  assert.deepEqual(withPackageTools(command, { Path: "inherited", OTHER: "kept" }), { Path: tools + path.delimiter + "inherited", OTHER: "kept" });
  assert.deepEqual(withPackageTools(command, {}), { PATH: tools });
  assert.deepEqual(withPackageTools(resolveCodexCommand(fakeCodex, where), { PATH: "inherited" }), { PATH: "inherited" });
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

test("serves a PDF's bytes to the token holder, and only PDFs", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-pdf-"));
  const pdf = path.join(dir, "Doc.PDF");
  writeFileSync(pdf, "%PDF-1.4 test");
  writeFileSync(path.join(dir, "secret.txt"), "nope");
  await withBridge(async (port, auth) => {
    const at = (file) => `/api/pdf/${encodeURIComponent(path.basename(file))}?path=${encodeURIComponent(file)}`;
    const got = await request(port, { path: at(pdf), headers: auth });
    assert.equal(got.status, 200);
    assert.equal(got.headers["content-type"], "application/pdf");
    assert.equal(got.text, "%PDF-1.4 test");
    const head = await request(port, { method: "HEAD", path: at(pdf), headers: auth });
    assert.equal(head.headers["content-length"], "13");
    assert.equal(head.text, "");
    assert.equal((await request(port, { path: at(pdf), headers: { host: auth.host } })).status, 401);
    assert.equal((await request(port, { path: at(path.join(dir, "secret.txt")), headers: auth })).status, 400);
    assert.equal((await request(port, { path: at("Doc.PDF"), headers: auth })).status, 400);
    assert.equal((await request(port, { path: at(path.join(dir, "gone.pdf")), headers: auth })).status, 404);
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

test("turns on streamed patches and keeps them out of Codex's unstable-feature warning", async () => {
  await withBridge(async (port, auth) => {
    const frames = await readEvents(port, auth, (frame) => {
      if (frame.event === "hello") {
        const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
        request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body: `${JSON.stringify({ id: 8, method: "warn" })}\n` });
      }
      return frame.data.id === 8;
    });
    // The warning that named only the bridge's feature is gone; the other names the user's own.
    assert.deepEqual(
      frames.filter((frame) => frame.event === "message").map((frame) => frame.data),
      [
        { method: "warning", params: { threadId: "t", message: unstable("local_thread_store_compression") } },
        { id: 8, result: { argv: ["app-server", "-c", "features.apply_patch_streaming_events=true"] } },
      ],
    );
  });
});

for (const desktop of [false, true]) test(`transcribes dictation with ${desktop ? "desktop" : "Node"} transport under the session's private ChatGPT login`, async () => {
  const seen = [];
  const sent = [];
  const chatgptFetch = async (...args) => { sent.push(args[0]); return fetch(...args); };
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
    }, fakeCodex, desktop ? { chatgptFetch } : {});
    assert.equal(sent.length, desktop ? 2 : 0);
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

test("profile fields are bounded, HTTPS-only and contain no other account data", () => {
  assert.deepEqual(profileFields({ display_name: " 小明 ", profile_picture_url: "https://cdn.openai.com/avatar.png", token: "secret" }), { displayName: "小明", avatarUrl: "https://cdn.openai.com/avatar.png" });
  for (const profile_picture_url of ["javascript:alert(1)", "data:image/svg+xml,test", "http://example.com/a", "https://user:pass@example.com/a", {}, "x".repeat(2049)]) {
    assert.deepEqual(profileFields({ display_name: " ", username: "nick", profile_picture_url }), { displayName: "nick", avatarUrl: null });
  }
  assert.equal(profileFields(null), null);
  assert.equal(profileFields({ display_name: "x".repeat(257) }), null);
});

test("account profile uses this session's login, refreshes once and never exposes credentials", async () => {
  const seen = [];
  let fail = false;
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization, account: req.headers["chatgpt-account-id"] });
    if (fail) return void res.writeHead(503).end("private upstream error");
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ profile: { display_name: "测试昵称", profile_picture_url: "https://cdn.openai.com/test.png", email: "private@example.com" }, authToken: FRESH }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      assert.equal((await request(port, { path: "/api/account/profile" })).status, 401);
      assert.equal((await request(port, { path: "/api/account/profile", headers: auth })).status, 410);
      assert.equal((await request(port, { path: "/api/account/profile", headers: { ...auth, origin: "https://example.com" } })).status, 403);
      let work;
      const answers = [];
      const frames = await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          answers.push(await request(port, { path: `/api/account/profile?c=${c}`, headers: auth }));
          fail = true;
          answers.push(await request(port, { path: `/api/account/profile?c=${c}`, headers: auth }));
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: auth, body: JSON.stringify({ id: 91, method: "privateReply" }) });
        })();
        return frame.event === "message" && frame.data.id === 91;
      });
      await work;
      assert.equal(answers[0].status, 200);
      assert.equal(answers[0].headers["cache-control"], "no-store");
      assert.deepEqual(JSON.parse(answers[0].text), { profile: { displayName: "测试昵称", avatarUrl: "https://cdn.openai.com/test.png" } });
      assert.deepEqual(JSON.parse(answers[1].text), { profile: null });
      assert.ok(frames.every((frame) => !JSON.stringify(frame.data).includes("authToken")));
      assert.ok(answers.every((answer) => !answer.text.includes(FRESH) && !answer.text.includes("private")));
    });
    assert.deepEqual(seen.slice(0, 2), [STALE, FRESH].map((token) => ({ url: "/backend-api/wham/profiles/me", auth: `Bearer ${token}`, account: "acct-1" })));
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("Codex Cloud calls go out under this session's login, only on the allowed /wham routes", async () => {
  const seen = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, account: req.headers["chatgpt-account-id"], body: body ? JSON.parse(body) : null });
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/backend-api/wham/environments") return void res.end(JSON.stringify([{ id: "env-1", label: "web" }]));
    if (req.url === "/backend-api/wham/tasks") return void res.end(JSON.stringify({ task: { id: "task_e_1" } }));
    res.writeHead(404).end(JSON.stringify({ detail: "Not found" }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      const json = { ...auth, origin: `http://${auth.host}`, "content-type": "application/json" };
      let work;
      const answers = [];
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const call = (body) => request(port, { method: "POST", path: `/api/cloud?c=${frame.data.connectionId}`, headers: json, body: JSON.stringify(body) });
          answers.push(await call({ method: "GET", path: "/wham/environments" }));
          answers.push(await call({ method: "POST", path: "/wham/tasks", body: { new_task: { environment_id: "env-1", branch: "main" } } }));
          answers.push(await call({ method: "GET", path: "/wham/accounts/check" }));
          answers.push(await call({ method: "GET", path: "/wham/tasks/../profiles/me" }));
          answers.push(await call({ method: "DELETE", path: "/wham/environments/env-1" }));
          answers.push(await call({ method: "GET", path: "/wham/tasks/task_missing" }));
          await request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers: json, body: JSON.stringify({ id: 93, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 93;
      });
      await work;
      assert.deepEqual(answers.map((answer) => answer.status), [200, 200, 403, 403, 403, 200]);
      assert.deepEqual(JSON.parse(answers[0].text), { status: 200, body: [{ id: "env-1", label: "web" }] });
      assert.deepEqual(JSON.parse(answers[1].text), { status: 200, body: { task: { id: "task_e_1" } } });
      assert.deepEqual(JSON.parse(answers[5].text), { status: 404, body: { detail: "Not found" } });
      assert.ok(answers.every((answer) => !answer.text.includes(FRESH) && !answer.text.includes(STALE)));
    });
    assert.deepEqual(seen.map(({ method, url, auth }) => [method, url, auth]), [
      ["GET", "/backend-api/wham/environments", `Bearer ${STALE}`],
      ["GET", "/backend-api/wham/environments", `Bearer ${FRESH}`],
      ["POST", "/backend-api/wham/tasks", `Bearer ${STALE}`],
      ["POST", "/backend-api/wham/tasks", `Bearer ${FRESH}`],
      ["GET", "/backend-api/wham/tasks/task_missing", `Bearer ${STALE}`],
      ["GET", "/backend-api/wham/tasks/task_missing", `Bearer ${FRESH}`],
    ]);
    assert.equal(seen[3].account, "acct-1");
    assert.deepEqual(seen[3].body, { new_task: { environment_id: "env-1", branch: "main" } });
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("Dots calls go out as the Codex desktop app sends them, through the host's ChatGPT transport", async () => {
  const seen = [];
  const sent = [];
  const chatgptFetch = async (...args) => { sent.push(new URL(args[0]).pathname); return fetch(...args); };
  let eligible = true;
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, sku: req.headers["oai-product-sku"], account: req.headers["chatgpt-account-id"], body: body ? JSON.parse(body) : null });
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    res.setHeader("Content-Type", "application/json");
    // Another of the user's accounts has Dots; only the token's own counts.
    if (req.url === "/backend-api/accounts/check/v4-2023-04-27") return void res.end(JSON.stringify({ accounts: {
      "acct-1": { account: { plan_type: "pro", tbo_config: { plan_eligible: true, tbo_available: eligible } } },
      "acct-2": { account: { tbo_config: { tbo_available: true } } },
    } }));
    if (req.url === "/backend-api/tbo/primary") return void res.end(JSON.stringify({ selection: null }));
    if (req.url === "/backend-api/messaging/rooms/room_1/messages") return void res.end(JSON.stringify({ id: "msg_1" }));
    if (req.url === "/backend-api/wham/environments") return void res.end("[]");
    res.writeHead(404).end(JSON.stringify({ detail: "Not Found" }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      const json = { ...auth, origin: `http://${auth.host}`, "content-type": "application/json" };
      let work;
      const answers = [];
      const available = [];
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          const call = (body) => request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: json, body: JSON.stringify(body) });
          available.push(await request(port, { path: `/api/dots/available?c=${c}`, headers: auth }));
          eligible = false;
          available.push(await request(port, { path: `/api/dots/available?c=${c}`, headers: auth }));
          answers.push(await call({ method: "GET", path: "/tbo/primary" }));
          answers.push(await call({ method: "POST", path: "/messaging/rooms/room_1/messages", body: { content: { text: "你好", attachments: [] }, request_id: "r1" } }));
          answers.push(await call({ method: "GET", path: "/wham/environments" }));
          answers.push(await call({ method: "DELETE", path: "/tbo/tbo_1" }));
          answers.push(await call({ method: "POST", path: "/tbo/tbo_1/channels/email/claim" }));
          answers.push(await call({ method: "GET", path: "/messaging/rooms/../files" }));
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: json, body: JSON.stringify({ id: 94, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 94;
      });
      await work;
      assert.deepEqual(available.map((answer) => [answer.status, JSON.parse(answer.text)]), [[200, { available: true }], [200, { available: false }]]);
      assert.deepEqual(answers.map((answer) => answer.status), [200, 200, 200, 403, 403, 403]);
      assert.deepEqual(JSON.parse(answers[1].text), { status: 200, body: { id: "msg_1" } });
      assert.ok([...answers, ...available].every((answer) => !answer.text.includes(FRESH) && !answer.text.includes(STALE) && !answer.text.includes("acct-2")));
    }, fakeCodex, { chatgptFetch });
    // /wham keeps Node's stack and the Codex SKU; the rest goes as the desktop app sends it.
    assert.deepEqual(seen.filter((call) => call.sku === undefined).map(({ method, url }) => [method, url]), [
      ["GET", "/backend-api/accounts/check/v4-2023-04-27"], ["GET", "/backend-api/accounts/check/v4-2023-04-27"],
      ["GET", "/backend-api/accounts/check/v4-2023-04-27"], ["GET", "/backend-api/accounts/check/v4-2023-04-27"],
      ["GET", "/backend-api/tbo/primary"], ["GET", "/backend-api/tbo/primary"],
      ["POST", "/backend-api/messaging/rooms/room_1/messages"], ["POST", "/backend-api/messaging/rooms/room_1/messages"],
    ]);
    assert.deepEqual(seen.filter((call) => call.sku === "CODEX").map(({ url }) => url), ["/backend-api/wham/environments", "/backend-api/wham/environments"]);
    assert.ok(seen.every((call) => call.account === "acct-1"));
    assert.ok(sent.every((pathname) => !pathname.startsWith("/backend-api/wham/")));
    assert.equal(sent.length, 8);
    assert.deepEqual(seen.at(-3).body, { content: { text: "你好", attachments: [] }, request_id: "r1" });
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("API-key accounts never send their key to the profile service", async (t) => {
  const apiCodex = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-api-profile-")), "codex.mjs");
  writeFileSync(apiCodex, 'import { createInterface } from "node:readline"; createInterface({ input: process.stdin }).on("line", line => { const { id } = JSON.parse(line); process.stdout.write(JSON.stringify({ id, result: { authMethod: "apikey", authToken: "test-key" } }) + "\\n"); });');
  const upstream = t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  await withBridge(async (port, auth) => {
    let work, result;
    await readEvents(port, auth, (frame) => {
      if (frame.event === "hello") work = (async () => {
        const c = frame.data.connectionId;
        result = await request(port, { path: `/api/account/profile?c=${c}`, headers: auth });
        await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: auth, body: JSON.stringify({ id: 92, method: "ping" }) });
      })();
      return frame.event === "message" && frame.data.id === 92;
    });
    await work;
    assert.deepEqual(JSON.parse(result.text), { profile: null });
  }, apiCodex);
  assert.equal(upstream.mock.callCount(), 0);
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

test("serves Git preview replies over SSE including quoted untracked names", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "codex-ui-untracked-"));
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout;
  git("init", "-q", "-b", "main");
  git("config", "core.quotePath", "true");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base");
  const sha = git("rev-parse", "HEAD").trim();
  git("remote", "add", "origin", repo);
  git("update-ref", "refs/remotes/origin/main", sha);
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  writeFileSync(path.join(repo, "new.txt"), "ascii\n");
  writeFileSync(path.join(repo, "新文件.txt"), "第一行\n");
  const added = (name) => git("diff", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", name);
  const full = added("new.txt") + added("新文件.txt");
  await withBridge(async (port, auth) => {
    const answers = (frames) => frames.filter((frame) => frame.event === "message").map((frame) => frame.data);
    const frames = await readEvents(port, auth, (frame, frames) => {
      if (frame.event === "hello") {
        const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
        const body = [1, 2].map((id) => JSON.stringify({ id, method: "gitDiffToRemote", params: { cwd: repo } })).join("\n");
        request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body });
      }
      return answers(frames).length === 2;
    });
    // The service reads each file once, independent of the backend's Unicode-path support.
    const sorted = answers(frames).sort((a, b) => a.id - b.id);
    assert.deepEqual(sorted, [1, 2].map((id) => ({ id, result: { sha, diff: full } })));
  });
});

test("answers the environment dialog's Git requests itself, never passing them to the backend", async () => {
  const repo = mkdtempSync(path.join(tmpdir(), "codex-ui-branches-"));
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout;
  git("init", "-q", "-b", "main");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base");
  git("branch", "feature");
  await withBridge(async (port, auth) => {
    const answers = (frames) => frames.filter((frame) => frame.event === "message" && frame.data.id >= 10).map((frame) => frame.data);
    const frames = await readEvents(port, auth, (frame, frames) => {
      if (frame.event === "hello") {
        const headers = { ...auth, origin: `http://${auth.host}`, "content-type": "application/x-ndjson" };
        const body = [
          { id: 10, method: "codexUi/git/branches", params: { cwd: repo } },
          { id: 11, method: "codexUi/git/switch", params: { cwd: repo, branch: "--force" } },
          { id: 12, method: "codexUi/git/branches", params: {} },
        ].map((message) => JSON.stringify(message)).join("\n");
        request(port, { method: "POST", path: `/api/send?c=${frame.data.connectionId}`, headers, body });
      }
      return answers(frames).length === 3;
    });
    const [branches, refused, invalid] = answers(frames).sort((a, b) => a.id - b.id);
    assert.deepEqual([branches.result.inRepo, branches.result.head, branches.result.branches.sort()], [true, "main", ["feature", "main"]]);
    assert.equal(refused.error.message, "无效的分支名称。");
    assert.equal(invalid.error.code, -32602);
  });
});
