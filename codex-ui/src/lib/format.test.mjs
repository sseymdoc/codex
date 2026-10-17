// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of format.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { externalUrl } from "./format.ts";

test("externalUrl only opens https links without credentials", () => {
  assert.equal(externalUrl("https://example.com/authorize?state=1"), "https://example.com/authorize?state=1");
  for (const unsafe of ["http://example.com/", "javascript:alert(1)", "https://user:pass@example.com/", "file:///etc/passwd", "not a url"]) {
    assert.equal(externalUrl(unsafe), null, unsafe);
  }
});
