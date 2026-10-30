// In-process application service. Hosts supply browser/network capabilities; transports own framing.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendManager } from "./backend.mjs";
import { browserMcpMessage } from "./browser-protocol.mjs";
import { createDesktopTools } from "./desktop-tools.mjs";
import { generateTitle } from "./title.mjs";
import { readLines, stop } from "./process.mjs";
import { celsiusFeed } from "./celsius.mjs";
import { createExecutor } from "./executor.mjs";
import { cloudAllowed, cloudFetch } from "./cloud.mjs";
import { UUID, attach, available, cached, resolveContent, stableId, statsigBody, upload } from "./library.mjs";
import { applyPatch, bindWorktree, createWorktree, gitBranches, gitDiffToRemote, switchBranch, syncWithBase } from "./git.mjs";
import { appendDeveloperInstructions, hostContext } from "../context/index.mjs";

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

/** Git work the bridge answers itself (the app-server has no RPC for it), by JSON-RPC method. */
const LOCAL_GIT = {
  gitDiffToRemote: (cwd, _params, signal) => gitDiffToRemote(cwd, signal),
  "codexUi/git/branches": (cwd, _params, signal) => gitBranches(cwd, signal),
  "codexUi/git/switch": (cwd, { branch }, signal) => switchBranch(cwd, branch, signal).then(() => ({})),
  "codexUi/worktree/create": (cwd, { base, root }, signal) => createWorktree(cwd, base, root, signal),
  "codexUi/worktree/bind": (cwd, { threadId }, signal) => bindWorktree(cwd, threadId, signal).then(() => ({})),
  "codexUi/worktree/sync": (cwd, { base }, signal) => syncWithBase(cwd, base, signal),
  "codexUi/git/apply": (cwd, { diff }, signal) => applyPatch(cwd, diff, signal).then(() => ({})),
};

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

/**
 * Each host owns one service; backend settings are captured once, before any connection starts.
 * `dataDir` is the host's own folder (the desktop shell's userData), where the library keeps its
 * statsig stable id. `folder` is the one new chats start in, only where one was asked for (--cwd);
 * without it they start on 本电脑 with no folder.
 */
