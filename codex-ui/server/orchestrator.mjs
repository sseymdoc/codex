// In-process application service. Hosts supply browser/network capabilities; transports own framing.
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createBackendManager } from "./backend.mjs";
import { browserMcpMessage } from "./browser-protocol.mjs";
import { generateTitle } from "./title.mjs";
import { stop } from "./process.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;
/** Private app-server request ids; keep their wire prefix and replies away from the page. */
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

/**
 * A backend package keeps its command-line tools (rg) in codex-path beside bin. Official packages
 * name it in codex-package.json and Codex prepends it itself; codex-ui's packages have no such file
 * (it would also change how Codex identifies the build), so put it first on PATH here.
 */
export function withPackageTools(command, env = process.env) {
  const tools = !command.args.length && !command.shell && path.join(path.dirname(command.command), "..", "codex-path");
  if (!tools || !statSync(tools, { throwIfNoEntry: false })?.isDirectory()) return { ...env };
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return { ...env, [key]: env[key] ? tools + path.delimiter + env[key] : tools };
}

/** Each host owns one service; backend settings are captured once, before any connection starts. */
export function createOrchestrator({ codex, codexArgs = [], cwd = process.cwd(), log = console, browser: desktopBrowser, localBuilds = true, experimentalBackend = false, toolAccessMode = "on-demand", connectorSearch = true, transcribeFetch = fetch, backend: backendOptions } = {}) {
  const backend = backendOptions ? createBackendManager(backendOptions) : null;
  const backendStartup = backend?.startup();
  if (backendStartup) {
    codex = backendStartup.codex;
    experimentalBackend = backendStartup.channel !== "disabled";
    localBuilds = false;
  }
  const browser = experimentalBackend === true ? desktopBrowser : undefined;
  const connections = new Map();
  const browserConnections = new Map();
  const own = new Map();
  /** By app-server, the page's gitDiffToRemote requests awaiting an answer: id (as JSON) → folder. */
  const remoteDiffs = new WeakMap();
  const titleRequests = new Set();
  let spare, prewarmHost;
  let closed = false;

  function launchPlan() {
    const command = resolveCodexCommand(codex, { env: process.env, home: homedir(), localBuilds });
    if (!command) throw new Error("Could not find the codex binary. Install the Codex app or @openai/codex, build codex-rs, or set CODEX_BIN.");
    return {
      command,
      args: [...command.args, "app-server", "-c", `features.${STREAM_PATCHES}=true`, ...codexArgs],
      env: {
        ...withPackageTools(command),
        CODEX_UI_EXPERIMENTAL_BACKEND: experimentalBackend === true ? "1" : "0",
        CODEX_UI_TOOL_ACCESS_MODE: experimentalBackend === true && toolAccessMode === "all" ? "all" : "on-demand",
        CODEX_UI_CONNECTOR_SEARCH: experimentalBackend === true && connectorSearch !== false ? "1" : "0",
        ...(experimentalBackend === true ? { PONYTAIL_MAP: "0" } : {}),
      },
    };
  }

  function launchKey(plan, host) {
    const home = plan.env.CODEX_HOME || path.join(homedir(), ".codex");
    const files = new Set([plan.command.command, ...plan.command.args.filter(isFile),
      path.join(home, "config.toml"), path.join(home, "auth.json"), path.join(home, "managed_config.toml"),
      path.join(home, "plugins", "installed_plugins.json")]);
    for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
      files.add(path.join(dir, ".codex", "config.toml"));
      if (path.dirname(dir) === dir) break;
    }
    const stamps = [...files].map((file) => {
      const info = statSync(file, { throwIfNoEntry: false });
      return [file, info && [info.size, info.mtimeMs, info.ctimeMs, info.ino]];
    });
    return JSON.stringify([host, cwd, plan.command, plan.args, Object.entries(plan.env).sort(), stamps]);
  }

  function launch(plan, host) {
    const id = randomUUID();
    const binding = { token: randomBytes(24).toString("hex"), threads: new Map(), pending: new Map() };
    const browserArgs = browser ? [
      "-c", `mcp_servers.codex_ui_browser.url=${JSON.stringify(`http://${host}/api/browser-mcp?c=${id}`)}`,
      "-c", 'mcp_servers.codex_ui_browser.bearer_token_env_var="CODEX_UI_BROWSER_TOKEN"',
      "-c", "mcp_servers.codex_ui_browser.tool_timeout_sec=90",
    ] : [];
    const child = spawn(plan.command.command, [...plan.args, ...browserArgs], {
      cwd,
      env: { ...plan.env, ...(browser ? { CODEX_UI_BROWSER_TOKEN: binding.token } : {}) },
      shell: plan.command.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const record = { id, binding, child, command: plan.command, stderr: [], failed: false };
    // Leave stdout paused until claim: the pipe bounds buffering without losing early frames.
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on("line", (line) => {
      record.stderr.push(line);
      if (record.stderr.length > 50) record.stderr.shift();
      log.error(`[app-server ${id.slice(0, 8)}] ${line}`);
    });
    record.failedBeforeClaim = () => {
      record.failed = true;
      if (spare === record) discardSpare();
    };
    child.on("error", record.failedBeforeClaim);
    child.once("exit", record.failedBeforeClaim);
    return record;
  }

  function discardSpare() {
    const record = spare;
    spare = undefined;
    if (!record) return;
    clearTimeout(record.expiry);
    if (record.child.pid) stop(record.child, true);
  }

  function prewarm(host) {
    if (experimentalBackend !== true || closed || connections.size || typeof host !== "string" || !LOOPBACK_HOST.test(host)) return false;
    prewarmHost = host;
    try {
      const plan = launchPlan(), key = launchKey(plan, host);
      if (spare?.key === key && !spare.failed) return true;
      discardSpare();
      const record = launch(plan, host);
      record.key = key;
      spare = record;
      record.expiry = setTimeout(() => { if (spare === record) discardSpare(); }, 60_000);
      record.expiry.unref();
      return true;
    } catch {
      discardSpare();
      return false; // The page's normal launch reports startup failures when it connects.
    }
  }


  /** Callbacks receive existing event payloads and raw JSON-RPC lines, never SSE frames. */
  function connect(host, { event: emit, message: write, end: finish }) {
    if (closed) throw failure("CLOSED", "Codex UI is closing.");
    if (!LOOPBACK_HOST.test(host)) throw new Error("Codex UI only answers on loopback hosts.");
    let record, prewarmed = false;
    try {
      const plan = launchPlan();
      if (spare) {
        let matching = false;
        try {
          if (spare.child.pid) {
            // The OS can reap a child before Node delivers its exit event.
            process.kill(spare.child.pid, 0);
            matching = spare.key === launchKey(plan, host);
          }
        } catch {}
        if (matching && !spare.failed && !spare.child.killed && spare.child.exitCode === null && spare.child.signalCode === null) {
          record = spare;
          prewarmed = true;
          spare = undefined;
          clearTimeout(record.expiry);
        } else discardSpare();
      }
      record ??= launch(plan, host);
    } catch (error) {
      emit("fatal", { message: error.message });
      return finish();
    }
    const { id, binding, child, command, stderr } = record;
    child.off("error", record.failedBeforeClaim);
    child.off("exit", record.failedBeforeClaim);

    connections.set(id, child);
    if (browser) browserConnections.set(id, binding);
    remoteDiffs.set(child, new Map());
    emit("hello", { connectionId: id, cwd, command: [command.command, ...command.args].join(" "),
      ...(experimentalBackend === true ? { prewarmed } : {}),
    });

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
      if (line) write(line);
    });
    child.on("error", (error) => {
      connections.delete(id);
      dropBrowser(id);
      emit("fatal", { message: error.message });
      finish();
    });
    child.on("exit", (code, signal) => {
      connections.delete(id);
      dropBrowser(id);
      emit("exit", { code, signal, stderr });
      finish();
    });

    return id;
  }

  function disconnect(id) {
    const child = connections.get(id);
    connections.delete(id);
    dropBrowser(id);
    if (child) stop(child, false);
    if (prewarmHost) prewarm(prewarmHost);
  }

  function connection(id) {
    const child = connections.get(id ?? "");
    if (!child) throw failure("CONNECTION_CLOSED", "Connection closed.");
    return child;
  }

  function send(id, messages) {
    const child = connection(id);
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
      .then((full) => write(JSON.stringify({ ...message, result: { ...message.result, diff: full } })));
    return true;
  }

  /** Private replies, including credentials, stay inside the service. */
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

  async function accountProfile(id, signal) {
    const child = connection(id);
    let profile = null;
    try {
      for (const refreshToken of [false, true]) {
        const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken });
        if (signal?.aborted || !auth?.authToken || !CHATGPT_AUTH.has(auth.authMethod)) break;
        // shortcut: ChatGPT's private profile endpoint; replace when app-server exposes profile fields.
        const response = await fetch(`${chatgptBase()}/wham/profiles/me`, {
          headers: { ...chatgptHeaders(auth.authToken), Accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10_000)]),
        });
        if (response.status === 401 && !refreshToken) { await response.body?.cancel(); continue; }
        if (!response.ok) { await response.body?.cancel(); break; }
        profile = profileFields((await response.json())?.profile);
        break;
      }
    } catch {
      // Cosmetic data is optional; do not expose upstream errors or credentials.
    }
    return { profile };
  }

  // Dictation as the Codex desktop composer does it (app-initial YLo): the recording goes to
  // ChatGPT's /transcribe as a multipart `file` under the session's own ChatGPT login and comes
  // back as `{ text }`. The token comes from this page's app-server and never reaches the page;
  // a 401 retries once with a refreshed one.
  async function transcribe(id, audio, type) {
    const child = connection(id);
    try {
      for (const refreshToken of [false, true]) {
        const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken });
        if (!auth?.authToken || !CHATGPT_AUTH.has(auth.authMethod)) throw failure("CHATGPT_REQUIRED", "听写需要使用 ChatGPT 账户登录 Codex。");
        const form = new FormData();
        form.append("file", new Blob([audio], { type }), `codex.${type.split(/[/;]/)[1] || "webm"}`);
        const response = await transcribeFetch(`${chatgptBase()}/transcribe`, {
          method: "POST",
          headers: chatgptHeaders(auth.authToken),
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 401 && !refreshToken) continue;
        const body = await response.json().catch(() => null);
        if (!response.ok) throw failure("TRANSCRIBE_FAILED", transcribeError(response.status, body));
        return { text: typeof body?.text === "string" ? body.text : "" };
      }
    } catch (error) {
      if (["CHATGPT_REQUIRED", "TRANSCRIBE_FAILED"].includes(error.code)) throw error;
      throw failure("TRANSCRIBE_FAILED", `请检查您的网络连接后重试（${error.message}）`);
    }
  }

  function dropBrowser(id) {
    const binding = browserConnections.get(id);
    for (const pending of binding?.pending.values() ?? []) pending.abort();
    browserConnections.delete(id);
  }

  function authorizeBrowser(id, token) {
    const binding = browserConnections.get(id);
    return !!(browser && binding && sameSecret(token, binding.token));
  }

  async function browserMessage(id, token, message, signal) {
    if (!authorizeBrowser(id, token)) throw failure("BROWSER_UNAUTHORIZED", "Browser MCP is unauthorized.");
    const binding = browserConnections.get(id);
    if (message.method === "notifications/cancelled") {
      binding.pending.get(message.params?.requestId)?.abort();
      return null;
    }
    const abort = new AbortController();
    if (message.id !== undefined) binding.pending.set(message.id, abort);
    try {
      return await browserMcpMessage(message, { browser, threads: binding.threads,
        signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal });
    } finally { binding.pending.delete(message.id); }
  }

  async function title(description, model, signal) {
    if (closed) throw failure("CLOSED", "Codex UI is closing.");
    const command = resolveCodexCommand(codex, { env: process.env, home: homedir(), localBuilds });
    if (!command) throw failure("UNAVAILABLE", "Codex is unavailable.");
    const abort = new AbortController();
    titleRequests.add(abort);
    try {
      return await generateTitle({ command, codexArgs, description, model,
        signal: signal ? AbortSignal.any([signal, abort.signal]) : abort.signal });
    } catch (error) {
      if (!abort.signal.aborted && !signal?.aborted) log.error("[title] generation failed", error.message);
      throw error;
    } finally { titleRequests.delete(abort); }
  }

  // Desktop stops maintenance before disposing browser views; transport closes last.
  function stopMaintenance() { backend?.close(); }

  function close() {
    if (closed) return;
    closed = true;
    stopMaintenance();
    discardSpare();
    for (const abort of titleRequests) abort.abort();
    for (const id of browserConnections.keys()) dropBrowser(id);
    for (const child of connections.values()) stop(child, true);
    connections.clear();
  }

  return { backend, backendStartup,
    get experimentalBackend() { return experimentalBackend === true; },
    get closed() { return closed; },
    hasConnection: (id) => connections.has(id ?? ""),
    connect, send, disconnect, prewarm, close, stopMaintenance,
    accountProfile, transcribe, title, authorizeBrowser, browserMessage };
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
export function sameSecret(presented, secret) {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}


const failure = (code, message) => Object.assign(new Error(message), { code });
