import { execSync } from "node:child_process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createBridge, parseArgs } from "./server/bridge.mjs";

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
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_SHA__: JSON.stringify(gitSha()),
  },
  server: { host: "127.0.0.1", port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
