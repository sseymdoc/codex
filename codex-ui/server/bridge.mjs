// Bridges browser tabs to `codex app-server`.
//
// Browsers cannot use the app-server WebSocket listener directly (it rejects any
// request that carries an Origin header), so every page load gets its own
// `codex app-server` child speaking JSON-RPC over stdio. Server -> browser
// messages stream over Server-Sent Events; browser -> server messages arrive as
// newline-delimited JSON POST bodies.
//
// The app-server can run commands as the current user, so every API request must
// use a loopback Host (DNS rebinding), come from our own origin (CSRF), and carry
// the per-process token cookie (other local users).
//
// Dictation recordings go to ChatGPT's transcription endpoint under the session's own
// login, which the bridge asks the page's app-server for and keeps (transcribe).

import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, readFileSync, readdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { ccSwitchQuota } from "./ccswitch.mjs";
import { ROLLOUT_FILE, readContextUsage } from "./context-usage.mjs";
import { browserMcpMessage } from "./browser-protocol.mjs";
import { generateTitle } from "./title.mjs";
import { stop } from "./process.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** The transcription endpoint's own cap on one recording. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;
/** Ids of the bridge's own requests to an app-server; their answers never reach the page. */
const OWN_ID = "codex-ui-bridge:";
const CHATGPT_AUTH = new Set(["chatgpt", "chatgptAuthTokens"]);
/**
 * Codex sends a patch as the model writes it (item/fileChange/patchUpdated) only with this
 * under-development feature on, so a file row's +N −N grows while the file is written.
 * ponytail: a codex older than 0.122 does not know the key and warns that it ignores it.
 */
const STREAM_PATCHES = "apply_patch_streaming_events";
const UNSTABLE = "Under-development features enabled: ";

/**
 * Codex's warning about the under-development features turned on, as the user's own config alone
 * would have it: without the one the bridge turns on, and gone when that was all.
 */
export function withoutStreamingWarning(line) {
  if (!line.includes(UNSTABLE)) return line;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }
  const text = message.method === "warning" ? message.params?.message : undefined;
  if (typeof text !== "string" || !text.startsWith(UNSTABLE)) return line;
  const end = text.indexOf(".", UNSTABLE.length);
  const keys = text.slice(UNSTABLE.length, end).split(", ").filter((key) => key !== STREAM_PATCHES);
  if (!keys.length) return "";
  message.params.message = UNSTABLE + keys.join(", ") + text.slice(end);
  return JSON.stringify(message);
}

