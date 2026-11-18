// Run with `pnpm test`. rpc.ts's reviver: history from before the rename reads as Better Codex names.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

registerHooks({
  load: (url, context, next) =>
    url.startsWith("file:") && url.endsWith(".ts") ? { format: "module", shortCircuit: true, source: transformSync(readFileSync(new URL(url), "utf8"), { loader: "ts", format: "esm" }).code } : next(url, context),
});
const { renamed } = await import("./rpc.ts");

test("a Codex UI desktop server and its _meta keys read as Better Codex's; other values stay", () => {
  const item = JSON.parse('{"server":"codex_ui_desktop","tool":"start_session","result":{"_meta":{"codexUiSession":{"outcome":"started"},"other":1}}}', renamed);
  assert.deepEqual(item, { server: "better_codex_desktop", tool: "start_session", result: { _meta: { betterCodexSession: { outcome: "started" }, other: 1 } } });
  assert.deepEqual(JSON.parse('{"server":"github","text":"codex_ui_desktop","_meta":null}', renamed), { server: "github", text: "codex_ui_desktop", _meta: null });
});
