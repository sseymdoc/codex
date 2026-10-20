// Run with Node: launches two isolated Electron processes to verify real cookie persistence.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.versions.electron) {
  const work = mkdtempSync(path.join(tmpdir(), "codex-browser-storage-"));
  mkdirSync(path.join(work, "profile"));
  const executable = createRequire(import.meta.url)("electron");
  for (const phase of ["write", "read"]) {
    const result = spawnSync(executable, [fileURLToPath(import.meta.url), phase, work], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  console.log(
    "BROWSER_STORAGE_SMOKE " +
      JSON.stringify({
        ok: true,
        work,
        checks: [
          "temporary cookies vanish after process restart",
          "shared cookies survive restart",
          "per-thread cookies survive and remain isolated",
          "clear data works without open tabs",
        ],
      }),
  );
} else {
  const { app, BrowserWindow } = await import("electron");
  const { createDesktopBrowser } = await import("./browser.mjs");
  const [, , phase, work] = process.argv;
  app.setPath("userData", path.join(work, "profile"));
  app.setName("codex-browser-storage-test");
  app.disableHardwareAcceleration();
  let win, browser;
  const timer = setTimeout(() => app.exit(2), 25000);
  async function run() {
    try {
      await app.whenReady();
      win = new BrowserWindow({ show: false });
      let config = {};
      Object.defineProperty(config, "archive", {
        get() {
          throw new Error("Legacy archive path must never be read");
        },
      });
      browser = createDesktopBrowser({
        getWindow: () => win,
        getSettings: () => config,
        saveSettings: (patch) => Object.assign(config, patch),
        isOwnOrigin: () => false,
        emit() {},
        confirm: async () => 1,
      });
      const open = async (view) => {
        await browser.request({ view, cwd: work, action: "new" });
        return win.contentView.children.at(-1).webContents.session;
      };
      const cookie = {
        url: "https://cookie-fixture.invalid",
        name: "acceptance",
        value: "saved",
        expirationDate: Date.now() / 1000 + 3600,
      };
      const count = async (jar) => (await jar.cookies.get({ name: cookie.name })).length;
      const save = async (jar) => {
        await jar.cookies.set(cookie);
        await jar.cookies.flushStore();
      };
      const temporary = await open("temporary-a");
      assert.equal(await count(temporary), 0);
      if (phase === "write") {
        await save(temporary);
        assert.equal(await count(await open("temporary-b")), 0);
      }
      await browser.request({ view: "temporary-a", cwd: work, action: "settings", storage: "shared" });
      const shared = await open("shared-a");
      if (phase === "write") await save(shared);
      assert.equal(await count(await open("shared-b")), 1);
      if (phase === "read") {
        for (const view of ["shared-a", "shared-b"])
          for (const tab of browser.snapshot(view).tabs) await browser.request({ view, cwd: work, action: "close", tabId: tab.id });
        await browser.request({ view: "shared-a", cwd: work, action: "clearData" });
        assert.equal(await count(await open("shared-a")), 0);
      }
      await browser.request({ view: "shared-a", cwd: work, action: "settings", storage: "session" });
      const isolated = await open("isolated-a");
      if (phase === "write") await save(isolated);
      assert.equal(await count(isolated), 1);
      assert.equal(await count(await open("isolated-b")), 0);
      console.log("COOKIE_PHASE " + phase + " passed");
    } catch (error) {
      console.error(error.stack);
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
      await browser?.close();
      win?.destroy();
      app.exit(process.exitCode ?? 0);
    }
  }
  void run();
}
