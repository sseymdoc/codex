import assert from "node:assert/strict";
import { test } from "node:test";
import { browserUrl } from "./browser.ts";
test("the browser address bar normalizes web and localhost addresses without accepting credentials or executable schemes", () => {
  assert.equal(browserUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(browserUrl(" localhost:5173/path "), "http://localhost:5173/path");
  assert.equal(browserUrl("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(browserUrl("https://example.com/?q=中文"), "https://example.com/?q=%E4%B8%AD%E6%96%87");
  for (const input of ["", "javascript:alert(1)", "file:///C:/secret", "https://user:password@example.com"])
    assert.throws(() => browserUrl(input));
});
