// Pull request tools and 自动修复 end to end: the real renderer, SSE bridge and MCP receipts in a
// hidden Electron window; gh's answers come from a stand-in for command/exec.
// Run: pnpm build && pnpm exec electron desktop/pr-tools-smoke.test.mjs
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { createOrchestrator } from "../server/orchestrator.mjs";
import { createBridge } from "../server/bridge.mjs";
import { STAND_INS } from "../server/claude-fonts.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-pr-tools-"));
app.setPath("userData", path.join(work, "profile"));
app.disableHardwareAcceleration();
const fake = path.join(work, "backend.mjs");
writeFileSync(fake, `import {createInterface} from 'node:readline';createInterface({input:process.stdin}).on('line',line=>{
const {id,method,params={}}=JSON.parse(line);let result={};
if(method==='initialize')result={codexUiHostContext:true,codexUiDesktopContext:true,codexUiDesktopTools:true};
if(method==='thread/start')result={token:process.env.CODEX_UI_DESKTOP_TOKEN,thread:{id:'main',cwd:params.cwd||process.cwd(),parentThreadId:null,source:'cli'}};
if(id!==undefined)console.log(JSON.stringify({id,result}));});`);

// gh as the stand-in answers it: PR 7 bound to the session, its head and checks set from the test
// (window.gh), PR 9 found by number; auto-merge flips window.gh.autoMerge.
const fixture = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {Rpc} from './src/lib/rpc';import {emptyThreadState,getState,setState,useStore} from './src/lib/store';
import {displayRequest} from './src/components/DesktopTools';
import {SessionRail} from './src/components/Rail';
import {pollNow,isMonitored} from './src/lib/pr-monitor';
import {hostContext} from './context/index.mjs';
window.codexDesktop={onBrowserState:()=>()=>{},browserRequest:async()=>({}),onShortcut:()=>()=>{}};
window.effects=[];window.gh={sha:'aaa111',failing:true,conflict:false,comments:[{id:'c1',login:'alice'}],autoMerge:false};
const attachments=[{attachmentType:'pull_request',identityKey:JSON.stringify(['github.com','o','r',7]),payload:{url:'https://github.com/o/r/pull/7',headBranch:'feat/x'}}];
const view=number=>({number,url:'https://github.com/o/r/pull/'+number,state:'OPEN',isDraft:false,title:number===7?'Fix "parser"':'Other',reviewDecision:'REVIEW_REQUIRED',mergeable:window.gh.conflict?'CONFLICTING':'MERGEABLE',mergeStateStatus:'BLOCKED',
  statusCheckRollup:[{__typename:'CheckRun',workflowName:'CI',name:'test',conclusion:window.gh.failing?'FAILURE':'SUCCESS',startedAt:'2026-10-29T00:00:00Z'},{__typename:'CheckRun',workflowName:'CI',name:'lint',conclusion:'SUCCESS',startedAt:'2026-10-29T00:00:00Z'}],
  headRefOid:window.gh.sha,headRefName:'feat/x',baseRefName:'main',autoMergeRequest:window.gh.autoMerge?{enabledAt:'x'}:null});
const extra=()=>({data:{viewer:{login:'me'},repository:{pullRequest:{isInMergeQueue:false,reviewThreads:{nodes:window.gh.comments.map(c=>({isResolved:false,comments:{nodes:[{id:c.id,author:{login:c.login}}]}}))},reviews:{nodes:[]}}}}});
const gh=argv=>{
  if(argv[1]==='pr'&&argv[2]==='view'){const target=argv.at(-1);const number=/pull\\/(\\d+)$/.exec(target)?.[1]??target.replace('#','');
    return ['7','9'].includes(number)?{exitCode:0,stdout:JSON.stringify(view(Number(number))),stderr:''}:{exitCode:1,stdout:'',stderr:'no pull requests found'};}
  if(argv[1]==='api')return {exitCode:0,stdout:JSON.stringify(extra()),stderr:''};
  if(argv[1]==='repo')return {exitCode:0,stdout:JSON.stringify({squashMergeAllowed:true}),stderr:''};
  if(argv[1]==='pr'&&argv[2]==='merge'){window.gh.autoMerge=argv.includes('--auto');return {exitCode:0,stdout:'',stderr:''};}
  return {exitCode:1,stdout:'',stderr:'unexpected'};};
