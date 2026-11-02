import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { test } from "node:test";
import { generateTitle } from "./title.mjs";
import { createBridge } from "./bridge.mjs";
import { createOrchestrator } from "./orchestrator.mjs";

function fixture({ ephemeral = true, answer = "<title>通知样式</title>", hang = false, tool = false, oversized = false, modelPages, features = [{ name: "fast_mode", enabled: false }], rejectFastStart = false, rejectFastTurn = false } = {}) {
  modelPages ??= [[{ id: "test-model", model: "test-model", supportedReasoningEfforts: [{ reasoningEffort: "low" }] }]];
  const work = mkdtempSync(path.join(tmpdir(), "title-worker-test-"));
  const log = path.join(work, "requests.jsonl"), script = path.join(work, "codex.mjs");
  writeFileSync(script, `import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const log=${JSON.stringify(log)},modelPages=${JSON.stringify(modelPages)},features=${JSON.stringify(features)};let fastThread=false;const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
appendFileSync(log,JSON.stringify({pid:process.pid,argv:process.argv.slice(2),cwd:process.cwd(),browserToken:process.env.CODEX_UI_BROWSER_TOKEN})+'\\n');
createInterface({input:process.stdin}).on('line',line=>{
 const {id,method,params}=JSON.parse(line);appendFileSync(log,line+'\\n');if(id===undefined)return;
 if(method==='thread/start'&&params.serviceTier==='priority'&&${rejectFastStart}){send({id,error:{message:'fast mode unavailable'}});return;}
 if(method==='turn/start'&&fastThread&&${rejectFastTurn}){send({id,error:{message:'fast mode unavailable'}});return;}
 if(method==='thread/start')fastThread=params.serviceTier==='priority';
 if(${oversized}){process.stdout.write(Buffer.alloc(300*1024,'x'));return;}
 const result=method==='config/read'?{config:{mcp_servers:{external:{command:'fixture',tool_timeout_sec:null}},plugins:{'sample@market':{enabled:true}}}}:
 method==='model/list'?{data:modelPages[params.cursor?Number(params.cursor):0]??[],nextCursor:params.cursor?null:(modelPages.length>1?'1':null)}:
 method==='experimentalFeature/list'?{data:features,nextCursor:null}:
 method==='thread/start'?{thread:{id:'title-only',ephemeral:${ephemeral}},model:params.model??'test-model'}:
 method==='turn/start'?{turn:{id:'title-turn'}}:{};
 send({id,result});
 if(method==='turn/start'&&!${hang}){
  if(${tool})send({id:'tool-request',method:'item/tool/call',params:{threadId:'title-only'}});
  else{send({method:'item/completed',params:{threadId:'unrelated',item:{type:'agentMessage',text:'<title>错误会话</title>'}}});send({method:'item/completed',params:{threadId:'title-only',item:{type:'agentMessage',text:${JSON.stringify(answer)}}}});send({method:'turn/completed',params:{threadId:'title-only',turn:{status:'completed',items:[]}}});}
 }
});`);
  return { command: { command: process.execPath, args: [script] }, script, log, records: () => readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(test) {
  for (let i = 0; i < 150; i++) { if (test()) return; await sleep(20); }
  throw new Error("worker did not reach expected state");
}

test("dedicated title worker has its own process, neutral cwd, no browser binding and disabled MCP/plugins", async () => {
  const f = fixture();
  assert.equal(await generateTitle({ command: f.command, description: "修改通知样式", model: "test-model" }), "通知样式");
  const records = f.records(), start = records.find((r) => r.method === "thread/start").params;
  assert.deepEqual(records[0].argv, ["app-server"]);
  assert.equal(records[0].browserToken, undefined);
  assert.notEqual(records[0].cwd, process.cwd());
  // By name: the worker's own cwd comes back with symlinks resolved (macOS /var → /private/var),
  // and the folder is gone by now.
  assert.equal(path.basename(start.cwd), path.basename(records[0].cwd));
  assert.equal(start.ephemeral, true);
  assert.equal(start.config.developer_instructions, "");
  assert.equal(start.config.project_doc_max_bytes, 0);
  assert.equal(start.config.mcp_servers, undefined, "never replay nullable config/read transport fields");
  assert.equal(start.config["mcp_servers.external.enabled"], false);
  assert.equal(start.config.plugins["sample@market"].enabled, false);
  assert.equal(start.config["features.hooks"], false);
  const turn = records.find((r) => r.method === "turn/start").params;
  assert.equal(turn.effort, "low");
  assert.equal(JSON.parse(turn.input[0].text), "修改通知样式");
  assert.equal(records.some((r) => r.method === "thread/name/set"), false);
});

test("title worker selects the highest available Luna model with fast mode", async () => {
  const model = (id, { fast = true, hidden = false } = {}) => ({
    id, model: id, hidden, serviceTiers: fast ? [{ id: "priority" }] : [], additionalSpeedTiers: [],
    supportedReasoningEfforts: [{ reasoningEffort: "low" }],
  });
  const f = fixture({
    modelPages: [[model("gpt-6.9-luna"), model("gpt-6.11-luna", { fast: false })], [model("gpt-6.10-luna"), model("gpt-7-luna", { hidden: true })]],
    features: [{ name: "fast_mode", enabled: true }],
  });
  assert.equal(await generateTitle({ command: f.command, description: "描述", model: "gpt-5.4" }), "通知样式");
  const records = f.records(), starts = records.filter((record) => record.method === "thread/start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].params.model, "gpt-6.10-luna");
  assert.equal(starts[0].params.serviceTier, "priority");
  assert.deepEqual(records.filter((record) => record.method === "model/list").map((record) => record.params.cursor), [null, "1"]);
  assert.equal(records.find((record) => record.method === "turn/start").params.effort, "low");
});

test("unavailable fast mode falls back to the conversation model", async () => {
  const model = { id: "gpt-6-luna", model: "gpt-6-luna", hidden: false, serviceTiers: [{ id: "priority" }] };
  for (const features of [[{ name: "fast_mode", enabled: false }], []]) {
    const f = fixture({ modelPages: [[model]], features });
    assert.equal(await generateTitle({ command: f.command, description: "描述", model: "gpt-5.4" }), "通知样式");
    const start = f.records().find((record) => record.method === "thread/start").params;
    assert.equal(start.model, "gpt-5.4");
    assert.equal("serviceTier" in start, false);
  }
});

test("a rejected fast model or service tier retries with the conversation model", async () => {
  const modelPages = [[{ id: "gpt-6-luna", model: "gpt-6-luna", hidden: false, serviceTiers: [{ id: "priority" }] }]];
  for (const options of [{ rejectFastStart: true }, { rejectFastTurn: true }]) {
    const f = fixture({ modelPages, features: [{ name: "fast_mode", enabled: true }], ...options });
    assert.equal(await generateTitle({ command: f.command, description: "描述", model: "gpt-5.4" }), "通知样式");
    const starts = f.records().filter((record) => record.method === "thread/start");
    assert.equal(starts[0].params.model, "gpt-6-luna");
    assert.equal(starts[0].params.serviceTier, "priority");
    assert.equal(starts.at(-1).params.model, "gpt-5.4");
    assert.equal("serviceTier" in starts.at(-1).params, false);
  }
});

test("title worker rejects non-ephemeral threads, invalid output and interactive requests", async () => {
  for (const options of [{ ephemeral: false }, { answer: "not a title" }, { tool: true }]) {
    const f = fixture(options);
    await assert.rejects(generateTitle({ command: f.command, description: "描述" }));
    if (options.ephemeral === false) assert.equal(f.records().some((r) => r.method === "turn/start"), false);
  }
});

test("cancelling a title request stops its private worker", async () => {
  const f = fixture({ hang: true }), abort = new AbortController();
  const result = generateTitle({ command: f.command, description: "描述", signal: abort.signal });
  const rejected = assert.rejects(result, /cancel|abort/i);
  await until(() => existsSync(f.log) && f.records().some((r) => r.method === "turn/start"));
  abort.abort();
  await rejected;
});

test("oversized title output rejects promptly and cleans up its worker", async () => {
  const f = fixture({ oversized: true });
  await assert.rejects(generateTitle({ command: f.command, description: "描述" }), /too large/);
  const pid = f.records()[0].pid;
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
});

test("title endpoint requires bridge auth, validates input, and works without a page app-server connection", async () => {
  const f = fixture();
  const orchestrator = createOrchestrator({ codex: f.script, browser: { verificationInstructions() { throw new Error("title must bypass browser injection"); } } });
  const bridge = createBridge(orchestrator, { token: "secret" });
  const server = http.createServer((req, res) => bridge.handle(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port, url = `http://127.0.0.1:${port}/api/title`;
  const post = (body, headers = {}) => fetch(url, { method: "POST", body: JSON.stringify(body), headers });
  const headers = { cookie: `codex_ui_${port}=secret`, "content-type": "application/json" };
  try {
    assert.equal((await post({ description: "描述" })).status, 401);
    assert.equal((await post({ description: "描述" }, { ...headers, origin: "http://untrusted.test" })).status, 403);
    for (const body of [{}, { description: "" }, { description: 12 }, { description: "字".repeat(4001) }, { description: "描述", model: {} }]) assert.equal((await post(body, headers)).status, 400);
    assert.equal(existsSync(f.log), false, "invalid requests must not start a worker");
    const response = await post({ description: "修改通知样式", model: "test-model" }, headers);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { title: "通知样式" });
  } finally { orchestrator.close(); server.close(); }
});

test("the deadline bounds startup and already cancelled requests start no worker", async (t) => {
  const f = fixture({ hang: true });
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(generateTitle({ command: f.command, description: "描述", signal: abort.signal }));
  assert.equal(existsSync(f.log), false);
  const timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => timeout(callback, delay === 30_000 ? 50 : delay, ...args));
  await assert.rejects(generateTitle({ command: f.command, description: "描述" }), /timed out/);
});

test("disconnecting HTTP or closing the bridge kills outstanding title workers", async () => {
  for (const mode of ["disconnect", "shutdown"]) {
    const f = fixture({ hang: true });
    const orchestrator = createOrchestrator({ codex: f.script, log: { error() {} } });
    const bridge = createBridge(orchestrator, { token: "secret" });
    const server = http.createServer((req, res) => bridge.handle(req, res));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port, abort = new AbortController();
    const response = fetch(`http://127.0.0.1:${port}/api/title`, {
      method: "POST", signal: abort.signal, headers: { cookie: `codex_ui_${port}=secret`, "content-type": "application/json" }, body: JSON.stringify({ description: "描述" }),
    }).then((response) => response.status, () => "aborted");
    try {
      await until(() => existsSync(f.log) && f.records().some((r) => r.method === "turn/start"));
      const pid = f.records()[0].pid;
      if (mode === "disconnect") abort.abort();
      else orchestrator.close();
      assert.equal(await response, mode === "disconnect" ? "aborted" : 502);
      await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
    } finally { abort.abort(); orchestrator.close(); server.close(); }
  }
});
