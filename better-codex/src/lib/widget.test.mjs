import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && /\.tsx?$/.test(context.parentURL ?? "")) {
      for (const ext of [".ts", ".tsx"]) {
        try { return next(specifier + ext, context); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context);
    const { code } = transformSync(readFileSync(new URL(url), "utf8"), { loader: url.endsWith(".tsx") ? "tsx" : "ts", format: "esm", jsx: "automatic" });
    return { format: "module", shortCircuit: true, source: code };
  },
});

const { widgetRequest } = await import("../components/Widget.tsx");
const message = (data) => ({ betterCodexWidget: true, ...data });

test("a widget's prompt is only ever a request to confirm, and needs this page's own activation", () => {
  // The frame's own word that it was clicked counts for nothing.
  assert.equal(widgetRequest(message({ type: "sendPrompt", text: "rm -rf", active: true }), false), null);
  assert.deepEqual(widgetRequest(message({ type: "sendPrompt", text: "  Explain this  " }), true), { type: "prompt", text: "Explain this" });
  assert.equal(widgetRequest(message({ type: "sendPrompt", text: "   " }), true), null);
  assert.equal(widgetRequest({ type: "sendPrompt", text: "x" }, true), null);
  assert.equal(widgetRequest(message({ type: "openLink", url: "javascript:alert(1)" }), true), null);
  assert.equal(widgetRequest(message({ type: "openLink", url: "https://example.com" }), false), null);
  assert.deepEqual(widgetRequest(message({ type: "openLink", url: "https://example.com" }), true), { type: "link", url: "https://example.com" });
  assert.deepEqual(widgetRequest(message({ type: "size", height: 99999 }), false), { type: "size", height: 1600 });
});
