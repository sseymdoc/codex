import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createAutomations } from "./automations.mjs";
import { createBridge } from "./bridge.mjs";
import { createOrbitFiles } from "./orbit.mjs";
import { createOrchestrator, installedCodex, profileFields, resolveCodexCommand, transcribeError, withPackageTools } from "./orchestrator.mjs";

// ChatGPT access tokens as getAuthStatus hands them out: a stale one, then a refreshed one.
const jwt = (sub) => ["e30", Buffer.from(JSON.stringify({ sub, "https://api.openai.com/auth": { chatgpt_account_id: "acct-1", chatgpt_user_id: "user-1" } })).toString("base64url"), "sig"].join(".");
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
function readEvents(port, headers, until, target = "/api/events") {
  return new Promise((resolve, reject) => {
    const frames = [];
    const req = http.get({ host: "127.0.0.1", port, path: target, headers }, (res) => {
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
          answers.push(await call({ method: "GET", path: "/tbo/tbo_1/doctor" }));
          answers.push(await call({ method: "DELETE", path: "/tbo/tbo_1/activity" }));
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

test("a dot room's files, avatars and live events stay behind the bridge", async () => {
  const seen = [];
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers["content-type"] ?? "", body: body.toString("latin1") });
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    if (req.url === "/backend-api/messaging/rooms/room_1/files") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "file_1", status: "ready" }));
    if (req.url === "/backend-api/celsius/ws/user") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ websocket_url: "wss://celsius.example/ws?ticket=SOCKET-SECRET" }));
    if (req.url === "/backend-api/files/download/file_1") return void res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
    if (req.url === "/backend-api/files/page") return void res.writeHead(200, { "Content-Type": "text/html" }).end("<script>alert(1)</script>");
    if (req.url === "/backend-api/files/moved") return void res.writeHead(302, { Location: "https://evil.example/steal" }).end();
    res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${backend.address().port}/backend-api`;
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = base;
  // The pubsub socket: it opens, answers the subscribe with a missed message, then pushes one.
  const sockets = [];
  class FakeSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = url;
      this.sent = [];
      sockets.push(this);
      setTimeout(() => this.dispatchEvent(new Event("open")), 0);
    }
    send(text) {
      const commands = JSON.parse(text);
      this.sent.push(...commands.map((entry) => entry.command));
      const subscribe = commands.find((entry) => entry.command.type === "subscribe");
      if (!subscribe) return;
      const message = (offset, type) => ({ type: "message", topic_id: "calpico-chatgpt-messaging", offset, payload: { type, payload: { room_id: "room_1" } } });
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify([{ id: subscribe.id, reply: { type: "subscribe", topic_id: "calpico-chatgpt-messaging", recovered: true, catchups: [message("4", "calpico-message-update")], last_offset: "4" } }]) }));
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify([message("5", "calpico-message-add"), { type: "message", topic_id: "other", payload: { type: "x" } }]) }));
      }, 0);
    }
    close() { this.dispatchEvent(new Event("close")); }
  }
  try {
    await withBridge(async (port, auth) => {
      const json = { ...auth, origin: `http://${auth.host}` };
      let work;
      const results = {};
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          const upload = (params, body) => request(port, { method: "POST", path: `/api/dots/upload?${new URLSearchParams({ c, ...params })}`, headers: json, body });
          results.upload = await upload({ path: "/messaging/rooms/room_1/files", name: "图.png", type: "image/png" }, PNG);
          results.notMultipart = await upload({ path: "/tbo/tbo_1/messaging-room", name: "x", type: "text/plain" }, "x");
          results.tooLarge = await upload({ path: "/messaging/rooms/room_1/files", name: "big.bin", type: "application/octet-stream" }, Buffer.alloc(20 * 1024 * 1024 + 1));
          const content = (url, name = "") => request(port, { path: `/api/dots/content?${new URLSearchParams({ c, url, name })}`, headers: auth });
          results.image = await content(`${base}/files/download/file_1`, "图.png");
          results.page = await content(`${base}/files/page`, "page.html");
          results.foreign = await content("https://evil.example/x");
          results.redirect = await content(`${base}/files/moved`);
          results.internal = await request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: { ...json, "content-type": "application/json" }, body: JSON.stringify({ method: "GET", path: "/celsius/ws/user" }) });
          results.events = await new Promise((resolve, reject) => {
            const frames = [];
            const req = http.get({ host: "127.0.0.1", port, path: `/api/dots/events?c=${c}`, headers: auth }, (res) => {
              let buffer = "";
              res.on("data", (chunk) => {
                buffer += chunk;
                for (let end; (end = buffer.indexOf("\n\n")) !== -1; buffer = buffer.slice(end + 2)) {
                  const frame = buffer.slice(0, end);
                  if (frame.startsWith(":")) continue;
                  frames.push({ event: /^event: (.*)$/m.exec(frame)[1], data: JSON.parse(/^data: (.*)$/m.exec(frame)[1]), raw: frame });
                  if (frames.length === 4) {
                    req.destroy();
                    resolve(frames);
                  }
                }
              });
            });
            req.on("error", (error) => (error.code === "ECONNRESET" ? undefined : reject(error)));
          });
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: json, body: JSON.stringify({ id: 95, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 95;
      });
      await work;
      assert.deepEqual([results.upload.status, JSON.parse(results.upload.text)], [200, { status: 200, body: { id: "file_1", status: "ready" } }]);
      assert.deepEqual([results.notMultipart.status, results.tooLarge.status, results.foreign.status, results.redirect.status, results.internal.status], [403, 413, 403, 403, 403]);
      assert.equal(results.image.status, 200);
      assert.equal(results.image.headers["content-type"], "image/png");
      assert.match(results.image.headers["content-disposition"], /^inline; filename\*=UTF-8''%E5%9B%BE\.png$/);
      assert.equal(results.image.headers["content-security-policy"], "sandbox; default-src 'none'");
      // Upstream HTML never renders here: it downloads, sandboxed.
      assert.equal(results.page.headers["content-type"], "application/octet-stream");
      assert.match(results.page.headers["content-disposition"], /^attachment;/);
      assert.deepEqual(results.events.map((frame) => [frame.event, frame.data]), [
        ["live", { live: true }],
        ["dots", { type: "resync" }],
        ["dots", { type: "calpico-message-update", payload: { room_id: "room_1" } }],
        ["dots", { type: "calpico-message-add", payload: { room_id: "room_1" } }],
      ]);
      const everything = Object.values(results).flatMap((result) => (Array.isArray(result) ? result.map((frame) => frame.raw) : [result.text]));
      assert.ok(everything.every((text) => !text.includes(FRESH) && !text.includes(STALE) && !text.includes("SOCKET-SECRET")));
    }, fakeCodex, { webSocket: FakeSocket });
    assert.equal(sockets[0].url, "wss://celsius.example/ws?ticket=SOCKET-SECRET");
    assert.deepEqual(sockets[0].sent, [
      { presence: { state: "foreground", type: "presence" }, type: "connect" },
      { topic_id: "calpico-chatgpt-messaging", type: "subscribe" },
    ]);
    // The upload went out as multipart under the login, built anew for the retry after a 401.
    const uploads = seen.filter((call) => call.url === "/backend-api/messaging/rooms/room_1/files");
    assert.deepEqual(uploads.map((call) => call.auth), [`Bearer ${STALE}`, `Bearer ${FRESH}`]);
    assert.ok(uploads.every((call) => call.type.startsWith("multipart/form-data; boundary=") && call.body.includes('name="file"') && call.body.includes("\x89PNG")));
    // Files from ChatGPT carry the login; the redirect elsewhere was never followed.
    assert.ok(seen.filter((call) => call.url.startsWith("/backend-api/files/")).every((call) => call.auth));
    assert.ok(!seen.some((call) => call.url.includes("steal")));
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("the dot character runtime comes from the installed Codex app's archive, only its own files", async () => {
  // A tiny app.asar: the pickle header (4, 8 + padded JSON, …, JSON length), the JSON, then the files.
  const files = { "runtime/bundle.json": JSON.stringify({ files: { "orbit-characters.data": { sha256: "e".repeat(64) } } }), "f0/frame.html": "<!doctype html><title>frame</title>", "f0/frame.mjs": "export {};" };
  const tree = { files: {} };
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    let node = tree;
    const parts = ["webview", "assets", "orbit-character-abc123", ...name.split("/")];
    for (const part of parts.slice(0, -1)) node = node.files[part] ??= { files: {} };
    node.files[parts.at(-1)] = { size: Buffer.byteLength(text), offset: String(offset) };
    offset += Buffer.byteLength(text);
  }
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4)]);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded.length, 4);
  head.writeUInt32LE(4 + padded.length, 8);
  head.writeUInt32LE(json.length, 12);
  const asar = path.join(mkdtempSync(path.join(tmpdir(), "codex-ui-orbit-")), "app.asar");
  writeFileSync(asar, Buffer.concat([head, padded, ...Object.values(files).map((text) => Buffer.from(text))]));
  const orbit = createOrbitFiles({ locate: async () => asar });
  await withBridge(async (port, auth) => {
    const info = await request(port, { path: "/api/dots/orbit", headers: auth });
    assert.deepEqual(JSON.parse(info.text), { bundleId: "e".repeat(64), frame: "/api/dots/orbit/files/orbit-character-abc123/f0/frame.html" });
    const frame = await request(port, { path: "/api/dots/orbit/files/orbit-character-abc123/f0/frame.html", headers: auth });
    assert.equal(frame.text, files["f0/frame.html"]);
    assert.equal(frame.headers["content-type"], "text/html; charset=utf-8");
    assert.match(frame.headers["content-security-policy"], /script-src 'self' 'wasm-unsafe-eval'.*frame-ancestors 'self'/);
    const script = await request(port, { path: "/api/dots/orbit/files/orbit-character-abc123/f0/frame.mjs", headers: auth });
    assert.deepEqual([script.status, script.headers["content-type"], script.text], [200, "text/javascript; charset=utf-8", "export {};"]);
    for (const refused of ["orbit-character-abc123/f0/frame%2Fmjs", "orbit-character-other/f0/frame.html", "orbit-character-abc123/f0/frame.exe", "orbit-character-abc123/f0/missing.mjs"]) {
      assert.equal((await request(port, { path: `/api/dots/orbit/files/${refused}`, headers: auth })).status, 404, refused);
    }
    assert.equal((await request(port, { path: "/api/dots/orbit", headers: { host: auth.host } })).status, 401);
  }, fakeCodex, { orbit });
  // Without the app there is nothing to serve, and the page is told so.
  await withBridge(async (port, auth) => {
    assert.deepEqual(JSON.parse((await request(port, { path: "/api/dots/orbit", headers: auth })).text), { bundleId: null, frame: null });
  }, fakeCodex, { orbit: createOrbitFiles({ locate: async () => null }) });
});

