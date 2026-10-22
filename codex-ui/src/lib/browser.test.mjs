import assert from "node:assert/strict";
import { test } from "node:test";
import { browserUrl, writtenFiles } from "./browser.ts";
test("a completed patch opens the pages, images and videos it added or updated, at their new path", () => {
  const change = (path, kind) => ({ path, kind, diff: "" });
  const item = (status) => ({
    type: "fileChange",
    id: "patch",
    status,
    changes: [
      change("/w/index.html", { type: "add" }),
      change("/w/old.svg", { type: "update", move_path: "/w/new.svg" }),
      change("/w/shot.PNG", { type: "update", move_path: null }),
      change("/w/gone.html", { type: "delete" }),
      change("/w/app.ts", { type: "update", move_path: null }),
      change("/w/report.pdf", { type: "add" }),
    ],
  });
  assert.deepEqual(writtenFiles(item("completed")), ["/w/index.html", "/w/new.svg", "/w/shot.PNG"]);
  assert.deepEqual(writtenFiles(item("failed")), []);
  assert.deepEqual(writtenFiles({ type: "agentMessage", id: "m", text: "a.html" }), []);
});
test("the browser address bar normalizes web and localhost addresses without accepting credentials or executable schemes", () => {
  assert.equal(browserUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(browserUrl(" localhost:5173/path "), "http://localhost:5173/path");
  assert.equal(browserUrl("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(browserUrl("app.localhost:5173/path"), "http://app.localhost:5173/path");
  assert.equal(browserUrl("localhost.attacker.test/path"), "https://localhost.attacker.test/path");
  assert.equal(browserUrl("[::1]:5173"), "http://[::1]:5173/");
  assert.equal(browserUrl("https://example.com/?q=中文"), "https://example.com/?q=%E4%B8%AD%E6%96%87");
  for (const input of ["", "javascript:alert(1)", "file:///C:/secret", "https://user:password@example.com"])
    assert.throws(() => browserUrl(input));
});
