import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";

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
import {Transcript} from '/src/components/Transcript.tsx';
import {emptyThreadState,setState} from '/src/lib/store.ts';
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
 return <div className="session-row"><div className="session-chat"><Transcript thread={thread} dock={dock} scrollRef={scrollRef}/><div ref={dock} className="dock"/></div><SessionRail thread={thread} scrollRef={scrollRef} overlay={floating?'pointer':undefined}/></div>;
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
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        res.setHeader("Content-Type", "text/html");
        res.end(
          html.replace(/<script type="module">[\s\S]*?<\/script>/, '<link rel="stylesheet" href="/style.css"><script src="/fixture.js"></script>'),
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
    const js = (code) => wc.executeJavaScript(code);
    await wc.loadURL(`http://127.0.0.1:${server.address().port}/`);
    for (let i = 0; i < 100 && !(await js("!!document.querySelector('.rail')")); i++) await delay(50);
    assert.ok(await js("!!document.querySelector('.rail')"), errors.join("\n"));
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
