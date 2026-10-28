// Terminal tools end to end: the real renderer, SSE bridge and MCP receipts in a hidden Electron
// window, with the shells' process/spawn answered by an echo stand-in.
// Run: pnpm build && pnpm exec electron desktop/terminal-tools-smoke.test.mjs
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

const work = mkdtempSync(path.join(tmpdir(), "codex-terminal-tools-"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
mkdirSync(path.join(work, "other"));
mkdirSync(path.join(work, "web"));
const fake = path.join(work, "backend.mjs");
writeFileSync(fake, `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{
const {id,method,params={}}=JSON.parse(line);let result={};
if(method==='initialize')result={codexUiHostContext:true,codexUiDesktopContext:true,codexUiDesktopTools:true};
if(method==='thread/start')result={token:process.env.CODEX_UI_DESKTOP_TOKEN,thread:{id:params.cwd?.endsWith('other')?'other':'main',cwd:params.cwd||process.cwd(),parentThreadId:null,source:'cli'}};
if(id!==undefined)console.log(JSON.stringify({id,result}));});`);

// The shells: process/spawn succeeds, a typed line comes back as its echo plus a reply, Ctrl+C
// prints ^C, and process/kill exits with 1.
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {Rpc} from './src/lib/rpc';import {emptyThreadState,getState,setState,useStore,answerConsent} from './src/lib/store';
import {applyNotification} from './src/lib/codex';
import {Panes} from './src/components/Panes';import {Approvals} from './src/components/Approvals';
import {Markdown} from './src/components/content';
import {displayRequest} from './src/components/DesktopTools';
import {openTerminalTab,terminalTabs} from './src/components/Terminal';
import {layoutOf} from './src/lib/panes';
import {hostContext} from './context/index.mjs';
window.effects=[];window.codexDesktop={onBrowserState:()=>()=>{},browserRequest:async()=>({}),onShortcut:()=>()=>{}};
const b64=text=>btoa(unescape(encodeURIComponent(text)));
const say=(handle,text)=>setTimeout(()=>applyNotification({method:'process/outputDelta',params:{processHandle:handle,deltaBase64:b64(text)}}),5);
const real=Rpc.prototype.request;
Rpc.prototype.request=function(method,params){if(this.connection)return real.call(this,method,params);window.effects.push({method,params});
if(method==='process/spawn')say(params.processHandle,'PS '+params.cwd+'> ');
if(method==='process/writeStdin'){const typed=decodeURIComponent(escape(atob(params.deltaBase64)));
  if(typed===String.fromCharCode(3))say(params.processHandle,'^C\\r\\nPS> ');
  else{const command=typed.replace(/\\r$/,'');say(params.processHandle,command+'\\r\\n'+(command==='color'?'\\x1b[31mred\\x1b[0m':'out:'+command)+'\\r\\nPS> ');}}
if(method==='process/kill')setTimeout(()=>applyNotification({method:'process/exited',params:{processHandle:params.processHandle,exitCode:1}}),5);
return Promise.resolve({data:[],nextCursor:null});};
const client=new Rpc({close(){},notification(){},request(){},desktop:displayRequest,async open(hello){
await client.request('initialize',{});window.connection=hello.connectionId;
const threads={};for(const cwd of [${JSON.stringify(work)},${JSON.stringify(path.join(work, "other"))}]){
const response=await client.request('thread/start',{cwd});window.token=response.token;
const thread=emptyThreadState({...response.thread,status:{type:'idle'}});thread.subscribed=true;thread.loaded=true;
if(thread.meta.id==='other')thread.overrides={...thread.overrides,permission:'full-access'};
threads[thread.meta.id]=thread;await client.request('thread/settings/update',{threadId:thread.meta.id,codexUiContext:hostContext(cwd,true,{desktopContext:true,desktopTools:true})});}
setState({threads,activeId:'main',conn:{status:'ready'},server:{...getState().server,info:{platformOs:'windows'}}});window.ready=true;
}});
Object.assign(window,{getState,setState,answerConsent,openTerminalTab,terminalTabs,layoutOf});
function View(){const thread=useStore(s=>s.threads[s.activeId]);const [text,setText]=React.useState('');window.showMarkdown=setText;
return <div style={{display:'flex',height:'720px'}}><div style={{width:'420px'}}><textarea id='composer' aria-label='Message'/><div id='reply'><Markdown text={text}/></div><Approvals threadId='main' cwd=${JSON.stringify(work)}/></div><Panes thread={thread}/></div>}
createRoot(document.getElementById('root')).render(<View/>);void client.connect();
`;

async function run() {
  let win, server, service;
  const errors = [], checks = [];
  const pass = (what) => { checks.push(what); console.log("PASS", what); };
  const timer = setTimeout(() => { console.error("TERMINAL_TOOLS_TIMEOUT", work); app.exit(2); }, 90000);
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
    win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on("console-message", event => { if (event.level === "error" && !event.message.includes("Failed to load resource")) errors.push(event.message); });
    await win.loadURL(base + "/?token=fixture");
    const js = code => Promise.race([win.webContents.executeJavaScript(code), new Promise((_, reject) => setTimeout(() => reject(new Error("renderer did not answer: " + code.slice(0, 80))), 8000))]);
    const until = async (code, what) => { for (let i = 0; i < 200; i++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail(what); };
    await until("window.ready === true", "renderer not ready: " + errors.join("\n"));
    const auth = await js("({connection:window.connection,token:window.token})");
    const endpoint = `${base}/api/desktop-mcp?c=${auth.connection}`;
    const headers = { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };
    headers["Mcp-Session-Id"] = (await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: 0, method: "initialize", params: {} }) })).headers.get("mcp-session-id");
    let sequence = 0;
    const invoke = async (name, args = {}, threadId = "main") => {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: ++sequence, method: "tools/call", params: { name, arguments: args, _meta: { threadId, codexUiDesktopCwd: threadId === "main" ? work : path.join(work, "other") } } }) });
      const result = (await response.json()).result;
      return { error: result.isError === true, text: result.content[0].text };
    };
    const typed = () => js("window.effects.filter(e=>e.method==='process/writeStdin').map(e=>decodeURIComponent(escape(atob(e.params.deltaBase64))))");

    const tools = (await (await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: 99, method: "tools/list" }) })).json()).result.tools.map(tool => tool.name);
    for (const name of ["list_terminal_tabs", "open_terminal_tab", "run_in_terminal", "read_terminal", "stop_terminal_tab"]) assert.ok(tools.includes(name), name);
    assert.deepEqual(JSON.parse((await invoke("list_terminal_tabs")).text), { tabs: [] });
    pass("tools listed; no tabs yet");

    await js("document.querySelector('#composer').focus()");
    const opened = await invoke("open_terminal_tab", { title: "dev", cwd: "web" });
    assert.equal(opened.error, false, opened.text);
    const id = /tab_id ([0-9a-f]{8})/.exec(opened.text)[1];
    assert.match(opened.text, new RegExp(`\\[dev\\]\\(#terminal/${id}\\)`));
    assert.equal(await js("window.effects.filter(e=>e.method==='process/spawn').at(-1).params.cwd"), path.join(work, "web"));
    await until("document.querySelector('[data-pane=\"terminal\"]') !== null", "terminal pane not shown");
    assert.equal(await js("document.activeElement.id"), "composer", "the pane opens without taking focus");
    const listed = JSON.parse((await invoke("list_terminal_tabs")).text).tabs;
    assert.deepEqual(listed.map(tab => [tab.tab_id, tab.label, tab.state, tab.codex]), [[id, "dev", "running", true]]);
    pass("open_terminal_tab starts a shell in the folder and keeps focus");

    // Outside full access the command waits on the card: 允许一次 types it, 拒绝 types nothing.
    const allowed = invoke("run_in_terminal", { command: "npm test", tab_id: id, wait_for_output_ms: 1500 });
    await until("!!getState().terminalConsents.main", "no consent card");
    assert.equal(await js("document.body.innerText.includes('允许 Codex 在终端中运行此命令吗？') && document.body.innerText.includes('npm test')"), true);
    assert.equal((await typed()).includes("npm test\r"), false, "nothing typed before the answer");
    await new Promise(resolve => setTimeout(resolve, 1200)); // the card's grace against accidental clicks
    writeFileSync(path.join(work, "consent.png"), (await win.webContents.capturePage()).toPNG());
    await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('允许一次')).click()");
    await until("!getState().terminalConsents.main", "the card stayed after 允许一次");
    await until("window.effects.some(e=>e.method==='process/writeStdin')", "nothing typed after 允许一次");
    const ran = await allowed;
    assert.equal(ran.error, false, ran.text);
    assert.ok((await typed()).includes("npm test\r"));
    assert.match(ran.text, /<terminal-output>[^]*out:npm test[^]*<\/terminal-output>/);
    const declined = invoke("run_in_terminal", { command: "rm -rf build", tab_id: id });
    await until("!!getState().terminalConsents.main", "no second consent card");
    await js("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('拒绝')).click()");
    const no = await declined;
    assert.equal(no.error, true);
    assert.match(no.text, /declined/);
    assert.equal((await typed()).some(text => text.startsWith("rm -rf")), false);
    pass("consent card: allowed command typed, declined one never typed");

    // Full access: no card; a new tab in the chat's own folder; ANSI colors come back as plain text.
    const quick = await invoke("run_in_terminal", { command: "color", wait_for_output_ms: 1500 }, "other");
    assert.equal(quick.error, false, quick.text);
    assert.equal(await js("Object.keys(getState().terminalConsents).length"), 0);
    const otherId = /tab_id ([0-9a-f]{8})/.exec(quick.text)[1];
    assert.match(quick.text, /\nred\n/);
    assert.equal(quick.text.includes(String.fromCharCode(27)), false);
    assert.equal(await js("window.effects.filter(e=>e.method==='process/spawn').at(-1).params.cwd"), path.join(work, "other"));
    pass("full access runs without a card; colors read as plain text");

    // Another chat's tab reads as missing; the user's own tab cannot be stopped.
    const foreign = await invoke("read_terminal", { tab_id: id }, "other");
    assert.equal(foreign.error, true);
    assert.match(foreign.text, /No terminal tab with that tab_id in this chat/);
    await js(`openTerminalTab('main',${JSON.stringify(work)})`);
    const userTab = await js(`terminalTabs('main',${JSON.stringify(work)}).find(t=>!t.codex).tab_id`);
    assert.match((await invoke("stop_terminal_tab", { tab_id: userTab })).text, /user's own/);
    pass("tabs scoped to their chat; user tabs not stoppable");

    const read = await invoke("read_terminal", { tab_id: id, lines: 2 });
    assert.match(read.text, /dev \(tab_id [0-9a-f]{8}\), running: 2 lines/);
    assert.match((await invoke("stop_terminal_tab", { tab_id: id })).text, /Sent Ctrl\+C/);
    assert.equal((await typed()).at(-1), String.fromCharCode(3));
    assert.match((await invoke("stop_terminal_tab", { tab_id: otherId, mode: "kill" }, "other")).text, /Ended the shell/);
    await until(`terminalTabs('other','x').find(t=>t.tab_id===${JSON.stringify(otherId)})?.state==='exited'`, "killed shell not exited");
    assert.match((await invoke("stop_terminal_tab", { tab_id: otherId }, "other")).text, /already exited/);
    pass("read_terminal limits lines; interrupt and kill");

    // A #terminal/<tab_id> link in a reply opens the pane on that tab.
    await js(`window.showMarkdown('Started it in [the dev tab](#terminal/${id}) and [a closed one](#terminal/0000ffff).')`);
    await until(`document.querySelector('#reply [data-terminal="${id}"]') !== null`, "terminal link not rendered");
    assert.equal(await js("document.querySelector('#reply a[href*=\"terminal\"]')"), null, "no <a> leaves for the browser");
    await js(`terminalTabs('main','x');document.querySelector('[data-term-tab="${userTab}"]')?.click()`);
    await until(`terminalTabs('main','x').find(t=>t.tab_id===${JSON.stringify(userTab)}).selected`, "user tab not selected");
    await js(`document.querySelector('#reply [data-terminal="${id}"]').click()`);
    await until(`terminalTabs('main','x').find(t=>t.tab_id===${JSON.stringify(id)}).selected`, "link did not select its tab");
    await js(`document.querySelector('#reply [data-terminal="0000ffff"]').click()`);
    await until("getState().toasts.some(t=>t.title==='此终端标签页已关闭，或不属于此会话。')", "no toast for a missing tab");
    pass("terminal links select their tab; a missing tab says so");

    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "terminal.png"), (await win.webContents.capturePage()).toPNG());
    console.log("TERMINAL_TOOLS_SMOKE " + JSON.stringify({ ok: true, work, checks }));
  } catch (error) { console.error("TERMINAL_TOOLS_FAILED", work, error.stack, errors); process.exitCode = 1; }
  finally { clearTimeout(timer); win?.destroy(); service?.close(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode ?? 0); }
}
void run();
