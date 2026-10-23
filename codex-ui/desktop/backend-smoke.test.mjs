// Real Electron entrypoint, real archive/executable installation, isolated profile; GitHub is a fixture.
import { app, dialog } from "electron";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

async function smoke() {
  const root = path.resolve(import.meta.dirname, "..");
  const initiallyCustom = process.argv[4] === "custom";
  const work = mkdtempSync(path.join(tmpdir(), "codex-backend-ui-"));
  const profile = path.join(work, "profile"), home = path.join(work, "home"), bundle = path.join(work, "package");
  for (const directory of [profile, home, path.join(bundle, "bin")]) mkdirSync(directory, { recursive: true });
  app.setName("Codex backend settings acceptance");
  app.setPath("userData", profile);
  app.disableHardwareAcceleration();
  const codex = path.resolve(root, "../codex-rs/target/debug/codex.exe");
  const host = path.join(path.dirname(codex), "codex-code-mode-host.exe");
  const archive = process.argv[2] || path.join(work, "backend.tar.gz");
  if (!process.argv[2]) {
    copyFileSync(codex, path.join(bundle, "bin/codex.exe"));
    copyFileSync(host, path.join(bundle, "bin/codex-code-mode-host.exe"));
    execFileSync("tar", ["-czf", archive, "-C", bundle, "bin"], { windowsHide: true });
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const digest = hash.digest("hex");
  let picked = { canceled: true, filePaths: [] };
  let pickerCalls = 0;
  dialog.showOpenDialog = async (_window, options) => {
    assert.deepEqual(options.properties, ["openFile"]);
    assert.ok(options.filters.some((filter) => filter.extensions.includes("gz")));
    pickerCalls++;
    return picked;
  };
  let releaseAvailable = false;
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === "https://api.github.com/repos/sseymdoc/codex/releases/latest") return releaseAvailable
      ? Response.json({ tag_name: "backend-fixture", assets: [{ name: "codex-package-x86_64-pc-windows-msvc.tar.gz", digest: `sha256:${digest}`, browser_download_url: "https://github.com/sseymdoc/codex/releases/download/backend-fixture/codex-package-x86_64-pc-windows-msvc.tar.gz" }] })
      : new Response("", { status: 404 });
    if (String(url).startsWith("https://github.com/sseymdoc/codex/releases/download/backend-fixture/")) return new Response(Readable.toWeb(createReadStream(archive)));
    return fetch(url, options);
  };
  writeFileSync(path.join(profile, "window-state.json"), JSON.stringify({ backendChannel: initiallyCustom ? "custom" : "disabled", menuBar: false, quickEntry: false, keepAwake: false, theme: "light", bounds: { width: 1300, height: 900, x: 50, y: 50 } }));
  process.env.CODEX_HOME = home;
  process.env.CODEX_BIN = codex;
  process.env.INIT_CWD = work;
  let win, server;
  const errors = [];
  app.on("browser-window-created", (_event, window) => {
    if (win) return;
    win = window;
    win.webContents.on("console-message", (event) => { if (event.level === "error") errors.push(event.message); });
  });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(test, label) {
    for (let i = 0; i < 1500; i++) { if (await test()) return; await sleep(40); }
    throw new Error("Condition failed: " + label);
  }
  const timeout = setTimeout(() => { console.error("BACKEND_UI_TIMEOUT", work); app.exit(2); }, 150000);
  try {
    server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(path.join(home, "config.toml"), `model="gpt-5.1"\nmodel_provider="backend_fixture"\nsandbox_mode="read-only"\napproval_policy="never"\n[windows]\nsandbox="unelevated"\n[model_providers.backend_fixture]\nname="Backend UI fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`);
    if (initiallyCustom) {
      const { createBackendManager } = await import("../server/backend.mjs");
      const manager = createBackendManager({ root: path.join(profile, "backends") });
      await manager.installCustom(archive);
      manager.close();
    }
    await import(process.argv[3] ? pathToFileURL(process.argv[3]).href : "./main.mjs");
    const js = (code) => win.webContents.executeJavaScript(code);
    await until(() => win && !win.webContents.isLoading(), "UI loaded");
    await until(() => js("!!document.querySelector('textarea')"), "application ready");
    win.webContents.send("menu-command", "settings");
    await until(() => js("!!document.querySelector('.settings-nav')"), "settings open");
    await js("Array.from(document.querySelectorAll('.settings-nav button')).find(e=>e.textContent.includes('实验性功能')).click()");
    const row = "document.getElementById('setting-labs-experimental-backend')";
    await until(() => js(`!!${row}?.querySelector('[role=radio]')`), "backend control ready");
    assert.deepEqual(await js(`Array.from(${row}.querySelectorAll('[role=radio]'),e=>e.textContent)`), ["禁用", "Release", "Preview", "自定义"]);
    if (initiallyCustom) {
      assert.equal(await js(`${row}.querySelector('[aria-checked=true]').textContent`), "自定义");
      const state = await js("window.codexDesktop.getBackendState()");
      assert.equal(state.restartNeeded, false);
      assert.equal(state.packageName, path.basename(archive));
      const origin = new URL(win.webContents.getURL()).origin;
      const cookies = await win.webContents.session.cookies.get({ url: origin });
      const abort = new AbortController();
      const stream = await fetch(origin + "/api/events", { headers: { Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }, signal: abort.signal });
      const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      while (!text.includes("\n\n")) text += (await reader.read()).value;
      const hello = JSON.parse(/^data: (.*)$/m.exec(text)[1]);
      const installed = JSON.parse(readFileSync(path.join(profile, "backends/custom.json"), "utf8"));
      assert.ok(hello.command.includes(installed.directory));
      assert.equal(typeof hello.prewarmed, "boolean", "custom startup must enable the runtime experimental gate");
      abort.abort();
      await reader.cancel().catch(() => {});
      await sleep(150);
      writeFileSync(path.join(work, "custom-startup.png"), (await win.webContents.capturePage()).toPNG());
      assert.deepEqual(errors, []);
      const result = { ok: true, work, customStartup: true, realArchiveAndExecutable: true, runtimeGateEnabled: true, consoleErrors: 0 };
      writeFileSync(path.join(work, "verification.json"), JSON.stringify(result, null, 2));
      console.log("BACKEND_CUSTOM_STARTUP " + JSON.stringify(result));
      clearTimeout(timeout); server.close(); app.quit();
      return;
    }
    assert.equal(await js(`${row}.querySelector('[aria-checked=true]').textContent`), "禁用");
    assert.equal(await js(`${row}.querySelectorAll('[role=switch]').length`), 0);
    await js(`${row}.querySelectorAll('[role=radio]')[1].click()`);
    await until(() => js(`${row}.textContent.includes('尚未发布 Release') && ${row}.querySelector('[aria-checked=true]').textContent==='禁用'`), "missing Release leaves channel disabled");
    releaseAvailable = true;
    await js(`${row}.querySelectorAll('[role=radio]')[1].click()`);
    await until(() => js(`${row}.textContent.includes('Release 已安装')`), "verified archive installed");
    assert.equal(await js("window.codexDesktop.getDesktopSettings().then(s=>s.backendChannel)"), "release");
    assert.ok(await js(`${row}.textContent.includes('重启应用')`));
    const installed = JSON.parse(readFileSync(path.join(profile, "backends/release.json"), "utf8"));
    assert.equal(installed.sha256, digest);
    await js(`${row}.querySelectorAll('[role=radio]')[3].click()`);
    await until(() => js(`${row}.querySelector('[aria-checked=true]').textContent==='Release' && !${row}.querySelector('[role=radio]').disabled`), "cancelled picker restores Release");
    assert.equal(pickerCalls, 1);
    picked = { canceled: false, filePaths: [archive] };
    await js(`${row}.querySelectorAll('[role=radio]')[3].click()`);
    await until(() => js(`${row}.textContent.includes('自定义后端已安装') && !${row}.querySelector('[role=radio]').disabled`), "local archive imported");
    assert.equal(await js("window.codexDesktop.getDesktopSettings().then(s=>s.backendChannel)"), "custom");
    const customFile = path.join(profile, "backends/custom.json");
    const imported = readFileSync(customFile, "utf8");
    assert.equal(JSON.parse(imported).sha256, digest);
    assert.equal(JSON.parse(imported).packageName, path.basename(archive));
    assert.ok(await js(`${row}.textContent.includes('重启应用')`));
    picked = { canceled: true, filePaths: [] };
    await js(`Array.from(${row}.querySelectorAll('button')).find(e=>e.textContent==='选择其他后端包').click()`);
    await until(() => pickerCalls === 3 && js(`!${row}.querySelector('[role=radio]').disabled`), "cancelled replacement settles");
    assert.equal(readFileSync(customFile, "utf8"), imported);
    const broken = path.join(work, "broken.tar.gz");
    writeFileSync(broken, "not a gzip archive");
    picked = { canceled: false, filePaths: [broken] };
    await js(`Array.from(${row}.querySelectorAll('button')).find(e=>e.textContent==='选择其他后端包').click()`);
    await until(() => js(`${row}.textContent.includes('执行失败') && !${row}.querySelector('[role=radio]').disabled`), "failed replacement preserves custom");
    assert.equal(readFileSync(customFile, "utf8"), imported);
    assert.equal(await js("window.codexDesktop.getDesktopSettings().then(s=>s.backendChannel)"), "custom");
    picked = { canceled: false, filePaths: [archive] };
    await js(`Array.from(${row}.querySelectorAll('button')).find(e=>e.textContent==='选择其他后端包').click()`);
    await until(() => js(`${row}.textContent.includes('自定义后端已安装') && !${row}.querySelector('[role=radio]').disabled`), "valid replacement installed");
    assert.notEqual(JSON.parse(readFileSync(customFile, "utf8")).directory, JSON.parse(imported).directory);
    await js("document.querySelectorAll('.toast-close').forEach(button=>button.click())");
    await sleep(150);
    writeFileSync(path.join(work, "custom-light.png"), (await win.webContents.capturePage()).toPNG());

    const originalPath = process.env.PATH;
    process.env.PATH = ""; // Fail the compiler preflight instead of starting a real long build in this UI fixture.
    await js(`${row}.querySelectorAll('[role=radio]')[2].click()`);
    await until(() => js(`${row}.textContent.includes('Preview 编译失败')`), "build failure keeps Release");
    process.env.PATH = originalPath;
    assert.equal(await js("window.codexDesktop.getBackendState().then(s=>s.channel)"), "preview");
    await js(`${row}.querySelectorAll('[role=radio]')[2].focus()`);
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Left" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Left" });
    await until(() => js(`${row}.querySelector('[aria-checked=true]').textContent==='Release'`), "left arrow selects Release");
    const lightText = await js("getComputedStyle(document.documentElement).getPropertyValue('--cds-text-primary')");
    await js("document.documentElement.classList.add('dark')");
    await sleep(250);
    assert.notEqual(await js("getComputedStyle(document.documentElement).getPropertyValue('--cds-text-primary')"), lightText);
    writeFileSync(path.join(work, "release-dark.png"), (await win.webContents.capturePage()).toPNG());
    win.setMinimumSize(600, 400);
    win.setContentSize(680, 700);
    await sleep(250);
    assert.ok(await js(`(()=>{const b=${row}.querySelector('[role=radiogroup]').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth})()`), "four-way control stays inside the narrow window");
    writeFileSync(path.join(work, "release-narrow.png"), (await win.webContents.capturePage()).toPNG());
    await js(`${row}.querySelectorAll('[role=radio]')[0].click()`);
    await until(() => js("(async()=> (await window.codexDesktop.getDesktopSettings()).backendChannel==='disabled')()"), "disable persists");
    assert.deepEqual(errors, []);
    const result = { ok: true, work, realArchiveAndExecutable: true, githubFixture: true, customImport: true, customReplacement: true, cancelledPicker: true, pickerFixture: true, previewBuildFixture: "real missing-tool preflight", keyboard: true, themes: ["light", "dark"], narrowWidth: 680, consoleErrors: 0 };
    writeFileSync(path.join(work, "verification.json"), JSON.stringify(result, null, 2));
    console.log("BACKEND_SETTINGS_UI " + JSON.stringify(result));
    clearTimeout(timeout); server.close(); app.quit();
  } catch (error) {
    console.error(error.stack, errors, work);
    if (win && !win.isDestroyed()) writeFileSync(path.join(work, "failure.png"), (await win.webContents.capturePage()).toPNG());
    clearTimeout(timeout); server?.close(); app.exit(1);
  }
}
void smoke().catch((error) => { console.error(error.stack); app.exit(1); });
