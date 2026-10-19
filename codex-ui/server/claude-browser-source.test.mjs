import assert from "node:assert/strict";
import { test } from "node:test";
import { tmpdir } from "node:os";
import path from "node:path";
import manifest from "../desktop/claude-browser-2.42304.json" with { type: "json" };
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { loadClaudeBrowser, readAsarMember } from "../desktop/claude-browser-source.mjs";

const archive = process.env.CODEX_UI_CLAUDE_ASAR || "F:/REA/Claude_2.42304.0.0_x64__pzs8sxrjxfjjc/app/resources/app.asar";
test("the original Claude CDP class loads without the application or native addons", { skip: !existsSync(archive) }, () => {
  const runtime = loadClaudeBrowser(archive);
  const tools = new runtime.CDPTools(true);
  assert.equal(tools.isAttached(), false);
  for (const method of [
    "attach",
    "detach",
    "takeSnapshot",
    "click",
    "fill",
    "inspectElement",
    "evaluate",
    "setViewport",
    "setColorScheme",
    "getNetworkEntries",
    "enableInspectMode",
  ])
    assert.equal(typeof tools[method], "function");
  assert.throws(() => readAsarMember(archive, "../missing"), /missing/);
});

test("a modified module is rejected before it can execute", () => {
  const root = mkdtempSync(path.join(tmpdir(), "codex-browser-hash-"));
  const files = {};
  let entry = { files };
  const names = manifest.member.split("/");
  for (const name of names.slice(0, -1)) entry = entry.files[name] = { files: {} };
  const body = Buffer.from("globalThis.unexpectedClaudeExecution = true;");
  entry.files[names.at(-1)] = { offset: "0", size: body.length };
  const header = Buffer.from(JSON.stringify({ files }));
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(header.length + 8, 4);
  prefix.writeUInt32LE(header.length, 12);
  const file = path.join(root, "modified.asar");
  writeFileSync(file, Buffer.concat([prefix, header, body]));
  assert.deepEqual(readAsarMember(file, manifest.member), body);
  assert.throws(() => loadClaudeBrowser(file), /版本不匹配/);
  assert.equal(globalThis.unexpectedClaudeExecution, undefined);
});