export function createOrchestrator({ codex, codexArgs = [], cwd = process.cwd(), folder, log = console, browser: desktopBrowser, desktopUi = false, localBuilds = true, experimentalBackend = false, toolAccessMode = "on-demand", connectorSearch = true, chatgptFetch = fetch, webSocket = globalThis.WebSocket, backend: backendOptions, localExecutor, dataDir } = {}) {
  const backend = backendOptions ? createBackendManager(backendOptions) : null;
  const backendStartup = backend?.startup();
  if (backendStartup) {
    codex = backendStartup.codex;
    experimentalBackend = backendStartup.channel !== "disabled";
    localBuilds = false;
  }
  const browser = experimentalBackend === true ? desktopBrowser : undefined;
  const desktopEnabled = experimentalBackend === true && desktopUi === true;
  const connections = new Map();
  const browserConnections = new Map();
  const own = new Map();
  /** UI-owned Git previews never enter the app-server's unbounded binary-patch response path. */
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
    const binding = { token: randomBytes(24).toString("hex"), desktopToken: randomBytes(24).toString("hex"), primary: new Set(), threads: new Map(), pending: new Map(), hostContexts: new Map(), managed: false, displayCapable: false };
    const browserArgs = browser ? [
      "-c", `mcp_servers.codex_ui_browser.url=${JSON.stringify(`http://${host}/api/browser-mcp?c=${id}`)}`,
      "-c", 'mcp_servers.codex_ui_browser.bearer_token_env_var="CODEX_UI_BROWSER_TOKEN"',
      "-c", "mcp_servers.codex_ui_browser.tool_timeout_sec=90",
    ] : [];
    const desktopArgs = desktopEnabled ? [
      "-c", `mcp_servers.codex_ui_desktop.url=${JSON.stringify(`http://${host}/api/desktop-mcp?c=${id}`)}`,
      "-c", 'mcp_servers.codex_ui_desktop.bearer_token_env_var="CODEX_UI_DESKTOP_TOKEN"',
      // Display calls time out after 5 s in desktop-tools.mjs; set_session_title and enter_plan_mode may
      // wait 10 min on consent, a start_session offer a day on its card (Claude's waits with no limit).
      "-c", "mcp_servers.codex_ui_desktop.tool_timeout_sec=86400",
      // Those waits block the turn, as in Claude, only as top-level calls: nested in a code-mode exec
      // the cell yields after 30 s and the turn can end with the offer card unanswerable.
      // ponytail: replaces a features.code_mode list or boolean from config.toml; merge it if one turns up.
      "-c", 'features.code_mode.direct_only_tool_namespaces=["mcp__codex_ui_desktop"]',
    ] : [];
    const env = { ...plan.env };
    // A process launched from another chat must never inherit that chat's host credentials.
    delete env.CODEX_UI_BROWSER_TOKEN;
    delete env.CODEX_UI_DESKTOP_TOKEN;
    if (browser) env.CODEX_UI_BROWSER_TOKEN = binding.token;
    if (desktopEnabled) env.CODEX_UI_DESKTOP_TOKEN = binding.desktopToken;
    const child = spawn(plan.command.command, [...plan.args, ...browserArgs, ...desktopArgs], {
      cwd,
      env,
      shell: plan.command.shell ?? false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const record = { id, binding, child, command: plan.command, stderr: [], failed: false };
    record.outputError = (stream) => (error) => {
      record.failed = true;
      const message = error.code === "OUTPUT_TOO_LARGE"
        ? `后端 ${stream} 的单条输出过大（上限 ${stream === "stdout" ? 64 : 1} MiB），连接已关闭。`
        : `后端 ${stream} 读取失败：${error.message}`;
      log.error(`[app-server ${id.slice(0, 8)}] ${message}`);
      child.stdout.destroy();
      child.stderr.destroy();
      const prewarmed = spare === record;
      child.emit("error", Object.assign(new Error(message), { code: error.code }));
      if (child.pid && !prewarmed) stop(child, true);
    };
    // Leave stdout paused until claim: the pipe bounds buffering without losing early frames.
    readLines(child.stderr, {
      maxBytes: 1024 * 1024, error: record.outputError("stderr"), line: (line) => {
        record.stderr.push(line);
        if (record.stderr.length > 50) record.stderr.shift();
        log.error(`[app-server ${id.slice(0, 8)}] ${line}`);
      },
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
    executor?.wake();
    if (browser || desktopEnabled) browserConnections.set(id, binding);
    if (desktopEnabled) binding.desktop = createDesktopTools({
      enabled: () => binding.displayCapable && connections.get(id) === child,
      context: threadId => {
        const accepted = binding.hostContexts.get(threadId)?.accepted;
        return { cwd: binding.threads.get(threadId), enabled: binding.primary.has(threadId) && accepted?.desktop?.enabled === true,
          browserEnabled: browser?.toolsEnabled?.() !== false && !!browser };
      }, emit,
    });
    remoteDiffs.set(child, { abort: new AbortController(), write });
    emit("hello", { connectionId: id, cwd, ...(folder ? { folder } : {}), command: [command.command, ...command.args].join(" "),
      ...(experimentalBackend === true ? { prewarmed, experimentalBackend: true } : {}),
    });

    readLines(child.stdout, {
      maxBytes: 64 * 1024 * 1024, error: record.outputError("stdout"), line: (line) => {
        if (browser || desktopEnabled) {
          try {
            const message = JSON.parse(line);
            if (message.result?.codexUiHostContext === true) binding.managed = true;
            if (message.result?.codexUiDesktopTools === true) binding.displayCapable = true;
            const thread = message.result?.thread ?? message.params?.thread;
            const threadId = thread?.id ?? message.params?.threadId;
            const threadCwd = thread?.cwd ?? message.params?.threadSettings?.cwd;
            if (message.method === "thread/closed" || message.params?.status?.type === "notLoaded") {
              binding.desktop?.invalidate(threadId);
              binding.primary.delete(threadId);
              binding.threads.delete(threadId);
              binding.hostContexts.get(threadId)?.stop?.();
              binding.hostContexts.delete(threadId);
            } else if (typeof threadId === "string" && typeof threadCwd === "string") {
              if (thread && Object.hasOwn(thread, "parentThreadId")) {
                if (thread.parentThreadId === null && !(typeof thread.source === "object" && thread.source && ("subAgent" in thread.source || "subagent" in thread.source))) binding.primary.add(threadId);
                else binding.primary.delete(threadId);
              }
              binding.threads.set(threadId, threadCwd);
              const context = binding.hostContexts.get(threadId);
              if (context && context.cwd !== threadCwd) {
                binding.desktop?.invalidate(threadId);
                context.cwd = threadCwd;
                context.stop?.();
                context.stop = browser?.watchVerification?.(threadCwd, () => refreshHostContext(id, threadId));
                refreshHostContext(id, threadId);
              }
            }
          } catch {}
        }
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
      },
    });
    let ended = false;
    const end = (event, data) => {
      if (ended) return;
      ended = true;
      remoteDiffs.get(child).abort.abort();
      connections.delete(id);
      dropBrowser(id);
      emit(event, data);
      finish();
    };
    child.on("error", (error) => end("fatal", { message: error.message,
      ...(error.code === "OUTPUT_TOO_LARGE" ? { code: error.code } : {}),
    }));
    child.on("exit", (code, signal) => end("exit", { code, signal, stderr }));

    return id;
  }

  function disconnect(id) {
    if (String(id).startsWith("durable:")) return void durables.get(id)?.close("exit");
    for (const entry of durables.values()) if (entry.parent === id) entry.close("exit");
    const child = connections.get(id);
    connections.delete(id);
    dropBrowser(id);
    remoteDiffs.get(child)?.abort.abort();
    if (child) stop(child, false);
    if (prewarmHost) prewarm(prewarmHost);
  }

  function connection(id) {
    if (String(id).startsWith("durable:")) throw failure("CONNECTION_CLOSED", "Connection closed.");
    const child = connections.get(id ?? "");
    if (!child) throw failure("CONNECTION_CLOSED", "Connection closed.");
    return child;
  }

  function send(id, messages) {
    if (String(id).startsWith("durable:")) return sendDurable(id, messages);
    const child = connection(id);
    for (const message of messages) {
      const binding = browserConnections.get(id);
      if ((browser || desktopEnabled) && binding?.managed && message?.method === "thread/settings/update" && message.params?.codexUiContext) {
        const { threadId, codexUiContext } = message.params;
        let state = binding.hostContexts.get(threadId);
        if (!state) {
          const threadCwd = binding.threads.get(threadId) ?? codexUiContext.cwd;
          state = { cwd: threadCwd, latest: null, accepted: null, tail: Promise.resolve() };
          state.stop = browser?.watchVerification?.(threadCwd, () => refreshHostContext(id, threadId));
          binding.hostContexts.set(threadId, state);
        }
        const write = remoteDiffs.get(child).write;
        void enqueueHostContext(id, threadId, message.params).then(
          (result) => { if (connections.get(id) === child) write(JSON.stringify({ id: message.id, result })); },
          (error) => { if (connections.get(id) === child) write(JSON.stringify({ id: message.id, error: { code: -32602, message: error.message } })); },
        );
        continue;
      }
      if (browser && !binding?.managed && ["thread/start", "thread/resume"].includes(message?.method) && (message.method === "thread/start" || message.params?.config)) {
        const instruction = browser.verificationInstructions?.(message.params?.cwd || browserConnections.get(id)?.threads.get(message.params?.threadId) || cwd);
        if (instruction) {
          message.params ??= {};
          const config = message.params.config ?? {};
          message.params.config = appendDeveloperInstructions(config, instruction);
        }
      }
      const local = Object.hasOwn(LOCAL_GIT, message?.method ?? "") ? LOCAL_GIT[message.method] : null;
      if (local) {
        const { abort, write } = remoteDiffs.get(child);
        const reply = (body) => {
          if (!abort.signal.aborted) write(JSON.stringify({ id: message.id ?? null, ...body }));
        };
        if (typeof message.params?.cwd !== "string" || !message.params.cwd || message.params.cwd.includes("\0")
          || !(typeof message.id === "string" || Number.isSafeInteger(message.id))) {
          reply({ error: { code: -32602, message: "Invalid Git preview request." } });
          continue;
        }
        void local(path.resolve(cwd, message.params.cwd), message.params, abort.signal).then(
          (result) => reply({ result }),
          (error) => reply({ error: { code: -32000, message: error.message } }),
        );
        continue;
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  function refreshHostContext(id, threadId) {
    void enqueueHostContext(id, threadId).catch((error) => {
      if (connections.has(id)) remoteDiffs.get(connections.get(id)).write(JSON.stringify({ method: "warning", params: { threadId, message: `宿主上下文同步失败：${error.message}` } }));
    });
  }

  function enqueueHostContext(id, threadId, params) {
    const child = connections.get(id);
    const binding = browserConnections.get(id);
    const state = binding?.hostContexts.get(threadId);
    if (!state || !child) return Promise.reject(new Error("Connection closed."));
    const next = state.tail.catch(() => {}).then(async () => {
      if (connections.get(id) !== child || binding.hostContexts.get(threadId) !== state) throw new Error("Connection closed.");
      const requested = params?.codexUiContext ?? state.latest;
      if (!requested) return {};
      const targetCwd = typeof params?.cwd === "string" ? path.resolve(state.cwd, params.cwd) : state.cwd;
      const snapshot = { ...requested, cwd: targetCwd,
        browserVerification: hostContext(targetCwd, requested.planning.enabled, browser?.verificationState?.(targetCwd)).browserVerification };
      const same = JSON.stringify(snapshot) === JSON.stringify(state.accepted);
      if (same && (!params || Object.keys(params).length === 2)) return {};
      const result = await askAppServer(child, "thread/settings/update", { ...params, threadId, codexUiContext: snapshot });
      if (connections.get(id) !== child || binding.hostContexts.get(threadId) !== state) throw new Error("Connection closed.");
      state.latest = requested;
      binding.threads.set(threadId, targetCwd);
      if (state.cwd !== targetCwd) {
        binding.desktop?.invalidate(threadId);
        state.cwd = targetCwd;
        state.stop?.();
        state.stop = browser?.watchVerification?.(targetCwd, () => refreshHostContext(id, threadId));
      }
      state.accepted = snapshot;
      if (!snapshot.desktop?.enabled) binding.desktop?.invalidate(threadId);
      return result;
    });
    state.tail = next;
    return next;
  }

  /** Private replies, including credentials, stay inside the service. */
  function askAppServer(child, method, params) {
    const id = `${OWN_ID}${randomUUID()}`;
    return new Promise((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed || child.stdin.writableEnded) return reject(new Error("Connection closed."));
      const disconnected = () => settle({ error: { message: "Connection closed." } });
      const timer = setTimeout(() => settle({ error: { message: `${method} timed out` } }), 15_000);
      const settle = (message) => {
        clearTimeout(timer);
        own.delete(id);
        child.off("error", disconnected);
        child.off("exit", disconnected);
        if (message.error) reject(new Error(message.error.message ?? `${method} failed`));
        else resolve(message.result);
      };
      own.set(id, settle);
      child.once("error", disconnected);
      child.once("exit", disconnected);
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

  /**
   * Codex Cloud and Dots (server/cloud.mjs): one allowed call under this page's ChatGPT login.
   * Dots go out as the Codex desktop app sends them: without the Codex SKU, and through the
   * host's browser network stack where it has one (ChatGPT challenges Node's off /wham). The page
   * names `method`, `path`, `body`, a dot room's `threadRoute` and an `idempotencyKey`; `kind` and
   * `form` are the bridge's own.
   */
  function cloud(id, { method, path, body, threadRoute, idempotencyKey }, signal, onToken, { kind, form } = {}) {
    const child = connection(id);
    const wham = typeof path === "string" && path.startsWith("/wham/");
    return cloudFetch({
      base: typeof path === "string" && path.startsWith("/v1/") ? cloudBackend() : chatgptBase(),
      headers: (token) => {
        onToken?.(token);
        const headers = chatgptHeaders(token);
        if (!wham) delete headers["OAI-Product-Sku"];
        return headers;
      },
      fetch: wham ? fetch : chatgptFetch,
      method,
      path,
      body,
      form,
      threadRoute,
      idempotencyKey,
      ...(kind ? { kind } : {}),
      signal,
      auth: (refreshToken) => chatgptToken(child, refreshToken),
    });
  }

  async function chatgptToken(child, refreshToken) {
    const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken });
    return auth?.authToken && CHATGPT_AUTH.has(auth.authMethod) ? auth.authToken : null;
  }

  /**
   * Whether this login's ChatGPT account has Dots, read as the Codex desktop app does (`tbo_config`),
   * and the login's own account user id: a dot room tells the user's messages from the dot's by it.
   */
  async function dotsAvailable(id, signal) {
    let claims;
    const { status, body } = await cloud(id, { method: "GET", path: "/accounts/check/v4-2023-04-27" }, signal,
      (token) => { claims = tokenClaims(token); });
    const account = claims?.chatgpt_account_id;
    const user = typeof claims?.chatgpt_account_user_id === "string" ? claims.chatgpt_account_user_id.trim() : "";
    return {
      available: status === 200 && !!account && body?.accounts?.[account]?.account?.tbo_config?.tbo_available === true,
      ...(user ? { accountUserId: user } : {}),
    };
  }

  /** A file for a dot room or a character snapshot, uploaded as the desktop app does (a multipart `file`). */
  function dotsUpload(id, { path, name, type, bytes, fields = {} }, signal) {
    return cloud(id, { method: "POST", path }, signal, undefined, { form: { fields, file: { bytes, name, type } } });
  }

  // The socket URL is a credential of its own: it stays here, cached for 25 minutes as the
  // desktop app caches it (Pvt), and asked anew after a socket that never opened.
  const celsiusUrls = new Map();

  /** Dots' messaging events for this page (server/celsius.mjs), until `signal` aborts. */
  function dotsEvents(id, emit, signal) {
    connection(id);
    const getUrl = async (fresh) => {
      const cached = celsiusUrls.get(id);
      if (!fresh && cached && cached.expiresAt > Date.now()) return cached.url;
      const { status, body } = await cloud(id, { method: "GET", path: "/celsius/ws/user" }, signal, undefined, { kind: "internal" });
      const url = typeof body?.websocket_url === "string" ? body.websocket_url : "";
      if (status !== 200 || !/^wss?:\/\//.test(url)) throw new Error("No socket URL.");
      celsiusUrls.set(id, { url, expiresAt: Date.now() + 25 * 60_000 });
      return url;
    };
    celsiusFeed({ getUrl, WebSocket: webSocket, emit, signal });
    signal.addEventListener("abort", () => celsiusUrls.delete(id), { once: true });
  }

  /** An allowed ChatGPT event stream (a dot's activity), as the upstream response. */
  function cloudStream(id, path, signal) {
    return openStream(id, "GET", path, undefined, "text/event-stream", signal);
  }

  /** An allowed ChatGPT NDJSON stream the bridge posts itself (an upload's processing), as the upstream response. */
  function libraryStream(id, path, body, signal) {
    return openStream(id, "POST", path, body, "application/x-ndjson", signal);
  }

  async function openStream(id, method, path, body, accept, signal) {
    const child = connection(id);
    if (!cloudAllowed(method, path, "stream")) throw failure("CLOUD_REFUSED", "This stream is not allowed.");
    for (const refreshToken of [false, true]) {
      const token = await chatgptToken(child, refreshToken);
      if (!token) throw failure("CHATGPT_REQUIRED", "需要使用 ChatGPT 账户登录 Codex。");
      const headers = chatgptHeaders(token);
      delete headers["OAI-Product-Sku"];
      const response = await chatgptFetch(`${chatgptBase()}${path}`, {
        method,
        headers: { ...headers, Accept: accept, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal,
      });
      if (response.status === 401 && !refreshToken) { await response.body?.cancel(); continue; }
      return response;
    }
  }

  // The library (server/library.mjs): its gates a minute per connection and login, file addresses
  // five minutes per account, and the attachment folders this process made (the only ones it removes).
  const libraryGates = new Map();
  const contentUrls = new Map();
  const attachments = new Set();
  // ponytail: without a data folder (the CLI, Vite) statsig sees a new stable id every start; the desktop shell keeps one.
  const statsig = { stableId: dataDir ? null : randomUUID(), sessionId: randomUUID() };
  const codexHome = () => path.resolve(process.env.CODEX_HOME || path.join(homedir(), ".codex"));

  /** The bridge's own calls for the library, on its internal routes or the page's (`{status, body}`). */
  const libraryCall = (id, signal) => (method, path, body) =>
    cloud(id, { method, path, body }, signal, undefined, { kind: cloudAllowed(method, path, "internal") ? "internal" : "json" });

  /** Whether this login has the library (library.mjs `available`), kept a minute per connection and account. */
  async function libraryAvailable(id) {
    const child = connection(id);
    const auth = await askAppServer(child, "getAuthStatus", { includeToken: true, refreshToken: false });
    const claims = auth?.authToken ? tokenClaims(auth.authToken) : null;
    return cached(libraryGates, `${id}\n${claims?.chatgpt_account_id ?? ""}`, 60_000, () => available({
      authMethod: auth?.authMethod,
      claims,
      call: libraryCall(id),
      statsig: statsigBody({ stableId: (statsig.stableId ??= stableId(dataDir)), sessionId: statsig.sessionId, electron: !!process.versions.electron }),
    }));
  }

  /**
   * A library file's bytes, as the upstream response (library.mjs finds where): ChatGPT's own
   * address (estuary) under the login, the file host's signed one (a thumbnail) without it, neither
   * redirected. An address is kept five minutes per account, file and kind (a
   * note's current text, asked without a file id, never: it follows each save); one that stopped
   * working is asked anew once.
   */
  async function libraryContent(id, { id: node, fileId, kind, range }, signal) {
    const child = connection(id);
    const account = tokenClaims((await chatgptToken(child, false)) ?? "")?.chatgpt_account_id ?? "";
    const key = [account, node, fileId, kind === "html" ? "content" : kind].join("\n");
    // Not under one page request's signal: a kept address serves the others too.
    const resolve = () => resolveContent({ id: node ?? undefined, fileId: fileId ?? undefined, kind, base: chatgptBase(), json: (path) => libraryCall(id)("GET", path) });
    for (const again of [false, true]) {
      const response = await fetchContent(child, await (fileId || kind === "thumbnail" ? cached(contentUrls, key, 5 * 60_000, resolve) : resolve()), range, signal);
      if (again || ![401, 403, 404].includes(response.status)) return response;
      await response.body?.cancel();
      contentUrls.delete(key);
    }
  }

  /**
   * `target`'s answer, given 120 s to begin: its body then runs as long as the page waits for it
   * (a download has no cap; the page going away aborts it).
   */
  async function fetchContent(child, target, range, signal) {
    const due = new AbortController();
    const timer = setTimeout(() => due.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 120_000);
    const timeout = AbortSignal.any([...(signal ? [signal] : []), due.signal]);
    const headers = range ? { Range: range } : {};
    try {
      // Neither is ever redirected: the file host answers in place, and net.fetch cannot hand a
      // redirect back anyway ("manual" throws).
      if (!target.signed) return await chatgptFetch(target.url, { headers, redirect: "error", signal: timeout });
      for (const refreshToken of [false, true]) {
        const token = await chatgptToken(child, refreshToken);
        if (!token) throw failure("CHATGPT_REQUIRED", "需要使用 ChatGPT 账户登录 Codex。");
        const auth = chatgptHeaders(token);
        delete auth["OAI-Product-Sku"];
        const response = await chatgptFetch(target.url, { headers: { ...auth, ...headers }, redirect: "error", signal: timeout });
        if (response.status === 401 && !refreshToken) { await response.body?.cancel(); continue; }
        return response;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** An upload into the library (library.mjs `upload`), its stages to `emit`; the upload URL and token stay here. */
  function libraryUpload(id, { body, name, type, directoryId }, emit, signal) {
    connection(id);
    return upload({
      body, name, type, directoryId, emit, signal,
      json: libraryCall(id, signal),
      // net.fetch sends a Blob with its Content-Length, as Azure's Put Blob needs.
      put: chatgptFetch,
      stream: (path, request, streamSignal) => libraryStream(id, path, request, streamSignal),
    });
  }

  /** A library file saved for a chat under CODEX_HOME/attachments (library.mjs `attach`), by its ids only. */
  async function libraryAttach(id, { id: node, fileId, name, size }, signal) {
    connection(id);
    const saved = await attach({ name, size, home: codexHome(), signal, open: () => libraryContent(id, { id: node, fileId, kind: "content" }, signal) });
    attachments.add(path.dirname(saved.path));
    return saved;
  }

  /** A saved attachment dropped: its folder (or the file in it), only one this process made under CODEX_HOME/attachments. */
  async function libraryDetach(id, target) {
    connection(id);
    if (typeof target !== "string" || !path.isAbsolute(target)) return false;
    const resolved = path.resolve(target);
    const dir = attachments.has(resolved) ? resolved : path.dirname(resolved);
    if (!attachments.has(dir) || path.dirname(dir) !== path.join(codexHome(), "attachments") || !UUID.test(path.basename(dir))) return false;
    attachments.delete(dir);
    await rm(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * A dot's work runs on ChatGPT's durable app-server host. A page gets its own connection there,
   * opened as the Codex desktop app opens it (the token in the `openai-bearer.` subprotocol, the
   * Codex SKU and the account in headers) and carried like the local one (`durable:` ids on
   * /api/events and /api/send). Only the calls a dot's thread view makes go out; it closes with
   * the page's own connection.
   */
  const durables = new Map();

  function connectDurable(parentId, { event: emit, message: write, end: finish }, { internal = false } = {}) {
    const child = connection(parentId);
    const id = `durable:${randomUUID()}`;
    const entry = { parent: parentId, socket: null, closed: false, internal };
    // A call the host is not asked answers at once, so the page does not wait on it.
    entry.refuse = (request, method) => write(JSON.stringify({ id: request, error: { code: -32601, message: `${method} is not available on the durable host.` } }));
    durables.set(id, entry);
    const close = (code, message) => {
      if (entry.closed) return;
      entry.closed = true;
      durables.delete(id);
      try { entry.socket?.close(); } catch { /* already closed */ }
      emit(code === "fatal" ? "fatal" : "exit", code === "fatal" ? { message } : { code: null, signal: null, stderr: message ? [message] : [] });
      finish();
    };
    entry.close = close;
    void (async () => {
      const url = durableUrl();
      if (!url) return close("fatal", "Durable host URL is not allowed.");
      for (const refreshToken of [false, true]) {
        let token;
        try { token = await chatgptToken(child, refreshToken); } catch (error) { return close("fatal", error.message); }
        if (!token) return close("fatal", "Dot 的任务需要使用 ChatGPT 账户登录 Codex。");
        if (entry.closed) return;
        const claims = tokenClaims(token);
        const opened = await new Promise((resolve) => {
          let socket;
          try {
            socket = new webSocket(url, {
              protocols: ["codex-app-server", "codex-client.desktop", `openai-bearer.${token}`],
              headers: { "X-OpenAI-Product-Sku": "codex", ...(claims?.chatgpt_account_id ? { "ChatGPT-Account-Id": claims.chatgpt_account_id } : {}) },
            });
          } catch { return resolve(false); }
          entry.socket = socket;
          let open = false;
          socket.addEventListener("open", () => {
            open = true;
            resolve(true);
            emit("hello", { connectionId: id, cwd: "", command: "durable" });
          });
          socket.addEventListener("message", (event) => {
            if (typeof event.data === "string") write(event.data.replace(/\n/g, ""));
          });
          socket.addEventListener("close", () => {
            if (!open) return resolve(false);
            close("exit", "与 Dot 的任务宿主的连接已断开。");
          });
          socket.addEventListener("error", () => {});
        });
        if (opened || entry.closed) return;
      }
      close("fatal", "无法连接 Dot 的任务宿主。");
    })();
    return id;
  }

  /** Calls a dot's thread view makes on the durable host; nothing else goes there. */
  const DURABLE_METHODS = new Set(["initialize", "initialized", "thread/resume", "thread/read", "thread/turns/list", "thread/unsubscribe", "turn/addUserMessage", "thread/stop", "turn/interrupt"]);
  /** The local computer's own calls there (reportEnvironmentReady), never a page's. */
  const READY_METHODS = new Set(["thread/list", "thread/environmentReady"]);

  function sendDurable(id, messages) {
    const entry = durables.get(id);
    if (!entry || entry.closed || entry.socket?.readyState !== 1) throw failure("CONNECTION_CLOSED", "Connection closed.");
    for (const message of messages) {
      if (typeof message?.method !== "string" || !(DURABLE_METHODS.has(message.method) || (entry.internal && READY_METHODS.has(message.method)))) {
        if (message?.id !== undefined && typeof message?.method === "string") entry.refuse(message.id, message.method);
        continue;
      }
      entry.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Tells a dot's threads this computer is up, as the desktop app does: the threads on the durable
   * host that are a dot's (or its tasks') and list this environment hear `thread/environmentReady`,
   * four at a time, each once (`reported`). Any page's login will do; none open, none told.
   */
  async function reportEnvironmentReady(environmentId, roots, reported) {
    const parent = connections.keys().next().value;
    if (!parent) return;
    const pending = new Map();
    let next = 0, opened;
    const open = new Promise((resolve, reject) => { opened = { resolve, reject }; });
    const id = connectDurable(parent, {
      event: (name, data) => (name === "hello" ? opened.resolve() : opened.reject(new Error(data?.message ?? "closed"))),
      message: (text) => {
        let reply;
        try { reply = JSON.parse(text); } catch { return; }
        const waiter = pending.get(reply?.id);
        if (!waiter) return;
        pending.delete(reply.id);
        if (reply.error) waiter.reject(new Error(reply.error.message ?? "failed"));
        else waiter.resolve(reply.result);
      },
      end: () => {
        for (const waiter of pending.values()) waiter.reject(new Error("closed"));
        pending.clear();
      },
    }, { internal: true });
    const call = (method, params) => new Promise((resolve, reject) => {
      const key = ++next;
      pending.set(key, { resolve, reject });
      sendDurable(id, [{ id: key, method, params }]);
    });
    try {
      await open;
      await call("initialize", { clientInfo: { name: "codex_ui", title: "Codex UI", version: "0.0.0" }, capabilities: { experimentalApi: true } });
      sendDurable(id, [{ method: "initialized" }]);
      const selectedCapabilityRoots = roots.map(({ id: root, path: rootPath }) => ({ id: root, location: { type: "environment", environmentId, path: rootPath } }));
      let cursor = null;
      do {
        const page = await call("thread/list", { cursor, limit: 100, archived: false, useStateDbOnly: true });
        const threads = (Array.isArray(page?.data) ? page.data : [])
          .filter((thread) => ["aeon", "aeon_child", "cloud_threads.create"].includes(thread?.threadSource)
            && thread.environments?.some?.((environment) => environment?.environmentId === environmentId) && !reported.has(thread.id))
          .map((thread) => thread.id);
        for (let at = 0; at < threads.length; at += 4) {
          await Promise.all(threads.slice(at, at + 4).map((threadId) =>
            call("thread/environmentReady", { threadId, environmentId, selectedCapabilityRoots }).then(() => reported.add(threadId), () => {})));
        }
        cursor = typeof page?.nextCursor === "string" ? page.nextCursor : null;
      } while (cursor);
    } finally {
      durables.get(id)?.close("exit");
    }
  }

  /** The local computer (server/executor.mjs): only where the desktop shell hands over its data folder. */
  const executor = localExecutor?.dir ? createExecutor({
    dir: localExecutor.dir,
    launch: () => {
      const plan = launchPlan();
      return { command: plan.command.command, args: plan.command.args, env: plan.env, shell: plan.command.shell,
        codexHome: plan.env.CODEX_HOME || process.env.CODEX_HOME || path.join(homedir(), ".codex") };
    },
    register: async (body) => {
      const parent = connections.keys().next().value;
      if (!parent) throw new Error("连接 Codex 后才能注册这台电脑。");
      const { status, body: answer } = await cloud(parent, { method: "POST", path: "/flora/cca/executor", body }, AbortSignal.timeout(30_000), undefined, { kind: "internal" });
      const id = typeof answer?.executor_id === "string" ? answer.executor_id.trim() : "";
      if (status < 200 || status > 299 || !/^[\w.:-]{1,200}$/.test(id)) throw new Error(`无法注册这台电脑（HTTP ${status}）。`);
      return id;
    },
    reportReady: reportEnvironmentReady,
  }) : null;

  /** The local computer's state for the page; `available` false outside the desktop shell. */
  function executorState(id) {
    connection(id);
    return executor?.state() ?? { available: false };
  }

  function setExecutor(id, on) {
    connection(id);
    if (!executor) throw failure("UNAVAILABLE", "本机电脑只在桌面版中可用。");
    return executor.setEnabled(on);
  }

  /**
   * A dot room's file or a member's avatar, streamed: ChatGPT's own URLs go out under the login,
   * its file host's signed ones without it (one redirect followed, to an allowed host), anything
   * else is refused. Resolves to the upstream response.
   */
  async function dotsContent(id, url, signal) {
    const child = connection(id);
    const base = new URL(chatgptBase());
    const allowed = (raw) => {
      let target;
      try { target = new URL(raw, base); } catch { return null; }
      if (target.username || target.password) return null;
      if (target.origin === base.origin) return { target, signed: true };
      return target.protocol === "https:" && /(^|\.)oaiusercontent\.com$/.test(target.hostname) ? { target, signed: false } : null;
    };
    let next = allowed(url);
    for (let hop = 0; next && hop < 2; hop++) {
      for (const refreshToken of [false, true]) {
        const token = next.signed ? await chatgptToken(child, refreshToken) : null;
        if (next.signed && !token) throw failure("CHATGPT_REQUIRED", "需要使用 ChatGPT 账户登录 Codex。");
        const headers = token ? chatgptHeaders(token) : {};
        delete headers["OAI-Product-Sku"];
        const response = await chatgptFetch(next.target.href, {
          headers,
          redirect: "manual",
          signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60_000)]),
        });
        if (response.status === 401 && next.signed && !refreshToken) { await response.body?.cancel(); continue; }
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          next = location ? allowed(new URL(location, next.target).href) : null;
          break;
        }
        return response;
      }
    }
    throw failure("CLOUD_REFUSED", "This file is not allowed.");
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
        const response = await chatgptFetch(`${chatgptBase()}/transcribe`, {
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
    binding?.desktop?.close();
    for (const context of binding?.hostContexts.values() ?? []) context.stop?.();
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

  function authorizeDesktop(id, token) {
    const binding = browserConnections.get(id);
    return !!(desktopEnabled && binding?.desktop && sameSecret(token, binding.desktopToken));
  }
  function desktopSession(id, token, session, initialize = false) {
    if (!authorizeDesktop(id, token)) return undefined;
    const desktop = browserConnections.get(id).desktop;
    return initialize && !session ? desktop.openSession() : desktop.hasSession(session) ? session : undefined;
  }
  function closeDesktopSession(id, token, session) {
    return authorizeDesktop(id, token) && browserConnections.get(id).desktop.closeSession(session);
  }
  function desktopMessage(id, token, message, signal, session) {
    if (!authorizeDesktop(id, token)) throw failure("DESKTOP_UNAUTHORIZED", "Desktop MCP is unauthorized.");
    return browserConnections.get(id).desktop.message(message, signal, session);
  }
  function desktopResult(id, receipt) {
    if (!connections.has(id)) return false;
    return browserConnections.get(id)?.desktop?.respond(receipt) === true;
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
    for (const entry of durables.values()) entry.close("exit");
    executor?.close();
    for (const id of browserConnections.keys()) dropBrowser(id);
    for (const child of connections.values()) {
      remoteDiffs.get(child).abort.abort();
      stop(child, true);
    }
    connections.clear();
  }

  return { backend, backendStartup,
    get experimentalBackend() { return experimentalBackend === true; },
    get closed() { return closed; },
    hasConnection: (id) => connections.has(id ?? "") || durables.has(id ?? ""),
    connect, send, disconnect, prewarm, close, stopMaintenance,
    accountProfile, cloud, cloudStream, connectDurable, executorState, setExecutor, dotsAvailable, dotsUpload, dotsEvents, dotsContent,
    libraryAvailable, libraryContent, libraryUpload, libraryAttach, libraryDetach,
    transcribe, title, authorizeBrowser, browserMessage, authorizeDesktop, desktopSession, closeDesktopSession, desktopMessage, desktopResult };
}

// The backend the Codex desktop app talks to (CODEX_API_BASE_URL overrides it, as there), with
// its headers; the originator is codex-ui's own, as app-server reports it (clientInfo.name).
const chatgptBase = () => (process.env.CODEX_API_BASE_URL?.trim() || "https://chatgpt.com/backend-api").replace(/\/+$/, "");

/** The Codex cloud backend over https: the durable host's origin, as the desktop app derives it (AO); none for a refused override. */
const cloudBackend = () => durableUrl()?.replace(/^ws/, "http").replace(/\/+$/, "");

/** The durable app-server host a dot's work runs on (CODEX_DURABLE_HOST_URL overrides it): wss, or ws on loopback only. */
function durableUrl() {
  const raw = process.env.CODEX_DURABLE_HOST_URL?.trim() || "wss://codex-cloud-backend.chatgpt.com/";
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    return url.protocol === "wss:" || (url.protocol === "ws:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(url.hostname)) ? url.href : null;
  } catch {
    return null;
  }
}

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

export function sameSecret(presented, secret) {
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}


const failure = (code, message) => Object.assign(new Error(message), { code });
