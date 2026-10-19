import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_TOOLS, browserMcpMessage, validateToolInput } from "./browser-protocol.mjs";

test("original browser tools retain their contracts and reject malformed inputs", () => {
  assert.equal(BROWSER_TOOLS.filter((t) => t.name.startsWith("preview_")).length, 13);
  assert.deepEqual(validateToolInput("preview_start", { url: "https://example.com" }), { url: "https://example.com" });
  for (const args of [null, [], { serverId: 5 }, { serverId: "one", selector: "button", injected: true }])
    assert.throws(() => validateToolInput("preview_click", args));
  assert.throws(() => validateToolInput("preview_click", { serverId: "one" }), /selector/);
  assert.throws(() => validateToolInput("preview_resize", { serverId: "one", width: Infinity }), /width/);
});

test("MCP calls use host-provided thread metadata and cannot select another thread with arguments", async () => {
  const calls = [];
  const browser = {
    tool: async (context, name, args) => {
      calls.push({ context, name, args });
      return { content: [{ type: "text", text: "real result" }] };
    },
  };
  const context = { browser, threads: new Map([["thread-a", "workspace-a"]]) };
  const request = { id: 1, method: "tools/call", params: { name: "tabs_context", arguments: {} } };
  assert.equal((await browserMcpMessage(request, context)).result.isError, true);
  request.params._meta = { threadId: "thread-b" };
  assert.equal((await browserMcpMessage(request, context)).result.isError, true);
  assert.equal(calls.length, 0);
  request.params._meta.threadId = "thread-a";
  const result = await browserMcpMessage(request, context);
  assert.equal(result.result.content[0].text, "real result");
  assert.equal(calls[0].context.cwd, "workspace-a");
});