test("a character snapshot goes up as a PNG with its manifest, nothing else", async () => {
  const seen = [];
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ url: req.url, body: Buffer.concat(chunks).toString("latin1") });
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ snapshot: { asset_pointer: "sediment://file_1" } }));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      let work;
      const answers = [];
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          const headers = { ...auth, origin: `http://${auth.host}` };
          const upload = (type, body, fields = { avatar_manifest: JSON.stringify({ schema_version: 1 }) }) => request(port, {
            method: "POST", headers, body,
            path: `/api/dots/upload?${new URLSearchParams({ c, path: "/cloud-aeons/avatar-snapshots", name: "avatar.png", type, fields: JSON.stringify(fields) })}`,
          });
          const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("pixels")]);
          answers.push(await upload("image/png", Buffer.from("<svg/>")));
          answers.push(await upload("image/svg+xml", png));
          answers.push(await upload("image/png", png, { avatar_manifest: 1 }));
          answers.push(await upload("image/png", png));
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers, body: JSON.stringify({ id: 96, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 96;
      });
      await work;
      assert.deepEqual(answers.map((answer) => answer.status), [415, 415, 400, 200]);
      assert.deepEqual(JSON.parse(answers[3].text), { status: 200, body: { snapshot: { asset_pointer: "sediment://file_1" } } });
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0].body, /name="avatar_manifest"\r\n\r\n\{"schema_version":1\}/);
    assert.match(seen[0].body, /name="file"; filename="avatar.png"\r\nContent-Type: image\/png/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("a dot's durable host: connected as the desktop app does, only its thread calls, closed with the page", async () => {
  const sockets = [];
  class FakeSocket extends EventTarget {
    constructor(url, options) {
      super();
      Object.assign(this, { url, options, sent: [], readyState: 0 });
      sockets.push(this);
      setTimeout(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      }, 0);
    }
    send(text) {
      const message = JSON.parse(text);
      this.sent.push(message);
      if (message.id !== undefined) setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: message.id, result: { echoed: message.method } }) })), 0);
    }
    close() {
      this.readyState = 3;
      this.closed = true;
      this.dispatchEvent(new Event("close"));
    }
  }
  const previous = process.env.CODEX_DURABLE_HOST_URL;
  process.env.CODEX_DURABLE_HOST_URL = "ws://127.0.0.1:1/";
  try {
    await withBridge(async (port, auth) => {
      const json = { ...auth, origin: `http://${auth.host}` };
      let parent;
      let work;
      const frames = [];
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello" && !parent) {
          parent = frame.data.connectionId;
          work = new Promise((resolve, reject) => {
            const req = http.get({ host: "127.0.0.1", port, path: `/api/events?durable=${parent}`, headers: auth }, (res) => {
              let buffer = "";
              let durable;
              let leaving = false;
              res.on("data", (chunk) => {
                buffer += chunk;
                for (let end; (end = buffer.indexOf("\n\n")) !== -1; buffer = buffer.slice(end + 2)) {
                  const text = buffer.slice(0, end);
                  if (text.startsWith(":")) continue;
                  const event = /^event: (.*)$/m.exec(text)?.[1] ?? "message";
                  const data = JSON.parse(/^data: (.*)$/m.exec(text)[1]);
                  frames.push({ event, data });
                  if (event === "hello" && !durable) {
                    durable = data.connectionId;
                    const send = (body) => request(port, { method: "POST", path: `/api/send?c=${encodeURIComponent(durable)}`, headers: json, body: JSON.stringify(body) });
                    void (async () => {
                      await send({ id: 1, method: "thread/resume", params: { threadId: "th_root" } });
                      await send({ id: 2, method: "thread/start", params: {} });
                      await send({ id: 3, method: "turn/addUserMessage", params: { threadId: "th_root", input: [], clientUserMessageId: "c1", messageThreadId: "m1" } });
                    })();
                  }
                  if (!leaving && frames.filter((item) => item.event === "message").length === 3) {
                    leaving = true;
                    // The page's own connection goes: the durable one goes with it.
                    void request(port, { method: "POST", path: `/api/send?c=${parent}`, headers: json, body: JSON.stringify({ id: 97, method: "ping" }) });
                  }
                  if (event === "exit") {
                    req.destroy();
                    resolve();
                  }
                }
              });
            });
            req.on("error", (error) => (error.code === "ECONNRESET" ? undefined : reject(error)));
          });
        }
        return frame.event === "message" && frame.data.id === 97;
      });
      await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 300))]);
      const [socket] = sockets;
      assert.equal(socket.url, "ws://127.0.0.1:1/");
      assert.deepEqual(socket.options.protocols, ["codex-app-server", "codex-client.desktop", `openai-bearer.${STALE}`]);
      assert.deepEqual(socket.options.headers, { "X-OpenAI-Product-Sku": "codex", "ChatGPT-Account-Id": "acct-1" });
      assert.deepEqual(socket.sent.map((message) => message.method), ["thread/resume", "turn/addUserMessage"]);
      const messages = frames.filter((item) => item.event === "message").map((item) => item.data);
      assert.deepEqual(messages.find((message) => message.id === 2).error.code, -32601);
      assert.deepEqual(messages.filter((message) => message.result).map((message) => message.result.echoed), ["thread/resume", "turn/addUserMessage"]);
      assert.ok(frames.every((frame) => !JSON.stringify(frame).includes(STALE)));
    }, fakeCodex, { webSocket: FakeSocket });
    assert.equal(sockets[0].closed, true);
    // Only wss leaves the machine; plain ws only on loopback.
    process.env.CODEX_DURABLE_HOST_URL = "ws://example.com/";
    await withBridge(async (port, auth) => {
      let work;
      let answer = "";
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const parentId = frame.data.connectionId;
          answer = await new Promise((resolve) => http.get({ host: "127.0.0.1", port, path: `/api/events?durable=${parentId}`, headers: auth }, (res) => {
            let text = "";
            res.on("data", (chunk) => {
              text += chunk;
              if (text.includes("event: fatal")) { res.destroy(); resolve(text); }
            });
          }));
          await request(port, { method: "POST", path: `/api/send?c=${parentId}`, headers: { ...auth, origin: `http://${auth.host}` }, body: JSON.stringify({ id: 99, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 99;
      });
      await work;
      assert.match(answer, /Durable host URL is not allowed/);
    }, fakeCodex, { webSocket: FakeSocket });
    assert.equal(sockets.length, 1);
  } finally {
    if (previous === undefined) delete process.env.CODEX_DURABLE_HOST_URL;
    else process.env.CODEX_DURABLE_HOST_URL = previous;
  }
});

