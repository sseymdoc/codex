import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };
import { createBridge, parseArgs } from "./server/bridge.mjs";
import { serveClaudeFonts } from "./server/claude-fonts.mjs";
import { serveClaudeMarks } from "./server/claude-marks.mjs";

// Build stamp for the About card (codex.ts BUILD); empty outside a git checkout.
function gitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

// In dev the bridge runs inside Vite's own server, so `pnpm dev` is all you need.
function codexBridge() {
  return {
    name: "codex-app-server-bridge",
    configureServer(server) {
      const bridge = createBridge(parseArgs([]));
      server.middlewares.use(bridge.handle);
      server.middlewares.use((req, res, next) => serveClaudeFonts(req, res) || serveClaudeMarks(req, res) || next());
      server.httpServer?.once("listening", () => {
        const { port } = server.httpServer.address();
        console.log(`\n  Codex UI: http://127.0.0.1:${port}/?token=${bridge.token}\n`);
      });
      server.httpServer?.once("close", bridge.closeAll);
    },
  };
}

export default defineConfig({
  plugins: [react(), codexBridge()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  server: { host: "127.0.0.1", port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
