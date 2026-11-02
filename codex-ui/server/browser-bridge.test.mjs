import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBridge } from "./bridge.mjs";
import { createOrchestrator } from "./orchestrator.mjs";

test("browser HTTP endpoint needs its child token and rejects malformed, cross-origin and unbound calls", async () => {
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), "codex-browser-auth-")));
  const fake = path.join(work, "codex.mjs");
  writeFileSync(
    fake,
    `import {createInterface} from "node:readline"; createInterface({input:process.stdin}).on("line",line=>{const message=JSON.parse(line); console.log(JSON.stringify({id:message.id,result:{thread:{id:"bound-thread",cwd:process.cwd()},token:process.env.CODEX_UI_BROWSER_TOKEN,args:process.argv}}));});`,
  );
  const calls = [];
  const browser = {
    tool: async (...args) => {
      calls.push(args);
      return { content: [{ type: "text", text: "authorized" }] };
    },
  };
  const orchestrator = createOrchestrator({ codex: fake, cwd: work, browser, experimentalBackend: true, log: { error() {} } });
  const bridge = createBridge(orchestrator, { token: "ui-token" });
  const server = http.createServer((req, res) => bridge.handle(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`,
    cookie = `codex_ui_${server.address().port}=ui-token`;
  const abort = new AbortController();
  let reader;
  try {
    const stream = await fetch(base + "/api/events", { headers: { Cookie: cookie }, signal: abort.signal });
    reader = stream.body.getReader();
    let buffer = "";
    const decoder = new TextDecoder();
    async function frame() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end >= 0) {
          const value = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = /^data: (.*)$/m.exec(value)?.[1];
          if (data) return JSON.parse(data);
          continue;
        }
        const next = await reader.read();
        assert.equal(next.done, false);
        buffer += decoder.decode(next.value, { stream: true });
      }
    }
    const hello = await frame();
    await fetch(`${base}/api/send?c=${hello.connectionId}`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ id: 1, method: "thread/start", params: {} }),
    });
    let response;
    do {
      response = await frame();
    } while (response.id !== 1);
    const endpoint = JSON.parse(
      response.result.args
        .find((arg) => arg.startsWith("mcp_servers.codex_ui_browser.url="))
        .split("=")
        .slice(1)
        .join("="),
    );
    const auth = { "Authorization": `Bearer ${response.result.token}`, "Content-Type": "application/json" };
    const post = (body, headers = auth) => fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const initialize = { id: 1, method: "initialize", params: {} };
    assert.equal((await post(initialize, { Cookie: cookie })).status, 401);
    assert.equal((await post(initialize, { ...auth, Authorization: "Bearer incorrect" })).status, 401);
    assert.equal((await post(initialize, { ...auth, Origin: "https://untrusted.invalid" })).status, 401);
    assert.equal((await post(initialize)).status, 200);
    for (const body of [null, [], "string", { id: 1, method: "initialize", params: null }]) assert.equal((await post(body)).status, 400);
    const call = { id: 2, method: "tools/call", params: { name: "tabs_context", arguments: {}, _meta: { threadId: "other-thread" } } };
    assert.equal((await (await post(call)).json()).result.isError, true);
    assert.equal(calls.length, 0);
    call.params._meta.threadId = "bound-thread";
    assert.equal((await (await post(call)).json()).result.content[0].text, "authorized");
    assert.equal(calls[0][0].cwd, work);
    abort.abort();
    await reader.cancel().catch(() => {});
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await post(initialize);
      if (result.status === 401) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await post(initialize)).status, 401, "closing the UI must revoke its MCP token");
  } finally {
    abort.abort();
    await reader?.cancel().catch(() => {});
    orchestrator.close();
    server.closeAllConnections();
    server.close();
  }
});


test("browser declarations, direct MCP requests and automatic verification require the experimental backend", async () => {
  const work = mkdtempSync(path.join(tmpdir(), "codex-browser-gate-"));
  const fake = path.join(work, "codex.mjs");
  writeFileSync(fake, `import {createInterface} from "node:readline"; createInterface({input:process.stdin}).on("line",line=>{const m=JSON.parse(line); console.log(JSON.stringify({id:m.id,result:{thread:{id:"gate-thread",cwd:process.cwd()},args:process.argv,params:m.params,token:process.env.CODEX_UI_BROWSER_TOKEN,enabled:process.env.CODEX_UI_EXPERIMENTAL_BACKEND}}));});`);
  for (const experimentalBackend of [undefined, false, true]) {
    let scheduled = 0, calls = 0;
    const browser = { verificationInstructions() { scheduled++; return "browser auto-verify"; }, tool() { calls++; return { content: [] }; } };
    const orchestrator = createOrchestrator({ codex: fake, cwd: work, browser, experimentalBackend, log: { error() {} } });
    const bridge = createBridge(orchestrator, { token: "gate-token" });
    const server = http.createServer((req, res) => bridge.handle(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: `codex_ui_${server.address().port}=gate-token` };
    const abort = new AbortController();
    let reader;
    try {
      const stream = await fetch(base + "/api/events", { headers, signal: abort.signal });
      reader = stream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const frame = async () => {
        for (;;) {
          const end = buffer.indexOf("\n\n");
          if (end >= 0) {
            const value = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(value)?.[1];
            if (data) return JSON.parse(data);
          } else { const next = await reader.read(); assert.equal(next.done, false); buffer += decoder.decode(next.value, { stream: true }); }
        }
      };
      const hello = await frame();
      await fetch(`${base}/api/send?c=${hello.connectionId}`, { method: "POST", headers, body: JSON.stringify({ id: 1, method: "thread/start", params: { cwd: work } }) });
      let reply; do { reply = await frame(); } while (reply.id !== 1);
      const enabled = experimentalBackend === true;
      assert.equal(reply.result.args.some((arg) => arg.startsWith("mcp_servers.codex_ui_browser.url=")), enabled);
      assert.equal(reply.result.params.config?.developer_instructions, enabled ? "browser auto-verify" : undefined);
      assert.equal(scheduled, enabled ? 1 : 0);
      assert.equal(reply.result.enabled, enabled ? "1" : "0");
      const endpoint = `${base}/api/browser-mcp?c=${hello.connectionId}`;
      const post = (method) => fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${reply.result.token || "forged"}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: 2, method, params: { name: "tabs_context", _meta: { threadId: "gate-thread" } } }) });
      for (const method of ["tools/list", "tools/call"]) {
        const result = await post(method);
        assert.equal(result.status, enabled ? 200 : 401);
        if (enabled && method === "tools/list") assert.ok((await result.json()).result.tools.length);
      }
      assert.equal(calls, enabled ? 1 : 0);
    } finally {
      abort.abort(); await reader?.cancel().catch(() => {});
      orchestrator.close(); server.closeAllConnections(); server.close();
    }
  }
});