test("a dot's activity streams through as it comes, only from its own stream route", async () => {
  const backend = http.createServer((req, res) => {
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    if (req.url !== "/backend-api/tbo/tbo_1/activity/stream") return void res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: snapshot\ndata: {}\n\n");
    setTimeout(() => res.end(`event: upsert\ndata: ${JSON.stringify({ thread_id: "th_1", title: "任务" })}\n\n`), 20);
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      let work;
      const results = {};
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          const stream = (path) => request(port, { path: `/api/cloud/stream?${new URLSearchParams({ c, path })}`, headers: auth });
          results.ok = await stream("/tbo/tbo_1/activity/stream");
          results.json = await stream("/tbo/tbo_1/activity");
          results.page = await request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: { ...auth, origin: `http://${auth.host}`, "content-type": "application/json" }, body: JSON.stringify({ method: "GET", path: "/tbo/tbo_1/activity/stream" }) });
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: { ...auth, origin: `http://${auth.host}` }, body: JSON.stringify({ id: 98, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 98;
      });
      await work;
      assert.equal(results.ok.headers["content-type"], "text/event-stream; charset=utf-8");
      assert.equal(results.ok.text, `event: snapshot\ndata: {}\n\nevent: upsert\ndata: ${JSON.stringify({ thread_id: "th_1", title: "任务" })}\n\n`);
      assert.deepEqual([results.json.status, results.page.status], [403, 403]);
    });
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
    assert.deepEqual(JSON.parse(ok.text), { usedTokens: 40, windowTokens: 100, mcpDeferred: false, system: 10, tools: 20, skills: 0, agents: 0, memory: 0, mcp: 0, apps: 0, memoryFiles: [] });
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

test("a dot call's answer comes back as text, with the call's Location and root thread beside it", async () => {
  const seen = [];
  const backend = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body, sku: req.headers["oai-product-sku"] });
      if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
      if (req.url === "/backend-api/tbo/tbo_1/voice/calls") {
        return void res.writeHead(201, { "Content-Type": "application/sdp", Location: "/backend-api/tbo/tbo_1/voice/calls/call_9", "OpenAI-Root-Thread-ID": "th_root" }).end("v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n");
      }
      if (req.url === "/backend-api/tbo/tbo_2/voice/calls") return void res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ detail: "busy" }));
      res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge(async (port, auth) => {
      let work;
      const results = {};
      await readEvents(port, auth, (frame) => {
        if (frame.event === "hello") work = (async () => {
          const c = frame.data.connectionId;
          const cloud = (body) => request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: { ...auth, origin: `http://${auth.host}`, "content-type": "application/json" }, body: JSON.stringify(body) });
          results.call = await cloud({ method: "POST", path: "/tbo/tbo_1/voice/calls", body: { sdp: "offer" } });
          results.busy = await cloud({ method: "POST", path: "/tbo/tbo_2/voice/calls", body: { sdp: "offer" } });
          results.stop = await cloud({ method: "POST", path: "/tbo/tbo_1/voice/calls/call_9/stop" });
          results.refused = await cloud({ method: "POST", path: "/tbo/tbo_1/voice/calls/call_9/hangup" });
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: { ...auth, origin: `http://${auth.host}` }, body: JSON.stringify({ id: 99, method: "ping" }) });
        })();
        return frame.event === "message" && frame.data.id === 99;
      });
      await work;
      assert.deepEqual(JSON.parse(results.call.text), { status: 201, body: { text: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n", location: "/backend-api/tbo/tbo_1/voice/calls/call_9", rootThreadId: "th_root" } });
      assert.deepEqual(JSON.parse(results.busy.text), { status: 409, body: { detail: "busy" } });
      assert.equal(JSON.parse(results.stop.text).status, 200);
      assert.equal(results.refused.status, 403);
      const offer = seen.find((item) => item.url === "/backend-api/tbo/tbo_1/voice/calls" && item.body);
      assert.deepEqual(JSON.parse(offer.body), { sdp: "offer" });
      assert.equal(offer.sku, undefined);
    });
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    backend.close();
  }
});

test("the local computer: desktop only, registered under the login, its exec-server started, the dot's threads told, off again", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-ui-executor-"));
  // `codex exec-server` reaches rendezvous and stays until its stdin closes; anything else is the
  // fake app-server.
  const codex = path.join(dir, "codex.mjs");
  writeFileSync(codex, `import { writeFileSync } from "node:fs";
if (process.argv.includes("exec-server")) {
  writeFileSync(${JSON.stringify(path.join(dir, "exec-server.json"))}, JSON.stringify({ argv: process.argv.slice(2), pid: process.pid, exit: process.env.CODEX_EXEC_SERVER_EXIT_ON_STDIN_CLOSE }));
  process.stderr.write('INFO codex_exec_server::remote: connected noise_event="rendezvous_connection" noise_outcome="ok"\\n');
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else await import(${JSON.stringify(pathToFileURL(fakeCodex).href)});
`);
  const registrations = [];
  const backend = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
      if (req.method === "POST" && req.url === "/backend-api/flora/cca/executor") {
        registrations.push({ body: JSON.parse(body), account: req.headers["chatgpt-account-id"] });
        return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ executor_id: "env_local" }));
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const told = [];
  class FakeSocket extends EventTarget {
    constructor(url, options) {
      super();
      Object.assign(this, { url, options, readyState: 0 });
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0);
    }
    send(text) {
      const { id, method, params } = JSON.parse(text);
      if (id === undefined) return;
      const result = method === "thread/list" ? (params.cursor ? { data: [{ id: "th_task", threadSource: "aeon_child", environments: [{ environmentId: "env_local" }] }], nextCursor: null } : {
        data: [
          { id: "th_root", threadSource: "aeon", environments: [{ environmentId: "env_local" }] },
          { id: "th_elsewhere", threadSource: "aeon", environments: [{ environmentId: "env_other" }] },
          { id: "th_mine", threadSource: "vscode", environments: [{ environmentId: "env_local" }] },
        ],
        nextCursor: "page-2",
      }) : {};
      if (method === "thread/environmentReady") told.push(params);
      setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id, result }) })), 0);
    }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  const env = { CODEX_API_BASE_URL: `http://127.0.0.1:${backend.address().port}/backend-api`, CODEX_TPP_LOCAL_EXECUTOR_REMOTE_URL: "http://127.0.0.1:9/api", CODEX_DURABLE_HOST_URL: "ws://127.0.0.1:1/" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const page = (port, auth, run) => withPage(port, auth, run);
  try {
    // The browser page has no local computer.
    await withBridge(async (port, auth) => {
      await page(port, auth, async (c, json) => {
        assert.deepEqual(JSON.parse((await request(port, { path: `/api/executor?c=${c}`, headers: auth })).text), { available: false });
        assert.equal((await request(port, { method: "POST", path: `/api/executor?c=${c}&enabled=1`, headers: json })).status, 404);
      });
    }, codex);

    let spawned;
    await withBridge(async (port, auth) => {
      await page(port, auth, async (c, json) => {
        const state = async () => JSON.parse((await request(port, { path: `/api/executor?c=${c}`, headers: auth })).text);
        assert.deepEqual(await state(), { available: true, enabled: false, environmentId: null, ready: false, error: null });
        assert.equal((await request(port, { method: "POST", path: `/api/executor?c=${c}&enabled=yes`, headers: json })).status, 400);
        // Registering is the bridge's own call, never the page's.
        const refused = await request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: { ...json, "content-type": "application/json" }, body: JSON.stringify({ method: "POST", path: "/flora/cca/executor", body: {} }) });
        assert.equal(refused.status, 403);
        assert.equal(JSON.parse((await request(port, { method: "POST", path: `/api/executor?c=${c}&enabled=1`, headers: json })).text).enabled, true);
        for (let tries = 0; !(await state()).ready; tries++) {
          assert.ok(tries < 200, "never ready");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        for (let tries = 0; told.length < 2; tries++) {
          assert.ok(tries < 200, "threads never told");
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        spawned = JSON.parse(readFileSync(path.join(dir, "exec-server.json"), "utf8"));
        assert.equal(JSON.parse((await request(port, { method: "POST", path: `/api/executor?c=${c}&enabled=0`, headers: json })).text).enabled, false);
      });
    }, codex, { webSocket: FakeSocket, localExecutor: { dir } });
    assert.deepEqual(spawned.argv.slice(-7), ["-c", 'forced_login_method="chatgpt"', "exec-server", "--remote", "http://127.0.0.1:9/api", "--environment-id", "env_local"]);
    assert.equal(spawned.exit, "true");
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].account, "acct-1");
    assert.match(registrations[0].body.installation_id, /^[0-9a-f-]{36}$/);
    assert.equal(registrations[0].body.selected_capability_roots[0].id, "codex-home-skills");
    // Only the dot's threads on this computer, each once, with its capability roots.
    assert.deepEqual(told.map((item) => item.threadId).sort(), ["th_root", "th_task"]);
    assert.equal(told[0].environmentId, "env_local");
    assert.equal(told[0].selectedCapabilityRoots[0].location.type, "environment");
    assert.equal(told[0].selectedCapabilityRoots[0].location.environmentId, "env_local");
    assert.ok(!JSON.stringify(spawned).includes(STALE) && !JSON.stringify(spawned).includes(FRESH));
    for (let tries = 0; ; tries++) {
      try { process.kill(spawned.pid, 0); } catch { break; }
      assert.ok(tries < 200, "exec-server outlived turning it off");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, "local-executor.json"), "utf8")), { installationId: registrations[0].body.installation_id, enabled: false });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    backend.close();
  }
});

