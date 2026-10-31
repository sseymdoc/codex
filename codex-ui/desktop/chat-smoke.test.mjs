// Real Electron, OS-encrypted synthetic credentials, SDK and HTTP/SSE bridge. No live account or inference.
import { app, BrowserWindow, safeStorage } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createOrchestrator } from "../server/orchestrator.mjs";
import { createBridge } from "../server/bridge.mjs";
import { ConnectionStore } from "../vendor/siwc/packages/local/dist/storage.js";
import { chatCredentials } from "./chat-credentials.mjs";
import { STAND_INS } from "../server/claude-fonts.mjs";

const root = path.resolve(import.meta.dirname, ".."), work = mkdtempSync(path.join(tmpdir(), "codex-siwc-ui-"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
let win, server, service, mode = "complete";
const requests = [], errors = [], delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timer = setTimeout(() => { console.error("SIWC_SMOKE_TIMEOUT", work); app.exit(2); }, 60000);

async function run() {
  try {
    await app.whenReady();
    const { createChatGPT } = await import(pathToFileURL(path.resolve(process.argv[2] || path.join(root, "server/siwc-dist/index.mjs"))).href);
    const encryption = chatCredentials(safeStorage), credentials = path.join(work, "siwc-chat", "credentials");
    assert.equal(await encryption.isAvailable(), true);
    const store = new ConnectionStore(credentials, encryption);
    await store.withLock(() => store.write({ version: 2, activeProfileId: "account-a", pendingRegistrations: [], profiles: [{
      version: 1, id: "account-a", label: "测试账号", clientId: "oaiapp_synthetic", subject: "synthetic-subject",
      status: "connected", scopes: ["chatgpt.tokens.use.direct"], savedAt: new Date().toISOString(),
      identity: { email: "synthetic@example.invalid" }, credentials: { accessToken: "synthetic-access-token", expiresAt: Date.now() + 3600000 },
    }] }));
    assert.ok(!readFileSync(path.join(credentials, "chatgpt-auth.json"), "utf8").includes("synthetic-access-token"));
    globalThis.fetch = async (raw, options = {}) => {
      const url = String(raw);
      if (url === "https://api.openai.com/v1/models") return Response.json({ models: [{ slug: "test-model", display_name: "模拟模型", visibility: "list" }] });
      assert.equal(url, "https://api.openai.com/v1/responses", "unexpected network request");
      const body = JSON.parse(options.body); requests.push(body);
      const encoder = new TextEncoder(), currentMode = mode;
      let finish;
      return new Response(new ReadableStream({
        start(controller) {
          const frame = (event) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          frame({ type: "response.output_text.delta", delta: "模拟回复：" });
          finish = setTimeout(() => {
            if (currentMode === "failed") frame({ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } });
            else { frame({ type: "response.output_text.delta", delta: "已收到" }); frame({ type: "response.completed", response: { status: "completed" } }); }
            controller.close();
          }, currentMode === "slow" ? 10000 : 200);
          options.signal?.addEventListener("abort", () => { clearTimeout(finish); try { controller.error(new DOMException("cancelled", "AbortError")); } catch {} }, { once: true });
        }, cancel() { clearTimeout(finish); },
      }), { headers: { "Content-Type": "text/event-stream" } });
    };
    const fake = path.join(work, "backend.mjs");
    writeFileSync(fake, `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id!==undefined)console.log(JSON.stringify({id:m.id,result:{codexUiSiwcChat:true}}));}).on('close',()=>process.exit(0));`);
    service = createOrchestrator({ codex: fake, cwd: work, dataDir: work, desktopUi: true, experimentalBackend: true,
      createSiwcClient: async () => createChatGPT({ appName: "Codex UI Test", appId: "codex-ui-test", redirectPort: 0, sendHostId: true,
        storageDir: credentials, credentialEncryption: encryption, openBrowser() { throw new Error("Live login forbidden in smoke test"); } }),
    });
    const bridge = createBridge(service, { token: "synthetic-cookie" });
    let script;
    const cssDir = path.join(root, "dist/assets"), css = readFileSync(path.join(cssDir, readdirSync(cssDir).find((name) => name.endsWith(".css"))));
    server = http.createServer((req, res) => bridge.handle(req, res, () => {
      if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
      else if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(script); }
      else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (req.url === "/fonts.css") { res.setHeader("Content-Type", "text/css"); res.end(STAND_INS); }
      else { res.writeHead(204); res.end(); }
    }));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const host = `127.0.0.1:${server.address().port}`;
    const replies = [];
    const connection = service.connect(host, { event() {}, message: (line) => replies.push(JSON.parse(line)), end() {} });
    service.send(connection, [{ id: 1, method: "initialize", params: { capabilities: { experimentalApi: true } } }]);
    for (let i = 0; i < 100 && !replies.length; i++) await delay(20);
    assert.equal(service.chatAvailable(connection), true);
    const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import {ChatView} from './src/components/Chat.tsx';import {connectChat,chatState,selectChat} from './src/lib/chat.ts';import {Rpc} from './src/lib/rpc.ts';
Object.defineProperty(Rpc.prototype,'connection',{get:()=>${JSON.stringify(connection)}});window.chatState=chatState;window.selectChat=selectChat;connectChat();createRoot(document.getElementById('root')).render(<div className="app"><div className="main"><ChatView/></div></div>);`;
    const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, bundle: true, write: false,
      format: "iife", platform: "browser", jsx: "automatic", loader: { ".md": "text", ".css": "empty" },
      define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"', __GIT_SHA__: '"test"', "process.env.NODE_ENV": '"production"' },
    });
    script = bundle.outputFiles[0].contents;
    win = new BrowserWindow({ width: 1100, height: 820, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
    await win.loadURL(`http://${host}/?token=synthetic-cookie`);
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => { for (let i = 0; i < 200; i++) { if (await js(code)) return; await delay(25); } throw new Error(`Condition failed: ${code}`); };
    const type = async (text) => {
      await js(`(()=>{const e=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
      await delay(60);
    };
    const click = (text) => js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    await until("window.chatState().model==='test-model'");
    await click("知道了");
    await type("中文第一轮");
    await js("document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}))");
    assert.equal(requests.length, 0);
    await js("document.querySelector('textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))");
    await click("发送");
    await until("Object.values(window.chatState().documents).some(c=>c.turns[0]?.status==='completed')");
    const id = await js("window.chatState().selectedId");
    await type("第二轮"); await click("发送");
    await until("window.chatState().documents[window.chatState().selectedId].turns[1]?.status==='completed'");
    assert.deepEqual(requests[1].input.map((m) => m.content), ["中文第一轮", "模拟回复：已收到", "第二轮"]);
    assert.equal(requests[0].store, false); assert.equal(requests[0].stream, true);
    assert.ok(!("tools" in requests[0]));
    mode = "slow";
    await type("停止测试"); await click("发送");
    await until("document.querySelector('.siwc-working')!==null"); await click("停止");
    await until("window.chatState().documents[window.chatState().selectedId].turns[2]?.status==='cancelled'");
    mode = "failed";
    await type("额度错误测试"); await click("发送");
    await until("window.chatState().documents[window.chatState().selectedId].turns[3]?.status==='failed'");
    assert.ok((await js("document.body.innerText")).includes("模拟回复"));
    const screenshot = path.join(root, "../.tmp/siwc-chat-electron.png");
    writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
    await win.reload();
    await until("window.chatState().chats.length===1");
    await js(`window.selectChat(${JSON.stringify(id)})`);
    await until("document.querySelectorAll('.siwc-turn').length===4");
    assert.equal(requests.length, 4, "reload must not send inference");
    assert.ok(!await js("Object.values(localStorage).join('').includes('synthetic-access-token')"));
    await click("删除"); await click("删除此聊天");
    await until("window.chatState().chats.length===0");
    assert.deepEqual(errors, []);
    console.log("SIWC_ELECTRON_SMOKE_OK", JSON.stringify({ requests: requests.length, screenshot, work, osEncryption: true }));
  } catch (error) { console.error("SIWC_ELECTRON_SMOKE_FAILED", work, error); process.exitCode = 1; }
  finally {
    clearTimeout(timer); win?.destroy(); await service?.closeChat(); service?.close(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode || 0);
  }
}
void run();
