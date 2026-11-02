import assert from "node:assert/strict";
import { test } from "node:test";
import { loginShellPath, spawnArgs } from "./process.mjs";

test("spawnArgs quotes a shell launch's args the way CommandLineToArgvW splits them", () => {
  const args = ["app-server", "-c", 'features.code_mode.direct_only_tool_namespaces=["mcp__codex_ui_desktop"]', "C:\\dir with space\\"];
  assert.equal(spawnArgs({ command: "codex" }, args), args);
  assert.deepEqual(spawnArgs({ command: '"codex.cmd"', shell: true }, args), [
    '"app-server"', '"-c"', '"features.code_mode.direct_only_tool_namespaces=[\\"mcp__codex_ui_desktop\\"]"', '"C:\\dir with space\\\\"',
  ]);
  // A backslash run before a quote doubles, as the parser halves it.
  assert.deepEqual(spawnArgs({ shell: true }, ['a\\"b']), ['"a\\\\\\"b"']);
});

test("loginShellPath takes the last line a login shell prints, and null when it fails", () => {
  const calls = [];
  const run = (shell, args) => (calls.push([shell, args[0]]), "Last login: today\nwelcome\n/opt/homebrew/bin:/usr/bin");
  assert.equal(loginShellPath({ shell: "/bin/zsh", run }), "/opt/homebrew/bin:/usr/bin");
  assert.deepEqual(calls, [["/bin/zsh", "-ilc"]]);
  assert.equal(loginShellPath({ run: () => { throw new Error("timed out"); } }), null);
  assert.equal(loginShellPath({ run: () => "\n" }), null);
});

test("loginShellPath reads a real shell's PATH", { skip: process.platform === "win32" }, () => {
  assert.equal(loginShellPath({ shell: "/bin/sh" })?.includes("/usr/bin"), true);
});