// The library's backend and its file host: ChatGPT's /backend-api, and a stand-in for
// *.oaiusercontent.com that the injected chatgptFetch reaches by hostname (as /<host>/<path>).
// Every call is logged; the login's stale token gets a 401 everywhere on the backend.
const PDF = Buffer.from("%PDF-1.7\n%");
const SIGNED = (host, file) => `https://${host}.oaiusercontent.com/${file}?se=2099&sig=SIGNED-SECRET`;
async function withLibrary(run, options = {}) {
  const seen = [];
  const blobs = [];
  const sent = [];
  const download = {
    file_img: SIGNED("sdmntprwestus", "files/img"), file_doc: "/backend-api/estuary/content?id=file_doc&sig=E", "file_doc~ver_1": "/backend-api/estuary/content?id=file_doc&sig=E", file_evil: "https://evil.example/x",
    file_hop: SIGNED("sdmntprwestus", "hop"), file_hop2: SIGNED("sdmntprwestus", "hop2"), file_html: SIGNED("sdmntprwestus", "files/html"),
    file_pdf: SIGNED("sdmntprwestus", "files/pdf"), file_svg: SIGNED("sdmntprwestus", "files/svg"), file_huge: SIGNED("sdmntprwestus", "files/huge"), file_flood: SIGNED("sdmntprwestus", "files/flood"),
    file_att: SIGNED("sdmntprwestus", "files/att"), file_short: SIGNED("sdmntprwestus", "files/short"),
    file_slow: SIGNED("sdmntprwestus", "files/slow"), file_hang: SIGNED("sdmntprwestus", "files/hang"),
  };
  // File host answers the test finishes itself.
  const held = [];
  const backend = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, sheep: req.headers["x-openai-use-sheep"], accept: req.headers.accept, type: req.headers["content-type"], body });
    if (req.headers.authorization === `Bearer ${STALE}`) return void res.writeHead(401).end("{}");
    const json = (value, status = 200) => void res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    const route = `${req.method} ${req.url.split("?")[0]}`;
    const file = /^GET \/backend-api\/files\/download\/([\w~]+)$/.exec(route)?.[1];
    if (file && /\?(?:inline=|download_intent=false$)/.test(req.url)) return download[file] ? json({ status: "success", download_url: download[file] }) : json({ detail: "Not Found" }, 404);
    switch (route) {
      case "GET /backend-api/accounts/check/v4-2023-04-27": return json({ account_ordering: ["acct-1"], accounts: { "acct-1": { account: { account_id: "acct-1", plan_type: "plus" }, features: ["writing_blocks_document_mode"] } } });
      case "POST /backend-api/wham/statsig/bootstrap": return json({ statsigPayload: JSON.stringify({ has_updates: true, feature_gates: { 224248639: { value: true } }, dynamic_configs: { 3333071866: { value: { enabled: true } } } }) });
      case "GET /backend-api/settings/user": return json({ flags: {} });
      case "GET /backend-api/files/library/nodes": return json({ items: [], cursor: null });
      case "DELETE /backend-api/files/library/files/libfile_1": return json({ success: true });
      case "GET /backend-api/files/download/file_dots": return json({ status: "success", download_url: "https://example.invalid/dots" });
      case "PATCH /backend-api/learning/flashcards/libfile_f": return json({ ok: true });
      case "GET /backend-api/learning/flashcards/libfile_f/progress": return json({ card_progress: {} });
      case "GET /backend-api/estuary/content": return void res.writeHead(200, { "Content-Type": "text/plain" }).end("estuary bytes");
      case "GET /backend-api/files/library/files/libfile_t/thumbnail": return json({ thumbnail_url: "https://chatgpt.com/api/library/files/libfile_t/thumbnail" });
      case "GET /backend-api/files/library/files/libfile_t/thumbnail_url": return json({ thumbnail_url: SIGNED("sdmntprwestus", "files/thumb") });
      case "POST /backend-api/files": return json({ file_id: "file_up", upload_url: SIGNED("sdmntprwestus", "upload/file_up").replace("SIGNED-SECRET", "UPLOAD-SECRET"), upload_headers: { "x-ms-meta-source": "codex" } });
      case "POST /backend-api/files/process_upload_stream":
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(`${JSON.stringify({ event: "file.processing.progress", file_id: "file_up", progress: 100 })}\n`);
        return void res.end(JSON.stringify({ event: "file.processing.file_ready", file_id: "file_up", extra: { metadata_object_id: "libfile_up" } }));
      default: return json({ detail: "Not Found" }, 404);
    }
  });
  const blob = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    blobs.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    const at = req.url.split("?")[0];
    if (at === "/sdmntprwestus.oaiusercontent.com/files/img" || at === "/sdmntprseasia.oaiusercontent.com/files/img") return void res.writeHead(200, { "Content-Type": "image/png" }).end(PNG_BYTES);
    if (at === "/sdmntprwestus.oaiusercontent.com/hop") return void res.writeHead(302, { Location: "https://evil.example/steal" }).end();
    if (at === "/sdmntprwestus.oaiusercontent.com/hop2") return void res.writeHead(302, { Location: "https://sdmntprseasia.oaiusercontent.com/files/img?sig=2" }).end();
    if (at === "/sdmntprwestus.oaiusercontent.com/files/html") return void res.writeHead(200, { "Content-Type": "text/html" }).end("<script>alert(1)</script><img src=https://evil.example/b>");
    if (at === "/sdmntprwestus.oaiusercontent.com/files/svg") return void res.writeHead(200, { "Content-Type": "image/svg+xml" }).end("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    if (at === "/sdmntprwestus.oaiusercontent.com/files/thumb") return void res.writeHead(200, { "Content-Type": "image/webp" }).end("webp");
    if (at === "/sdmntprwestus.oaiusercontent.com/files/pdf") {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
      if (range) return void res.writeHead(206, { "Content-Type": "application/pdf", "Content-Range": `bytes ${range[1]}-${range[2]}/${PDF.length}`, "Accept-Ranges": "bytes" }).end(PDF.subarray(Number(range[1]), Number(range[2]) + 1));
      return void res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(PDF.length), "Accept-Ranges": "bytes" }).end(PDF);
    }
    if (at === "/sdmntprwestus.oaiusercontent.com/files/huge") {
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": String(41943040 + 1) }).flushHeaders();
      return void setTimeout(() => res.destroy(), 500);
    }
    if (at === "/sdmntprwestus.oaiusercontent.com/files/flood") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      for (let i = 0; i < 41; i++) res.write(Buffer.alloc(1024 * 1024, "x"));
      return void res.end("xx");
    }
    if (at === "/sdmntprwestus.oaiusercontent.com/files/att") return void res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "5" }).end("hello");
    if (at === "/sdmntprwestus.oaiusercontent.com/files/short") {
      res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "10" });
      res.write("abc");
      return void setTimeout(() => res.destroy(), 20);
    }
    if (at === "/sdmntprwestus.oaiusercontent.com/files/slow") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.write("abc");
      return void held.push({ at, res });
    }
    if (at === "/sdmntprwestus.oaiusercontent.com/files/hang") return void held.push({ at, res });
    if (req.method === "PUT" && at === "/sdmntprwestus.oaiusercontent.com/upload/file_up") return void res.writeHead(201).end();
    res.writeHead(404).end();
  });
  await Promise.all([backend, blob].map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));
  // The desktop shell's net.fetch stands in for both; nothing reaches the internet.
  const chatgptFetch = async (url, init) => {
    const target = new URL(url);
    sent.push({ host: target.host, path: target.pathname, auth: init?.headers?.Authorization, redirect: init?.redirect });
    if (target.hostname.endsWith(".oaiusercontent.com")) return fetch(`http://127.0.0.1:${blob.address().port}/${target.hostname}${target.pathname}${target.search}`, init);
    if (target.hostname !== "127.0.0.1") throw new TypeError("fetch failed");
    return fetch(url, init);
  };
  const previous = process.env.CODEX_API_BASE_URL;
  process.env.CODEX_API_BASE_URL = `http://127.0.0.1:${backend.address().port}/backend-api`;
  try {
    await withBridge((port, auth) => withPage(port, auth, (c, headers) => run({ port, auth, c, headers, seen, blobs, sent, held })), fakeCodex, { chatgptFetch, ...options });
  } finally {
    if (previous === undefined) delete process.env.CODEX_API_BASE_URL;
    else process.env.CODEX_API_BASE_URL = previous;
    for (const server of [backend, blob]) { server.closeAllConnections(); server.close(); }
  }
}
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const leaks = (text) => [FRESH, STALE, "SIGNED-SECRET", "UPLOAD-SECRET", "oaiusercontent"].filter((secret) => text.includes(secret));

