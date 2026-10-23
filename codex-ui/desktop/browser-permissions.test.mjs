// Run with Electron: real pages, site cards and a disposable browser profile.
import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDesktopBrowser } from "./browser.mjs";
import { isBrowserServiceUrl } from "../server/browser-policy.mjs";
const legacyContext = JSON.parse(readFileSync(new URL("../context/fixtures/legacy.json", import.meta.url), "utf8"));

const work = mkdtempSync(path.join(tmpdir(), "codex-browser-permissions-"));
app.setPath("userData", work);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-proxy-server");
app.commandLine.appendSwitch("host-resolver-rules", "MAP *.browser.test 127.0.0.1");
let browser, win, server;
const timer = setTimeout(() => app.exit(2), 60000);
const waitFor = async (test) => {
  for (let i = 0; i < 200; i++) {
    const value = test();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for site approval");
};
async function run() {
  try {
    await app.whenReady();
    server = http.createServer((req, res) => res.end('<title>permission fixture</title><h1>real page</h1><input id="name">'));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port, local = `http://127.0.0.1:${port}`;
    const external = `http://external.browser.test:${port}`, other = `http://other.browser.test:${port}`;
    win = new BrowserWindow({ show: false });
    const settingsFile = path.join(work, "browser.json");
    let config = {}, enabled = false, failSave = false;
    const events = [];
    const create = () => createDesktopBrowser({
      getWindow: () => win, getSettings: () => config,
      saveSettings: (patch) => { if (failSave) throw new Error("fixture save failed"); const next = { ...config, ...patch }; writeFileSync(settingsFile, JSON.stringify(next)); config = next; },
      isOwnOrigin: (raw) => isBrowserServiceUrl(raw, "http://127.0.0.1:7478"),
      isExperimentalBackend: () => enabled, emit: (event) => events.push(event),
    });
    browser = create();
    const ctx = { view: "permissions", cwd: work };
    const tool = (name, args = {}, context = ctx) => browser.tool(context, name, args);
    const request = (action, args = {}, context = ctx) => browser.request({ ...context, action, ...args });
    const approval = () => waitFor(() => browser.snapshot(ctx.view).approvals[0]);
    const choose = async (decision) => request("approve", { id: (await approval()).id, decision });
    mkdirSync(path.join(work, ".codex"));
    writeFileSync(path.join(work, ".codex", "launch.json"), JSON.stringify({ autoVerify: true, configurations: [] }));
    assert.equal(browser.verificationInstructions(work), "");
    for (const name of ["tabs_context", "preview_start", "preview_eval"])
      await assert.rejects(tool(name, { url: local }), /实验型后端/);
    await request("new", { url: local });
    assert.equal(browser.snapshot(ctx.view).tabs.length, 1, "manual browsing still works with the backend disabled");
    enabled = true;
    assert.equal(browser.verificationInstructions(work), legacyContext.browser);
    writeFileSync(path.join(work, ".codex", "launch.json"), JSON.stringify({ autoVerify: false, configurations: [] }));
    assert.equal(browser.verificationInstructions(work), "");
    writeFileSync(path.join(work, ".codex", "launch.json"), "invalid JSON");
    assert.equal(browser.verificationInstructions(work), "");
    writeFileSync(path.join(work, ".codex", "launch.json"), JSON.stringify({ autoVerify: true, configurations: [] }));
    for (const url of [local, local.replace("127.0.0.1", "localhost"), local.replace("127.0.0.1", "app.localhost")])
      await tool("tabs_create", { url });
    await tool("preview_snapshot");
    assert.equal(events.some((event) => event.approvals?.length), false, "local previews never request site permission");
    for (const url of ["http://app.localhost:7478/api/events", "http://[::ffff:127.0.0.1]:7478/api/events"])
      await assert.rejects(tool("tabs_create", { url }), /内部服务/);

    let pending = tool("tabs_create", { url: external });
    assert.equal((await approval()).origin, external);
    await choose(2);
    await pending;
    await tool("preview_snapshot");
    await tool("tabs_create", { url: external }, { view: "another-thread", cwd: work });
    assert.deepEqual(config.allowedOrigins, [external]);
    await request("settings", { openLinks: true });
    assert.ok(events.some((event) => event.view === "another-thread" && event.settings.openLinks), "global settings update every session snapshot");
    await browser.close();
    config = JSON.parse(readFileSync(settingsFile, "utf8"));
    browser = create();
    await tool("tabs_create", { url: external });
    assert.equal(browser.snapshot(ctx.view).approvals.length, 0, "saved approval survives browser recreation");
    await request("settings", { removeOrigin: external });
    pending = tool("preview_snapshot");
    await choose(1);
    assert.match((await pending).content[0].text, /real page/);
    pending = tool("preview_snapshot");
    assert.equal((await approval()).origin, external, "allow once must not become a session-wide grant");
    const rejected = assert.rejects(pending, /拒绝/);
    await choose(0);
    await rejected;

    await request("new", { url: other });
    pending = tool("preview_snapshot");
    assert.equal((await approval()).origin, other, "manual navigation does not grant model access");
    await choose(2);
    await pending;
    const before = browser.snapshot(ctx.view).tabs.length;
    const cancel = new AbortController();
    pending = tool("tabs_create", { url: `http://cancel.browser.test:${port}` }, { ...ctx, signal: cancel.signal });
    const cancelled = assert.rejects(pending, /cancelled/);
    const stale = await approval();
    cancel.abort();
    await cancelled;
    assert.equal(browser.snapshot(ctx.view).approvals.length, 0);
    assert.equal(browser.snapshot(ctx.view).tabs.length, before, "cancelled approval must not leave an orphan tab");
    await assert.rejects(request("approve", { id: stale.id, decision: 2 }), /失效/);
    assert.equal(config.allowedOrigins.includes(stale.origin), false);

    failSave = true;
    pending = tool("tabs_create", { url: `http://save-error.browser.test:${port}` });
    const failedSave = assert.rejects(pending, /fixture save failed/);
    await choose(2);
    await failedSave;
    assert.equal(config.allowedOrigins.some((origin) => origin.includes("save-error")), false);
    assert.equal(browser.snapshot(ctx.view).tabs.length, before, "failed persistence must not grant access or create a tab");
    failSave = false;

    pending = tool("tabs_create", { url: `http://disabled.browser.test:${port}` });
    const disabled = assert.rejects(pending, /拒绝/);
    await approval();
    await request("settings", { enabled: false });
    await disabled;
    assert.equal(browser.verificationInstructions(work), "");
    await assert.rejects(tool("tabs_context"), /已关闭/);
    await request("settings", { enabled: true, addOrigin: "https://saved.browser.test/path" });
    assert.ok(config.allowedOrigins.includes("https://saved.browser.test"));
    await request("settings", { clearOrigins: true });
    assert.deepEqual(config.allowedOrigins, []);
    console.log("BROWSER_PERMISSIONS_SMOKE " + JSON.stringify({ ok: true, work, checks: ["local preview aliases", "internal service isolation", "in-app site cards", "persistent grants", "allow once", "manual navigation", "revocation", "cancelled approvals", "no orphan tabs", "backend gate", "automatic verification gate", "save failure", "cross-session settings"] }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally {
    clearTimeout(timer);
    await browser?.close();
    win?.destroy();
    server?.closeAllConnections(); server?.close();
    app.exit(process.exitCode ?? 0);
  }
}
void run();
