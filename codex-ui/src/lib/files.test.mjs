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
