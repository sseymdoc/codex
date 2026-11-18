import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { BrowserCDP } from "../desktop/browser-cdp.mjs";

function fixture(reply = () => ({})) {
  const debuggerApi = new EventEmitter(),
    calls = [];
  let attached = false;
  Object.assign(debuggerApi, {
    attach() {
      attached = true;
    },
    isAttached: () => attached,
    detach() {
      attached = false;
      debuggerApi.emit("detach", {}, "closed");
    },
    async sendCommand(method, params) {
      calls.push({ method, params });
      return reply(method, params);
    },
  });
  return { debuggerApi, calls, wc: { debugger: debuggerApi, isDestroyed: () => false } };
}

test("native executor owns its debugger and removes listeners when detached", async () => {
  const { wc, debuggerApi } = fixture(),
    cdp = new BrowserCDP();
  await cdp.attach(wc);
  await cdp.attach(wc);
  assert.equal(debuggerApi.listenerCount("message"), 1);
  await cdp.detach();
  assert.equal(debuggerApi.listenerCount("message"), 0);
  assert.equal(cdp.isAttached(), false);
  debuggerApi.attach();
  await assert.rejects(cdp.attach(wc), /another client/);
  assert.equal(debuggerApi.isAttached(), true, "an unrelated debugger must not be detached");
});

test("expired budgets stop late input; cancelling rejects an unresolved evaluation immediately", async () => {
  const { wc, calls } = fixture((method) => (method === "Runtime.evaluate" ? new Promise(() => {}) : {})),
    cdp = new BrowserCDP();
  await cdp.attach(wc);
  await assert.rejects(
    cdp.run(10, async () => {
      await delay(40);
      await cdp.sendCommand("Input.insertText", { text: "late" });
    }),
    /timed out/,
  );
  await delay(60);
  assert.equal(
    calls.some((call) => call.method === "Input.insertText"),
    false,
  );
  const pending = cdp.run(30000, () => cdp.evaluate("new Promise(()=>{})"));
  setTimeout(() => cdp.cancel(), 10);
  await assert.rejects(pending, /cancelled/);
  await cdp.detach();
});

test("debugger loss rejects pending commands instead of hanging", async () => {
  const { wc, debuggerApi } = fixture((method) => (method === "Runtime.evaluate" ? new Promise(() => {}) : {})),
    cdp = new BrowserCDP();
  await cdp.attach(wc);
  const pending = cdp.evaluate("pending");
  debuggerApi.detach();
  await assert.rejects(pending, /detached/);
  await cdp.attach(wc);
  assert.equal(debuggerApi.listenerCount("message"), 1);
  await cdp.detach();
});

test("telemetry is bounded and oversized or unknown response bodies never get fetched", async () => {
  const { wc, debuggerApi, calls } = fixture(),
    cdp = new BrowserCDP();
  await cdp.attach(wc);
  for (let index = 0; index < 600; index++) {
    debuggerApi.emit("message", {}, "Runtime.consoleAPICalled", {
      type: index === 599 ? "warning" : "log",
      args: [{ value: "entry" + index }],
      timestamp: index,
    });
    debuggerApi.emit("message", {}, "Network.requestWillBeSent", {
      requestId: String(index),
      request: { url: "https://fixture.invalid/" + index, method: "GET" },
      timestamp: index,
    });
  }
  assert.equal(cdp.getConsoleLogs().length, 500);
  assert.equal(cdp.getConsoleLogs("warn").length, 1);
  assert.equal(cdp.getNetworkEntries().length, 500);
  debuggerApi.emit("message", {}, "Network.responseReceived", { requestId: "599", response: { status: 503, mimeType: "text/plain" } });
  debuggerApi.emit("message", {}, "Network.loadingFinished", { requestId: "599", encodedDataLength: 3 * 1024 * 1024 });
  assert.equal(cdp.getNetworkEntries("failed").length, 1);
  await assert.rejects(cdp.getResponseBody("599"), /exceeds/);
  await assert.rejects(cdp.getResponseBody("0"), /no longer/);
  assert.equal(
    calls.some((call) => call.method === "Network.getResponseBody"),
    false,
  );
  await cdp.detach();
});

test("snapshot output handles ignored nodes and repeated children without recursion loops", () => {
  const cdp = new BrowserCDP();
  const text = cdp.formatSnapshotAsText({
    nodes: [
      { nodeId: "1", ignored: true, childIds: ["2"] },
      { nodeId: "2", parentId: "1", role: { value: "textbox" }, name: { value: "姓名" }, value: { value: "测试" }, childIds: ["1"] },
    ],
  });
  assert.equal(text, 'textbox "姓名" value="测试"');
});
