// Serves the built UI from dist/ and bridges each page to its own
// `codex app-server`. Shared by the CLI (main.mjs) and the Electron shell
// (desktop/main.mjs); development uses `vite` with the same bridge.

import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBridge } from "./bridge.mjs";

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

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

// Listens on 127.0.0.1 at `options.port` (default 7477, or one of the next ten
// if taken) and resolves with the tokenized URL to open.
export async function serve(options) {
  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error("dist/ is missing. Run `pnpm build` first, or `pnpm dev` while developing.");
  }
  const bridge = createBridge(options);
  const server = http.createServer((req, res) => bridge.handle(req, res, () => serveStatic(req, res)));
  const port = await listen(server, options.port ?? 7477, 10);
  return {
    url: `http://127.0.0.1:${port}/?token=${bridge.token}`,
    close() {
      bridge.closeAll();
      server.close();
    },
  };
}

function listen(server, port, retries) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      if (error.code === "EADDRINUSE" && retries > 0) resolve(listen(server, port + 1, retries - 1));
      else reject(error);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolve(server.address().port);
    });
  });
}

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
