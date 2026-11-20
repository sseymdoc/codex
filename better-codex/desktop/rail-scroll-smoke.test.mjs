import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { serveClaudeFonts } from "../server/claude-fonts.mjs";

// After npm run build: npm exec -- electron desktop/rail-scroll-smoke.test.mjs
// Uses an isolated profile and never connects to an app-server.
const work = mkdtempSync(path.join(tmpdir(), "codex-rail-scroll-"));
app.setPath("userData", path.join(work, "profile"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div>
<style>body{margin:0}#root{height:100%;width:100%}.session-row{height:360px;flex:none}.dock{height:50px;flex:none}</style>
<script type="module">
import React, {useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {SessionRail} from '/src/components/Rail.tsx';
import {Dialogs} from '/src/components/Dialogs.tsx';
import {Transcript} from '/src/components/Transcript.tsx';
import {emptyThreadState,getState,setState} from '/src/lib/store.ts';
import {Rpc} from '/src/lib/rpc.ts';
import '/src/styles/tokens.css';
import '/src/styles/base.css';
import '/src/styles/shell.css';
import '/src/styles/pages.css';
import '/src/styles/transcript.css';
import '/src/styles/composer.css';
const thread=emptyThreadState({id:'rail-scroll-fixture',cwd:'D:/fixture',gitInfo:null,createdAt:0,updatedAt:0});
thread.loaded=true;
setState({mcp:[],threads:{[thread.meta.id]:thread}});
function Fixture({floating}){
 const scrollRef=useRef(null),dock=useRef(null);
 return <><div className="session-row"><div className="session-chat"><Transcript thread={thread} dock={dock} scrollRef={scrollRef}/><div ref={dock} className="dock"/></div><SessionRail thread={thread} scrollRef={scrollRef} overlay={floating?'pointer':undefined}/></div><Dialogs/></>;
}
const root=createRoot(document.getElementById('root'));
window.fixture=(floating,tall)=>{
 flushSync(()=>root.render(<Fixture key={floating+'-'+tall} floating={floating}/>));
 document.querySelectorAll('.rail-card').forEach(e=>e.style.minHeight=tall?'330px':'');
 const chat=document.querySelector('.transcript');
 chat.insertAdjacentHTML('beforeend','<div style="height:3000px">滚动测试内容</div>');
 chat.scrollTop=400;
};
window.fixture(false,false);
window.environmentFixture=(projectId='environment-project',cwd='D:/Visual_Studio/codex')=>{
 const project={id:'environment-project',name:'codex',roots:[{path:'D:/Visual_Studio/codex'},{path:'d:/visual_studio/codex/'},{path:'F:/REA/Claude_2.42304.0.0_x64__pzs8sxrjxfjjc'},{path:'D:/Visual_Studio/open-claude-ui'}]};
 const other={...project,id:'another-project',name:'不要显示此环境',roots:[{path:'D:/Visual_Studio/codex'},{path:'D:/unrelated'}]};
 thread.meta={...thread.meta,cwd,projectId,gitInfo:{branch:'feat/codex-ui'}};
 setState(s=>({projects:[other,project],prefs:{...s.prefs,projectId:other.id,cwd:'D:/unrelated'},remoteControl:{status:'enabled'},dialog:null}));
 window.fixture(false,false);
};
window.environmentCalls=[];
window.environmentState=()=>({projects:getState().projects,prefs:getState().prefs,cwd:thread.meta.cwd});
Rpc.prototype.request=async(method,params)=>{
 if(method==='fs/readDirectory') return {entries:[]};
 if(method==='project/update'){
  window.environmentCalls.push(params);
  if(window.failEnvironmentSave) throw new Error('保存测试失败');
  return {project:{...getState().projects.find(p=>p.id===params.projectId),...params}};
 }
 throw new Error('Fixture has no server: '+method);
};
</script></html>`;
const rows = [],
  errors = [];
let server, win;
const timeout = setTimeout(() => {
  console.error("RAIL_SCROLL_TIMEOUT", work);
  app.exit(2);
}, 45000);
async function run() {
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const bundle = await build({
      stdin: {
        contents: html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replaceAll("'/src/", "'./src/"),
        resolveDir: root,
        loader: "jsx",
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      loader: { ".css": "empty", ".md": "text" },
      define: { "__APP_VERSION__": '\"test\"', "__BUILD_TIME__": '\"test\"', "__GIT_SHA__": '\"test\"', "process.env.NODE_ENV": '\"production\"' },
    });
    const assets = path.join(root, "dist/assets");
    const css = readFileSync(
      path.join(
        assets,
        readdirSync(assets).find((name) => name.endsWith(".css")),
      ),
    );
    server = createServer((req, res) => {
      if (serveClaudeFonts(req, res)) return;
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          html.replace(/<script type="module">[\s\S]*?<\/script>/, '<link rel="stylesheet" href="/claude-fonts.css"><link rel="stylesheet" href="/style.css"><script src="/fixture.js"></script>'),
        );
      } else if (url.pathname === "/fixture.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bundle.outputFiles[0].contents);
      } else if (url.pathname === "/style.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css);
      } else if (/^\/fonts\/[\w./-]+$/.test(url.pathname) && !url.pathname.includes("..")) {
        try {
          res.end(readFileSync(path.join(root, "public", url.pathname)));
        } catch {
          res.writeHead(404);
          res.end();
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({ show: false, width: 1050, height: 600, webPreferences: { offscreen: true, backgroundThrottling: false } });
    const wc = win.webContents;
    wc.on("console-message", (event) => {
      if (event.level === "error") errors.push(event.message);
    });
    wc.debugger.attach("1.3");
    const js = (code) => wc.executeJavaScript(code).catch((error) => { throw new Error(`Browser check failed: ${code}`, { cause: error }); });
    await wc.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    for (let i = 0; i < 100 && !(await js("!!document.querySelector('.rail')")); i++) await delay(50);
    assert.ok(await js("!!document.querySelector('.rail')"), errors.join("\n"));
    await js("document.fonts.ready.then(()=>true)");
    const positions = () =>
      js(
        "({rail:document.querySelector('.rail-scroll').scrollTop,chat:document.querySelector('.transcript').scrollTop,body:document.scrollingElement.scrollTop})",
      );
    const wheel = async (selector, deltaY, padding = false) => {
      const point = await js(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+${padding === "border" ? 0.5 : padding ? 4 : "Math.min(60,r.height/2)"}}})()`,
      );
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY });
      await delay(220);
    };
    for (const floating of [false, true])
      for (const tall of [false, true]) {
        await js(`window.fixture(${floating},${tall})`);
        await delay(150);
        const label = `${floating ? "floating" : "docked"}/${tall ? "overflow" : "short"}`;
        assert.ok(
          await js(
            "(()=>{const r=document.querySelector('.rail'),s=document.querySelector('.rail-scroll'),c=getComputedStyle(r),b=document.querySelector('.rail-surface');return Math.abs(s.clientHeight-(r.clientHeight-parseFloat(c.paddingTop)-parseFloat(c.paddingBottom)-(b?2:0)))<=2})()",
          ),
          `${label}: scroller must fill rail`,
        );
        const check = async (name, selector, delta, padding, expected) => {
          const before = await positions();
          await wheel(selector, delta, padding);
          const after = await positions();
          assert.equal(after.body, before.body, `${label}/${name}: outer page`);
          if (expected === "chat") assert.ok(after.chat > before.chat, `${label}/${name}: transcript scrolls`);
          else assert.equal(after.chat, before.chat, `${label}/${name}: transcript stays`);
          if (expected === "rail") assert.ok(after.rail > before.rail, `${label}/${name}: rail scrolls`);
          rows.push({ label, name, before, after });
        };
        await check("content", ".rail-card-head", 120, false, tall ? "rail" : "chat");
        await check("outer padding", ".rail", 120, true, "chat");
        if (floating) await check("panel border", ".rail-surface", 120, "border", "chat");
        if (tall) {
          await js("document.querySelector('.rail-scroll').scrollTop=0");
          await check("top boundary", ".rail-card-head", -120, false, "stay");
          await js("document.querySelector('.rail-scroll').scrollTop=100000");
          await check("bottom boundary", ".rail-scroll", 120, false, "stay");
        }
        await check("transcript control", ".transcript", 120, false, "chat");
      }
    await js(
      `window.fixture(false,false);document.querySelector('.session-row').insertAdjacentHTML('afterbegin','<div class="transcript" style="position:absolute;left:-1000px;width:1px;height:1px;overflow:auto"><div style="height:3000px"></div></div>')`,
    );
    const boundBefore = await js("document.querySelectorAll('.transcript')[1].scrollTop");
    await wheel(".rail-card-head", 120);
    assert.ok(
      (await js("document.querySelectorAll('.transcript')[1].scrollTop")) > boundBefore,
      "forwarding follows the passed ref, not the first transcript selector",
    );
    assert.equal(await js("document.querySelector('.transcript').scrollTop"), 0, "unrelated transcript stays put");
    rows.push({ label: "bound ref", name: "ignores unrelated transcript" });
    await js("window.environmentFixture()");
    await delay(100);
    const card = '[data-rail-card="environment"]';
    const labels = () => js(`Array.from(document.querySelectorAll('${card} .rail-row')).map(e=>Array.from(e.querySelectorAll('.rail-label,.rail-name,.rail-dot,.rail-path')).map(e=>e.textContent.trim()).join(String.fromCharCode(10)))`);
    assert.deepEqual(await labels(), ["codex", "codex\n·\nD:/Visual_Studio", "Claude_2.42304.0.0_x64__pzs8sxrjxfjjc", "open-claude-ui", "feat/codex-ui", "Remote Control"]);
    assert.ok(await js(`document.querySelector('${card} .rail-icon [data-cds="Icon"]').textContent.codePointAt(0)===0xe093`), "environment uses the Laptop glyph");
    assert.ok(await js(`(()=>{const e=document.querySelectorAll('${card} .rail-name')[1];return e.scrollWidth>e.clientWidth && getComputedStyle(e).textOverflow==='ellipsis'})()`), "long folder names truncate");
    const clip = await js(`(()=>{const r=document.querySelector('${card}').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`);
    writeFileSync(path.join(work, "environment.png"), (await wc.capturePage(clip)).toPNG());
    const beforeSettings = await js("window.environmentState()");
    await js(`document.querySelector('${card} [aria-label="环境设置"]').focus()`);
    wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    wc.sendInputEvent({ type: "char", keyCode: "\r" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await delay(100);
    assert.equal(await js("document.querySelector('[role=dialog] .dialog-title').textContent"), "环境设置");
    assert.equal(await js("document.activeElement.value"), "codex", "name field receives focus");
    assert.equal(await js("document.querySelectorAll('.environment-roots li').length"), 4);
    await js("document.querySelectorAll('.environment-roots button')[1].click()");
    await delay(50);
    await js("document.querySelectorAll('.environment-roots button')[1].click()");
    await delay(50);
    await js("window.failEnvironmentSave=true;document.querySelector('button[type=submit][form=create-environment]').click()");
    await delay(100);
    assert.equal(await js("document.querySelector('[role=alert]').textContent"), "保存测试失败");
    assert.deepEqual(await js("window.environmentState()"), beforeSettings, "failed save preserves the project and workspace");
    await js("window.failEnvironmentSave=false;document.querySelector('button[type=submit][form=create-environment]').click()");
    await delay(250);
    assert.equal(await js("!!document.querySelector('[role=dialog]')"), false);
    assert.deepEqual(await js("window.environmentCalls.at(-1)"), {projectId:"environment-project",name:"codex",roots:[{path:"D:/Visual_Studio/codex"},{path:"D:/Visual_Studio/open-claude-ui"}]});
    assert.deepEqual((await js("window.environmentState()")).prefs, beforeSettings.prefs);
    assert.equal((await js("window.environmentState()")).cwd, beforeSettings.cwd);
    assert.ok(!(await labels()).includes("Claude_2.42304.0.0_x64__pzs8sxrjxfjjc"), "saved roots refresh the card");
    assert.equal(await js("document.activeElement.getAttribute('aria-label')"), "环境设置", "focus returns to the gear");
    await js(`document.querySelector('${card} [aria-label="环境设置"]').click()`);
    await delay(50);
    await js("document.querySelector('.environment-roots button').click()");
    await delay(100);
    await js("document.querySelector('.environment-roots button').click()");
    await delay(50);
    assert.equal(await js("document.querySelector('button[type=submit][form=create-environment]').disabled"), true, "empty environment cannot save");
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await delay(250);
    assert.equal(await js("!!document.querySelector('[role=dialog]')"), false);
    assert.deepEqual((await js("window.environmentState()")).prefs, beforeSettings.prefs);
    await js("window.environmentFixture('deleted-project')");
    await delay(50);
    assert.ok(!(await labels()).some(label => label.includes("不要显示此环境") || label.includes("open-claude-ui")), "missing explicit ID never borrows another project");
    await js("window.environmentFixture(null,'D:/unassigned')");
    await delay(50);
    assert.equal((await labels())[0], "unassigned");
    await js(`document.querySelector('${card} [aria-label="环境设置"]').click()`);
    await delay(50);
    assert.equal(await js("document.querySelector('.dialog-title').textContent"), "新建环境");
    assert.equal(await js("document.querySelector('.environment-root-path').textContent"), "D:/unassigned");
    wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    wc.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await delay(250);
    for (const width of [320, 768, 1024, 1440]) {
      win.setContentSize(width, 600);
      await js(`window.fixture(${width < 1024},false)`);
      await delay(50);
      assert.ok(await js(`(()=>{const e=document.querySelector('${card}');return e.scrollWidth<=e.clientWidth})()`), `environment fits at ${width}px`);
    }
    win.setContentSize(1050, 600);
    rows.push({ label: "environment", name: "project identity, roots, truncation, settings, failure, save and keyboard" });
    await js("window.fixture(true,true)");
    await delay(100);
    assert.deepEqual(errors, []);
    writeFileSync(path.join(work, "after.png"), (await win.webContents.capturePage()).toPNG());
    writeFileSync(path.join(work, "results.json"), JSON.stringify({ chromium: process.versions.chrome, rows, errors }, null, 2));
    console.log("RAIL_SCROLL_SMOKE", JSON.stringify({ ok: true, checks: rows.length, chromium: process.versions.chrome, work }));
    clearTimeout(timeout);
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    app.quit();
  } catch (error) {
    writeFileSync(path.join(work, "failure.json"), JSON.stringify({ error: error.stack, errors, rows }, null, 2));
    console.error("RAIL_SCROLL_FAILED", work, error.stack, errors);
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
}
app.whenReady().then(run);
