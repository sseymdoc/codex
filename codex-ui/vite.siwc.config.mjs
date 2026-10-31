// Keep the desktop runtime self-contained: packaging deliberately omits node_modules.
import { copyFile, mkdir } from "node:fs/promises";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: "vendor/siwc/packages/local/src/index.ts",
    outDir: "server/siwc-dist",
    emptyOutDir: true,
    minify: false,
    rolldownOptions: { output: { entryFileNames: "index.mjs", codeSplitting: false } },
  },
  plugins: [{
    name: "siwc-notices",
    async closeBundle() {
      await mkdir("server/siwc-dist/docs", { recursive: true });
      for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "UPSTREAM.md", "docs/dependency-inventory.json"]) {
        await copyFile(`vendor/siwc/${file}`, `server/siwc-dist/${file}`);
      }
    },
  }],
});