export function parseArgs(argv, env = process.env) {
  const options = {
    codex: env.CODEX_BIN || undefined,
    codexArgs: [],
    token: env.CODEX_UI_TOKEN || undefined,
    cwd: env.INIT_CWD || process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--codex") options.codex = value();
    else if (arg === "-c" || arg === "--config") options.codexArgs.push("-c", value());
    else if (arg === "--cwd") options.cwd = path.resolve(value());
    else if (arg === "--port") options.port = Number(value());
    else if (arg === "--no-open") options.open = false;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

// `where` lets tests point the lookups at a fake environment, home and repository.
export function resolveCodexCommand(requested, where = { env: process.env, home: homedir() }) {
  const builds = where.localBuilds === false ? [] : repositoryBuilds(where);
  const configured = requested && (/[\\/]/.test(requested) ? path.resolve(requested) : findOnPath(requested, where.env.PATH));
  for (const file of [configured, ...builds, findOnPath("codex", where.env.PATH), ...installedCodex(where)]) {
    if (!file || !isFile(file)) continue;
    // A repository build without its matching host starts but cannot execute tools.
    if (/(?:^|[\\/])target[\\/](?:release|debug)[\\/]codex(?:\.exe)?$/i.test(file)
      && !hasCodeModeHost(file)) continue;
    const command = commandFor(path.resolve(file));
    if (command) return command;
  }
  return null;
}

function repositoryBuilds(where) {
  const root = where.repoRoot ?? path.join(here, "..", "..");
  return ["release", "debug"].map((profile) => path.join(root, "codex-rs", "target", profile, process.platform === "win32" ? "codex.exe" : "codex"));
}

function hasCodeModeHost(file) {
  return isFile(path.join(path.dirname(file), process.platform === "win32" ? "codex-code-mode-host.exe" : "codex-code-mode-host"));
}

/**
 * codex binaries shipped by the Codex desktop app (%LOCALAPPDATA%/OpenAI/Codex/bin/<hash>/) and
 * the VS Code extension (~/.vscode/extensions/openai.chatgpt-<version>/bin/<platform>/), newest
 * first. Their folders change with every update, so look them up instead of asking for CODEX_BIN.
 */
export function installedCodex({ env, home }) {
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const dirs = (parent) => {
    try {
      return readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(parent, entry.name));
    } catch {
      return [];
    }
  };
  const roots = [
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin")] : []),
    ...dirs(path.join(home, ".vscode", "extensions"))
      .filter((dir) => path.basename(dir).startsWith("openai.chatgpt-"))
      .map((dir) => path.join(dir, "bin")),
  ];
  return roots
    .flatMap(dirs)
    .map((dir) => path.join(dir, exe))
    .filter(isFile)
    .map((file) => ({ file, mtime: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(({ file }) => file);
}

function findOnPath(name, searchPath = process.env.PATH) {
  const extensions = path.extname(name) || process.platform !== "win32" ? [""] : [".exe", ".cmd"];
  for (const dir of (searchPath ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const file = dir && path.join(dir, name + extension);
      if (file && isFile(file)) return file;
    }
  }
  return null;
}

function commandFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".js" || extension === ".mjs") return nodeCommand(file);
  if (extension === ".cmd" || extension === ".bat") {
    // npm's Windows shim; run the launcher it wraps so no shell is involved.
    const launcher = path.join(path.dirname(file), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (isFile(launcher)) return nodeCommand(launcher);
    // ponytail: shell fallback does not quote -c values; pass --codex to a real binary if that bites.
    return { command: `"${file}"`, args: [], shell: true };
  }
  return { command: file, args: [] };
}

// Under Electron execPath is the app itself. ELECTRON_RUN_AS_NODE would leak into
// every command the agent runs, so use the Node on PATH instead.
function nodeCommand(file) {
  const node = process.versions.electron ? findOnPath(process.platform === "win32" ? "node.exe" : "node") : process.execPath;
  return node && { command: node, args: [file] };
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function createBridge({ codex, codexArgs = [], token, cwd = process.cwd(), log = console, browser, localBuilds = true, experimentalBackend = false } = {}) {
  const secret = token || randomBytes(24).toString("hex");
  const connections = new Map();
  const browserConnections = new Map();
  const own = new Map();
  /** By app-server, the page's gitDiffToRemote requests awaiting an answer: id (as JSON) → folder. */
  const remoteDiffs = new WeakMap();
  const titleRequests = new Set();

  function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = LOOPBACK_HOST.exec(req.headers.host ?? "");
    if (!host) return deny(res, 403, "Codex UI only answers on loopback hosts.");
    // Cookies ignore ports, so scope the name to ours.
    const cookieName = `codex_ui_${host[2] ?? "80"}`;

    if (url.pathname === "/api/browser-mcp") {
      const binding = browserConnections.get(url.searchParams.get("c"));
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
      if (!browser || !binding || !fromOwnOrigin(req) || !sameSecret(bearer, binding.token)) return deny(res, 401, "Browser MCP is unauthorized.");
      if (req.method === "DELETE") return void res.writeHead(204).end();
      if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST, DELETE" }).end();
      return void handleBrowserMcp(req, res, binding);
    }

    const presented = url.searchParams.get("token");
    if (presented !== null && req.method === "GET" && !url.pathname.startsWith("/api/")) {
      if (!sameSecret(presented, secret)) return deny(res, 401, "Invalid token.");
      url.searchParams.delete("token");
      res.writeHead(302, {
        "Set-Cookie": `${cookieName}=${secret}; HttpOnly; SameSite=Strict; Path=/`,
        Location: url.pathname + url.search,
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (!url.pathname.startsWith("/api/")) return next ? next() : deny(res, 404, "Not found.");
    if (!fromOwnOrigin(req)) return deny(res, 403, "Cross-origin requests are not allowed.");
    if (!sameSecret(readCookie(req.headers.cookie, cookieName) ?? "", secret)) {
      return deny(res, 401, "Open the tokenized URL printed by the server.");
    }
    if (url.pathname === "/api/title") {
      if (req.method !== "POST") return void res.writeHead(405, { Allow: "POST" }).end();
      return void title(req, res);
    }
    if (url.pathname === "/api/events" && req.method === "GET") return openEvents(req, res);
    if (url.pathname === "/api/account/profile" && req.method === "GET") return void accountProfile(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/send" && req.method === "POST") return forward(req, res, url.searchParams.get("c"));
    if (url.pathname === "/api/transcribe" && req.method === "POST") return void transcribe(req, res, url.searchParams.get("c"));
    if ((url.pathname === "/api/opencodex/quotas" || url.pathname === "/api/ccswitch/quota") && req.method === "GET") {
      return void (url.pathname === "/api/ccswitch/quota" ? ccSwitchQuota() : opencodexQuotas()).then((body) =>
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body)),
      );
    }
    if (url.pathname === "/api/context-usage" && req.method === "GET") {
      // The thread's rollout (Thread.path), and only a rollout: this reads no other file.
      const file = url.searchParams.get("path") ?? "";
      if (!path.isAbsolute(file) || !ROLLOUT_FILE.test(path.basename(file))) return deny(res, 400, "Not a Codex rollout.");
      return void readContextUsage(file).then(
        (body) => res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body)),
        () => deny(res, 404, "Rollout not found."),
      );
    }
    // /api/pdf/<name>?path=…: the viewer titles the document with the URL's last segment.
    if (url.pathname.startsWith("/api/pdf/") && (req.method === "GET" || req.method === "HEAD")) return void sendPdf(req, res, url.searchParams.get("path") ?? "");
    return deny(res, 404, "Not found.");
  }

  async function title(req, res) {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return deny(res, 415, "Not JSON.");
    let body;
    try { body = JSON.parse((await readBody(req, 32 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid title request."); }
    if (!body || typeof body.description !== "string" || !body.description.trim() || body.description.length > 4000
      || (body.model !== undefined && (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200))) return deny(res, 400, "Invalid title request.");
    const command = resolveCodexCommand(codex, { env: process.env, home: homedir(), localBuilds });
    if (!command) return deny(res, 503, "Codex is unavailable.");
    const abort = new AbortController();
    titleRequests.add(abort);
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const title = await generateTitle({ command, codexArgs, description: body.description, model: body.model, signal: abort.signal });
      if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ title }));
    } catch (error) {
      if (!abort.signal.aborted) log.error("[title] generation failed", error.message);
      if (!res.destroyed) deny(res, 502, "Title generation failed.");
    } finally { titleRequests.delete(abort); }
  }

  function openEvents(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const write = (chunk) => {
      if (!res.writableEnded) res.write(chunk);
    };
    const emit = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const finish = () => {
      if (!res.writableEnded) res.end();
    };

    const command = resolveCodexCommand(codex, { env: process.env, home: homedir(), localBuilds });
    if (!command) {
      emit("fatal", {
        message: "Could not find the codex binary. Install the Codex app or @openai/codex, build codex-rs, or set CODEX_BIN.",
      });
      return finish();
    }

    const id = randomUUID();
    const binding = { token: randomBytes(24).toString("hex"), threads: new Map(), pending: new Map() };
    const browserArgs = browser ? [
      "-c", `mcp_servers.codex_ui_browser.url=${JSON.stringify(`http://${req.headers.host}/api/browser-mcp?c=${id}`)}`,
      "-c", 'mcp_servers.codex_ui_browser.bearer_token_env_var="CODEX_UI_BROWSER_TOKEN"',
      "-c", "mcp_servers.codex_ui_browser.tool_timeout_sec=90",
    ] : [];
    let child;
    try {
      child = spawn(command.command, [...command.args, "app-server", "-c", `features.${STREAM_PATCHES}=true`, ...codexArgs, ...browserArgs], {
        cwd,
        env: {
          ...process.env,
          CODEX_UI_EXPERIMENTAL_BACKEND: experimentalBackend === true ? "1" : "0",
          ...(browser ? { CODEX_UI_BROWSER_TOKEN: binding.token } : {}),
        },
        shell: command.shell ?? false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      emit("fatal", { message: error.message });
      return finish();
    }

    connections.set(id, child);
    if (browser) browserConnections.set(id, binding);
    remoteDiffs.set(child, new Map());
    emit("hello", { connectionId: id, cwd, command: [command.command, ...command.args].join(" ") });

    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      if (browser) {
        try {
          const message = JSON.parse(line);
          const thread = message.result?.thread ?? message.params?.thread;
          if (typeof thread?.id === "string" && typeof thread?.cwd === "string") binding.threads.set(thread.id, thread.cwd);
        } catch {}
      }
      if (withUntracked(child, line, write)) return;
      if (line.includes(`"${OWN_ID}`)) {
        try {
          const message = JSON.parse(line);
          const settle = own.get(message.id);
          if (settle) return void settle(message);
          // Late private replies (including credentials) must not reach the page after timeout.
          if (typeof message.id === "string" && message.id.startsWith(OWN_ID)) return;
        } catch {}
      }
      line = withoutStreamingWarning(line);
      if (line) write(`data: ${line}\n\n`);
    });
    const stderr = [];
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", (line) => {
      stderr.push(line);
      if (stderr.length > 50) stderr.shift();
      log.error(`[app-server ${id.slice(0, 8)}] ${line}`);
    });
    child.on("error", (error) => {
      emit("fatal", { message: error.message });
      finish();
    });
    child.on("exit", (code, signal) => {
      connections.delete(id);
      dropBrowser(id);
      emit("exit", { code, signal, stderr });
      finish();
    });

    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      connections.delete(id);
      dropBrowser(id);
      stop(child, false);
    });
  }

  function forward(req, res, id) {
    const child = connections.get(id ?? "");
    if (!child) return deny(res, 410, "Connection closed.");
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) return void chunks.push(chunk);
      deny(res, 413, "Message too large.");
      req.destroy();
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const messages = [];
      for (const line of Buffer.concat(chunks).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          messages.push(JSON.parse(line));
        } catch {
          return deny(res, 400, "Body must be newline-delimited JSON.");
        }
      }
      for (const message of messages) {
        if (browser && ["thread/start", "thread/resume"].includes(message?.method) && (message.method === "thread/start" || message.params?.config)) {
          const instruction = browser.verificationInstructions?.(message.params?.cwd || browserConnections.get(id)?.threads.get(message.params?.threadId) || cwd);
          if (instruction) {
            message.params ??= {};
            const config = message.params.config ?? {};
            const previous = typeof config.developer_instructions === "string" ? config.developer_instructions : "";
            message.params.config = { ...config, developer_instructions: [previous, instruction].filter(Boolean).join("\n\n") };
          }
        }
        if (message?.method === "gitDiffToRemote" && typeof message.params?.cwd === "string") {
          remoteDiffs.get(child).set(JSON.stringify(message.id), path.resolve(cwd, message.params.cwd));
        }
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
      res.writeHead(204).end();
    });
  }

  /**
   * Holds back app-server's answer to the page's gitDiffToRemote until it has the untracked files
   * app-server leaves out (addUntracked); false for every other line.
   */
  function withUntracked(child, line, write) {
    const asked = remoteDiffs.get(child);
    if (!asked?.size) return false;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return false;
    }
    // A request from app-server may carry the same id as one of the page's.
    const key = JSON.stringify(message?.id);
    const folder = message?.method === undefined ? asked.get(key) : undefined;
    if (folder === undefined) return false;
    asked.delete(key);
    const diff = message.result?.diff;
    if (typeof diff !== "string") return false;
    void addUntracked(folder, diff)
      .catch(() => diff)
      .then((full) => write(`data: ${JSON.stringify({ ...message, result: { ...message.result, diff: full } })}\n\n`));
    return true;
  }

  /** Asks a page's app-server something the page must not see: the answer stays in the bridge. */
  function askAppServer(child, method, params) {
    const id = `${OWN_ID}${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        own.delete(id);
        reject(new Error(`${method} timed out`));
      }, 15_000);
      own.set(id, (message) => {
        clearTimeout(timer);
        own.delete(id);
        if (message.error) reject(new Error(message.error.message ?? `${method} failed`));
        else resolve(message.result);
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async function accountProfile(req, res, id) {
    const child = connections.get(id ?? "");
    if (!child) return deny(res, 410, "Connection closed.");
    const abort = new AbortController();
    res.on("close", () => abort.abort());
    let profile = null;
    try {
      for (const refreshToken of [false, true]) {
        const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken });
        if (abort.signal.aborted || !auth?.authToken || !CHATGPT_AUTH.has(auth.authMethod)) break;
        // shortcut: ChatGPT's private profile endpoint; replace when app-server exposes profile fields.
        const response = await fetch(`${chatgptBase()}/wham/profiles/me`, {
          headers: { ...chatgptHeaders(auth.authToken), Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
        });
        if (response.status === 401 && !refreshToken) { await response.body?.cancel(); continue; }
        if (!response.ok) { await response.body?.cancel(); break; }
        profile = profileFields((await response.json())?.profile);
        break;
      }
    } catch {
      // Cosmetic data is optional; do not expose upstream errors or credentials.
    }
    if (!res.destroyed) res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify({ profile }));
  }

  // Dictation as the Codex desktop composer does it (app-initial YLo): the recording goes to
  // ChatGPT's /transcribe as a multipart `file` under the session's own ChatGPT login and comes
  // back as `{ text }`. The token comes from this page's app-server and never reaches the page;
  // a 401 retries once with a refreshed one.
  async function transcribe(req, res, id) {
    const child = connections.get(id ?? "");
    if (!child) return deny(res, 410, "Connection closed.");
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("audio/")) return deny(res, 415, "Not audio.");
    const audio = await readBody(req, MAX_AUDIO_BYTES).catch(() => null);
    if (!audio) return deny(res, 413, "录音太长，请分段听写。");
    try {
      for (const refreshToken of [false, true]) {
        const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken });
        if (!auth?.authToken || !CHATGPT_AUTH.has(auth.authMethod)) return deny(res, 403, "听写需要使用 ChatGPT 账户登录 Codex。");
        const form = new FormData();
        form.append("file", new Blob([audio], { type }), `codex.${type.split(/[/;]/)[1] || "webm"}`);
        const response = await fetch(`${chatgptBase()}/transcribe`, {
          method: "POST",
          headers: chatgptHeaders(auth.authToken),
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 401 && !refreshToken) continue;
        const body = await response.json().catch(() => null);
        if (!response.ok) return deny(res, 502, transcribeError(response.status, body));
        return void res
          .writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
          .end(JSON.stringify({ text: typeof body?.text === "string" ? body.text : "" }));
      }
    } catch (error) {
      return deny(res, 502, `请检查您的网络连接后重试（${error.message}）`);
    }
  }

  function dropBrowser(id) {
    const binding = browserConnections.get(id);
    for (const pending of binding?.pending.values() ?? []) pending.abort();
    browserConnections.delete(id);
  }

  async function handleBrowserMcp(req, res, binding) {
    let message;
    try { message = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString("utf8")); }
    catch { return deny(res, 400, "Invalid browser MCP message."); }
    if (!message || typeof message !== "object" || Array.isArray(message) || typeof message.method !== "string" || (message.params !== undefined && (!message.params || typeof message.params !== "object" || Array.isArray(message.params)))) return deny(res, 400, "Invalid browser MCP message.");
    if (message.method === "notifications/cancelled") {
      binding.pending.get(message.params?.requestId)?.abort();
      return void res.writeHead(202).end();
    }
    const abort = new AbortController();
    if (message.id !== undefined) binding.pending.set(message.id, abort);
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const response = await browserMcpMessage(message, { browser, threads: binding.threads, signal: abort.signal });
      if (!res.destroyed) response === null ? res.writeHead(202).end() : res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(response));
    } catch {
      if (!res.destroyed) deny(res, 500, "Browser MCP failed.");
    } finally { binding.pending.delete(message.id); }
  }

  function closeAll() {
    for (const abort of titleRequests) abort.abort();
    for (const id of browserConnections.keys()) dropBrowser(id);
    for (const child of connections.values()) stop(child, true);
    connections.clear();
  }

  return { token: secret, handle, closeAll };
}

// opencodex (a local provider proxy for Codex) reports each provider's quota at GET
// /api/provider-quotas. Its runtime record holds a per-process secret; a capability signed with it
// admits one allowlisted read, unlike the admin token, which could change the proxy's config. No
// proxy, a stale record or any failure reads as no reports.
async function opencodexQuotas() {
  const home = process.env.OPENCODEX_HOME?.trim().replace(/^~(?=[\\/])/, homedir()) || path.join(homedir(), ".opencodex");
  try {
    const { pid, port, attestationSecret } = JSON.parse(readFileSync(path.join(home, "runtime-port.json"), "utf8"));
    const sign = (...lines) => createHmac("sha256", attestationSecret).update(lines.join("\n")).digest("base64url");
    const route = "/api/provider-quotas";
    const nonce = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 10_000;
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      headers: {
        "x-opencodex-local-expected-pid": String(pid),
        "x-opencodex-local-expires-at": String(expiresAt),
        "x-opencodex-local-nonce": nonce,
        "x-opencodex-local-capability": sign("opencodex-local-management-read-v1", nonce, "GET", route, pid, port, expiresAt),
      },
      signal: AbortSignal.timeout(15_000),
    });
    // opencodex signs the nonce back; an answer from whatever else now holds a stale port is dropped.
    if (!response.ok || response.headers.get("x-opencodex-attestation-proof") !== sign("opencodex-local-management-v1", nonce, pid, port)) {
      return { reports: [] };
    }
    const { reports } = await response.json();
    return { reports: reports.map(({ provider, label, quota, updatedAt }) => ({ provider, label, quota, updatedAt })) };
  } catch {
    return { reports: [] };
  }
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= max) return void chunks.push(chunk);
      req.destroy();
      reject(new Error("too large"));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// The backend the Codex desktop app talks to (CODEX_API_BASE_URL overrides it, as there), with
// its headers; the originator is codex-ui's own, as app-server reports it (clientInfo.name).
const chatgptBase = () => (process.env.CODEX_API_BASE_URL?.trim() || "https://chatgpt.com/backend-api").replace(/\/+$/, "");

export function profileFields(profile) {
  const text = (value, max) => typeof value === "string" && value.trim().length <= max ? value.trim() || null : null;
  const displayName = text(profile?.display_name, 256) ?? text(profile?.username, 100);
  let avatarUrl = text(profile?.profile_picture_url, 2048);
  try {
    const url = new URL(avatarUrl);
    if (url.protocol !== "https:" || url.username || url.password) avatarUrl = null;
  } catch { avatarUrl = null; }
  return displayName || avatarUrl ? { displayName, avatarUrl } : null;
}

function chatgptHeaders(token) {
  const claims = tokenClaims(token);
  return {
    Authorization: `Bearer ${token}`,
    originator: "codex_ui",
    "OAI-Product-Sku": "CODEX",
    ...(claims?.chatgpt_account_id ? { "ChatGPT-Account-Id": claims.chatgpt_account_id } : {}),
    ...(claims?.chatgpt_account_is_fedramp === true ? { "X-OpenAI-Fedramp": "true" } : {}),
  };
}

/** The ChatGPT claims of an access token, read (not verified) only to address the request. */
export function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"))["https://api.openai.com/auth"] ?? null;
  } catch {
    return null;
  }
}

/** Codex's own wording for the failures it names (zh-CN dictation.error.*). */
export function transcribeError(status, body) {
  const detail = body?.detail;
  if (detail?.code === "audio_too_short") return "没听清楚。请重试";
  const message = typeof detail === "string" ? detail : (detail?.message ?? body?.error?.message);
  return `无法转录音频（${status}${message ? `：${message}` : ""}）`;
}

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";
/** As codex-rs git-utils runs git in a checkout (run_git_command_with_timeout_from). */
const SAFE_GIT = ["-c", "safe.bareRepository=explicit", "-c", `core.hooksPath=${NULL_DEVICE}`, "-c", "core.fsmonitor=false"];
/** The bytes C quoting spells as a letter (quote.c cq_lookup); `\"` and `\\` are the character itself. */
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

/**
 * gitDiffToRemote (codex-rs git-utils info.rs diff_against_sha) hands each line of `git ls-files
 * --others` to `git diff --no-index` as it is, so an untracked file whose name git quotes (any
 * non-ASCII name under core.quotePath, which is on by default) names no file there and is left
 * out. This diffs those the same way, 8 at a time as there, unless the diff has them already.
 */
export async function addUntracked(cwd, diff) {
  const listed = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  if (listed.code !== 0) return diff;
  // A diff header quotes "a/<name>" as ls-files quotes <name>.
  const names = listed.stdout
    .split("\n")
    .filter((line) => line.startsWith('"') && !diff.includes(`diff --git "a/${line.slice(1)} "b/${line.slice(1)}\nnew file mode`))
    .map(unquote);
  for (let i = 0; i < names.length; i += 8) {
    const extras = await Promise.all(names.slice(i, i + 8).map((name) => git(cwd, ["diff", "--no-textconv", "--no-ext-diff", "--binary", "--no-index", "--", NULL_DEVICE, name])));
    for (const extra of extras) if (extra.code === 0 || extra.code === 1) diff += extra.stdout;
  }
  return diff;
}

/** A name git C-quoted (quote.c quote_c_style), read back as diff.ts gitPath does: octal escapes are UTF-8 bytes. */
function unquote(text) {
  const bytes = [];
  for (const [, octal, escape, plain] of text.slice(1, -1).matchAll(/\\([0-7]{3})|\\(.)|([^\\]+)/g))
    bytes.push(...(octal ? [parseInt(octal, 8)] : escape ? [ESCAPES[escape] ?? escape.charCodeAt(0)] : Buffer.from(plain)));
  return Buffer.from(bytes).toString("utf8");
}

/** Runs git in a checkout within codex's 5 seconds; `code` is its exit code, null once timed out. */
function git(cwd, args) {
  const options = { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 5000, maxBuffer: Infinity, windowsHide: true };
  // A killed git exits 1 on Windows (TerminateProcess), which would pass for "has a diff".
  return new Promise((resolve) => execFile("git", [...SAFE_GIT, ...args], options, (error, stdout) => resolve({ code: error ? (error.killed ? null : error.code) : 0, stdout })));
}


function fromOwnOrigin(req) {
  const origin = req.headers.origin;
  if (origin !== undefined) return origin === `http://${req.headers.host}`;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

function readCookie(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function sameSecret(presented, secret) {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The files pane's PDF preview: the raw bytes of one absolute `.pdf` path, for an iframe (the
 * page reads any file through fs/readFile already; this serves only PDFs, as PDFs). HEAD gives
 * the size, so the pane can turn a file past Claude's 30 MB cap away unread.
 */
async function sendPdf(req, res, file) {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== ".pdf") return deny(res, 400, "Not a PDF.");
  let info;
  try { info = await stat(file); }
  catch { return deny(res, 404, "File not found."); }
  if (!info.isFile()) return deny(res, 404, "File not found.");
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": info.size,
    "Content-Disposition": "inline",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).on("error", () => res.destroy()).pipe(res);
}

function deny(res, status, message) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
}
