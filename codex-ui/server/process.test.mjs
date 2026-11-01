import assert from "node:assert/strict";
import { test } from "node:test";
import { loginShellPath } from "./process.mjs";

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