test("library calls: the page's own pass, the bridge's own and loose ones are refused, flashcards carry their header", async () => {
  await withLibrary(async ({ port, c, headers, seen }) => {
    const call = async (body) => {
      const answer = await request(port, { method: "POST", path: `/api/cloud?c=${c}`, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      return [answer.status, answer.status === 200 ? JSON.parse(answer.text).status : answer.text];
    };
    const LIB = "/files/library";
    assert.deepEqual(await call({ method: "GET", path: `${LIB}/nodes?entry_surface=library&include_files=true` }), [200, 200]);
    // A delete says outright whether it is to the trash or for good.
    assert.deepEqual(await call({ method: "DELETE", path: `${LIB}/files/libfile_1` }), [403, "This ChatGPT request is not allowed."]);
    assert.deepEqual(await call({ method: "DELETE", path: `${LIB}/files/libfile_1?soft_delete=true` }), [200, 200]);
    assert.deepEqual(await call({ method: "DELETE", path: `${LIB}/files/libfile_1?file_id=file_1&parent_directory_id=libdir_1&file_name=a%20b.txt&soft_delete=false` }), [200, 200]);
    // A name may hold `..` (the page's query() leaves dots as they are): in the query it moves nothing.
    assert.deepEqual(await call({ method: "DELETE", path: `${LIB}/files/libfile_1?file_id=file_1&file_name=v1..2.txt&soft_delete=true` }), [200, 200]);
    for (const query of ["?soft_delete=maybe", "?xsoft_delete=true", "?file_id=file_1"]) assert.equal((await call({ method: "DELETE", path: `${LIB}/files/libfile_1${query}` }))[0], 403, query);
    // Ids never carry a slash, a dot or an escape.
    for (const id of ["lib%2Ffile", "libfile.1", "..%2Fx", "libfile_1%2E"]) assert.equal((await call({ method: "GET", path: `${LIB}/files/${id}/node` }))[0], 403, id);
    // A favorite's id joins two with `~`, as the real library's do; still no dot, slash or escape.
    assert.equal((await call({ method: "DELETE", path: `${LIB}/favorites/user_1a2B~libfile_x9` }))[0], 200);
    assert.ok(seen.some((call) => call.url === `/backend-api${LIB}/favorites/user_1a2B~libfile_x9`));
    for (const id of ["user_1~lib.x", "user_1~%2Fx", "~..%2F"]) assert.equal((await call({ method: "DELETE", path: `${LIB}/favorites/${id}` }))[0], 403, id);
    assert.equal((await call({ method: "GET", path: `${LIB}/files/user_1~libfile_x/node` }))[0], 403, "`~` only in a favorite's id");
    // Dots' file pointer stays a page call; the library's own with `inline` is the bridge's.
    assert.deepEqual(await call({ method: "GET", path: "/files/download/file_dots" }), [200, 200]);
    for (const [method, path] of [["GET", "/files/download/file_img?inline=true"], ["POST", "/files"], ["GET", `${LIB}/files/libfile_1/content_url`], ["POST", "/wham/statsig/bootstrap"],
      ["GET", "/settings/user"], ["POST", "/files/process_upload_stream"], ["POST", `${LIB}/files/libfile_1/deep-research/tools/export`], ["GET", "/files/library/files/libfile_1/content_redirect"]]) {
      assert.equal((await call({ method, path }))[0], 403, `${method} ${path}`);
    }
    assert.deepEqual(await call({ method: "PATCH", path: "/learning/flashcards/libfile_f", body: { artifact: {}, expected_current_version: 2 } }), [200, 200]);
    assert.deepEqual(await call({ method: "GET", path: "/learning/flashcards/libfile_f/progress" }), [200, 200]);
    // The page cannot name a header; the route adds its own.
    assert.deepEqual(await call({ method: "GET", path: "/learning/flashcards/libfile_f/progress", headers: { "x-openai-use-sheep": "0" } }), [200, 200]);
    assert.ok(seen.filter((call) => call.url.startsWith("/backend-api/learning/")).every((call) => call.sheep === "1"));
    assert.ok(seen.filter((call) => !call.url.startsWith("/backend-api/learning/")).every((call) => call.sheep === undefined));
    assert.ok(!seen.some((call) => call.url.includes("soft_delete=maybe") || call.url.includes("%2F") || call.url.includes("/files/process_upload_stream")));
  });
});

test("the library's gate: a ChatGPT login, its plan, statsig asked as codex-ui and the registration country, kept a minute", async () => {
  await withLibrary(async ({ port, auth, c, seen, sent }) => {
    const ask = async () => { const answer = await request(port, { path: `/api/library/available?c=${c}`, headers: auth }); return [answer.status, JSON.parse(answer.text)]; };
    assert.deepEqual(await ask(), [200, { available: true, favorites: true, storageBanner: false, notes: true, userId: "user-1" }]);
    const asked = seen.length;
    assert.deepEqual(await ask(), [200, { available: true, favorites: true, storageBanner: false, notes: true, userId: "user-1" }]);
    assert.equal(seen.length, asked);
    const bootstrap = seen.filter((call) => call.url === "/backend-api/wham/statsig/bootstrap").at(-1);
    const body = JSON.parse(bootstrap.body);
    assert.equal(body.app_version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    assert.match(body.stable_id, /^[0-9a-f-]{36}$/);
    for (const key of ["brand_name", "build_flavor", "window_type"]) assert.ok(!(key in body), key);
    // /wham keeps Node's stack, the rest the host's.
    assert.deepEqual(sent.map((call) => call.path), ["/backend-api/accounts/check/v4-2023-04-27", "/backend-api/accounts/check/v4-2023-04-27", "/backend-api/settings/user", "/backend-api/settings/user"]);
    assert.ok(seen.slice(0, asked).every((call) => call.auth));
    assert.equal((await request(port, { path: "/api/library/available?c=gone", headers: auth })).status, 410);
  });
  // The stable id is kept in the host's data folder.
  const dataDir = mkdtempSync(path.join(tmpdir(), "codex-ui-data-"));
  await withLibrary(async ({ port, auth, c }) => { await request(port, { path: `/api/library/available?c=${c}`, headers: auth }); }, { dataDir });
  assert.match(JSON.parse(readFileSync(path.join(dataDir, "library-statsig.json"), "utf8")).stableId, /^[0-9a-f-]{36}$/);
});

test("a library file's bytes: ChatGPT's own under the login, the file host's without it, nothing from elsewhere, never run", async () => {
  await withLibrary(async ({ port, auth, c, seen, blobs, sent }) => {
    const content = (name, params, extra = {}) => request(port, { path: `/api/library/content/${encodeURIComponent(name)}?${new URLSearchParams({ c, ...params })}`, ...extra, headers: { ...auth, ...extra.headers } });
    const results = {
      image: await content("图 1.png", { id: "libfile_img", fileId: "file_img", kind: "content" }),
      imageDownload: await content("图 1.png", { id: "libfile_img", fileId: "file_img", kind: "download" }),
      estuary: await content("a.txt", { id: "libfile_doc", fileId: "file_doc" }),
      evil: await content("x", { id: "libfile_x", fileId: "file_evil" }),
      hop: await content("x", { id: "libfile_x", fileId: "file_hop" }),
      hop2: await content("x.png", { id: "libfile_x", fileId: "file_hop2" }),
      html: await content("p.html", { id: "libfile_h", fileId: "file_html", kind: "html" }),
      htmlAsContent: await content("p.html", { id: "libfile_h", fileId: "file_html", kind: "content" }),
      pdf: await content("报告.pdf", { id: "libfile_p", fileId: "file_pdf" }),
      svg: await content("v.svg", { id: "libfile_s", fileId: "file_svg" }),
      range: await content("报告.pdf", { id: "libfile_p", fileId: "file_pdf" }, { headers: { range: "bytes=0-3" } }),
      ranges: await content("报告.pdf", { id: "libfile_p", fileId: "file_pdf" }, { headers: { range: "bytes=0-1,3-4" } }),
      head: await content("报告.pdf", { id: "libfile_p", fileId: "file_pdf" }, { method: "HEAD" }),
      thumbnail: await content("t", { id: "libfile_t", fileId: "file_t", kind: "thumbnail" }),
      huge: await content("big.pdf", { id: "libfile_b", fileId: "file_huge" }),
      missing: await content("x", { id: "libfile_m", fileId: "file_missing" }),
      badId: await content("x", { id: "libfile_m", fileId: "file/../x" }),
      kind: await content("x", { id: "libfile_m", fileId: "file_img", kind: "raw" }),
      // 255 characters at most, cut between them: never half of an emoji's surrogate pair.
      longName: await content(`${"a".repeat(254)}${String.fromCodePoint(0x1f600)}.png`, { id: "libfile_img", fileId: "file_img" }),
    };
    const { image, imageDownload, estuary, html, pdf, range, head, thumbnail } = results;
    assert.deepEqual([image.status, image.headers["content-type"], image.text.length], [200, "image/png", PNG_BYTES.length]);
    assert.equal(image.headers["content-disposition"], "inline; filename*=UTF-8''%E5%9B%BE%201.png");
    assert.equal(image.headers["content-security-policy"], "sandbox; default-src 'none'");
    assert.deepEqual([image.headers["x-content-type-options"], image.headers["referrer-policy"], image.headers["cache-control"]], ["nosniff", "no-referrer", "no-store"]);
    assert.match(imageDownload.headers["content-disposition"], /^attachment;/);
    // Estuary is ChatGPT's own: under the login (refreshed after the stale one), never redirected.
    assert.deepEqual([estuary.status, estuary.headers["content-type"], estuary.text], [200, "application/octet-stream", "estuary bytes"]);
    assert.match(estuary.headers["content-disposition"], /^attachment;/);
    assert.deepEqual(seen.filter((call) => call.url.startsWith("/backend-api/estuary/")).map((call) => call.auth), [`Bearer ${STALE}`, `Bearer ${FRESH}`]);
    assert.ok(sent.filter((call) => call.path.includes("/estuary/")).every((call) => call.redirect === "error"));
    // A note's old version: its file id through /files/download, not inline (preview-a0bda9357a3b P).
    const note = await content("笔记.md", { id: "libfile_doc", fileId: "file_doc", kind: "note" });
    assert.deepEqual([note.status, note.text], [200, "estuary bytes"]);
    assert.ok(seen.some((call) => call.url === "/backend-api/files/download/file_doc?download_intent=false"));
    // Its version's file id as the real versions list gives it (`<file>~<version>`): through the same route; never for other kinds.
    const version = await content("笔记.md", { id: "libfile_doc", fileId: "file_doc~ver_1", kind: "note" });
    assert.deepEqual([version.status, version.text], [200, "estuary bytes"]);
    assert.ok(seen.some((call) => call.url === "/backend-api/files/download/file_doc~ver_1?download_intent=false"));
    assert.equal((await content("x.txt", { id: "libfile_doc", fileId: "file_doc~ver_1", kind: "content" })).status, 403);
    // Elsewhere is refused, and the file host's redirects are never followed, even to another file host.
    assert.deepEqual([results.evil.status, results.hop.status, results.hop2.status], [403, 502, 502]);
    assert.ok(sent.filter((call) => call.host.endsWith(".oaiusercontent.com")).every((call) => call.redirect === "error"));
    assert.ok(!sent.some((call) => call.host === "evil.example"));
    // The file host never sees the login.
    assert.ok(blobs.length > 0 && blobs.every((call) => call.headers.authorization === undefined && call.headers["chatgpt-account-id"] === undefined));
    assert.ok(sent.filter((call) => call.host.endsWith(".oaiusercontent.com")).every((call) => call.auth === undefined));
    // HTML shows only as a preview that loads nothing; otherwise it downloads.
    assert.deepEqual([html.headers["content-type"], html.headers["content-security-policy"]], ["text/html; charset=utf-8", "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"]);
    assert.match(html.headers["content-disposition"], /^inline;/);
    assert.equal(results.htmlAsContent.headers["content-type"], "application/octet-stream");
    // An SVG shows as an image (an <img> decodes it under no other type), sandboxed like the rest.
    assert.deepEqual([results.svg.headers["content-type"], results.svg.headers["content-security-policy"], results.svg.headers["x-content-type-options"]], ["image/svg+xml", "sandbox; default-src 'none'", "nosniff"]);
    assert.match(results.svg.headers["content-disposition"], /^inline;/);
    // A PDF for the viewer: no CSP of its own, one byte range at a time, HEAD for its size.
    assert.deepEqual([pdf.status, pdf.headers["content-type"], pdf.headers["content-security-policy"], pdf.headers["accept-ranges"], pdf.text], [200, "application/pdf", undefined, "bytes", PDF.toString()]);
    assert.deepEqual([range.status, range.headers["content-range"], range.headers["accept-ranges"], range.text], [206, "bytes 0-3/10", "bytes", "%PDF"]);
    assert.equal(results.ranges.status, 416);
    assert.deepEqual([head.status, head.headers["content-length"], head.headers["content-type"], head.text], [200, "10", "application/pdf", ""]);
    // A thumbnail's library route is asked again through its JSON call, and only thumbnails are cached.
    assert.deepEqual([thumbnail.status, thumbnail.headers["content-type"], thumbnail.headers["cache-control"]], [200, "image/webp", "private, max-age=3600"]);
    assert.ok(seen.some((call) => call.url === "/backend-api/files/library/files/libfile_t/thumbnail_url"));
    assert.ok(!sent.some((call) => call.host === "chatgpt.com"));
    assert.deepEqual([results.huge.status, results.missing.status, results.badId.status, results.kind.status], [413, 404, 403, 400]);
    assert.deepEqual([results.longName.status, results.longName.headers["content-disposition"]], [200, `inline; filename*=UTF-8''${"a".repeat(254)}%F0%9F%98%80`]);
    for (const [name, result] of Object.entries(results)) assert.deepEqual(leaks(result.text), [], name);
    // A preview past 40 MiB that does not say so stops there.
    const flood = await new Promise((resolve) => {
      let bytes = 0;
      const req = http.get({ host: "127.0.0.1", port, path: `/api/library/content/f.txt?${new URLSearchParams({ c, id: "libfile_f", fileId: "file_flood" })}`, headers: auth }, (res) => {
        res.on("data", (chunk) => (bytes += chunk.length));
        res.on("close", () => resolve({ bytes, complete: res.complete }));
      });
      req.on("error", () => resolve({ bytes, complete: false }));
    });
    assert.equal(flood.complete, false);
    assert.ok(flood.bytes <= 41943040 + 1024 * 1024, String(flood.bytes));
  });
});

test("a library file's answer has two minutes to begin, its body as long as it takes", async (t) => {
  await withLibrary(async ({ port, auth, c, held }) => {
    const target = (fileId) => `/api/library/content/x.bin?${new URLSearchParams({ c, id: "libfile_x", fileId, kind: "download" })}`;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      // Begun, a download runs past the two minutes and comes in whole.
      const slow = await new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port, path: target("file_slow"), headers: auth }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("close", () => resolve({ status: res.statusCode, text, complete: res.complete }));
          t.mock.timers.tick(121_000);
          held.find((call) => call.at.endsWith("/files/slow")).res.end("def");
        }).on("error", reject);
      });
      assert.deepEqual(slow, { status: 200, text: "abcdef", complete: true });
      // One that never begins is given up at two minutes.
      const hung = request(port, { path: target("file_hang"), headers: auth });
      while (!held.some((call) => call.at.endsWith("/files/hang"))) await new Promise(setImmediate);
      t.mock.timers.tick(120_000);
      assert.equal((await hung).status, 502);
    } finally {
      t.mock.timers.reset();
    }
  });
});

