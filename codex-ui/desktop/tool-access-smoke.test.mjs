// Real Chromium, isolated profile and synthetic desktop settings; no user backend is restarted.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { STAND_INS } from "../server/claude-fonts.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-tool-access-"));
app.setPath("userData", path.join(work, "profile"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
window.settings={backendChannel:'disabled',toolAccessMode:'on-demand',connectorSearch:true};
window.patches=[];window.fail=false;window.restarts=0;
window.codexDesktop={
 onBrowserState:()=>()=>{},
 getDesktopSettings:async()=>({...window.settings}),
 setDesktopSettings:async(patch)=>{window.patches.push(patch);if(window.fail)return {ok:false,error:'fixture save failure'};Object.assign(window.settings,patch);return {ok:true}},
 relaunch:()=>{window.restarts++}
};
const {SettingsDialog,openSettings}=await import('./src/components/Settings');
window.openTools=()=>openSettings('capabilities');
createRoot(document.getElementById('root')).render(<SettingsDialog/>);
window.openTools();
`;

app.whenReady().then(async () => {
  let win, server;
  const errors = [];
  const timeout = setTimeout(() => { console.error("TOOL_ACCESS_TIMEOUT", work); app.exit(1); }, 30000);
  try {
    const root = process.cwd();
    const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", target: "chrome140", tsconfig: "tsconfig.json", loader: { ".md": "text", ".css": "empty" } });
    const css = readdirSync(path.join(root, "dist/assets")).filter((file) => file.endsWith(".css")).map((file) => readFileSync(path.join(root, "dist/assets", file), "utf8")).join("\n");
    server = createServer((req, res) => {
      if (req.url === "/") res.setHeader("Content-Type", "text/html; charset=utf-8"), res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
      else if (req.url === "/fixture.js") res.setHeader("Content-Type", "text/javascript"), res.end(bundle.outputFiles[0].contents);
      else if (req.url === "/style.css") res.setHeader("Content-Type", "text/css"), res.end(css);
      else if (req.url === "/fonts.css") res.setHeader("Content-Type", "text/css"), res.end(STAND_INS);
      else if (req.url.startsWith("/fonts/") && !req.url.includes("..")) {
        try { res.end(readFileSync(path.join(root, "public", req.url))); } catch { res.writeHead(404).end(); }
      }
      else res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ width: 1200, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on("console-message", (event) => { if (event.level === "error" && !event.message.includes("Failed to load resource")) errors.push(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => { for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(30); } throw new Error("Condition failed: " + code); };
    const access = "document.querySelector('#setting-capabilities-tool-access button')";
    const search = "document.querySelector('#setting-capabilities-connector-search button')";
    await until(`!!${access}`);
    assert.equal(await js(`${access}.disabled && ${search}.disabled`), true);
    await js(`${access}.click();${search}.click()`);
    assert.deepEqual(await js("window.patches"), []);
    await js("document.querySelector('.settings-nav button').click()");
    await until(`!${access}`);
    await js("window.settings.backendChannel='preview';window.openTools()");
    await until(`${access}?.disabled===false`);
    await js(`${access}.click()`);
    await until("!!document.querySelector('[role=menuitemradio]')");
    await js("Array.from(document.querySelectorAll('[role=menuitemradio]')).find(e=>e.textContent.includes('全部加载工具')).click()");
    await until("window.settings.toolAccessMode==='all'");
    await js(`${search}.click()`);
    await until("window.settings.connectorSearch===false");
    assert.equal(await js(`${search}.getAttribute('aria-checked')`), "false");
    await js("window.fail=true");
    await js(`${search}.click()`);
    await until(`${search}.getAttribute('aria-checked')==='false'`);
    await js("document.querySelector('#setting-capabilities-tools .settings-note button').click()");
    assert.equal(await js("window.restarts"), 1);
    for (const width of [390, 1200]) {
      win.setContentSize(width, 900);
      await delay(100);
      assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"), true);
      writeFileSync(path.join(work, `settings-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log("TOOL_ACCESS_SMOKE", JSON.stringify({ ok: true, work, chromium: process.versions.chrome }));
    clearTimeout(timeout);
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    app.quit();
  } catch (error) {
    console.error("TOOL_ACCESS_FAILED", work, error.stack, errors);
    if (win) writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
});
