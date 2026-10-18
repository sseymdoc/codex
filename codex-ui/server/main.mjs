#!/usr/bin/env node
// Production entry: serves the built UI (serve.mjs) and opens it in a browser.
// Development uses `vite` with the same bridge.

import { spawn } from "node:child_process";
import { parseArgs } from "./bridge.mjs";
import { serve } from "./serve.mjs";

const USAGE = `Usage: codex-ui [--port 7477] [--codex PATH] [--cwd DIR] [-c key=value]... [--no-open]

Serves Codex UI on 127.0.0.1 and starts one \`codex app-server\` per browser tab.

  --port N        port to listen on (default 7477, next free port if taken)
  --codex PATH    codex binary (default: $CODEX_BIN, codex-rs/target/{release,debug}, PATH, then
                  the newest copy installed by the Codex app or the VS Code extension)
  --cwd DIR       working directory for app-server, the default workspace for new chats
  -c key=value    config override forwarded to codex (repeatable)
  --no-open       do not open a browser`;

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

let server;
try {
  server = await serve(options);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`Codex UI is running at ${server.url}`);
if (options.open !== false) openBrowser(server.url);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    process.exit(0);
  });
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}