test("a library upload: the bytes through a temporary file, the upload URL and the login kept in the bridge", async () => {
  const spools = () => readdirSync(tmpdir()).filter((name) => name.startsWith("codex-ui-upload-"));
  const before = spools();
  await withLibrary(async ({ port, c, headers, seen, blobs }) => {
    const upload = (params, body, extra = {}) => request(port, { method: "POST", path: `/api/library/upload?${new URLSearchParams({ c, ...params })}`, headers: { ...headers, ...extra }, body });
    const done = await upload({ name: "报告.txt", type: "text/plain", directoryId: "libdir_1" }, "hello");
    assert.equal(done.status, 200);
    assert.equal(done.headers["content-type"], "application/x-ndjson; charset=utf-8");
    assert.deepEqual(done.text.trim().split("\n").map((line) => JSON.parse(line)), [{ stage: "uploading" }, { stage: "processing" }, { stage: "processing", progress: 100 }, { done: true, libraryFileId: "libfile_up" }]);
    assert.deepEqual(leaks(done.text), []);
    const created = JSON.parse(seen.find((call) => call.url === "/backend-api/files" && call.auth === `Bearer ${FRESH}`).body);
    assert.deepEqual([created.file_name, created.file_size, created.directory_id, created.supports_direct_azure_multipart, created.entry_surface], ["报告.txt", 5, "libdir_1", false, "codex_library_upload"]);
    // The PUT carries the bytes with their length, Azure's headers and the server's, never the login.
    const [put] = blobs.filter((call) => call.method === "PUT");
    assert.equal(put.body, "hello");
    assert.deepEqual([put.headers["content-length"], put.headers["transfer-encoding"], put.headers["x-ms-blob-type"], put.headers["x-ms-blob-content-type"], put.headers["x-ms-meta-source"]], ["5", undefined, "BlockBlob", "text/plain", "codex"]);
    assert.ok(!put.headers.authorization && !put.headers["chatgpt-account-id"] && !put.headers.originator);
    const processed = seen.filter((call) => call.url === "/backend-api/files/process_upload_stream");
    assert.deepEqual(processed.map((call) => [call.auth, call.accept, call.type]), [[`Bearer ${STALE}`, "application/x-ndjson", "application/json"], [`Bearer ${FRESH}`, "application/x-ndjson", "application/json"]]);
    assert.equal(JSON.parse(processed[1].body).directory_id, "libdir_1");
    // Turned away before reading: past 512 MiB (said, not sent: the socket is not kept), a hidden name, nothing at all, an odd folder.
    assert.equal((await upload({ name: "big.bin" }, "x", { "content-length": String(536870912 + 1), connection: "close" })).status, 413);
    assert.deepEqual([(await upload({ name: ".env" }, "x")).status, (await upload({ name: "empty.txt" }, "", { "content-length": "0" })).status, (await upload({ name: "a.txt", directoryId: "../x" }, "x")).status], [400, 400, 400]);
  });
  assert.deepEqual(spools().filter((name) => !before.includes(name)), []);
});

