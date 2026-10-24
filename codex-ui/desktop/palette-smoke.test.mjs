// After npm run build: run with Electron. Private profile, real Chromium, synthetic RPC only.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { STAND_INS } from "../server/claude-fonts.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-palette-"));
app.setPath("userData", path.join(work, "profile"));
process.on("uncaughtException", (error) => { console.error("PALETTE_UNCAUGHT", work, error); app.exit(1); });
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Palette,openPalette,useShortcuts} from './src/components/Palette';
import {Rpc,RpcError} from './src/lib/rpc';
import {getState,setState,emptyThreadState} from './src/lib/store';
const titles=['Vite 开发服务器不监听 codex-ui/out','把“远程控制”开关做成记住上次退出时的开关状态','Codex UI 思考动画和 token 计数（fork 2）','Codex UI 右侧空白页禁用右键','Codex UI 更新说明文案','修改模型选择项的最高档警告','努力程度滑块','修复“已压缩会话”的排版问题'];
const meta=(id,name)=>({id,name,preview:name,cwd:'D:/fixture',path:null,createdAt:1,updatedAt:100,recencyAt:1000-Number(id.replace(/\\D/g,'')),source:'appServer',status:{type:'idle'},modelProvider:'fixture',ephemeral:false,turns:[]});
const recent=titles.map((name,i)=>meta('recent'+i,name));
const archive=meta('archive1','已归档的验收会话');
window.calls=[];window.fail=false;window.failArchived=false;window.titleOnly=false;
Rpc.prototype.request=async function(method,params){
 window.calls.push({method,params});
 if(method==='thread/list')return {data:params.archived?[archive]:recent,nextCursor:null};
 if(method==='thread/search'){
  if(window.fail||window.failArchived&&params.archived)throw new Error('fixture search failure');
  if(window.titleOnly)throw new RpcError('method not found',-32601);
  const q=params.searchTerm;
  if(q==='排序验收')return {data:Array.from({length:25},(_,i)=>({thread:{...meta((params.archived?'sorted-archive-':'sorted-live-')+i,'排序 '+i),recencyAt:1000-i*2-(params.archived?0:1)},snippet:q}))};
  if(q==='慢查询')await new Promise(r=>setTimeout(r,500));
  const thread=params.archived?archive:meta('content99',q==='慢查询'?'过时结果':q==='新查询'?'最新结果':'仅正文命中的会话');
  return {data:q==='无匹配结果'?[]:[{thread,snippet:'正文片段包含 '+q}]};
 }
 if(method==='thread/resume'||method==='thread/read')return {thread:meta(params.threadId,'打开的会话'),model:'fixture',cwd:'D:/fixture'};
 return {data:[],nextCursor:null,config:{}};
};
setState({threads:Object.fromEntries(recent.map(t=>[t.id,{...emptyThreadState(t),loaded:true,subscribed:true}])),list:{...getState().list,ids:recent.map(t=>t.id)}});
window.state=getState;
function Fixture(){useShortcuts();return <><button id="opener" onClick={()=>openPalette('command')}>搜索</button><Palette/></>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
let win, server;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error("PALETTE_TIMEOUT", work); app.exit(2); }, 45000);
async function run() {
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const bundle = await build({
      stdin: { contents: fixture, resolveDir: root, loader: "jsx" }, bundle: true, write: false,
      format: "iife", platform: "browser", jsx: "automatic", loader: { ".md": "text", ".css": "empty" },
      define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"', __GIT_SHA__: '"test"', "process.env.NODE_ENV": '"production"' },
    });
    const assets = path.join(root, "dist/assets");
    const css = readFileSync(path.join(assets, readdirSync(assets).find((name) => name.endsWith(".css"))));
    server = createServer((req, res) => {
      if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="zh-CN" data-theme="light" data-wco><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/fixture.js"></script></html>'); }
      else if (req.url === "/fonts.css") { res.setHeader("Content-Type", "text/css"); res.end(STAND_INS); }
      else if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].contents); }
      else if (req.url === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css); }
      else if (req.url.startsWith("/fonts/") && !req.url.includes("..")) {
        try { res.end(readFileSync(path.join(root, "public", req.url))); } catch { res.writeHead(404); res.end(); }
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
    win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(50); }
      throw new Error("Condition failed: " + code);
    };
    const key = async (keyCode, modifiers = []) => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      await delay(60);
    };
    const type = async (text) => {
      await js(`(()=>{const e=document.querySelector('.palette-search textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
      await delay(50);
    };
    const open = async () => { await js("document.querySelector('#opener').focus();document.querySelector('#opener').click()"); await until("!!document.querySelector('.palette')"); await delay(250); };
    await until("!!document.querySelector('#opener')");
    await open();
    await js("document.fonts.ready.then(()=>true)");
    await delay(150);
    assert.equal(await js("document.activeElement.getAttribute('aria-label')"), "搜索");
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.palette-group-title'),e=>e.textContent)"), ["最近使用", "操作"]);
    assert.equal(await js("document.querySelectorAll('.palette-item').length"), 9);
    assert.equal(await js("document.querySelectorAll('.palette [role=tab],.palette [role=tablist]').length"), 0);
    assert.ok(await js("document.querySelector('.palette-item').textContent.includes('Vite')"));
    assert.ok(await js("!document.querySelector('.palette-item').textContent.includes('过去一年')"));
    writeFileSync(path.join(work, "recent.png"), (await win.webContents.capturePage()).toPNG());
    await key("Return", ["alt"]);
    await until("!!document.querySelector('[role=menu]')");
    await until("!!document.activeElement.closest('[role=menu]')");
    assert.ok(await js("document.querySelector('[role=menu]').textContent.includes('重命名')"));
    await key("Escape");
    assert.ok(await js("!!document.querySelector('.palette') && document.activeElement.tagName==='TEXTAREA'"));
    await key("/");
    await until("!!document.querySelector('[role=menu]')");
    await until("!!document.activeElement.closest('[role=menu]')");
    await js("Array.from(document.querySelectorAll('[role=menuitemradio],[role=menuitem]')).find(e=>e.textContent.includes('已归档会话')).click()");
    await until("document.querySelector('.palette-list').textContent.includes('已归档的验收会话')");
    await key("Return", ["alt"]);
    await until("!!document.querySelector('[role=menu]')");
    assert.ok(await js("document.querySelector('[role=menu]').textContent.includes('取消归档')"));
    await key("Escape");
    await js("document.querySelector('.palette-filters button').click()");
    await type("正文独有关键字");
    await until("!!document.querySelector('.palette-snippet')");
    assert.equal(await js("document.querySelector('.palette-hit').textContent"), "正文独有关键字");
    assert.ok(await js("window.calls.some(c=>c.method==='thread/search'&&c.params.limit===25&&c.params.archived===false)"));
    assert.ok(await js("window.calls.some(c=>c.method==='thread/search'&&c.params.searchTerm==='正文独有关键字'&&c.params.archived===true)"));
    assert.equal(await js("document.querySelectorAll('.palette-item').length"), 2);
    assert.ok(await js("document.querySelector('#palette-archive1 .palette-aside').textContent.includes('已归档')"));
    await delay(200);
    writeFileSync(path.join(work, "search.png"), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#palette-archive1').click()");
    await until("!document.querySelector('.palette') && window.state().threads.archive1.loaded");
    assert.equal(await js("window.state().activeId"), "archive1");
    assert.ok(await js("window.calls.some(c=>c.method==='thread/turns/list'&&c.params.threadId==='archive1')"));
    assert.ok(await js("!window.calls.some(c=>(c.method==='thread/resume'||c.method==='thread/unarchive'||c.method==='turn/start')&&c.params.threadId==='archive1')"), "opening an archived result must stay read-only");
    await open();
    await type("正文独有关键字");
    await until("document.querySelectorAll('.palette-item').length===2");
    const filter = async (label) => {
      await js("document.querySelector('button[aria-label=筛选条件]').click()");
      await until("!!document.querySelector('[role=menu]')");
      await js(`Array.from(document.querySelectorAll('[role=menuitemradio],[role=menuitem]')).find(e=>e.textContent.includes(${JSON.stringify(label)})).click()`);
      await until("!document.querySelector('[role=menu]') && document.querySelector('.palette-list').getAttribute('aria-busy')==='false'");
    };
    await filter("已归档会话");
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.palette-item'),e=>e.id)"), ["palette-archive1"]);
    assert.equal(await js("document.querySelector('.palette-search textarea').value"), "正文独有关键字");
    await filter("未归档会话");
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.palette-item'),e=>e.id)"), ["palette-content99"]);
    await key("Return");
    await until("!document.querySelector('.palette')");
    assert.equal(await js("window.state().activeId"), "content99");
    await open();
    await type("排序验收");
    await until("document.querySelectorAll('.palette-item').length===25");
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.palette-item'),e=>e.id).slice(0,4)"), ["palette-sorted-archive-0", "palette-sorted-live-0", "palette-sorted-archive-1", "palette-sorted-live-1"]);
    await js("window.failArchived=true");
    await type("部分失败");
    await until("document.querySelector('.palette-empty')?.textContent.includes('搜索失败')");
    await js("window.failArchived=false;document.querySelector('.palette-empty button').click()");
    await until("document.querySelectorAll('.palette-item').length===2");
    await type("慢查询");
    await until("window.calls.some(c=>c.method==='thread/search'&&c.params.searchTerm==='慢查询')");
    await type("新查询");
    await until("document.querySelector('.palette-list').textContent.includes('最新结果')");
    await delay(550);
    assert.ok(await js("!document.querySelector('.palette-list').textContent.includes('过时结果')"));
    const long = "长搜索".repeat(30);
    await type(long);
    await until(`window.calls.some(c=>c.method==='thread/search'&&c.params.searchTerm===${JSON.stringify(long)})`);
    assert.ok(await js("!window.calls.some(c=>c.method==='turn/start')"), "typing a long query must not send a message");
    await type("粘贴第一行\n第二行");
    await until("window.calls.some(c=>c.method==='thread/search'&&c.params.searchTerm==='粘贴第一行 第二行')");
    await type("无匹配结果");
    await until("document.querySelector('.palette-empty')?.textContent==='未找到结果'");
    await js("window.fail=true");
    await type("失败验收");
    await until("document.querySelector('.palette-empty')?.textContent.includes('搜索失败')");
    await js("window.fail=false;document.querySelector('.palette-empty button').click()");
    await until("!!document.querySelector('.palette-snippet')");
    await key("Tab");
    assert.equal(await js("document.querySelector('.palette').dataset.compose"), "true");
    assert.equal(await js("document.querySelector('.palette-search textarea').value"), "失败验收");
    await key("Tab");
    assert.ok(await js("!document.querySelector('.palette').dataset.compose"));
    await type("");
    await delay(250);
    await key("Tab", ["shift"]);
    assert.ok(await js("document.activeElement.classList.contains('palette-compose-toggle')"), "Shift+Tab stays in the dialog");
    await key("Escape");
    await until("!document.querySelector('.palette')");
    assert.equal(await js("document.activeElement.id"), "opener");
    await open();
    await type("触屏归档验收");
    await until("document.querySelectorAll('.palette-item').length===2");
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    assert.ok(await js("matchMedia('(pointer: coarse)').matches"));
    assert.ok(await js("document.querySelector('button[aria-label=筛选条件]').getBoundingClientRect().width>0"));
    await filter("已归档会话");
    for (const width of [320, 768, 1024, 1440]) {
      win.setContentSize(width, 900);
      await delay(80);
      assert.ok(await js("(()=>{const r=document.querySelector('.palette').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()"), `fits ${width}px`);
      writeFileSync(path.join(work, `archived-${width}.png`), (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false });
    win.webContents.debugger.detach();
    await js("document.documentElement.classList.add('dark')");
    await delay(150);
    writeFileSync(path.join(work, "dark.png"), (await win.webContents.capturePage()).toPNG());
    await js("window.titleOnly=true");
    await type("旧后端");
    await until("!!document.querySelector('.palette-search-note')");
    assert.ok(await js("window.calls.some(c=>c.method==='thread/list'&&c.params.searchTerm==='旧后端'&&c.params.limit===25)"));
    assert.deepEqual(await js("Array.from(document.querySelectorAll('.palette-item'),e=>e.id)"), ["palette-archive1"]);
    await filter("全部会话");
    assert.ok(await js("window.calls.some(c=>c.method==='thread/list'&&c.params.searchTerm==='旧后端'&&c.params.archived===false)"));
    assert.ok(await js("window.calls.some(c=>c.method==='thread/list'&&c.params.searchTerm==='旧后端'&&c.params.archived===true)"));
    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "results.json"), JSON.stringify({ ok: true, chromium: process.versions.chrome, errors }, null, 2));
    console.log("PALETTE_SMOKE", JSON.stringify({ ok: true, work, chromium: process.versions.chrome }));
    clearTimeout(timeout);
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    app.quit();
  } catch (error) {
    console.error("PALETTE_FAILED", work, error.stack, errors);
    if (win) {
      console.error("FOCUS", await win.webContents.executeJavaScript("document.activeElement.outerHTML"));
      writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    }
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
}
app.whenReady().then(run);
