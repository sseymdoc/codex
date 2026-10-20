// Run with Electron. Uses a private profile, a local fixture and the built-in CDP implementation.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDesktopBrowser } from "./browser.mjs";
import { verifyBrowserMcp } from "./browser-mcp-smoke.test.mjs";

app.setName("codex-browser-smoke");
const work = mkdtempSync(path.join(tmpdir(), "codex-browser-smoke-"));
mkdirSync(path.join(work, "profile"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
let win, browser, server;
const timer = setTimeout(() => {
  console.error("Browser smoke timed out");
  app.exit(2);
}, 60000);
async function run() {
  try {
    await app.whenReady();
    const page = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器验收</title><style>button{color:rgb(12,34,56)}</style><label>姓名<input id="name"></label><button id="send" onclick="fetch('/api/echo',{method:'POST',body:document.querySelector('#name').value}).then(r=>r.text()).then(t=>document.querySelector('#result').textContent=t)">提交</button><p id="result">等待输入</p><a href="/second">下一页</a><script>console.info('browser fixture ready')</script></html>`;
    let slowStarted = false;
    server = http.createServer((req, res) => {
      if (req.url === "/slow") {
        slowStarted = true;
        return;
      }
      if (req.url === "/api/echo") {
        let body = "";
        req.on("data", (b) => (body += b));
        req.on("end", () => res.end("已收到：" + body));
      } else {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
        res.end(page);
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await win.loadURL("data:text/html,<title>Codex browser acceptance</title>");
    win.showInactive();
    let config = {};
    const events = [];
    let permissions = 0;
    browser = createDesktopBrowser({
      getWindow: () => win,
      getSettings: () => config,
      saveSettings: (patch) => Object.assign(config, patch),
      isOwnOrigin: (raw) => raw.startsWith("http://127.0.0.1:7478"),
      emit: (event) => events.push(event),
      confirm: async () => {
        permissions++;
        return 1;
      },
    });
    const context = { view: "smoke-session", cwd: work };
    const call = (name, args = {}) => browser.tool(context, name, args);
    const started = await call("preview_start", { url });
    const { serverId, tabId } = JSON.parse(started.content[0].text);
    await browser.request({ ...context, action: "bounds", rect: { x: 20, y: 20, width: 900, height: 600 } });
    assert.match((await call("preview_snapshot", { serverId })).content[0].text, /等待输入/);
    await call("preview_fill", { serverId, selector: "#name", value: "Codex 测试" });
    await call("preview_click", { serverId, selector: "#send" });
    let result;
    for (let i = 0; i < 30; i++) {
      result = await call("preview_snapshot", { serverId });
      if (result.content[0].text.includes("已收到：Codex 测试")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(result.content[0].text, /已收到：Codex 测试/);
    const inspected = JSON.parse((await call("preview_inspect", { serverId, selector: "#send", styles: ["color"] })).content[0].text);
    assert.equal(inspected.styles.color, "rgb(12, 34, 56)");
    await call("preview_eval", {
      serverId,
      expression: `(()=>{
      const box=document.createElement('section');box.innerHTML='<select id="native-select"><option value="a">A</option><option value="b">B</option></select><div id="native-editor" contenteditable="true">旧内容</div><button id="native-double">双击</button><div id="native-shadow"></div><input type="file" id="native-file">';document.body.append(box);document.querySelector('#native-double').ondblclick=()=>{document.querySelector('#native-double').textContent='双击成功'};
      document.querySelector('#native-shadow').attachShadow({mode:'open'}).innerHTML='<input id="shadow-input">';return true;
    })()`,
    });
    await call("preview_fill", { serverId, selector: "#native-select", value: "b" });
    await call("preview_fill", { serverId, selector: "#native-editor", value: "原生编辑" });
    await call("preview_fill", { serverId, selector: "#shadow-input", value: "Shadow DOM" });
    await assert.rejects(call("preview_fill", { serverId, selector: "#native-file", value: "C:/not-allowed" }), /accept text/);
    await call("preview_click", { serverId, selector: "#native-double", doubleClick: true });
    const extra = JSON.parse(
      (
        await call("preview_eval", {
          serverId,
          expression: `({select:document.querySelector('#native-select').value,editor:document.querySelector('#native-editor').textContent,shadow:document.querySelector('#native-shadow').shadowRoot.querySelector('input').value,double:document.querySelector('#native-double').textContent})`,
        })
      ).content[0].text,
    ).value;
    assert.deepEqual(extra, { select: "b", editor: "原生编辑", shadow: "Shadow DOM", double: "双击成功" });
    const request = JSON.parse((await call("preview_network", { serverId })).content[0].text).find((entry) =>
      entry.url.endsWith("/api/echo"),
    );
    const body = JSON.parse((await call("preview_network", { serverId, requestId: request.requestId })).content[0].text);
    assert.equal(body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body, "已收到：Codex 测试");
    await assert.rejects(call("preview_screenshot", { serverId, scale: 0.01 }), /scale/);
    const small = await call("preview_screenshot", { serverId, scale: 0.5 });
    assert.equal(small.content[0].mimeType, "image/png");
    await call("preview_eval", {
      serverId,
      expression: `(()=>{const cover=document.createElement('div');cover.id='cover';cover.style='position:fixed;inset:0;z-index:99999';document.body.append(cover);return true})()`,
    });
    await assert.rejects(call("preview_click", { serverId, selector: "#send" }), /covered/);
    await call("preview_eval", { serverId, expression: `document.querySelector('#cover').remove()` });
    const evaluationAbort = new AbortController();
    const evaluating = browser.tool({ ...context, signal: evaluationAbort.signal }, "preview_eval", {
      serverId,
      expression: "new Promise(()=>{})",
    });
    setTimeout(() => evaluationAbort.abort(), 30);
    await assert.rejects(evaluating, /cancelled/);
    assert.equal(JSON.parse((await call("preview_eval", { serverId, expression: "1 + 1" })).content[0].text).value, 2);
    const guest = win.contentView.children.at(-1).webContents;
    const point = JSON.parse(
      (
        await call("preview_eval", {
          serverId,
          expression: `(()=>{const el=document.querySelector('#send');el.scrollIntoView();const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
        })
      ).content[0].text,
    ).value;
    await browser.request({ ...context, action: "inspect" });
    await guest.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await guest.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await guest.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    for (let i = 0; i < 100 && !events.some((event) => event.selection); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    const picked = events.find((event) => event.selection)?.selection;
    assert.match(picked?.element.html ?? "", /id="send"/);
    assert.match(picked.image, /^data:image\/png;base64,/);
    await call("preview_resize", { serverId, preset: "mobile", colorScheme: "dark" });
    const size = JSON.parse(
      (await call("preview_eval", { serverId, expression: "({width:innerWidth,dark:matchMedia('(prefers-color-scheme: dark)').matches})" }))
        .content[0].text,
    ).value;
    assert.equal(size.width, 375);
    assert.equal(size.dark, true);
    await call("preview_resize", { serverId, preset: "desktop", colorScheme: "system" });
    const image = await call("preview_screenshot", { serverId });
    assert.ok(Buffer.from(image.content[0].data, "base64").subarray(1, 4).equals(Buffer.from("PNG")));
    const screenshot = path.join(work, "browser.png");
    writeFileSync(screenshot, Buffer.from(image.content[0].data, "base64"));
    assert.match((await call("preview_network", { serverId })).content[0].text, /api\/echo/);
    assert.match((await call("preview_console_logs", { serverId })).content[0].text, /fixture ready/);
    await assert.rejects(call("preview_snapshot", { serverId: "other-session" }), /不属于/);
    const crossOrigin = url.replace("127.0.0.1", "localhost"),
      beforeRedirect = permissions;
    await call("preview_eval", { serverId, expression: `setTimeout(()=>location.href=${JSON.stringify(crossOrigin)},100);true` });
    for (
      let i = 0;
      i < 100 &&
      !browser
        .snapshot(context.view)
        .tabs.find((tab) => tab.id === tabId)
        ?.url.startsWith(crossOrigin);
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(
      browser
        .snapshot(context.view)
        .tabs.find((tab) => tab.id === tabId)
        .url.startsWith(crossOrigin),
    );
    assert.equal(permissions, beforeRedirect + 1, "delayed page navigation must not inherit manual navigation privileges");
    await call("navigate", { url });
    await call("tabs_create", { url: url + "/second" });
    await call("tabs_select", { tabId });
    assert.equal(browser.snapshot(context.view).active, tabId);
    assert.equal(browser.snapshot(context.view).tabs.length, 2);
    const before = permissions;
    await browser.request({ ...context, action: "settings", removeOrigin: url });
    await call("preview_snapshot", { serverId });
    assert.equal(permissions, before + 1, "revoking an origin must revoke the session grant too");
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(browser.tool({ ...context, signal: cancelled.signal }, "preview_snapshot", { serverId }), /cancelled/);
    await assert.rejects(call("navigate", { url: "http://127.0.0.1:7478/api/events" }), /内部服务/);
    const reserve = http.createServer();
    await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
    const port = reserve.address().port;
    await new Promise((resolve) => reserve.close(resolve));
    const script = path.join(work, "dev-server.mjs");
    writeFileSync(
      script,
      `import http from "node:http"; http.createServer((req,res)=>res.end("development server ready")).listen(${port},"127.0.0.1",()=>console.log("server listening"));`,
    );
    const entry = { name: "smoke", runtimeExecutable: "node", runtimeArgs: [script], port };
    await browser.request({ ...context, action: "addServer", entry });
    await assert.rejects(
      browser.request({ ...context, action: "addServer", entry: { ...entry, name: "unsafe", runtimeArgs: ["a&echo unexpected"] } }),
      /配置无效/,
    );
    await browser.request({ ...context, action: "startServer", name: "smoke" });
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "development server ready");
    await browser.request({ ...context, action: "addServer", entry: { ...entry, name: "occupied" } });
    await assert.rejects(browser.request({ ...context, action: "startServer", name: "occupied" }), /已被其他进程占用/);
    await browser.request({ ...context, action: "stopServer", name: "smoke" });
    await assert.rejects(fetch(`http://127.0.0.1:${port}`));
    await browser.request({ ...context, action: "startServer", name: "smoke" });
    await browser.request({ ...context, action: "stopAll" });
    await assert.rejects(fetch(`http://127.0.0.1:${port}`));
    await browser.request({ ...context, action: "addServer", entry: { ...entry, name: "failed", runtimeArgs: ["missing-fixture.mjs"] } });
    await assert.rejects(
      browser.request({ ...context, action: "startServer", name: "failed" }),
      /MODULE_NOT_FOUND|Cannot find module|未在/,
    );
    const navigationAbort = new AbortController();
    const navigating = browser.tool({ view: "cancel-navigation", cwd: work, signal: navigationAbort.signal }, "preview_start", {
      url: url + "/slow",
    });
    for (let i = 0; i < 50 && !slowStarted; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(slowStarted);
    navigationAbort.abort();
    await assert.rejects(navigating, /cancelled/);
    const idle = path.join(work, "idle-server.mjs");
    writeFileSync(idle, "setInterval(()=>{},1000)");
    await browser.request({ ...context, action: "addServer", entry: { ...entry, name: "cancel-start", runtimeArgs: [idle] } });
    const startupAbort = new AbortController();
    const starting = browser.tool({ ...context, signal: startupAbort.signal }, "preview_start", { name: "cancel-start" });
    for (
      let i = 0;
      i < 50 && !browser.snapshot(context.view).servers.some((server) => server.name === "cancel-start" && server.status === "starting");
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    startupAbort.abort();
    await assert.rejects(starting, /cancelled/);
    assert.equal(browser.snapshot(context.view).servers.find((server) => server.name === "cancel-start").status, "stopped");
    console.log(
      "BROWSER_LIFECYCLE_SMOKE " +
        JSON.stringify({
          ok: true,
          checks: [
            "permission revocation",
            "cancel before execution",
            "cancel in-flight navigation",
            "cancel server startup",
            "host API isolation",
            "dev-server start/stop/restart",
            "port collision",
            "invalid command rejected",
            "startup failure",
          ],
        }),
    );
    await verifyBrowserMcp(browser, work, url);
    console.log(
      "BROWSER_SMOKE " +
        JSON.stringify({
          ok: true,
          engine: browser.snapshot(context.view).engine,
          tabId,
          checks: [
            "real navigation",
            "native AX snapshot",
            "native fill/click",
            "real POST response",
            "computed CSS",
            "select/contenteditable/shadow input",
            "double click",
            "covered target rejected",
            "cancel pending evaluation",
            "native element picker",
            "response body",
            "scaled PNG",
            "mobile/dark emulation",
            "PNG capture",
            "network",
            "console",
            "thread isolation",
            "tabs",
          ],
          screenshot,
          work,
        }),
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await browser?.close();
    win?.destroy();
    server?.close();
    app.exit(process.exitCode ?? 0);
  }
}
void run();
