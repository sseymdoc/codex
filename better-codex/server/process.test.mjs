import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { loginShellPath, spawnArgs } from "./process.mjs";

test("spawnArgs quotes a shell launch's args the way CommandLineToArgvW splits them", () => {
  const args = ["app-server", "-c", 'features.code_mode.direct_only_tool_namespaces=["mcp__better_codex_desktop"]', "C:\\dir with space\\"];
  assert.equal(spawnArgs({ command: "codex" }, args), args);
  assert.deepEqual(spawnArgs({ command: '"codex.cmd"', shell: true }, args), [
    '"app-server"', '"-c"', '"features.code_mode.direct_only_tool_namespaces=[\\"mcp__better_codex_desktop\\"]"', '"C:\\dir with space\\\\"',
  ]);
  // A backslash run before a quote doubles, as the parser halves it.
  assert.deepEqual(spawnArgs({ shell: true }, ['a\\"b']), ['"a\\\\\\"b"']);
  assert.deepEqual(spawnArgs({ shell: true }, ["%OS%"]), ['"%%cd:~,%OS%%cd:~,%"']);
});

test("spawnArgs gets % and quotes through cmd.exe and an npm-style .cmd shim unchanged", { skip: process.platform !== "win32" }, async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "spawn args "));
  try {
    writeFileSync(path.join(dir, "argv.js"), "console.log(JSON.stringify(process.argv.slice(2)))");
    writeFileSync(path.join(dir, "codex.cmd"), `@ECHO off\r\n"${process.execPath}" "%~dp0\\argv.js" %*\r\n`);
    const args = ["%OS%", 'k="%PATH%"', "100%", "%%", "%cd:~,%", "a&b", "C:\\dir\\"];
    const command = { command: `"${path.join(dir, "codex.cmd")}"`, shell: true };
    const out = spawnSync(command.command, spawnArgs(command, args), { shell: true, encoding: "utf8" });
    assert.deepEqual(JSON.parse(out.stdout), args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
