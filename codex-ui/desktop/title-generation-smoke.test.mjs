// Real desktop + app-server, with an isolated profile and a local model fixture.
import { app } from "electron";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveCodexCommand } from "../server/orchestrator.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-title-ui-"));
const profile = path.join(work, "profile"), codexHome = path.join(work, "codex-home");
mkdirSync(profile);
mkdirSync(codexHome);
mkdirSync(path.join(work, ".codex"));
writeFileSync(path.join(work, ".codex", "launch.json"), JSON.stringify({ version: "0.0.1", configurations: [], autoVerify: true }));
writeFileSync(path.join(work, "AGENTS.md"), "TITLE_PROJECT_INSTRUCTION_SHOULD_NOT_APPEAR");
app.setName("Codex Title Acceptance");
app.setPath("userData", profile);
writeFileSync(path.join(profile, "window-state.json"), JSON.stringify({ menuBar: false, quickEntry: false, keepAwake: false, theme: "light" }));
process.env.CODEX_HOME = codexHome;
process.env.INIT_CWD = work;
const backend = resolveCodexCommand(process.env.CODEX_BIN);
assert.ok(backend && !backend.shell && backend.args.length === 0, "set CODEX_BIN to a native Codex executable");
process.env.CODEX_BIN = backend.command;
let win, server;
const consoleMessages = [], requests = [];
app.on("browser-window-created", (_event, window) => {
  if (win) return;
  win = window;
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on("console-message", (event) => {
    if (["error", "warning"].includes(event.level)) consoleMessages.push(event.message);
  });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, label) {
  for (let i = 0; i < 300; i++) {
    const value = await test();
    if (value) return value;
    await sleep(50);
  }
  throw new Error(label);
}
const timeout = setTimeout(() => { console.error("TITLE_UI_TIMEOUT", work); app.exit(2); }, 60000);

async function seedUnnamedThread() {
  const child = spawn(backend.command, ["app-server", "--listen", "stdio://"], { cwd: work, env: process.env, windowsHide: true });
  child.stderr.resume();
  let next = 0;
  const pending = new Map();
  const completed = Promise.withResolvers();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
    if (message.method === "turn/completed") completed.resolve(message.params.turn);
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await call("initialize", { clientInfo: { name: "title_acceptance", version: "1" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const { thread } = await call("thread/start", { cwd: work, sandbox: "read-only", approvalPolicy: "never" });
    await call("turn/start", { threadId: thread.id, input: [{ type: "text", text: "调整界面字体大小", text_elements: [] }] });
    assert.equal((await completed.promise).status, "completed");
  } finally {
    child.kill();
  }
}

async function run() {
  try {
    server = http.createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => text += chunk);
      req.on("end", () => {
        const body = JSON.parse(text || "{}");
        const naming = JSON.stringify(body).includes("succinct title for a coding session");
        const title = JSON.stringify(body).includes("字体") ? "字体设置" : "通知样式";
        const payload = JSON.stringify(body);
        requests.push({ naming, browserInstructions: payload.includes("For web changes in this project"), projectInstructions: payload.includes("TITLE_PROJECT_INSTRUCTION_SHOULD_NOT_APPEAR"), browserTools: JSON.stringify(body.tools ?? []).includes("codex_ui_browser"), ...(naming ? { title } : {}) });
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const id = `title-fixture-${requests.length}`;
        for (const event of [
          { type: "response.created", response: { id } },
          { type: "response.output_item.done", item: { type: "message", role: "assistant", content: [{ type: "output_text", text: naming ? `<title>${title}</title>` : "已完成" }] } },
          { type: "response.completed", response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
        ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(path.join(codexHome, "config.toml"), `model="gpt-5.1"\nmodel_provider="title_fixture"\n[model_providers.title_fixture]\nname="Title fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    await seedUnnamedThread();
    await import("./main.mjs");
    await until(() => win && !win.webContents.isLoading(), "window loaded");
    const js = (code) => win.webContents.executeJavaScript(code);
    const hasTitle = (title) => js(`[...document.querySelectorAll('[data-row-key^="code:"] [data-row-label] .relative')].some(e=>e.firstChild?.textContent.trim()===${JSON.stringify(title)})`);
    await until(() => hasTitle("调整界面字体大小"), "existing session listed");
    await js("[...document.querySelectorAll('[data-row-key^=\"code:\"] [data-row-main-button]')].find(e=>e.textContent.includes('调整界面字体大小')).click()");
    await until(() => js("document.querySelector('.transcript[aria-busy=\"false\"]')?.innerText.includes('调整界面字体大小')"), "existing session loaded");
    await sleep(300);
    assert.equal(await hasTitle("调整界面字体大小"), true, "an existing unnamed conversation keeps its fallback title");
    assert.equal(await hasTitle("字体设置"), false, "restoring an old conversation does not generate a title");
    assert.equal(requests.filter((request) => request.naming).length, 0);
    await js("document.querySelector('[data-row-nav]').click()");
    await until(() => js("!!document.querySelector('.draft-title') && !!document.querySelector('textarea')"), "new session composer ready");
    await js(`(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'修改 Codex UI 通知样式，让优先级展示更紧凑');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus()})()`);
    await sleep(80);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(() => hasTitle("通知样式"), "new session renamed");
    win.webContents.reload();
    await until(() => !win.webContents.isLoading(), "reload completed");
    await until(async () => await hasTitle("调整界面字体大小") && await hasTitle("通知样式"), "titles persisted after reload");
    assert.equal(requests.filter((request) => request.naming).length, 1, "only the new conversation gets a generated title");
    assert.ok(requests.some((request) => !request.naming && request.browserInstructions), "fixture enables browser verification on ordinary turns");
    for (const request of requests.filter((request) => request.naming)) {
      assert.equal(request.browserInstructions, false, "title never receives browser verification instructions");
      assert.equal(request.projectInstructions, false, "title never loads project instructions");
      assert.equal(request.browserTools, false, "title never receives browser MCP tools");
    }
    assert.deepEqual(consoleMessages, []);
    console.log("TITLE_UI_SMOKE", JSON.stringify({ ok: true, work, checks: ["existing session", "new session", "persisted titles", "independent worker", "no browser or project instructions", "no browser MCP tools"], requests }));
    clearTimeout(timeout);
    server.close();
    app.quit();
  } catch (error) {
    writeFileSync(path.join(work, "console.json"), JSON.stringify(consoleMessages, null, 2));
    if (win && !win.isDestroyed()) writeFileSync(path.join(work, "page.txt"), await win.webContents.executeJavaScript("document.body.innerText"));
    console.error("TITLE_UI_FAILURE", JSON.stringify({ reason: error.stack, work, requests, consoleMessages }));
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
}
// Electron emits ready only after the entry module has finished evaluating.
void run();
