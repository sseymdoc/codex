// Run with `pnpm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileSize } from "./files.ts";

test("a size reads as Claude's: decimal units, a decimal place past bytes", () => {
  const plain = (bytes) => fileSize(bytes).replace(/\s/g, " ");
  assert.equal(plain(512), "512 B");
  assert.equal(plain(12_345), "12.3 kB");
  assert.equal(plain(1_000_000), "1 MB");
  assert.equal(plain(2_500_000_000), "2.5 GB");
});

test("content search results group by file, five lines a file and two hundred in all", async () => {
  const { groupMatches } = await import("./files.ts");
  const out = ["./src/a.ts\x0012:5:const a = 1;", "./src/a.ts\x0020:1:a()", "README.md\x003:2:about a", ""].join("\n");
  assert.deepEqual(groupMatches(out), {
    files: [
      { path: "src/a.ts", matches: [{ line: 12, column: 5, text: "const a = 1;" }, { line: 20, column: 1, text: "a()" }], more: false },
      { path: "README.md", matches: [{ line: 3, column: 2, text: "about a" }], more: false },
    ],
    truncated: false,
  });
  const many = Array.from({ length: 7 }, (_, i) => `x.ts\x00${i + 1}:1:hit`).join("\n");
  assert.equal(groupMatches(many).files[0].matches.length, 5);
  assert.equal(groupMatches(many).files[0].more, true);
  assert.equal(groupMatches(many, 3).truncated, true);
  // The default cap: 205 lines over 41 files keep 200.
  const wide = Array.from({ length: 205 }, (_, i) => `f${Math.floor(i / 5)}.ts\x00${i + 1}:1:hit`).join("\n");
  const capped = groupMatches(wide);
  assert.equal(capped.truncated, true);
  assert.equal(capped.files.reduce((sum, file) => sum + file.matches.length, 0), 200);
});

test("content search hands rg the query after -e: a leading dash is searched, and rg's own syntax such as (?i) passes", async (t) => {
  const { searchCommand } = await import("./files.ts");
  const argv = searchCommand("--help");
  assert.deepEqual(argv.slice(-4), ["-F", "-e", "--help", "."]);
  assert.deepEqual(searchCommand("-x", { regex: true }).slice(-3), ["-e", "-x", "."]);
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const cwd = mkdtempSync(path.join(tmpdir(), "better-codex-rg-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(path.join(cwd, "a.txt"), "run with --help\nHELLO there\n");
  const rg = (query, options) => {
    const [command, ...args] = searchCommand(query, options);
    return spawnSync(command, args, { cwd, encoding: "utf8" });
  };
  if (rg("x").error) return t.skip("rg is not installed");
  const literal = rg("--help");
  assert.equal(literal.status, 0);
  assert.match(literal.stdout, /1:10:run with --help/);
  const flagged = rg("(?i)hello", { caseSensitive: true, regex: true });
  assert.equal(flagged.status, 0);
  assert.match(flagged.stdout, /2:1:HELLO there/);
  // searchFiles calls only this stderr an invalid pattern; an unreadable file's exit 2 is not one.
  const bad = rg("(", { regex: true });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /regex parse error|error compiling pattern/i);
});

test("a CRLF file's matches keep their line, without the carriage return", async () => {
  const { groupMatches } = await import("./files.ts");
  const { files } = groupMatches("./a.bat\x003:1:echo hi\r\n");
  assert.deepEqual(files[0].matches, [{ line: 3, column: 1, text: "echo hi" }]);
});
