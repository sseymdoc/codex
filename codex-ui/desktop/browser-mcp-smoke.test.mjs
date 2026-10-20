// Real Codex app-server + authenticated MCP + native browser; model SSE is a local fixture.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createBridge } from "../server/bridge.mjs";

export async function verifyBrowserMcp(browser, work, url) {
  let threadId,
    calls = 0;
  const requests = [];
  const model = http.createServer((req, res) => {
    if (!req.url.includes("/responses")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "gpt-5.1", object: "model" }] }));
    }
    let body = "";
    req.on("data", (bytes) => (body += bytes));
    req.on("end", () => {
      requests.push(body);
      const actions = [
        ["preview_start", { url }],
        ["preview_fill", { serverId: threadId, selector: "#name", value: "MCP 实测" }],
        ["preview_click", { serverId: threadId, selector: "#send" }],
        ["preview_snapshot", { serverId: threadId }],
      ];
      const step = calls++,
        responseId = `response-${step}`;
      const output = actions[step]
        ? {
            type: "function_call",
            call_id: `call-${step}`,
            namespace: "mcp__codex_ui_browser",
            name: actions[step][0],
            arguments: JSON.stringify(actions[step][1]),
          }
        : { type: "message", role: "assistant", content: [{ type: "output_text", text: "浏览器 MCP 验证完成" }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id: responseId } },
        { type: "response.output_item.done", item: output },
        { type: "response.completed", response: { id: responseId, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
      ])
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
  });
  await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
  const codexHome = path.join(work, "codex-home");
  mkdirSync(codexHome);
  writeFileSync(
    path.join(codexHome, "config.toml"),
    `model = "gpt-5.1"\nmodel_provider = "browser_fixture"\n[model_providers.browser_fixture]\nname = "Browser fixture"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
  );
  // Only this disposable test profile approves the fixture's mutations automatically.
  for (const tool of ["preview_start", "preview_fill", "preview_click"]) {
    const file = path.join(codexHome, "config.toml");
    writeFileSync(file, `\n[mcp_servers.codex_ui_browser.tools.${tool}]\napproval_mode = "approve"\n`, { flag: "a" });
  }
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  const bridge = createBridge({
    cwd: work,
    browser,
    token: "browser-smoke-token",
    log: {
      error: (line) => {
        if (/error|failed/i.test(line)) console.error(line);
      },
    },
  });
  const httpServer = http.createServer((req, res) => bridge.handle(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  let reader,
    nextId = 1,
    connection;
  const frames = [],
    pending = new Map(),
    controllers = [];
  const cookie = `codex_ui_${httpServer.address().port}=browser-smoke-token`;
  const send = async (message) => {
    const result = await fetch(`${base}/api/send?c=${connection}`, {
      method: "POST",
      headers: { "Cookie": cookie, "Content-Type": "application/json" },
      body: JSON.stringify(message) + "\n",
    });
    assert.equal(result.status, 204);
  };
  const rpc = async (method, params) => {
    const id = nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`RPC timeout: ${method}`)), 30000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
      });
    });
    await send({ id, method, params });
    return response;
  };
  let helloResolve;
  const hello = new Promise((resolve) => {
    helloResolve = resolve;
  });
  const streamAbort = new AbortController();
  controllers.push(streamAbort);
  try {
    const response = await fetch(base + "/api/events", { headers: { Cookie: cookie }, signal: streamAbort.signal });
    assert.equal(response.status, 200);
    reader = response.body.getReader();
    const reading = (async () => {
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (!data) continue;
          const message = JSON.parse(data);
          frames.push(message);
          if (message.connectionId) {
            connection = message.connectionId;
            helloResolve();
          }
          if (message.id !== undefined && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
          }
        }
      }
    })().catch((error) => {
      if (error.name !== "AbortError") throw error;
    });
    await hello;
    await rpc("initialize", { clientInfo: { name: "codex_ui_browser_smoke", version: "1.0" }, capabilities: { experimentalApi: true } });
    await send({ method: "initialized" });
    const started = await rpc("thread/start", {
      cwd: work,
      model: "gpt-5.1",
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
    });
    threadId = started.thread.id;
    await rpc("turn/start", {
      threadId,
      input: [
        { type: "text", text: "Use only codex_ui_browser tools to open the test page, fill and submit the form, then inspect the result." },
      ],
    });
    for (let i = 0; i < 300; i++) {
      const snapshot = browser.snapshot(threadId);
      if (snapshot.tabs.length)
        await browser.request({ view: threadId, cwd: work, action: "bounds", rect: { x: 20, y: 20, width: 900, height: 600 } });
      if (frames.some((frame) => frame.method === "turn/completed")) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      frames.some((frame) => frame.method === "turn/completed"),
      "Codex turn did not complete",
    );
    const completed = frames.filter((frame) => frame.method === "item/completed" && frame.params?.item?.type === "mcpToolCall");
    assert.equal(completed.length, 4, JSON.stringify(completed.map((frame) => frame.params.item)));
    assert.ok(
      completed.every((frame) => frame.params.item.status === "completed"),
      JSON.stringify(completed.map((frame) => frame.params.item)),
    );
    assert.ok(
      requests.some((body) => body.includes("已收到：MCP 实测")),
      "model did not receive the actual browser snapshot result",
    );
    console.log(
      "BROWSER_MCP_SMOKE " +
        JSON.stringify({
          ok: true,
          threadId,
          actualAppServer: true,
          actualMcp: true,
          actualNativeBrowser: true,
          model: "local synthetic SSE",
          calls: completed.map((frame) => frame.params.item.tool),
          modelReceivedPageResult: true,
        }),
    );
    streamAbort.abort();
    await reading;
  } finally {
    controllers.forEach((controller) => controller.abort());
    await reader?.cancel().catch(() => {});
    bridge.closeAll();
    httpServer.closeAllConnections();
    httpServer.close();
    model.closeAllConnections();
    model.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
  }
}
