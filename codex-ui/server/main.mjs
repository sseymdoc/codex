#!/usr/bin/env node
// Production entry: serves the built UI from dist/ and bridges each tab to its
// own `codex app-server`. Development uses `vite` with the same bridge.

import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge, parseArgs } from "./bridge.mjs";

const USAGE = `Usage: codex-ui [--port 7477] [--codex PATH] [--cwd DIR] [-c key=value]... [--no-open]

Serves Codex UI on 127.0.0.1 and starts one \`codex app-server\` per browser tab.

  --port N        port to listen on (default 7477, next free port if taken)
  --codex PATH    codex binary (default: $CODEX_BIN, codex-rs/target/{release,debug}, then PATH)
  --cwd DIR       working directory for app-server, the default workspace for new chats
  -c key=value    config override forwarded to codex (repeatable)
  --no-open       do not open a browser`;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

// Agent output is rendered as markdown; keep remote images (an exfiltration
// channel) and any script we did not ship out of the page.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
if (!existsSync(path.join(dist, "index.html"))) {
  console.error("dist/ is missing. Run `pnpm build` first, or `pnpm dev` while developing.");
  process.exit(1);
}

const bridge = createBridge(options);
const server = http.createServer((req, res) => bridge.handle(req, res, () => serveStatic(req, res)));

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405).end();
  let file = path.join(dist, decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname));
  if (file !== dist && !file.startsWith(dist + path.sep)) return void res.writeHead(403).end();
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, "index.html");
  const immutable = file.startsWith(path.join(dist, "assets") + path.sep);
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(file).pipe(res);
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

function listen(port, retries) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && retries > 0) return listen(port + 1, retries - 1);
    console.error(error.message);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}/?token=${bridge.token}`;
    console.log(`Codex UI is running at ${url}`);
    if (options.open !== false) openBrowser(url);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    bridge.closeAll();
    server.close();
    process.exit(0);
  });
}

listen(options.port ?? 7477, 10);