test("a library file saved for a chat: under CODEX_HOME/attachments by its ids only, removed on failure and on request", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-home-"));
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const folders = () => (existsSync(path.join(home, "attachments")) ? readdirSync(path.join(home, "attachments")) : []);
  try {
    await withLibrary(async ({ port, c, headers }) => {
      const attach = (body) => request(port, { method: "POST", path: `/api/library/attach?c=${c}`, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
      const detach = (target) => request(port, { method: "DELETE", path: `/api/library/attach?${new URLSearchParams({ c, path: target })}`, headers });
      const saved = await attach({ id: "libfile_att", fileId: "file_att", name: "CON.txt", size: 5 });
      assert.equal(saved.status, 200);
      const { path: file, label } = JSON.parse(saved.text);
      assert.equal(label, "CON.txt");
      assert.equal(path.dirname(path.dirname(file)), path.join(home, "attachments"));
      assert.match(path.basename(path.dirname(file)), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(path.basename(file), "_CON.txt");
      assert.equal(readFileSync(file, "utf8"), "hello");
      assert.deepEqual(leaks(saved.text), []);
      // An unknown size or one past 45 MiB is turned away; a short body, a missing file or an odd id leaves nothing.
      assert.equal((await attach({ id: "libfile_att", fileId: "file_att", name: "a.txt", size: null })).status, 413);
      assert.equal((await attach({ id: "libfile_att", fileId: "file_att", name: "a.txt", size: 47185920 + 1 })).status, 413);
      assert.equal((await attach({ id: "libfile_s", fileId: "file_short", name: "a.txt", size: 10 })).status, 502);
      assert.equal((await attach({ id: "libfile_m", fileId: "file_missing", name: "a.txt", size: 1 })).status, 404);
      assert.equal((await attach({ id: "libfile_m", fileId: "../file_att", name: "a.txt", size: 1 })).status, 403);
      assert.equal((await attach({ url: "https://evil.example/x", name: "a.txt", size: 1 })).status, 403);
      assert.equal((await attach({ fileId: "file_att", name: 5, size: 1 })).status, 400);
      assert.equal(folders().length, 1);
      // Only a folder this process made: not a path out of it, not another uuid folder there.
      const other = path.join(home, "attachments", "00000000-0000-4000-8000-000000000000");
      mkdirSync(other);
      for (const target of [path.join(path.dirname(file), "..", "..", "config.toml"), other, path.join(home, "attachments"), "relative/_CON.txt"]) {
        assert.equal((await detach(target)).status, 404, target);
      }
      assert.ok(existsSync(other) && existsSync(file));
      assert.equal((await detach(file)).status, 204);
      assert.ok(!existsSync(path.dirname(file)));
      assert.equal((await detach(file)).status, 404);
      // A file from the user's disk (Ctrl+U in a browser): saved the same way, and as easily dropped.
      const upload = (name, body, extra = {}) => request(port, { method: "POST", path: `/api/attachments?${new URLSearchParams({ c, name })}`, headers: { ...headers, ...extra }, body });
      const sent = await upload("../notes.md", "# hi");
      assert.equal(sent.status, 200);
      const mine = JSON.parse(sent.text);
      assert.equal(path.dirname(path.dirname(mine.path)), path.join(home, "attachments"));
      assert.equal(path.basename(mine.path), "notes.md");
      assert.equal(readFileSync(mine.path, "utf8"), "# hi");
      assert.equal((await upload("big.bin", "x", { "content-length": String(47185920 + 1), connection: "close" })).status, 413);
      assert.equal((await request(port, { method: "POST", path: `/api/attachments?${new URLSearchParams({ c, name: "a" })}`, headers, body: "x" })).status, 200);
      assert.equal((await request(port, { method: "POST", path: `/api/attachments?${new URLSearchParams({ c: "nope", name: "a" })}`, headers, body: "x" })).status, 410);
      assert.equal((await detach(mine.path)).status, 204);
    });
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previous;
  }
});

test("scheduled tasks: a page's own connection, JSON verbs, and every change pushed to each page", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "codex-ui-automations-"));
  let clock = Date.parse("2026-10-30T09:00:00Z");
  const store = createAutomations({ home, now: () => clock });
  // A verb may fail partway (a busy file, say) after it changed something: that change still goes out.
  let busy = false;
  const asked = [];
  const automations = { ...store, claim: (options) => (asked.push(options), store.claim(options)), threadEvent: (...args) => {
    const result = store.threadEvent(...args);
    if (busy) throw new Error("文件被占用");
    return result;
  } };
  // A durable host that opens and answers nothing: enough for a durable connection id.
  class Socket extends EventTarget {
    constructor() {
      super();
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0);
    }
    send() {}
    close() { this.readyState = 3; }
  }
  const previous = process.env.CODEX_DURABLE_HOST_URL;
  process.env.CODEX_DURABLE_HOST_URL = "ws://127.0.0.1:1/";
  try {
    await withBridge(async (port, auth) => {
      // Each stream stays open until a ping (id 95) comes back on it.
      const open = (target) => {
        let ready;
        const id = new Promise((resolve) => (ready = resolve));
        const frames = readEvents(port, auth, (frame) => {
          if (frame.event === "hello") ready(frame.data.connectionId);
          return frame.data.id === 95;
        }, target);
        return { id, frames };
      };
      const ping = (c) => request(port, { method: "POST", path: `/api/send?c=${encodeURIComponent(c)}`, headers: auth, body: JSON.stringify({ id: 95, method: "ping" }) + "\n" });
      const a = open(), b = open();
      const [c, other] = await Promise.all([a.id, b.id]);
      const durable = open(`/api/events?durable=${c}`);
      const json = { ...auth, "content-type": "application/json" };
      const call = (verb, body, headers = json) => request(port, { method: "POST", path: `/api/automations/${verb}?c=${c}`, headers, body: JSON.stringify(body) });
      const ok = async (verb, body) => {
        const answer = await call(verb, body);
        assert.equal(answer.status, 200, `${verb}: ${answer.text}`);
        return JSON.parse(answer.text);
      };
      const list = async () => JSON.parse((await request(port, { path: `/api/automations?c=${c}`, headers: auth })).text);

      // Refused: no cookie, another origin, no page (or a dot's durable host), not JSON, not an object, a bad or unknown task.
      assert.equal((await request(port, { path: `/api/automations?c=${c}`, headers: { host: auth.host } })).status, 401);
      assert.equal((await call("create", {}, { ...json, origin: "http://evil.example" })).status, 403);
      for (const query of ["", "?c=nope", `?c=${encodeURIComponent(await durable.id)}`]) {
        assert.equal((await request(port, { path: `/api/automations${query}`, headers: auth })).status, 410, query);
      }
      assert.equal((await request(port, { method: "POST", path: `/api/automations/create?c=${c}`, headers: auth, body: "{}" })).status, 415);
      assert.equal((await request(port, { method: "POST", path: `/api/automations/create?c=${c}`, headers: json, body: "{" })).status, 400);
      assert.equal((await call("create", [])).status, 400);
      const empty = await call("create", { input: { prompt: " " } });
      assert.deepEqual([empty.status, empty.text], [400, "请输入指令"]);
      assert.equal((await call("update", { id: "missing", patch: {} })).status, 404);
      assert.equal((await call("constructor", {})).status, 404);
      assert.equal((await request(port, { path: `/api/automations/claim?c=${c}`, headers: auth })).status, 405);
      assert.equal((await request(port, { method: "POST", path: `/api/automations?c=${c}`, headers: json, body: "{}" })).status, 405);
      assert.deepEqual((await list()).items, []);

      // create → GET → claim → report → runs → delete, with each verb on the way.
      const { item } = await ok("create", { input: { name: "Daily report", prompt: "Summarize the day.", rrule: "FREQ=HOURLY;INTERVAL=1", cwds: [home] } });
      assert.equal(item.id, "daily-report");
      assert.deepEqual((await list()).items.map((task) => [task.id, task.status]), [["daily-report", "ACTIVE"]]);
      assert.equal((await ok("update", { id: item.id, patch: { name: "Daily" } })).item.name, "Daily");
      assert.equal((await ok("set-status", { id: item.id, status: "PAUSED" })).item.nextRunAt, null);
      assert.equal((await call("set-status", { id: item.id })).status, 400);
      assert.equal((await ok("set-status", { id: item.id, status: "ACTIVE" })).item.status, "ACTIVE");
      clock += 2 * 3600_000;
      const { claims: [claim] } = await ok("claim", { held: ["th_held"] });
      assert.deepEqual([claim.automation.id, claim.trigger], [item.id, "scheduled"]);
      assert.deepEqual(asked, [{ held: ["th_held"] }]); // the page's held sessions reach the store
      assert.deepEqual((await ok("claim", {})).claims, []); // nothing more due: no push
      assert.deepEqual(await ok("report", { token: claim.token, outcome: "started", threadId: "th_run", threadTitle: "Daily" }), { ok: true });
      assert.equal((await call("report", { token: claim.token, outcome: "done" })).status, 400);
      assert.deepEqual((await list()).runs.map((run) => [run.threadId, run.status]), [["th_run", "IN_PROGRESS"]]);
      assert.equal((await ok("runs", { threadId: "th_run", event: "completed", inboxTitle: "All quiet" })).run.status, "PENDING_REVIEW");
      assert.deepEqual(await ok("runs", { threadId: "th_other", event: "read" }), { run: null }); // no such run: no push
      assert.equal((await call("runs", { threadId: "th_other", event: "bogus" })).status, 400); // refused before any lookup
      assert.equal((await list()).unread.total, 1);
      assert.deepEqual(await ok("runs/read-all", {}), { count: 1 });
      assert.deepEqual(await ok("runs/read-all", {}), { count: 0 }); // nothing unread: no push
      busy = true;
      const failed = await call("thread", { threadId: "th_run", event: "archived" });
      busy = false;
      assert.deepEqual([failed.status, failed.text], [500, "文件被占用"]);
      assert.equal((await list()).runs[0].status, "ARCHIVED"); // changed before it failed, and pushed all the same
      assert.equal((await ok("run-now", { id: item.id })).claim.token, `${item.id}/now-${clock}/`);
      assert.deepEqual(await ok("delete", { id: item.id }), { deleted: true });
      assert.deepEqual(await ok("delete", { id: item.id }), { deleted: false }); // already gone: no push
      const { items, stamp } = await list();
      assert.deepEqual(items, []);

      await ping(await durable.id);
      assert.ok((await durable.frames).every((frame) => frame.data.method !== "codexUi/automations/changed"));
      await Promise.all([ping(c), ping(other)]);
      const pushed = async (stream) => (await stream.frames).filter((frame) => frame.data.method === "codexUi/automations/changed").map((frame) => frame.data.params.stamp);
      const [first, second] = [await pushed(a), await pushed(b)];
      // create, update, pause, resume, claim, report, completed, read all, archived (then failed), run now, delete.
      assert.equal(first.length, 11);
      assert.deepEqual(second, first);
      assert.ok(first.every((value, index) => index === 0 || value > first[index - 1]));
      assert.equal(first.at(-1), stamp);
    }, fakeCodex, { automations, webSocket: Socket });
  } finally {
    if (previous === undefined) delete process.env.CODEX_DURABLE_HOST_URL;
    else process.env.CODEX_DURABLE_HOST_URL = previous;
  }
});

