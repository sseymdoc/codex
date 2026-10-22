// Runs the real desktop entrypoint with a private profile and local model/page fixtures.
import { app, BrowserWindow, screen } from "electron";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolveCodexCommand } from "../server/bridge.mjs";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "codex-browser-ui-"));
const profile = path.join(work, "profile"),
  codexHome = path.join(work, "codex-home");
mkdirSync(profile);
mkdirSync(codexHome);
app.setName("Codex Browser UI Acceptance");
app.setPath("userData", profile);
app.commandLine.appendSwitch("no-proxy-server");
app.commandLine.appendSwitch("host-resolver-rules", "MAP *.browser.test 127.0.0.1");
// Bind an existing binary only inside this disposable Preview profile; never install or replace it.
const backend = resolveCodexCommand(undefined, { env: process.env, home: homedir(), localBuilds: false });
assert.ok(backend && path.isAbsolute(backend.command));
const backendRoot = path.join(profile, "backends");
mkdirSync(path.join(backendRoot, "preview-fixture"), { recursive: true });
symlinkSync(path.dirname(backend.command), path.join(backendRoot, "preview-fixture", "bin"), "junction");
writeFileSync(path.join(backendRoot, "preview.json"), JSON.stringify({ directory: "preview-fixture" }));
writeFileSync(
  path.join(profile, "window-state.json"),
  JSON.stringify({
    menuBar: false,
    quickEntry: false,
    keepAwake: false,
    theme: "light",
    bounds: { width: 1400, height: 900, x: 40, y: 40 },
    backendChannel: "preview",
    browser: {},
  }),
);
process.env.CODEX_HOME = codexHome;
process.env.INIT_CWD = work;
let win, server, siteUrl;
let requestSite = false, emittedSiteCall = false;
const errors = [];
app.on("browser-window-created", (_event, window) => {
  if (!win) {
    win = window;
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
  }
});
const timeout = setTimeout(() => {
  console.error("UI smoke timed out", work);
  app.exit(2);
}, 45000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test, label) {
  for (let i = 0; i < 200; i++) {
    try {
      const value = await test();
      if (value) return value;
    } catch {}
    await sleep(50);
  }
  throw new Error("UI condition failed: " + label);
}
async function run() {
  try {
    server = http.createServer((req, res) => {
      if (req.url.includes("/responses")) {
        req.resume();
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const siteCall = requestSite && !emittedSiteCall;
        if (siteCall) emittedSiteCall = true;
        const output = siteCall
          ? { type: "function_call", call_id: "site-call", namespace: "mcp__codex_ui_browser", name: "preview_start", arguments: JSON.stringify({ url: siteUrl }) }
          : { type: "message", role: "assistant", content: [{ type: "output_text", text: "验收会话已就绪" }] };
        for (const event of [
          { type: "response.created", response: { id: "ui-response" } },
          {
            type: "response.output_item.done",
            item: output,
          },
          { type: "response.completed", response: { id: "ui-response", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
        ])
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        return res.end();
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>浏览器验收页面</title><style>body{font:16px system-ui;padding:32px;color:#252525}button{padding:8px 20px}</style><h1>同一个真实浏览器页面</h1><p>这个页面由 Codex UI 的原生浏览器显示。</p><label>姓名 <input id="name"></label><button onclick="document.querySelector(\"#result\").textContent=\"提交成功\"">提交</button><p id="result">等待提交</p>',
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    siteUrl = url.replace("127.0.0.1", "external.browser.test");
    writeFileSync(
      path.join(codexHome, "config.toml"),
      `model="gpt-5.1"\nmodel_provider="ui_fixture"\n[model_providers.ui_fixture]\nname="UI fixture"\nbase_url="${url}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.codex_ui_browser.tools.preview_start]\napproval_mode="approve"\n`,
    );
    await import("./main.mjs");
    await until(() => win && !win.isDestroyed() && !win.webContents.isLoading(), "main window load");
    const js = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (error) {
        throw new Error(code + "\n" + error.message);
      }
    };
    await until(() => js("!!document.querySelector('textarea')"), "composer ready");
    await js(
      `(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'建立浏览器验收会话');el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await sleep(50);
    await js("document.querySelector('textarea').focus()");
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(() => js("!!document.querySelector('button[aria-label=\"浏览器\"]')"), "session browser button");
    await js(
      "window.__browserEvents=[];window.codexDesktop.onBrowserState(e=>window.__browserEvents.push(e));document.querySelector('button[aria-label=\"浏览器\"]').click()",
    );
    await until(() => js("!!document.querySelector('[data-pane=browser]')"), "browser pane");
    await js("document.querySelector('[data-pane=browser] button[aria-label=\"新建标签页\"]').click()");
    const view = await until(() => js("window.__browserEvents.find(e=>e.tabs?.length)?.view"), "native tab event");
    await js(
      `window.codexDesktop.browserRequest({view:${JSON.stringify(view)},cwd:${JSON.stringify(work)},action:'navigate',url:${JSON.stringify(url + "/page")}})`,
    );
    await until(() => js("document.querySelector('[data-pane=browser] [role=tab]')?.textContent.includes('浏览器验收页面')"), "page title");
    await sleep(250);
    const captureScript = path.join(work, "capture.ps1");
    writeFileSync(
      captureScript,
      `param([long]$WindowHandle,[string]$OutputFile)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BrowserCapture { [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w, out Rect r); }'
[BrowserCapture]::SetProcessDPIAware()|Out-Null
$rect=New-Object BrowserCapture+Rect
[BrowserCapture]::GetWindowRect([IntPtr]$WindowHandle,[ref]$rect)|Out-Null
$bitmap=New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen((New-Object System.Drawing.Point($rect.Left,$rect.Top)),[System.Drawing.Point]::Empty,$bitmap.Size)
$graphics.Dispose()
try { $bitmap.Save($OutputFile,[System.Drawing.Imaging.ImageFormat]::Png) } finally { $bitmap.Dispose() }
`,
    );
    const captureWindow = async (file) => {
      const area = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: area.x, y: area.y, width: Math.min(1400, area.width), height: Math.min(900, area.height) });
      win.show();
      win.setAlwaysOnTop(true);
      await sleep(100);
      assert.ok(win.isVisible(), "test window must be visible for screen capture");
      const handle = win.getNativeWindowHandle().readBigUInt64LE().toString();
      await promisify(execFile)("powershell.exe", ["-NoProfile", "-File", captureScript, "-WindowHandle", handle, "-OutputFile", file], {
        windowsHide: true,
      });
    };
    const screenshot = path.join(work, "browser-ui.png");
    await captureWindow(screenshot);
    const native = win.contentView.children.find((view) => view.webContents && view.webContents !== win.webContents);
    assert.ok(native?.getVisible(), "native page was not visible");
    await js("document.querySelector('[data-pane=browser] button[aria-label=\"浏览器 设置\"]').click()");
    await until(() => !native.getVisible(), "menu occludes native page");
    await captureWindow(path.join(work, "browser-menu.png"));
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await until(() => native.getVisible(), "native page returns after menu");
    // 视口 is a submenu of the pane's settings menu, as in Claude.
    await js("document.querySelector('[data-pane=browser] button[aria-label=\"浏览器 设置\"]').click()");
    await until(() => js("[...document.querySelectorAll('.popover [role=menuitem]')].some(e=>e.textContent.startsWith('视口'))"), "settings menu");
    await js("[...document.querySelectorAll('.popover [role=menuitem]')].find(e=>e.textContent.startsWith('视口')).click()");
    await until(() => js("[...document.querySelectorAll('[role=menuitemradio]')].some(e=>e.textContent.includes('375'))"), "viewport menu");
    await js("[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent.includes('375')).click()");
    await until(() => native.webContents.executeJavaScript("innerWidth === 375"), "mobile viewport");
    await until(() => js("!document.querySelector('.popover')"), "viewport menu closes");
    await until(() => native.getVisible(), "mobile native page visible");
    await sleep(100);
    const mobileScreenshot = path.join(work, "browser-mobile.png");
    await captureWindow(mobileScreenshot);
    requestSite = true;
    await js(`(()=>{const el=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'验证外部站点授权');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();return true})()`);
    await sleep(50);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await until(() => js(`document.querySelector('.approval-card')?.textContent.includes(${JSON.stringify(siteUrl)})`), "site permission card in composer dock");
    await sleep(450);
    await captureWindow(path.join(work, "browser-permission-card.png"));
    await js("[...document.querySelectorAll('.approval-card button')].find(e=>e.textContent.includes('始终允许')).click()");
    await until(() => JSON.parse(readFileSync(path.join(profile, "window-state.json"), "utf8")).browser?.allowedOrigins?.includes(siteUrl), "approval persisted immediately");
    await until(() => js("!document.querySelector('.approval-card')"), "permission card settles");
    await until(() => js(`window.__browserEvents.some(e=>e.tabs?.some(t=>t.url.startsWith(${JSON.stringify(siteUrl)})))`), "authorized external page opens");
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log(
      "BROWSER_UI_SMOKE " +
        JSON.stringify({
          ok: true,
          work,
          screenshot,
          mobileScreenshot,
          checks: [
            "real desktop entrypoint",
            "real app-server",
            "session creation",
            "browser pane",
            "native page",
            "menu occlusion",
            "mobile menu",
            "clean console",
            "real MCP site request",
            "docked permission card",
            "immediate persistent approval",
          ],
        }),
    );
    clearTimeout(timeout);
    server.close();
    app.quit();
  } catch (error) {
    console.error(error.stack);
    console.error("UI evidence:", work, JSON.stringify(errors));
    if (win && !win.isDestroyed()) writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout);
    app.exit(1);
  }
}
void run();
