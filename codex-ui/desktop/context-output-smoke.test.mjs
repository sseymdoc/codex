// Real renderer, hidden Chromium and fixture RPCs; no running user session is touched.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { STAND_INS } from "../server/claude-fonts.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-context-output-"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
const command = "Get-Content -LiteralPath 'C:/project/My Report.md'";
const markdown = [
  "[app.ts](C:/project/app.ts:12)",
  "[My Report.md](<C:/project/My Report.md:3>)",
  "![预览](C:/project/screen.png)",
  "[diagram.svg](C:/project/diagram.svg)",
  "```powershell\n" + command + "\n```",
].join("\n\n");
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Rpc} from './src/lib/rpc';
import {Markdown} from './src/components/content';
window.opened=[];window.copied=[];window.reads=[];
window.addEventListener('codex:open-file',event=>window.opened.push(event.detail));
Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copied.push(text)}}});
Rpc.prototype.request=async(method,params)=>{
  if(method!=='fs/readFile')throw new Error('Unexpected RPC: '+method);
  window.reads.push(params.path);
  return {dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='};
};
createRoot(document.getElementById('root')).render(<Markdown text={${JSON.stringify(markdown)}}/>);
`;

async function run() {
  await app.whenReady();
  let win, server;
  const errors = [];
  const timer = setTimeout(() => { console.error("CONTEXT_OUTPUT_TIMEOUT", work); app.exit(2); }, 30000);
  try {
    const root = process.cwd();
    const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", target: "chrome140", tsconfig: "tsconfig.json", loader: { ".md": "text", ".css": "empty" } });
    const css = readdirSync(path.join(root, "dist/assets")).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(root, "dist/assets", file), "utf8")).join("\n");
    server = createServer((req, res) => {
      if (req.url === "/") res.setHeader("Content-Type", "text/html; charset=utf-8"), res.end('<!doctype html><html lang="zh-CN"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/style.css"><div id="root" style="padding:24px"></div><script type="module" src="/fixture.js"></script></html>');
      else if (req.url === "/fixture.js") res.setHeader("Content-Type", "text/javascript"), res.end(bundle.outputFiles[0].contents);
      else if (req.url === "/style.css") res.setHeader("Content-Type", "text/css"), res.end(css);
      else if (req.url === "/fonts.css") res.setHeader("Content-Type", "text/css"), res.end(STAND_INS);
      else if (req.url.startsWith("/fonts/") && !req.url.includes("..")) {
        try { res.end(readFileSync(path.join(root, "public", req.url))); } catch { res.writeHead(404).end(); }
      }
      else res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on("console-message", event => { if (event.level === "error" && !event.message.includes("Failed to load resource")) errors.push(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 100 && !(await js("document.querySelector('md-image img')?.naturalWidth > 0")); i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await js("document.querySelector('md-image img')?.naturalWidth"), 1);
    assert.deepEqual(await js("window.reads"), ["C:/project/screen.png"]);
    assert.equal(await js("document.querySelectorAll('md-image').length"), 1, "SVG stays a file link");
    await js("document.querySelectorAll('[data-path]').forEach(link=>link.click())");
    assert.deepEqual(await js("window.opened"), [
      { path: "C:/project/app.ts", line: 12 },
      { path: "C:/project/My Report.md", line: 3 },
      { path: "C:/project/diagram.svg", line: undefined },
    ]);
    assert.equal(await js("document.querySelectorAll('.md-code button').length"), 1);
    await js("document.querySelector('[data-copy]').click()");
    assert.deepEqual(await js("window.copied"), [command]);
    await js("document.fonts.ready.then(()=>true)");
    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "output.png"), (await win.webContents.capturePage()).toPNG());
    console.log("CONTEXT_OUTPUT_SMOKE " + JSON.stringify({ ok: true, work, chromium: process.versions.chrome, checks: ["absolute path and line", "path with spaces", "inline bitmap", "SVG file link", "copy-only command"] }));
  } catch (error) {
    console.error("CONTEXT_OUTPUT_FAILED", work, error.stack, errors);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    win?.destroy();
    server?.closeAllConnections();
    server?.close();
    app.exit(process.exitCode ?? 0);
  }
}
void run();