// Runs `run(connectionId, jsonHeaders)` while the page's own connection is open.
async function withPage(port, auth, run) {
  let work;
  await readEvents(port, auth, (frame) => {
    if (frame.event === "hello") {
      work = (async () => {
        const c = frame.data.connectionId;
        const json = { ...auth, origin: `http://${auth.host}` };
        try { await run(c, json); } finally {
          await request(port, { method: "POST", path: `/api/send?c=${c}`, headers: json, body: JSON.stringify({ id: 96, method: "ping" }) });
        }
      })();
      // Held until the page has closed: unhandled before then, a failure would end the test while its cleanup still runs.
      work.catch(() => {});
    }
    return frame.event === "message" && frame.data.id === 96;
  });
  await work;
}

test("show_widget's frame is served without a token, sandboxed by its own CSP, GET only", async () => {
  await withBridge(async (port, auth) => {
    const page = await request(port, { path: "/widget-frame", headers: { host: auth.host } });
    assert.equal(page.status, 200);
    const csp = page.headers["content-security-policy"];
    assert.match(csp, /^sandbox allow-scripts;/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /connect-src https:\/\/cdnjs\.cloudflare\.com https:\/\/cdn\.jsdelivr\.net https:\/\/unpkg\.com https:\/\/esm\.sh;/);
    assert.doesNotMatch(csp, /allow-same-origin|'self' 'unsafe|script-src 'self'/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.match(page.text, /window\.sendPrompt/);
    assert.equal((await request(port, { method: "POST", path: "/widget-frame", headers: { host: auth.host }, body: "x" })).status, 405);
  });
});
