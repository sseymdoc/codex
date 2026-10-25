// Real renderer, SSE bridge and MCP receipts in a disposable, hidden Electron window.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { createOrchestrator } from "../server/orchestrator.mjs";
import { createBridge } from "../server/bridge.mjs";
import { STAND_INS } from "../server/claude-fonts.mjs";
import { verifyNativeDesktop } from "./desktop-native-smoke.test.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-desktop-tools-"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
mkdirSync(path.join(work, "other"));
writeFileSync(path.join(work, "sample.txt"), "one\ntwo\nthree\n");
const fake = path.join(work, "backend.mjs");
writeFileSync(fake, `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{
const {id,method,params={}}=JSON.parse(line);let result={};
if(method==='initialize')result={codexUiHostContext:true,codexUiDesktopContext:true,codexUiDesktopTools:true};
if(method==='thread/start')result={token:process.env.CODEX_UI_DESKTOP_TOKEN,thread:{id:params.cwd?.endsWith('other')?'other':'main',cwd:params.cwd||process.cwd(),parentThreadId:null,source:'cli'}};
if(id!==undefined)console.log(JSON.stringify({id,result}));});`);

const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {Rpc} from './src/lib/rpc';import {emptyThreadState,getState,setState,useStore} from './src/lib/store';
import {Panes} from './src/components/Panes';import {displayRequest} from './src/components/DesktopTools';
import {fileTargets,openFileTab} from './src/components/FilePreview';
import {terminalTargets,openTerminalTab} from './src/components/Terminal';
import {layoutOf,closePane,toggleExpanded,openChanges} from './src/lib/panes';
import {hostContext} from './context/index.mjs';
window.effects=[];window.browserActions=[];
const browser={view:'main',engine:'electron-cdp',toolsEnabled:true,settings:{enabled:true,allowedOrigins:[]},tabs:[{id:'existing',title:'Existing page',url:'https://example.test/',viewport:null}],active:'existing',servers:[],approvals:[]};
window.codexDesktop={onBrowserState:()=>()=>{},browserRequest:async request=>{window.browserActions.push(request);if(request.action==='servers')return{configurations:[],autoVerify:false};return{...browser,view:request.view}},onShortcut:()=>()=>{}};
const real=Rpc.prototype.request;
Rpc.prototype.request=function(method,params){if(this.connection)return real.call(this,method,params);window.effects.push({method,params});return Promise.resolve(method==='fs/readFile'?{dataBase64:btoa('one\\ntwo\\nthree\\n')}:method==='fs/watch'?{watchId:'fixture'}:method==='gitDiffToRemote'?{sha:'a'.repeat(40),diff:'diff --git a/all.txt b/all.txt\\n--- a/all.txt\\n+++ b/all.txt\\n@@ -1 +1 @@\\n-before\\n+after\\n'}:{data:[],nextCursor:null});};
const client=new Rpc({close(){},notification(){},request(){},desktop:displayRequest,async open(hello){
await client.request('initialize',{});window.connection=hello.connectionId;
const threads={};for(const cwd of [${JSON.stringify(work)},${JSON.stringify(path.join(work, "other"))}]){
const response=await client.request('thread/start',{cwd});window.token=response.token;
const thread=emptyThreadState({...response.thread,gitInfo:{sha:'a'.repeat(40)},status:{type:'idle'}});thread.subscribed=true;thread.loaded=true;
thread.turns=[{id:'turn',status:'completed',items:[{id:'edit',type:'fileChange',status:'completed',changes:[{path:'sample.txt',kind:{type:'update',move_path:null},diff:'@@ -1 +1 @@\\n-one\\n+two\\n'}]},{id:'task',type:'commandExecution',command:'token=PRIVATE_COMMAND',description:'Fixture task',backgrounded:true,processId:'123',status:'completed',exitCode:0,aggregatedOutput:'PRIVATE_OUTPUT',durationMs:1}],plan:[{step:'Fixture plan',status:'completed'}],error:null}];
threads[thread.meta.id]=thread;await client.request('thread/settings/update',{threadId:thread.meta.id,codexUiContext:hostContext(cwd,true,{desktopContext:true,desktopTools:true})});}
setState({threads,activeId:'main',conn:{status:'ready'},server:{...getState().server,info:{platformOs:'windows'}}});window.ready=true;
}});
Object.assign(window,{getState,setState,fileTargets,openFileTab,terminalTargets,openTerminalTab,closePane,toggleExpanded,layoutOf,openChanges,displayRequest});
window.loadNativeThread=meta=>{const thread={...emptyThreadState(meta),loaded:true,subscribed:true};setState(s=>({threads:{...s.threads,[meta.id]:thread},activeId:meta.id}));};
function View(){const thread=useStore(s=>s.threads[s.activeId]);return <div style={{display:'flex',height:'680px'}}><div><textarea id='composer' aria-label='Message'/><button id='user-target'>Focus</button></div><Panes thread={thread}/></div>}
createRoot(document.getElementById('root')).render(<View/>);void client.connect();
`;

async function run() {
  let win, server, service;
  const errors = [], checks = [];
  const timer = setTimeout(() => { console.error("DESKTOP_TOOLS_TIMEOUT", work); app.exit(2); }, 60000);
  try {
    await app.whenReady();
    const root = process.cwd();
    const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", target: "chrome140", tsconfig: "tsconfig.json", loader: { ".md": "text", ".css": "empty" } });
    const css = readdirSync(path.join(root, "dist/assets")).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(root, "dist/assets", file), "utf8")).join("\n");
    service = createOrchestrator({ codex: fake, cwd: work, desktopUi: true, experimentalBackend: true, browser: { toolsEnabled: () => true }, log: { error() {} } });
    const bridge = createBridge(service, { token: "fixture" });
    server = createServer((req, res) => bridge.handle(req, res, () => {
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (pathname === "/") res.setHeader("Content-Type", "text/html; charset=utf-8"), res.end('<!doctype html><html lang="zh-CN"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
      else if (pathname === "/fixture.js") res.setHeader("Content-Type", "text/javascript"), res.end(bundle.outputFiles[0].contents);
      else if (pathname === "/style.css") res.setHeader("Content-Type", "text/css"), res.end(STAND_INS + css);
      else if (pathname.startsWith("/fonts/") && !pathname.includes("..")) { try { res.end(readFileSync(path.join(root, "public", pathname))); } catch { res.writeHead(404).end(); } }
      else res.writeHead(404).end();
    }));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ width: 1100, height: 760, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on("console-message", event => { if (event.level === "error" && !event.message.includes("Failed to load resource")) errors.push(event.message); });
    await win.loadURL(base + "/?token=fixture");
    const js = code => win.webContents.executeJavaScript(code);
    for (let i = 0; i < 150 && !(await js("window.ready === true")); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(await js("window.ready"), true, errors.join("\n"));
    const auth = await js("({connection:window.connection,token:window.token})");
    const initialized = await fetch(`${base}/api/desktop-mcp?c=${auth.connection}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id: 0, method: "initialize", params: {} }) });
    const session = initialized.headers.get("mcp-session-id");
    assert.ok(session);
    let sequence = 0;
    const invoke = async (name, args = {}, threadId = "main") => {
      const response = await fetch(`${base}/api/desktop-mcp?c=${auth.connection}`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json", "Mcp-Session-Id": session }, body: JSON.stringify({ id: ++sequence, method: "tools/call", params: { name, arguments: args, _meta: { threadId, codexUiDesktopCwd: threadId === "main" ? work : path.join(work, "other") } } }) });
      const result = (await response.json()).result;
      return { error: result.isError === true, ...JSON.parse(result.content[0].text) };
    };
    const show = args => invoke("show_pane", args);
    const before = await invoke("get_ui_state");
    assert.equal(before.panes.length, 6);
    assert.equal(before.panes.find(pane => pane.pane === "terminal").available, false);
    assert.equal((await show({ pane: "terminal" })).error, true);
    assert.equal(await js("window.effects.filter(e=>e.method==='process/spawn').length"), 0);
    checks.push("empty terminal does not spawn");
    await js("document.querySelector('#composer').focus()");
    for (const pane of ["files", "diff", "plan", "background", "browser"]) {
      const result = await show({ pane, ...(pane === "files" ? { path: "sample.txt", line: 2 } : {}) });
      assert.equal(result.error, false, JSON.stringify(result));
      assert.equal(result.displayed, true, pane);
      assert.equal(await js(`document.querySelector('[data-pane="${pane}"]') !== null`), true);
      assert.equal(await js("document.activeElement.id"), "composer");
      await js(`closePane(${JSON.stringify(pane)},'main')`);
    }
    checks.push("five panes acknowledged after DOM commit without stealing focus");
    await js(`openTerminalTab('main',${JSON.stringify(work)})`);
    for (let i = 0; i < 100 && !(await js("terminalTargets('main').length")); i++) await new Promise(resolve => setTimeout(resolve, 10));
    const terminal = (await invoke("get_ui_state", { pane: "terminal" })).targets[0];
    const spawns = await js("window.effects.filter(e=>e.method==='process/spawn').length");
    await js("closePane('terminal','main');document.querySelector('#composer').focus()");
    assert.equal((await show({ pane: "terminal", targetId: terminal.id })).displayed, true);
    assert.equal(await js("window.effects.filter(e=>e.method==='process/spawn').length"), spawns);
    assert.equal(await js("document.activeElement.id"), "composer");
    checks.push("existing terminal selected without a new shell");
    await show({ pane: "files" });
    await js(`(async()=>{toggleExpanded('files','main');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));openTerminalTab('main',${JSON.stringify(work)})})()`);
    assert.equal((await show({ pane: "plan" })).error, true, "revealing another pane must not initialize a hidden terminal tab");
    assert.equal(await js("window.effects.filter(e=>e.method==='process/spawn').length"), spawns);
    assert.equal((await show({ pane: "terminal", targetId: terminal.id })).displayed, true);
    checks.push("revealing other panes never starts a hidden terminal tab");
    for (const pane of ["files", "diff", "background", "browser"]) {
      const state = await invoke("get_ui_state", { pane });
      assert.ok(state.targets.length > 0, pane);
      assert.equal((await show({ pane, targetId: state.targets[0].id })).error, false);
      assert.equal((await show({ pane, targetId: "missing" })).error, true);
      assert.doesNotMatch(JSON.stringify(state), /PRIVATE_COMMAND|PRIVATE_OUTPUT/);
    }
    assert.equal(await js("window.browserActions.some(a=>['new','navigate','startServer'].includes(a.action))"), false);
    checks.push("existing targets only and no contents or navigation");
    await js("toggleExpanded('terminal','main')");
    await show({ pane: "plan" }); await show({ pane: "plan" });
    assert.equal(await js("layoutOf('main').expanded"), null);
    assert.equal(await js("layoutOf('main').open.filter(p=>p==='plan').length"), 1);
    const hidden = await invoke("show_pane", { pane: "plan" }, "other");
    assert.equal(hidden.applied, true); assert.equal(hidden.displayed, false);
    assert.equal(await js("getState().activeId"), "main");
    assert.equal((await invoke("show_pane", { pane: "files", targetId: path.join(work, "sample.txt") }, "other")).error, true);
    checks.push("idempotent layout and background thread isolation");
    assert.equal(await js(`(async()=>{document.querySelector('#composer').focus();const pending=displayRequest({id:'focus-race',name:'show_pane',threadId:'main',cwd:${JSON.stringify(work)},args:{pane:'plan'},deadline:Date.now()+5000,browserEnabled:true},new AbortController().signal);document.querySelector('#user-target').focus();await pending;return document.activeElement.id})()`), "user-target");
    checks.push("user focus changed during display is preserved");
    await js("setState(s=>({threads:{...s.threads,main:{...s.threads.main,turns:[{...s.threads.main.turns[0],items:Array.from({length:55},(_,i)=>({type:'commandExecution',id:'task-'+i,command:'PRIVATE_COMMAND',description:'Task '+i,status:'completed',backgrounded:true,processId:String(i),aggregatedOutput:'PRIVATE_OUTPUT',exitCode:0}))}]}}}))");
    const page = await invoke("get_ui_state", { pane: "background" });
    assert.equal(page.targets.length, 50); assert.equal(page.nextOffset, 50);
    const last = await invoke("get_ui_state", { pane: "background", offset: page.nextOffset });
    assert.equal(last.targets.length, 5); assert.equal(last.nextOffset, null);
    assert.doesNotMatch(JSON.stringify([page, last]), /PRIVATE_COMMAND|PRIVATE_OUTPUT/);
    checks.push("bounded metadata pagination");
    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "panes.png"), (await win.webContents.capturePage()).toPNG());
    if (process.env.CODEX_UI_TEST_APP_SERVER) await verifyNativeDesktop(win, work, process.env.CODEX_UI_TEST_APP_SERVER);
    console.log("DESKTOP_TOOLS_SMOKE " + JSON.stringify({ ok: true, work, checks, chromium: process.versions.chrome }));
  } catch (error) { console.error("DESKTOP_TOOLS_FAILED", work, error.stack, errors); process.exitCode = 1; }
  finally { clearTimeout(timer); win?.destroy(); service?.close(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode ?? 0); }
}
void run();
