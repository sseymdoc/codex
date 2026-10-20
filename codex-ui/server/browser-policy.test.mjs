import assert from "node:assert/strict";
import { test } from "node:test";
import { browserUrl, isBrowserServiceUrl, isLoopbackHost, isPrivateHost } from "./browser-policy.mjs";

test("local previews bypass site prompts across loopback aliases and ports, never LAN or lookalike hosts", () => {
  for (const host of ["localhost", "app.localhost", "localhost.", "127.0.0.1", "127.0.0.2", "[::1]", "[::ffff:7f00:1]", "0.0.0.0", "[::]"])
    assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["localhost.attacker.test", "app.localhost.attacker.test", "127.0.0.1.attacker.test", "192.168.1.1", "10.0.0.1", "[::ffff:c0a8:101]", "[fd00::1]", "example.com"])
    assert.equal(isLoopbackHost(host), false, host);
  for (const host of ["app.localhost", "192.168.1.1", "10.0.0.1", "[::ffff:c0a8:101]", "[fd00::1]"])
    assert.equal(isPrivateHost(host), true, host);
});

test("all loopback aliases and websocket transports protect the app's internal port", () => {
  for (const raw of ["http://127.0.0.2:7478/api/events", "http://app.localhost:7478", "ws://[::1]:7478", "http://[::ffff:127.0.0.1]:7478"])
    assert.equal(isBrowserServiceUrl(raw, "http://127.0.0.1:7478"), true, raw);
  assert.equal(isBrowserServiceUrl("http://127.0.0.1:7485", "http://127.0.0.1:7478"), false);
  assert.equal(isBrowserServiceUrl("https://example.com:7478", "http://127.0.0.1:7478"), false);
  assert.equal(isBrowserServiceUrl("http://localhost", "http://127.0.0.1:80"), true);
});

test("site grants cannot admit credential-bearing or executable URLs", () => {
  assert.equal(browserUrl("http://127.1:7485").hostname, "127.0.0.1");
  for (const raw of ["file:///C:/private", "javascript:alert(1)", "https://user:password@example.com", "not a URL"])
    assert.throws(() => browserUrl(raw));
});
