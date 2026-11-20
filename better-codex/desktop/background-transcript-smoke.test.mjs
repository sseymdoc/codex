// Real Chromium and transcript components with synthetic lifecycle records; no live backend.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { serveClaudeFonts } from "../server/claude-fonts.mjs";

const work = mkdtempSync(path.join(tmpdir(), "codex-background-transcript-"));
app.setPath("userData", path.join(work, "profile"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = `
import React,{useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {Transcript} from './src/components/Transcript';
import {Panes} from './src/components/Panes';
import {setState,emptyThreadState,useStore} from './src/lib/store';
window.fixture=(mode='running',plan=true)=>{
 const command={type:'commandExecution',id:'cmd',processId:'process',backgrounded:true,description:'持续监控后端构建并在结束后继续核验',command:'gh run watch 123 --exit-status',source:'unifiedExecStartup',commandActions:[],status:mode==='completed'?'completed':mode==='failed'?'failed':'inProgress',aggregatedOutput:'Refreshing run status every 60 seconds.',exitCode:mode==='completed'?0:mode==='failed'?1:null,durationMs:null};
 const thread=emptyThreadState({id:'acceptance',name:'后台唤醒',cwd:'D:/fixture',source:'cli',status:{type:mode==='active'?'active':'idle'},createdAt:1,updatedAt:2});
 thread.loaded=true;thread.subscribed=mode!=='unknown';
 thread.turns=[{id:'turn',status:mode==='active'?'inProgress':mode==='interrupted'?'interrupted':'completed',startedAt:1,completedAt:2,items:[{type:'userMessage',id:'user',content:[{type:'text',text:'推送后等待构建完成',text_elements:[]}]},command,{type:'agentMessage',id:'reply',text:'构建已经启动，完成后继续核验。',phase:'final'}],...(plan?{plan:{at:1,steps:[{step:'推送并启动构建',status:'completed'},{step:'核验构建结果',status:'inProgress'}]}}:{})}];
 if(mode==='interrupted')command.backgrounded=false;
 thread.timing={cmd:[Date.now()-15000],reply:[Date.now()-1000,Date.now()]};
 thread.background=['running','active'].includes(mode)?[{itemId:'cmd',processId:'process',command:command.command,backgrounded:true,cpuPercent:null}]:[];
 setState({threads:{acceptance:thread},activeId:'acceptance',conn:{status:'disconnected'},panes:{acceptance:{open:['background'],expanded:null}}});
};
function Fixture(){const thread=useStore(s=>s.threads.acceptance);const scroll=useRef(null),dock=useRef(null);return <><div className='fixture-chat'><Transcript thread={thread} dock={dock} scrollRef={scroll}/><div ref={dock}/></div><Panes thread={thread}/></>}
window.fixture();createRoot(document.getElementById('root')).render(<Fixture/>);
`;

app.whenReady().then(async () => {
  let win, server;
  const errors = [];
  const timeout = setTimeout(() => {
    console.error("BACKGROUND_TRANSCRIPT_TIMEOUT", work);
    app.exit(1);
  }, 30000);
  try {
    const root = path.resolve(import.meta.dirname, "..");
    const bundle = await build({
      stdin: { contents: fixture, resolveDir: root, loader: "tsx" },
      bundle: true,
      write: false,
      format: "esm",
      target: "chrome140",
      tsconfig: path.join(root, "tsconfig.json"),
      loader: { ".md": "text", ".css": "empty" },
    });
    const css = readdirSync(path.join(root, "dist/assets"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(path.join(root, "dist/assets", file), "utf8"))
      .join("\n");
    server = createServer((req, res) => {
      if (serveClaudeFonts(req, res)) return;
      if (req.url === "/")
        res.setHeader("Content-Type", "text/html; charset=utf-8"),
          res.end(
            '<!doctype html><html lang="zh-CN" data-theme="light" data-reduce-motion="true"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/claude-fonts.css"><link rel="stylesheet" href="/style.css"><style>#root{display:flex;height:100vh;gap:12px}.fixture-chat{display:flex;flex-direction:column;flex:1;min-width:0}.transcript-wrap{height:100%}</style><div id="root"></div><script type="module" src="/fixture.js"></script></html>',
          );
      else if (req.url === "/fixture.js")
        res.setHeader("Content-Type", "text/javascript"),
          res.end(bundle.outputFiles[0].contents);
      else if (req.url === "/style.css")
        res.setHeader("Content-Type", "text/css"), res.end(css);
      else if (req.url.startsWith("/fonts/") && !req.url.includes("..")) {
        try {
          res.end(readFileSync(path.join(root, "public", req.url)));
        } catch {
          res.writeHead(404).end();
        }
      } else res.writeHead(404).end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    win = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        offscreen: true,
      },
    });
    win.webContents.on("console-message", (event) => {
      if (
        event.level === "error" &&
        !event.message.includes("Failed to load resource")
      )
        errors.push(event.message);
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    const js = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await js(code)) return;
        await delay(30);
      }
      throw new Error("Condition failed: " + code);
    };
    await until("!!document.querySelector('.turn-plan')");
    assert.equal(
      await js(
        "document.querySelector('.transcript').textContent.includes('已停止')",
      ),
      false,
      "a completed reply must not stop its background command",
    );
    assert.equal(
      await js(
        "Array.from(document.querySelectorAll('.transcript button')).filter(e=>e.textContent==='1 个正在运行的任务').length",
      ),
      1,
      "show the running count once",
    );
    assert.equal(
      await js(
        "!!(document.querySelector('.turn-plan').compareDocumentPosition(document.querySelector('.msg-actions')) & Node.DOCUMENT_POSITION_FOLLOWING)",
      ),
      true,
      "plan before reply actions",
    );
    assert.equal(
      await js("document.querySelector('.turn-plan').checkVisibility()"),
      true,
    );
    assert.equal(
      await js(
        "!!document.querySelector('.bg-page button[aria-label=\"停止此任务\"]')",
      ),
      true,
    );
    await js(
      "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
    );
    writeFileSync(
      path.join(work, "running.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js("window.fixture('completed')");
    await until("!document.querySelector('.turn-plan')");
    assert.equal(
      await js("document.querySelectorAll('.working-line').length"),
      0,
      "idle replies do not reserve a working row above their actions",
    );
    assert.equal(
      await js(
        "document.querySelector('.transcript').textContent.includes('已停止')",
      ),
      false,
    );
    assert.equal(
      await js(
        "!!document.querySelector('.bg-page button[aria-label=\"停止此任务\"]')",
      ),
      false,
    );
    await js("window.fixture('interrupted',false)");
    await until(
      "document.querySelector('.transcript').textContent.includes('已停止')",
    );
    await js("window.fixture('failed')");
    await until(
      "document.querySelector('.transcript').textContent.includes('失败')",
    );
    await js("window.fixture('unknown')");
    await until(
      "document.querySelector('.transcript').textContent.includes('状态未知')",
    );
    assert.equal(
      await js(
        "document.querySelector('.transcript').textContent.includes('已停止')",
      ),
      false,
    );
    await js("window.fixture('running',false)");
    await until("!!document.querySelector('.working-action')");
    assert.equal(
      await js(
        "document.querySelector('.transcript').textContent.includes('已停止')",
      ),
      false,
    );
    await js("window.fixture('active')");
    await until("document.querySelector('[data-turn-working=true]')!==null");
    assert.deepEqual(errors, []);
    console.log(
      "BACKGROUND_TRANSCRIPT_SMOKE",
      JSON.stringify({ ok: true, work, chromium: process.versions.chrome }),
    );
    clearTimeout(timeout);
    win.destroy();
    await new Promise((resolve) => server.close(resolve));
    app.quit();
  } catch (error) {
    console.error("BACKGROUND_TRANSCRIPT_FAILED", work, error.stack, errors);
    if (win)
      writeFileSync(
        path.join(work, "failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    clearTimeout(timeout);
    server?.close();
    app.exit(1);
  }
});