const real=Rpc.prototype.request;
Rpc.prototype.request=function(method,params){if(this.connection)return real.call(this,method,params);window.effects.push({method,params});
  if(method==='command/exec')return Promise.resolve(gh(params.command));
  if(method==='thread/attachment/list')return Promise.resolve({data:attachments.slice()});
  if(method==='thread/attachment/add'){attachments.push({attachmentType:params.attachmentType,identityKey:params.identityKey,payload:params.payload});return Promise.resolve({});}
  if(method==='thread/attachment/remove'){const at=attachments.findIndex(a=>a.identityKey===params.identityKey);if(at>=0)attachments.splice(at,1);return Promise.resolve({});}
  if(method==='gitDiffToRemote')return Promise.resolve({sha:'a'.repeat(40),diff:''});
  if(method==='turn/start')return Promise.resolve({turn:{id:'wake-'+window.effects.length,status:'inProgress',items:[]}});
  return Promise.resolve({data:[],nextCursor:null});};
const client=new Rpc({close(){},notification(){},request(){},desktop:displayRequest,async open(hello){
await client.request('initialize',{});window.connection=hello.connectionId;
const response=await client.request('thread/start',{cwd:${JSON.stringify(work)}});window.token=response.token;
const thread=emptyThreadState({...response.thread,gitInfo:{sha:'a'.repeat(40),branch:'feat/x',originUrl:'git@github.com:o/r.git'},status:{type:'idle'}});thread.subscribed=true;thread.loaded=true;thread.attachments=attachments.slice();
await client.request('thread/settings/update',{threadId:'main',codexUiContext:hostContext(${JSON.stringify(work)},true,{desktopContext:true,desktopTools:true})});
setState({threads:{main:thread},activeId:'main',conn:{status:'ready'},server:{...getState().server,info:{platformOs:'windows'}}});window.ready=true;
}});
Object.assign(window,{getState,setState,pollNow,isMonitored});
const key=JSON.stringify(['github.com','o','r',7]);
window.userTurn=()=>setState(s=>({threads:{...s.threads,main:{...s.threads.main,turns:[{id:'u',status:'inProgress',items:[{type:'userMessage',id:'m',content:[{type:'text',text:'turn on auto-fix please',text_elements:[]}]}],error:null}]}}}));
window.endTurn=()=>setState(s=>({pendingMessages:{...s.pendingMessages,main:undefined},threads:{...s.threads,main:{...s.threads.main,turns:s.threads.main.turns.map(t=>({...t,status:'completed'}))}}}));
function View(){const thread=useStore(s=>s.threads.main);const ref=React.useRef(null);return thread?<div ref={ref} style={{width:'360px',height:'760px',overflow:'auto'}}><SessionRail thread={thread} scrollRef={ref}/></div>:null}
createRoot(document.getElementById('root')).render(<View/>);void client.connect();
`;

async function run() {
  let win, server, service;
  const errors = [], checks = [];
  const pass = (what) => { checks.push(what); console.log("PASS", what); };
  const timer = setTimeout(() => { console.error("PR_TOOLS_TIMEOUT", work); app.exit(2); }, 90000);
  try {
    await app.whenReady();
    const root = process.cwd();
    const bundle = await build({ stdin: { contents: fixture, resolveDir: root, loader: "tsx" }, bundle: true, write: false, format: "esm", target: "chrome140", tsconfig: "tsconfig.json", loader: { ".md": "text", ".css": "empty" } });
    const assets = path.join(process.env.CODEX_UI_DIST ?? path.join(root, "dist"), "assets");
    const css = readdirSync(assets).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(assets, file), "utf8")).join("\n");
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
    win = new BrowserWindow({ width: 900, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on("console-message", event => { if (event.level === "error" && !event.message.includes("Failed to load resource")) errors.push(event.message + " @ " + event.sourceId + ":" + event.lineNumber); });
    await win.loadURL(base + "/?token=fixture");
    const js = code => Promise.race([win.webContents.executeJavaScript(code), new Promise((_, reject) => setTimeout(() => reject(new Error("renderer did not answer: " + code.slice(0, 80))), 8000))]);
    const until = async (code, what) => { for (let i = 0; i < 200; i++) { if (await js(code)) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail(what); };
    await until("window.ready === true", "renderer not ready: " + errors.join("\n"));
    const auth = await js("({connection:window.connection,token:window.token})");
    const endpoint = `${base}/api/desktop-mcp?c=${auth.connection}`;
    const headers = { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" };
    headers["Mcp-Session-Id"] = (await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: 0, method: "initialize", params: {} }) })).headers.get("mcp-session-id");
    let sequence = 0;
    const invoke = async (name, args = {}) => {
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ id: ++sequence, method: "tools/call", params: { name, arguments: args, _meta: { threadId: "main", codexUiDesktopCwd: work } } }) });
      const result = (await response.json()).result;
      return { error: result.isError === true, text: result.content[0].text };
    };
    const wakes = () => js("window.effects.filter(e=>e.method==='turn/start').map(e=>e.params.input.map(p=>p.text).join(''))");

    const status = await invoke("get_pr_status");
    assert.equal(status.error, false, status.text);
    const [pr] = JSON.parse(status.text).pullRequests;
    assert.deepEqual([pr.number, pr.state, pr.checks.status, pr.checks.failing, pr.review_decision, pr.unresolved_threads, pr.head_branch, pr.auto_fix], [7, "open", "failed", ["CI / test"], "review_required", 1, "feat/x", false]);
    pass("get_pr_status reads the bound pull request through gh");

    // Turning switches on needs the user's own turn.
    const notAsked = await invoke("set_pr_monitor", { enabled: true });
    assert.equal(notAsked.error, true);
    assert.match(notAsked.text, /Only the user turns this on/);
    assert.equal(await js(`isMonitored('main',${JSON.stringify(JSON.stringify(["github.com", "o", "r", 7]))})`), false);
    await js("window.userTurn()");
    const on = await invoke("set_pr_monitor", { enabled: true });
    assert.match(on.text, /Auto-fix is now on for https:\/\/github.com\/o\/r\/pull\/7/);
    const merge = await invoke("set_auto_merge", { pr: "#7", enabled: true });
    assert.match(merge.text, /Auto-merge is now on/);
    assert.equal(await js("window.gh.autoMerge"), true);
    assert.ok(await js("window.effects.some(e=>e.method==='command/exec'&&e.params.command.join(' ').includes('pr merge https://github.com/o/r/pull/7 --auto --squash')&&e.params.sandboxPolicy.type==='dangerFullAccess')"));
    pass("switches only on the user's turn; auto-merge through gh");

    // Busy: the change waits. Idle: one wake, quoting the failing check; the same head never again.
    await js("pollNow(Date.now()+1e7)");
    assert.equal((await wakes()).length, 0, "no wake while the session is working");
    await js("window.endTurn()");
    await js("pollNow(Date.now()+2e7)");
    await until("window.effects.some(e=>e.method==='turn/start')", "no auto-fix wake");
    const [wake] = await wakes();
    assert.match(wake, /^<ci-monitor-event pr="https:\/\/github.com\/o\/r\/pull\/7" changes="ci">/);
    assert.match(wake, /- CI failed on aaa111: 'CI \/ test' \(1 of 2 checks\)\./);
    assert.doesNotMatch(wake, /alice/, "comments already there are only noted");
    await js("window.endTurn()");
    await js("pollNow(Date.now()+3e7)");
    assert.equal((await wakes()).length, 1, "the same head wakes once");
    await js("window.gh.sha='bbb222';window.gh.conflict=true;window.gh.comments.push({id:'c2',login:'bob'},{id:'c3',login:'me'})");
    await js("pollNow(Date.now()+4e7)");
    await until("window.effects.filter(e=>e.method==='turn/start').length===2", "no second wake");
    const second = (await wakes())[1];
    assert.match(second, /changes="ci,conflict,review"/);
    assert.match(second, /- 1 new review comment from 'bob'\./);
    pass("auto-fix wakes once per change, idle only, others' comments only");

    // The rail shows the switch; the auto-fix turn reads as its own row.
    await until("document.body.innerText.includes('Fix')", "PR row not shown");
    await js("document.querySelector('.rail-ci')?.click()");
    await until("document.body.innerText.includes('自动修复')", "no 自动修复 switch in the CI popover");
    assert.equal(await js("document.querySelector('.rail-ci-fix [role=switch]').getAttribute('aria-checked')"), "true");
    await new Promise(resolve => setTimeout(resolve, 400));
    writeFileSync(path.join(work, "ci-popover.png"), (await win.webContents.capturePage()).toPNG());
    pass("CI popover shows the 自动修复 switch on");

    // Binding by number, unbinding stops auto-fix.
    const bound = await invoke("bind_pr", { pr: "9" });
    assert.match(bound.text, /^Bound to this session: \{"url":"https:\/\/github.com\/o\/r\/pull\/9"/);
    assert.equal((await invoke("bind_pr", { pr: "404" })).error, true);
    const gone = await invoke("unbind_pr", { pr: "https://github.com/o/r/pull/7" });
    assert.match(gone.text, /Removed https:\/\/github.com\/o\/r\/pull\/7/);
    assert.equal(await js(`isMonitored('main',${JSON.stringify(JSON.stringify(["github.com", "o", "r", 7]))})`), false);
    assert.match((await invoke("get_pr_status")).text, /pull\/9/);
    pass("bind by number, unbind stops auto-fix");

    assert.deepEqual(errors, []);
    console.log("PR_TOOLS_SMOKE " + JSON.stringify({ ok: true, work, checks }));
  } catch (error) { console.error("PR_TOOLS_FAILED", work, error.stack, errors); process.exitCode = 1; }
  finally { clearTimeout(timer); win?.destroy(); service?.close(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode ?? 0); }
}
void run();
