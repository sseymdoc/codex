import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { serveClaudeFonts } from "../server/claude-fonts.mjs";

// After npm run build: node_modules/.bin/electron desktop/background-behavior-smoke.test.mjs
// An isolated profile, synthetic tasks and an inert RPC transport; no app-server is started.
const work = mkdtempSync(path.join(tmpdir(), "codex-background-"));
app.setPath("userData", path.join(work, "profile"));
const source = `
import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {SessionRail} from './src/components/Rail.tsx';import {Panes} from './src/components/Panes.tsx';import {TooltipLayer} from './src/components/ui.tsx';
import {emptyThreadState,getState,setState} from './src/lib/store.ts';import {Rpc} from './src/lib/rpc.ts';
import {openFinishedBackground} from './src/lib/background-view.ts';
let thread;window.calls=[];Rpc.prototype.request=async(method)=>{window.calls.push(method);throw new Error('No backend in this fixture')};
window.script='export PATH="/c/Users/test/.cargo/bin:$PATH" && cargo clippy --tests -p codex-core -- -D warnings '+ ' --long-option'.repeat(500);
const title='运行 codex-core 的全部测试，验证 PowerShell 和 Git Bash 的沙箱行为与退出状态';
const root=createRoot(document.getElementById('root'));
function render(){flushSync(()=>root.render(<><SessionRail thread={thread} scrollRef={{current:null}}/><Panes thread={thread}/><TooltipLayer/></>))}
window.fixture=(running=0,finished=0,id='background-fixture')=>{
 thread=emptyThreadState({id,cwd:'D:/fixture',source:'cli',status:{type:'idle'},createdAt:1,updatedAt:10});
 thread.turns=[{id:'turn',status:'completed',items:Array.from({length:running+finished},(_,i)=>({type:'commandExecution',id:'cmd-'+i,processId:'process-'+i,backgrounded:true,command:i===0?window.script:'cargo test '+i,description:i===0?title:'任务 '+i,source:'unifiedExecStartup',status:i<running?'inProgress':'completed',aggregatedOutput:i===0?'line\\n'.repeat(3000):'done',durationMs:2000,exitCode:i<running?null:0,commandActions:[]}))}];
 thread.background=thread.turns[0].items.slice(0,running).map(item=>({itemId:item.id,processId:item.processId,command:item.command,backgrounded:true,cpuPercent:null}));
 thread.timing=Object.fromEntries(thread.turns[0].items.map((item,i)=>[item.id,i<running?[Date.now()-5000+i]:[1000+i,3000+i]]));
 setState(s=>({threads:{...s.threads,[id]:thread},activeId:id}));render();
};
window.appendOutput=()=>{thread={...thread,turns:[{...thread.turns[0],items:thread.turns[0].items.map((item,i)=>i===0?{...item,aggregatedOutput:item.aggregatedOutput+'new line\\n'}:item)}]};setState(s=>({threads:{...s.threads,[thread.meta.id]:thread}}));render()};
window.taskCount=()=>thread.turns[0].items.length;window.panes=()=>getState().panes;
window.familyFixture=(run=0,active=true)=>{
 const child=(id,parent,status)=>{const value=emptyThreadState({id,parentThreadId:parent,name:id,source:'cli',cwd:'D:/fixture',status:{type:status},createdAt:1,updatedAt:10});value.turns=[{id:'turn-'+id+'-'+run,status:status==='active'?'inProgress':'completed',items:[]}];return value};
 thread=emptyThreadState({id:'background-fixture',source:'cli',cwd:'D:/fixture',status:{type:'idle'},createdAt:1,updatedAt:10});
 const a=child('parent-agent',thread.meta.id,'idle'),b=child('nested-agent',a.meta.id,active?'active':'idle'),c=child('finished-leaf',b.meta.id,'idle');
 setState({threads:{[thread.meta.id]:thread,[a.meta.id]:a,[b.meta.id]:b,[c.meta.id]:c}});render();
};
window.oldFailure=()=>{window.fixture(0,12,'failure-history');thread.turns[0].items[0].status='failed';thread={...thread};setState(s=>({threads:{...s.threads,[thread.meta.id]:thread}}));openFinishedBackground(thread.meta.id);render()};
window.fixture();
`;
const errors = [];
let win, server;
const timer = setTimeout(() => { console.error("BACKGROUND_TIMEOUT", work); app.exit(2); }, 45000);
const delay = () => new Promise((resolve) => setTimeout(resolve, 60));
app.whenReady().then(async () => {
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const bundle = await build({ stdin: { contents: source, resolveDir: root, loader: "jsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", loader: { ".css": "empty", ".md": "text" }, define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"', __GIT_SHA__: '"test"', "process.env.NODE_ENV": '"production"' } });
    const assets = path.join(root, "dist/assets");
    const css = readFileSync(path.join(assets, readdirSync(assets).find((name) => name.endsWith(".css"))));
    server = createServer((req, res) => {
      if (serveClaudeFonts(req, res)) return;
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/claude-fonts.css"><link rel="stylesheet" href="/style.css"><style>body{margin:0}#root{display:flex;height:680px;gap:24px;padding:20px;max-width:1000px;margin:auto}#root>.rail{width:320px;flex:none}</style><div id="root"></div><script src="/fixture.js"></script>'); }
      else if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
      else if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (/^\/fonts\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes("..")) { try { res.end(readFileSync(path.join(root, "public", url.pathname))); } catch { res.writeHead(404); res.end(); } }
      else { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ show: false, width: 1050, height: 730, webPreferences: { offscreen: true, backgroundThrottling: false } });
    const wc = win.webContents;
    wc.debugger.attach("1.3");
    wc.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
    const js = (code) => wc.executeJavaScript(code);
    await wc.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await js("document.fonts.ready.then(()=>true)");
    await delay();
    const card = '[data-rail-card="backgroundTasks"]';
    const head = `${card} .rail-card-head`;
    const click = async (selector) => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(); };
    const fixture = async (...args) => { await js(`window.fixture(...${JSON.stringify(args)})`); await delay(); };
    assert.equal(await js(`!!document.querySelector('${card}')`), false);
    await fixture(2, 1);
    assert.equal(await js(`document.querySelector('${head}').getAttribute('aria-expanded')`), "false", "new tasks do not unfold the card");
    assert.equal(await js("!!document.querySelector('.bg-page')"), false, "new tasks do not open the pane");
    await click(head);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 2);
    assert.equal(await js(`document.querySelector('${card} .bg-title').dataset.tip`), "运行 codex-core 的全部测试，验证 PowerShell 和 Git Bash 的沙箱行为与退出状态");
    assert.equal(await js(`document.querySelectorAll('${card} .bg-title')[1].dataset.tip`), undefined, "short labels have no overflow tooltip");
    await click(`${card} .rail-task .rail-row`);
    assert.equal(await js("document.querySelector('.bg-task-toggle').getAttribute('aria-expanded')"), "true", "the clicked task is focused and expanded");
    assert.equal(await js("document.querySelector('.bg-task-code').textContent===window.script"), true, "long commands are never cut");
    assert.equal(await js("getComputedStyle(document.querySelector('.bg-title')).textOverflow"), "ellipsis");
    const point = await js("(()=>{const r=document.querySelector('.bg-task-title').getBoundingClientRect();return{x:r.left+10,y:r.top+r.height/2}})()");
    await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(await js("!!document.querySelector('.tooltip[data-open]')"), true, "the full pane title is reachable by actual pointer hover");
    await js("document.querySelector('.bg-page').style.maxWidth='280px'"); await delay();
    assert.equal(await js("getComputedStyle(document.querySelector('.bg-task-duration')).display"), "none");
    await js("document.querySelector('.bg-page').style.maxWidth=''");
    assert.ok(await js("document.querySelector('.bg-task-code').scrollHeight>document.querySelector('.bg-task-code').clientHeight"));
    assert.equal(await js("document.querySelector('.bg-task-output').textContent.length"), 8000);
    assert.equal(await js("document.querySelector('.bg-task-output').scrollHeight-document.querySelector('.bg-task-output').scrollTop-document.querySelector('.bg-task-output').clientHeight<2"), true);
    await js("document.querySelector('.bg-task-output').scrollTop=0;document.querySelector('.bg-task-output').dispatchEvent(new Event('scroll'))");
    await js("window.appendOutput()"); await delay();
    assert.equal(await js("document.querySelector('.bg-task-output').scrollTop"), 0, "reading older output pauses following");
    await click(`${card} .rail-card-body > .rail-row`);
    assert.equal(await js("document.querySelector('.bg-finished').getAttribute('aria-expanded')"), "true");
    await fixture(0, 3);
    assert.equal(await js(`!!document.querySelector('${card}')`), false, "finished history alone does not keep the card");
    assert.equal(await js("document.querySelector('[data-background-key=\"shell:background-fixture:cmd-0\"] .bg-task-toggle').getAttribute('aria-expanded')"), "true", "a finished task retains its open detail");
    assert.equal(await js("document.querySelector('.bg-task-output').scrollTop"), 0, "paused output remains paused when completion remounts its group");
    await fixture(2, 1);
    assert.equal(await js(`document.querySelector('${head}').getAttribute('aria-expanded')`), "true");
    await fixture(1, 0, "other-session");
    assert.equal(await js(`document.querySelector('${head}').getAttribute('aria-expanded')`), "false");
    await fixture(6, 1);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 4);
    await click(`${card} .rail-more`);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 6);
    await fixture(6, 1, "other-session");
    await click(head); await click(`${card} .rail-more`);
    await fixture(6, 1);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 4, "switching sessions remounts the temporary more state");
    await fixture(2, 1); await fixture(6, 1);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 4, "more resets after the list shrinks");
    await click(head); await click(head);
    assert.equal(await js(`document.querySelectorAll('${card} .rail-task').length`), 4);
    await fixture(2, 1);
    const before = await js("window.taskCount()");
    await click('[aria-label="清除已完成任务"]');
    assert.equal(await js("!!document.querySelector('.bg-finished')"), false);
    assert.equal(await js("window.taskCount()"), before, "clear only hides task UI, never history");
    await fixture(3, 0); await fixture(2, 1);
    assert.equal(await js("!!document.querySelector('.bg-finished')"), true, "a revived task is no longer dismissed");
    await js("window.familyFixture()"); await delay();
    assert.equal(await js("document.querySelectorAll('.bg-family-toggle').length"), 1, "nested parents become separate families");
    assert.equal(await js("!!document.querySelector('.bg-children')"), false);
    await click('.bg-family-toggle');
    assert.equal(await js("!!document.querySelector('.bg-children')"), true);
    assert.equal(await js("document.querySelector('.bg-children .bg-finished').getAttribute('aria-expanded')"), "false");
    await click('.bg-children .bg-finished');
    assert.equal(await js("!!document.querySelector('[data-background-key=\"agent:finished-leaf\"]')"), true);
    await js("window.familyFixture(0,false)"); await delay();
    assert.equal(await js("!!document.querySelector('.bg-children .bg-finished')"), false, "a finished family directly displays all its leaves");
    assert.equal(await js("!!document.querySelector('[data-background-key=\"agent:finished-leaf\"]')"), true);
    await click('[aria-label="清除已完成任务"]');
    assert.equal(await js("!!document.querySelector('[data-background-key=\"agent:nested-agent\"]')"), false);
    await js("window.familyFixture(1,false)"); await delay();
    assert.equal(await js("!!document.querySelector('[data-background-key=\"agent:nested-agent\"]')"), true, "a new completed turn is visible even if its running transition was not observed");
    await js("window.oldFailure()"); await delay();
    assert.equal(await js("document.querySelectorAll('.bg-family').length"), 11, "older failures survive the initial ten-family limit");
    assert.equal(await js("!!document.querySelector('[data-background-key=\"shell:failure-history:cmd-0\"]')"), true);
    await fixture(2, 1);
    const calls = await js("window.calls");
    await click('[aria-label="关闭"]');
    assert.deepEqual(await js("window.calls"), calls, "closing the pane does not stop work");
    await click(`${card} .rail-task .rail-row`);
    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "background.png"), (await wc.capturePage()).toPNG());
    writeFileSync(path.join(work, "results.json"), JSON.stringify({ ok: true, chromium: process.versions.chrome, errors }, null, 2));
    console.log("BACKGROUND_SMOKE", JSON.stringify({ ok: true, work, chromium: process.versions.chrome }));
    clearTimeout(timer); win.destroy(); await new Promise((resolve) => server.close(resolve)); app.quit();
  } catch (error) {
    if (win) writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    writeFileSync(path.join(work, "failure.json"), JSON.stringify({ error: error.stack, errors }, null, 2));
    console.error("BACKGROUND_FAILED", work, error.stack, errors); clearTimeout(timer); server?.close(); app.exit(1);
  }
});
