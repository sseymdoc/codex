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
});

test("a CRLF file's matches keep their line, without the carriage return", async () => {
  const { groupMatches } = await import("./files.ts");
  const { files } = groupMatches("./a.bat\x003:1:echo hi\r\n");
  assert.deepEqual(files[0].matches, [{ line: 3, column: 1, text: "echo hi" }]);
});
