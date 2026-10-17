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

import { spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(?::(\d+))?$/i;

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

export function resolveCodexCommand(requested) {
  const exe = process.platform === "win32" ? "codex.exe" : "codex";
  const candidates = requested
    ? [requested]
    : ["release", "debug"].map((profile) => path.join(here, "..", "..", "codex-rs", "target", profile, exe));
  for (const candidate of candidates) {
    if (/[\\/]/.test(candidate) && isFile(candidate)) return commandFor(path.resolve(candidate));
  }
  const name = requested && !/[\\/]/.test(requested) ? requested : "codex";
  const found = findOnPath(name);
  return found ? commandFor(found) : null;
}

function findOnPath(name) {
  const extensions = path.extname(name) || process.platform !== "win32" ? [""] : [".exe", ".cmd"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const file = dir && path.join(dir, name + extension);
      if (file && isFile(file)) return file;
    }
  }
  return null;
}

function commandFor(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".js" || extension === ".mjs") return { command: process.execPath, args: [file] };
  if (extension === ".cmd" || extension === ".bat") {
    // npm's Windows shim; run the launcher it wraps so no shell is involved.
    const launcher = path.join(path.dirname(file), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (isFile(launcher)) return { command: process.execPath, args: [launcher] };
    // ponytail: shell fallback does not quote -c values; pass --codex to a real binary if that bites.
    return { command: `"${file}"`, args: [], shell: true };
  }
  return { command: file, args: [] };
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function createBridge({ codex, codexArgs = [], token, cwd = process.cwd(), log = console } = {}) {
  const secret = token || randomBytes(24).toString("hex");
  const connections = new Map();

  function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = LOOPBACK_HOST.exec(req.headers.host ?? "");
    if (!host) return deny(res, 403, "Codex UI only answers on loopback hosts.");
    // Cookies ignore ports, so scope the name to ours.
    const cookieName = `codex_ui_${host[2] ?? "80"}`;

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
    if (url.pathname === "/api/events" && req.method === "GET") return openEvents(req, res);
    if (url.pathname === "/api/send" && req.method === "POST") return forward(req, res, url.searchParams.get("c"));
    return deny(res, 404, "Not found.");
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

    const command = resolveCodexCommand(codex);
    if (!command) {
      emit("fatal", {
        message: "Could not find the codex binary. Build codex-rs, install @openai/codex, or set CODEX_BIN.",
      });
      return finish();
    }

    let child;
    try {
      child = spawn(command.command, [...command.args, "app-server", ...codexArgs], {
        cwd,
        env: process.env,
        shell: command.shell ?? false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      emit("fatal", { message: error.message });
      return finish();
    }

    const id = randomUUID();
    connections.set(id, child);
    emit("hello", { connectionId: id, cwd, command: [command.command, ...command.args].join(" ") });

    createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
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
      emit("exit", { code, signal, stderr });
      finish();
    });

    const ping = setInterval(() => write(": ping\n\n"), 15_000);
    res.on("close", () => {
      clearInterval(ping);
      connections.delete(id);
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
          messages.push(JSON.stringify(JSON.parse(line)));
        } catch {
          return deny(res, 400, "Body must be newline-delimited JSON.");
        }
      }
      for (const message of messages) child.stdin.write(`${message}\n`);
      res.writeHead(204).end();
    });
  }

  function closeAll() {
    for (const child of connections.values()) stop(child, true);
    connections.clear();
  }

  return { token: secret, handle, closeAll };
}

// app-server exits once stdin closes; force-kill only if it lingers.
function stop(child, force) {
  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  };
  child.stdin.end();
  if (force) kill();
  else setTimeout(kill, 3000).unref();
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

function deny(res, status, message) {
  if (res.headersSent) return void res.end();
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
}
