// Isolated Chromium profile, real components and controller, synthetic historical RPC records.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

const work = mkdtempSync(path.join(tmpdir(), "codex-background-"));
app.setPath("userData", path.join(work, "profile"));
const fixture = `
import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {SessionRail} from './src/components/Rail';
import {Panes} from './src/components/Panes';
import {refreshBackground} from './src/lib/codex';
import {Rpc} from './src/lib/rpc';
import {getState,setState,emptyThreadState,useStore} from './src/lib/store';
const meta=(id,status='notLoaded')=>({id,name:id,preview:'',cwd:'D:/fixture',source:'cli',status:{type:status},createdAt:1,updatedAt:2,modelProvider:'fixture',ephemeral:false,turns:[]});
const statuses={completed:'completed',stopped:'interrupted',failed:'failed',unknown:'inProgress'};
const children=Object.keys(statuses).map(id=>({...meta(id),name:id==='completed'?null:id,agentNickname:id==='completed'?'Tesla':id,parentThreadId:'parent',source:{subAgent:{thread_spawn:{parent_thread_id:'parent',depth:1,agent_nickname:id==='completed'?'Tesla':id}}}}));
window.calls=[];
Rpc.prototype.request=async function(method,params){
 window.calls.push({method,params});
 if(method==='thread/list')return {data:children,nextCursor:null};
 if(method==='thread/turns/list')return {data:[{id:'turn-'+params.threadId,status:statuses[params.threadId],items:[]}],nextCursor:null};
 return {data:[],nextCursor:null};
};
const parent={...emptyThreadState(meta('parent','idle')),loaded:true};
setState({threads:{parent},activeId:'parent',conn:{status:'ready'}});
window.state=getState;
window.addRunning=()=>setState(s=>({threads:{...s.threads,running:emptyThreadState({...meta('running','active'),parentThreadId:'parent'})}}));
function Fixture(){const thread=useStore(s=>s.threads.parent);const scrollRef=useRef(null);return <><SessionRail thread={thread} scrollRef={scrollRef}/><Panes thread={thread}/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);
refreshBackground('parent').then(()=>window.ready=true);
`;
let win, server;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error("BACKGROUND_TIMEOUT", work); app.exit(2); }, 30000);
app.whenReady().then(async () => {
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const bundle = await build({
      stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, bundle: true, write: false,
      format: "iife", platform: "browser", jsx: "automatic", loader: { ".md": "text", ".css": "empty" },
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const assets = path.join(root, "dist/assets");
    const css = readFileSync(path.join(assets, readdirSync(assets).find((name) => name.endsWith(".css"))));
    server = createServer((req, res) => {
      if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="zh-CN" data-theme="light"><link rel="stylesheet" href="/style.css"><style>#root{display:flex;height:100vh;gap:12px}.rail{width:280px;flex-shrink:0}</style><div id="root"></div><script src="/fixture.js"></script></html>'); }
      else if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
      else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (req.url.startsWith("/fonts/") && !req.url.includes("..")) {
        try { res.end(readFileSync(path.join(root, "public", req.url))); } catch { res.writeHead(404); res.end(); }
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ width: 1200, height: 850, show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(30); }
      throw new Error("Condition failed: " + code);
    };
    const card = '[data-rail-card="backgroundTasks"]';
    await until("window.ready");
    assert.equal(await js(`!!document.querySelector('${card}')`), true, "finished historical agents must retain their background-task entry");
    await js(`document.querySelector('${card} .rail-card-head').click()`);
    await until(`document.querySelectorAll('${card} .rail-task').length===4`);
    assert.equal(await js(`document.querySelector('${card} .rail-task .rail-label').textContent`), "Tesla");
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('${card} .rail-task .rail-meta'),e=>e.textContent)`), ["已完成", "已停止", "失败", "状态未知"]);
    assert.equal(await js(`document.querySelectorAll('${card} button[aria-label="停止此任务"]').length`), 0);
    assert.match(await js(`document.querySelector('${card} .rail-card-summary').textContent`), /3 个已结束.*1 个状态未知/);
    await js(`document.querySelector('${card} .rail-task .rail-row').click()`);
    await until("!!document.querySelector('.bg-page')");
    for (const [id, status] of Object.entries({ completed: "已完成", stopped: "已停止", failed: "失败", unknown: "状态未知" })) {
      assert.ok(await js(`document.querySelector('[data-task-id="agent:${id}"]').textContent.includes('${status}')`));
    }
    assert.equal(await js("window.state().threads.completed.loaded"), false);
    assert.equal(await js("window.calls.some(c=>c.method==='thread/resume')"), false);
    writeFileSync(path.join(work, "historical.png"), (await win.webContents.capturePage()).toPNG());
    await js("window.addRunning()");
    await until(`document.querySelector('${card} .rail-task .rail-label').textContent==='running'`);
    assert.equal(await js(`document.querySelectorAll('${card} button[aria-label="停止此任务"]').length`), 1);
    assert.deepEqual(errors, []);
    console.log("BACKGROUND_SMOKE", JSON.stringify({ ok: true, work, chromium: process.versions.chrome }));
    clearTimeout(timeout);
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    app.quit();
  } catch (error) {
    console.error("BACKGROUND_FAILED", work, error.stack, errors);
    if (win) writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
});
