// Called by desktop-tools-smoke with an explicitly supplied, freshly built app-server binary.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createOrchestrator } from "../server/orchestrator.mjs";
import { createBridge } from "../server/bridge.mjs";
import { hostContext } from "../context/index.mjs";

export async function verifyNativeDesktop(win, work, binary) {
  const bodies = [], messages = [], pending = new Map();
  let service, bridgeServer, connection, threadId, sequence = 0;
  const model = createServer((req, res) => {
    if (!req.url.includes("/responses")) return res.writeHead(200, { "Content-Type": "application/json" }).end('{"data":[]}');
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      bodies.push(JSON.parse(body));
      const index = (bodies.length - 1) % 4;
      const action = [["get_ui_state", {}], ["show_pane", { pane: "plan" }], ["show_pane", { pane: "files", path: "sample.txt", line: 2 }]][index];
      const output = action ? { type: "function_call", call_id: `desktop-${index}`, namespace: "mcp__codex_ui_desktop", name: action[0], arguments: JSON.stringify(action[1]) }
        : { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of [{ type: "response.created", response: { id: `response-${index}` } }, { type: "response.output_item.done", item: output }, { type: "response.completed", response: { id: `response-${index}`, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
  });
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  const home = path.join(work, "native-home"); mkdirSync(home);
  writeFileSync(path.join(home, "config.toml"), `model="gpt-5.1"\nmodel_provider="display_fixture"\n[model_providers.display_fixture]\nname="Display fixture"\nbase_url="http://127.0.0.1:${model.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
  const wrapper = path.join(work, "native-backend.mjs");
  writeFileSync(wrapper, `import {spawn} from 'node:child_process';const child=spawn(${JSON.stringify(binary)},process.argv.slice(3),{stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exit(code??1));`);
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  const until = async check => { const end = Date.now() + 30000; while (!check()) { assert.ok(Date.now() < end, "native desktop smoke timed out"); await new Promise(resolve => setTimeout(resolve, 20)); } };
  const js = code => win.webContents.executeJavaScript(code);
  try {
    service = createOrchestrator({ codex: wrapper, cwd: work, desktopUi: true, experimentalBackend: true, log: { error() {} } });
    const bridge = createBridge(service, { token: "native-display-fixture" });
    bridgeServer = createServer((req, res) => bridge.handle(req, res, () => res.writeHead(404).end()));
    await new Promise(resolve => bridgeServer.listen(0, "127.0.0.1", resolve));
    const host = `127.0.0.1:${bridgeServer.address().port}`;
    const receipts = [];
    connection = service.connect(host, {
      message(line) { const message = JSON.parse(line); messages.push(message); pending.get(message.id)?.(message); },
      end() {},
      event(event, request) {
        if (event !== "desktop-request") return;
        const receipt = { id: request.id };
        const operation = js(`displayRequest(${JSON.stringify(request)},new AbortController().signal)`).then(result => { receipt.result = result; }, error => { receipt.error = { code: "UI_ERROR", message: error.message }; })
          .then(async () => {
            const response = await fetch(`http://${host}/api/desktop-result?c=${connection}`, { method: "POST", headers: { Cookie: `codex_ui_${bridgeServer.address().port}=native-display-fixture`, "Content-Type": "application/json" }, body: JSON.stringify(receipt) });
            assert.equal(response.status, 204);
          });
        receipts.push(operation);
      },
    });
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, message => { pending.delete(id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result); });
      service.send(connection, [{ id, method, params }]);
    });
    const initialized = await rpc("initialize", { clientInfo: { name: "codex_ui_display_smoke", version: "1" }, capabilities: { experimentalApi: true } });
    assert.equal(initialized.codexUiDesktopTools, true);
    service.send(connection, [{ method: "initialized" }]);
    const started = await rpc("thread/start", { cwd: work, model: "gpt-5.1", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    threadId = started.thread.id;
    await js(`loadNativeThread(${JSON.stringify(started.thread)})`);
    await rpc("thread/settings/update", { threadId, codexUiContext: hostContext(work, false, { desktopContext: true, desktopTools: true }) });
    await rpc("turn/start", { threadId, input: [{ type: "text", text: "Display the existing plan and sample file with the declared desktop tools.", text_elements: [] }] });
    await until(() => messages.some(message => message.method === "turn/completed"));
    await Promise.all(receipts);
    const completed = messages.filter(message => message.method === "item/completed" && message.params?.item?.type === "mcpToolCall").map(message => message.params.item);
    assert.equal(completed.length, 3);
    assert.ok(completed.every(item => item.status === "completed"), JSON.stringify(completed));
    assert.equal(bodies.length, 4);
    assert.match(JSON.stringify(bodies[0].tools), /show_pane/);
    const outputs = bodies.at(-1).input.filter(item => item.type === "function_call_output").map(item => JSON.stringify(item.output)).join("\n");
    assert.ok(outputs.includes("displayed") && outputs.includes("true") && outputs.includes(threadId));
    assert.equal(await js(`document.querySelector('[data-view="${threadId}"][data-pane="files"]') !== null`), true);
    const secondCwd = path.join(work, "other");
    writeFileSync(path.join(secondCwd, "sample.txt"), "second directory\n");
    const second = await rpc("thread/start", { cwd: secondCwd, model: "gpt-5.1", approvalPolicy: "never", sandbox: "read-only", ephemeral: true });
    await js(`loadNativeThread(${JSON.stringify(second.thread)})`);
    await rpc("thread/settings/update", { threadId: second.thread.id, codexUiContext: hostContext(secondCwd, false, { desktopContext: true, desktopTools: true }) });
    await rpc("turn/start", { threadId: second.thread.id, input: [{ type: "text", text: "Display this chat only.", text_elements: [] }] });
    await until(() => messages.filter(message => message.method === "turn/completed").length === 2);
    await Promise.all(receipts);
    const secondCalls = messages.filter(message => message.method === "item/completed" && message.params?.threadId === second.thread.id && message.params.item.type === "mcpToolCall").map(message => message.params.item);
    assert.equal(secondCalls.length, 3);
    assert.ok(secondCalls.every(item => item.status === "completed"), JSON.stringify(secondCalls));
    assert.equal(await js(`document.querySelector('[data-view="${second.thread.id}"][data-pane="files"]') !== null`), true);
    console.log("DESKTOP_NATIVE_SMOKE " + JSON.stringify({ ok: true, binary, sha256: createHash("sha256").update(readFileSync(binary)).digest("hex"), threadId, model: "local synthetic SSE", calls: completed.map(item => item.tool), actualModelReceivedUiReceipts: true }));
  } finally {
    service?.close(); bridgeServer?.closeAllConnections(); bridgeServer?.close(); model.closeAllConnections(); model.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
  }
}
