import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { backendChannel, backendTarget, createBackendManager } from "./backend.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const target = "x86_64-pc-windows-msvc";
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "codex-backend-"));
  const calls = [], events = [];
  let bytes = Buffer.from("verified release archive");
  let extraction = "bin/codex.exe\nbin/codex-code-mode-host.exe";
  let listing = "-rwxr-xr-x codex.exe\n-rwxr-xr-x codex-code-mode-host.exe";
  let badDigest = false, missingRelease = false, failBuild = false, commit = "a".repeat(40);
  let buildGate, cloneGate, downloadGate, versionGate, manifest, withoutHost = false;
  const archive = path.join(root, "local-backend.tar.gz");
  writeFileSync(archive, "local package");
  const place = (directory, name) => { mkdirSync(path.join(directory, "bin"), { recursive: true }); writeFileSync(path.join(directory, "bin", name), "fixture"); };
  const installed = (channel) => {
    const directory = `${channel}-Fixture`;
    for (const name of ["codex.exe", "codex-code-mode-host.exe"]) place(path.join(root, directory), name);
    writeFileSync(path.join(root, `${channel}.json`), JSON.stringify({ directory }));
    return path.join(root, directory, "bin", "codex.exe");
  };
  const fetch = async (url, options) => {
    calls.push({ url });
    if (url.endsWith("releases/latest")) return missingRelease ? new Response("", { status: 404 }) : Response.json({ tag_name: "backend-v1", assets: [{ name: `codex-package-${target}.tar.gz`, digest: "sha256:" + (badDigest ? "0".repeat(64) : digest(bytes)), browser_download_url: `https://github.com/sseymdoc/codex/releases/download/backend-v1/codex-package-${target}.tar.gz` }] });
    if (url.includes("sseymdoc/codex/releases/download/")) { if (downloadGate) await downloadGate(options.signal); return new Response(bytes); }
    if (url.endsWith(".sha256")) return new Response(checksums);
    if (url.includes("BurntSushi/ripgrep")) return new Response("rg-fixture");
    return new Response("v8-fixture");
  };
  const checksums = `${digest("v8-fixture")}  rusty_v8_ptrcomp_sandbox_release_${target}.lib.gz\n${digest("v8-fixture")}  src_binding_ptrcomp_sandbox_release_${target}.rs\n`;
  let rgDigest = digest("rg-fixture");
  const rg = () => ({ "windows-x86_64": { digest: rgDigest, format: "zip", path: "ripgrep-15.2.0-x86_64-pc-windows-msvc/rg.exe", providers: [{ url: "https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip" }] } });
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    options.signal.throwIfAborted();
    if (command === "tar") {
      if (args[0] === "-tzf") return extraction;
      if (args[0] === "-tvzf") return listing;
      if (args[0] === "-xzf") {
        for (const name of withoutHost ? ["codex.exe"] : ["codex.exe", "codex-code-mode-host.exe"]) place(options.cwd, name);
        if (manifest) writeFileSync(path.join(options.cwd, "codex-backend.json"), JSON.stringify(manifest));
      }
      if (args[0] === "-xf") { mkdirSync(path.join(args[3], path.dirname(args[4])), { recursive: true }); writeFileSync(path.join(args[3], args[4]), "rg fixture"); }
    }
    if (command === "git" && args[0] === "clone") {
      const source = args.at(-1);
      mkdirSync(path.join(source, ".git"), { recursive: true });
      mkdirSync(path.join(source, "codex-rs"));
      mkdirSync(path.join(source, "third_party/v8"), { recursive: true });
      writeFileSync(path.join(source, "codex-rs/Cargo.lock"), '[[package]]\nname = "v8"\nversion = "152.2.0"\n');
      writeFileSync(path.join(source, "third_party/v8/rusty_v8_152_2_0_release_manifests.sha256"), `${digest(checksums)}  rusty_v8_ptrcomp_sandbox_release_${target}.sha256\n`);
      mkdirSync(path.join(source, "scripts/codex_package"), { recursive: true });
      writeFileSync(path.join(source, "scripts/codex_package/rg"), `#!/usr/bin/env dotslash\n\n${JSON.stringify({ name: "rg", platforms: rg() })}\n`);
      if (cloneGate) await cloneGate(options.signal);
    }
    if (command === "git" && args[0] === "rev-parse") return commit;
    if (command === "cargo" && args[0] === "build") {
      if (failBuild) throw new Error("compiler unavailable");
      if (buildGate) await buildGate(options.signal);
      const output = path.join(options.env.CARGO_TARGET_DIR, target, "release");
      mkdirSync(output, { recursive: true });
      for (const name of ["codex", "codex-code-mode-host", "codex-command-runner", "codex-windows-sandbox-setup", "codex-windows-sandbox-service", "codex-windows-managed-deny-probe"]) writeFileSync(path.join(output, name + ".exe"), "preview fixture");
    }
    if (command.endsWith("codex.exe") && args[0] === "--version" && versionGate) await versionGate(options.signal);
    return "fixture";
  };
  const manager = (channel) => createBackendManager({ root, channel, env: { CODEX_BIN: "original.exe" }, platform: "win32", arch: "x64", fetch, run, onChange: (state) => events.push(state) });
  return { root, calls, events, installed, manager, archive, set manifest(value) { manifest = value; }, set withoutHost(value) { withoutHost = value; }, set versionGate(value) { versionGate = value; }, set badDigest(value) { badDigest = value; }, set missingRelease(value) { missingRelease = value; }, set extraction(value) { extraction = value; }, set listing(value) { listing = value; }, set failBuild(value) { failBuild = value; }, set buildGate(value) { buildGate = value; }, set cloneGate(value) { cloneGate = value; }, set rgDigest(value) { rgDigest = value; }, set releaseBytes(value) { bytes = Buffer.from(value); }, set commit(value) { commit = value; }, set downloadGate(value) { downloadGate = value; } };
}
async function until(test) {
  for (let i = 0; i < 100; i++) { if (test()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error("Backend state did not settle");
}

test("new profiles and the old boolean switch default to disabled", () => {
  for (const value of [undefined, true, false, "true", "invalid"]) assert.equal(backendChannel(value), "disabled");
  assert.equal(backendChannel("preview"), "preview");
  assert.equal(backendTarget("win32", "x64"), target);
  assert.throws(() => backendTarget("win32", "ia32"));
  const f = fixture(), manager = f.manager();
  assert.deepEqual(manager.startup(), { codex: "original.exe", channel: "disabled" });
  assert.equal(f.calls.length, 0);
});

test("Release installs a verified complete package once and switches after restart", async () => {
  const f = fixture(), manager = f.manager();
  await manager.select("release");
  assert.equal(manager.status().restartNeeded, true);
  assert.equal(manager.startup().codex, "original.exe");
  const restarted = f.manager("release");
  assert.match(restarted.startup().codex, /release-.*[\\/]bin[\\/]codex.exe$/);
  assert.equal(restarted.status().restartNeeded, false);
  const count = f.calls.length;
  await restarted.select("release");
  assert.equal(f.calls.length, count);
  await restarted.select("disabled");
  assert.equal(restarted.status().restartNeeded, true);
  assert.equal(f.manager("disabled").startup().codex, "original.exe");
});

test("missing or tampered Release never replaces the original backend", async () => {
  for (const setting of ["missingRelease", "badDigest"]) {
    const f = fixture(); f[setting] = true;
    const manager = f.manager();
    await assert.rejects(manager.select("release"), setting === "missingRelease" ? /尚未发布 Release/ : /SHA-256/);
    assert.equal(manager.status().channel, "disabled");
    assert.equal(manager.startup().codex, "original.exe");
    assert.equal(existsSync(path.join(f.root, "release.json")), false);
  }
});

test("archive traversal and links are rejected before extraction", async () => {
  for (const setting of ["extraction", "listing"]) {
    const f = fixture(); f[setting] = setting === "extraction" ? "../../outside.exe" : "lrwxrwxrwx outside -> ../../";
    await assert.rejects(f.manager().select("release"), /路径|链接/);
    assert.equal(f.calls.some((call) => call.args?.[0] === "-xzf"), false);
  }
});

test("Preview bootstraps with Release, then builds pinned latest source and matching helpers", async () => {
  const f = fixture();
  let finishBuild;
  f.buildGate = () => new Promise((resolve) => { finishBuild = resolve; });
  const manager = f.manager();
  await manager.select("preview");
  await until(() => finishBuild);
  const interim = f.manager("preview");
  assert.match(interim.startup().codex, /release-/);
  const build = f.calls.find((call) => call.command === "cargo" && call.args[0] === "build");
  assert.ok(build.args.includes("--release") && build.args.includes("--locked"));
  assert.ok(build.args.includes("codex-code-mode-host") && build.args.includes("codex-windows-sandbox"));
  assert.ok(build.options.env.RUSTY_V8_ARCHIVE.endsWith(".lib.gz"));
  finishBuild();
  await until(() => manager.status().phase === "ready");
  assert.match(f.manager("preview").startup().codex, /preview-/);
  const manifest = JSON.parse(readFileSync(path.join(f.root, "preview.json"), "utf8"));
  assert.equal(manifest.commit, "a".repeat(40));
  assert.equal(existsSync(path.join(f.root, manifest.directory, "bin", "codex-command-runner.exe")), true);
  // ripgrep comes from the source's pinned manifest, digest-checked, into codex-path as officially.
  assert.equal(readFileSync(path.join(f.root, manifest.directory, "codex-path", "rg.exe"), "utf8"), "rg fixture");
  assert.ok(f.calls.some((call) => call.url?.endsWith("/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip")));
});

test("a tampered ripgrep download fails Preview before compiling and keeps Release", async () => {
  const f = fixture(); f.installed("release"); f.rgDigest = "0".repeat(64);
  const manager = f.manager();
  await manager.select("preview");
  await until(() => manager.status().phase === "error");
  assert.match(manager.status().message, /SHA-256/);
  assert.equal(f.calls.some((call) => call.command === "cargo" && call.args[0] === "build"), false);
  assert.match(f.manager("preview").startup().codex, /release-/);
});

test("failed Preview preserves Release and reports a recoverable error", async () => {
  const f = fixture(); f.failBuild = true;
  const manager = f.manager();
  await manager.select("preview");
  await until(() => manager.status().phase === "error");
  assert.match(manager.status().message, /已保留 Release/);
  assert.match(f.manager("preview").startup().codex, /release-/);
});

test("a missing installed binary turns the channel off at startup", () => {
  const f = fixture();
  writeFileSync(path.join(f.root, "release.json"), JSON.stringify({ directory: "release-missing" }));
  assert.deepEqual(f.manager("release").startup(), { codex: "original.exe", channel: "disabled" });
  writeFileSync(path.join(f.root, "release.json"), JSON.stringify({ directory: "../../outside" }));
  assert.equal(f.manager("release").startup().channel, "disabled");
});

test("disabling Preview cancels compilation without publishing a partial binary", async () => {
  const f = fixture();
  f.installed("release");
  let compiling = false;
  f.buildGate = (signal) => new Promise((_, reject) => { compiling = true; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  const manager = f.manager();
  await manager.select("preview");
  await until(() => compiling);
  await manager.select("disabled");
  assert.equal(manager.status().channel, "disabled");
  assert.equal(existsSync(path.join(f.root, "preview.json")), false);
});

test("an interrupted first clone can be retried without reusing an incomplete checkout", async () => {
  const f = fixture(); f.installed("release");
  let cloning = false;
  f.cloneGate = (signal) => new Promise((_, reject) => { cloning = true; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  const manager = f.manager();
  await manager.select("preview");
  await until(() => cloning);
  await manager.select("disabled");
  assert.equal(existsSync(path.join(f.root, "source")), false);
  f.cloneGate = undefined;
  await manager.select("preview");
  await until(() => manager.status().phase === "ready");
  assert.match(f.manager("preview").startup().codex, /preview-/);
  assert.equal(f.calls.filter((call) => call.command === "git" && call.args[0] === "clone").length, 2);
});

test("Release startup silently prepares an update for the next restart", async (t) => {
  const f = fixture(), original = f.installed("release"), manager = f.manager("release");
  t.after(() => manager.close());
  const before = manager.status();
  await manager.resume();
  const record = JSON.parse(readFileSync(path.join(f.root, "release.json"), "utf8"));
  assert.notEqual(record.directory, "release-Fixture");
  assert.equal(record.sha256, digest("verified release archive"));
  assert.equal(manager.startup().codex, original);
  assert.deepEqual(manager.status(), before);
  assert.deepEqual(f.events, []);
  assert.equal(existsSync(path.join(f.root, "preview-build.log")), false);
  assert.ok(f.calls.filter((call) => call.command).every((call) => call.options.log === undefined));
  assert.equal(f.calls.some((call) => call.command === "cargo" || call.command === "git"), false);
  assert.notEqual(f.manager("release").startup().codex, original);
  assert.equal(existsSync(original), true);
});

test("Release checks metadata without downloading an unchanged package", async (t) => {
  const f = fixture();
  f.installed("release");
  const file = path.join(f.root, "release.json");
  const record = { directory: "release-Fixture", tag: "backend-v1", sha256: digest("verified release archive") };
  writeFileSync(file, JSON.stringify(record));
  const manager = f.manager("release");
  t.after(() => manager.close());
  await manager.resume();
  assert.deepEqual(f.calls.map((call) => call.url), ["https://api.github.com/repos/sseymdoc/codex/releases/latest"]);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), record);
  assert.deepEqual(f.events, []);
});

test("failed automatic Release updates silently preserve the installed package", async (t) => {
  for (const setting of ["missingRelease", "badDigest", "extraction", "listing"]) {
    const f = fixture(), original = f.installed("release"), manager = f.manager("release");
    t.after(() => manager.close());
    f[setting] = setting === "extraction" ? "../../outside.exe" : setting === "listing" ? "lrwxrwxrwx outside -> ../../" : true;
    const before = manager.status(), record = readFileSync(path.join(f.root, "release.json"), "utf8");
    await manager.resume();
    assert.ok(f.calls.length > 0);
    assert.equal(readFileSync(path.join(f.root, "release.json"), "utf8"), record);
    assert.equal(manager.startup().codex, original);
    assert.deepEqual(manager.status(), before);
    assert.deepEqual(f.events, []);
  }
});

test("Release checks again after six hours and stops after close", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(); f.installed("release");
  const manager = f.manager("release");
  t.after(() => manager.close());
  await manager.resume();
  f.releaseBytes = "next verified archive";
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await until(() => JSON.parse(readFileSync(path.join(f.root, "release.json"), "utf8")).sha256 === digest("next verified archive"));
  assert.equal(f.calls.filter((call) => call.url?.endsWith("releases/latest")).length, 2);
  assert.deepEqual(f.events, []);
  manager.close();
  const count = f.calls.length;
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await manager.resume();
  assert.equal(f.calls.length, count);
});

test("disabled and installed Preview never schedule or directly request Release updates", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const channel of ["disabled", "preview"]) {
    const f = fixture(); f.installed("release"); f.installed("preview");
    const manager = f.manager(channel);
    t.after(() => manager.close());
    await manager.resume();
    t.mock.timers.tick(6 * 60 * 60 * 1000);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.events, []);
  }
});

test("leaving Release cancels a silent download without publishing it", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  for (const channel of ["disabled", "preview"]) {
    const f = fixture(); f.installed("release"); f.installed("preview");
    let downloading = false;
    f.downloadGate = (signal) => new Promise((_, reject) => { downloading = true; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
    const manager = f.manager("release"), record = readFileSync(path.join(f.root, "release.json"), "utf8");
    t.after(() => manager.close());
    const pending = manager.resume();
    await until(() => downloading);
    await manager.select(channel);
    await pending;
    assert.equal(readFileSync(path.join(f.root, "release.json"), "utf8"), record);
    const count = f.calls.length;
    t.mock.timers.tick(6 * 60 * 60 * 1000);
    await manager.resume();
    assert.equal(f.calls.length, count);
  }
});

test("overlapping checks share one download and close cancels it", async (t) => {
  const f = fixture(); f.installed("release");
  let downloading = false;
  f.downloadGate = (signal) => new Promise((_, reject) => { downloading = true; signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  const manager = f.manager("release"), record = readFileSync(path.join(f.root, "release.json"), "utf8");
  t.after(() => manager.close());
  const first = manager.resume(), second = manager.resume();
  await until(() => downloading);
  assert.equal(f.calls.filter((call) => call.url?.endsWith("releases/latest")).length, 1);
  manager.close();
  await Promise.all([first, second]);
  await manager.resume();
  assert.equal(readFileSync(path.join(f.root, "release.json"), "utf8"), record);
  assert.deepEqual(f.events, []);
});


test("检查更新 brings Release up to date for the next restart, or says it already is", async (t) => {
  const f = fixture(), original = f.installed("release");
  writeFileSync(path.join(f.root, "release.json"), JSON.stringify({ directory: "release-Fixture", tag: "backend-v1", sha256: digest("verified release archive") }));
  const manager = f.manager("release");
  t.after(() => manager.close());
  await manager.select("release", true);
  assert.deepEqual(f.calls.map((call) => call.url), ["https://api.github.com/repos/sseymdoc/codex/releases/latest"]);
  assert.deepEqual(f.events.map((event) => event.message), ["正在检查 Release 更新…", "Release 已是最新版本。"]);
  assert.equal(manager.status().restartNeeded, false);
  f.releaseBytes = "newer release archive";
  await manager.select("release", true);
  assert.equal(manager.status().restartNeeded, true);
  assert.equal(manager.status().message, "Release 已是最新版本，重启应用后使用。");
  assert.equal(manager.startup().codex, original);
  assert.notEqual(f.manager("release").startup().codex, original);
});

test("检查更新 on Preview pulls the latest source and rebuilds only a new commit", async () => {
  const f = fixture(), first = f.manager();
  await first.select("preview");
  await until(() => first.status().phase === "ready");
  const manager = f.manager("preview");
  const builds = () => f.calls.filter((call) => call.command === "cargo" && call.args[0] === "build").length;
  await manager.select("preview", true);
  await until(() => manager.status().phase === "ready");
  assert.deepEqual(f.calls.filter((call) => call.command === "git" && ["fetch", "reset"].includes(call.args[0])).map((call) => call.args.join(" ")),
    ["fetch --depth 1 origin HEAD", "reset --hard FETCH_HEAD"]);
  assert.equal(builds(), 1);
  assert.equal(manager.status().message, "Preview 已是最新版本。");
  f.commit = "b".repeat(40);
  await manager.select("preview", true);
  await until(() => builds() === 2 && manager.status().phase === "ready");
  assert.equal(manager.status().restartNeeded, true);
  assert.equal(JSON.parse(readFileSync(path.join(f.root, "preview.json"), "utf8")).commit, "b".repeat(40));
});

test("selecting Release starts periodic checks without changing the other channels", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = fixture(), manager = f.manager();
  t.after(() => manager.close());
  await manager.select("release");
  const before = manager.status(), events = f.events.length;
  f.releaseBytes = "updated after selecting Release";
  t.mock.timers.tick(6 * 60 * 60 * 1000);
  await until(() => JSON.parse(readFileSync(path.join(f.root, "release.json"), "utf8")).sha256 === digest("updated after selecting Release"));
  assert.deepEqual(manager.status(), before);
  assert.equal(f.events.length, events);
  assert.equal(manager.startup().codex, "original.exe");
});


test("custom imports a local package without a download and activates only after restart", async () => {
  const f = fixture(), manager = f.manager();
  assert.equal(backendChannel("custom"), "custom");
  await manager.installCustom(f.archive);
  assert.equal(manager.status().channel, "custom");
  assert.equal(manager.status().packageName, "local-backend.tar.gz");
  assert.equal(manager.status().restartNeeded, true);
  assert.equal(manager.startup().codex, "original.exe");
  assert.equal(readFileSync(f.archive, "utf8"), "local package");
  const record = JSON.parse(readFileSync(path.join(f.root, "custom.json"), "utf8"));
  assert.equal(record.sha256, digest("local package"));
  const restarted = f.manager("custom");
  assert.match(restarted.startup().codex, /custom-.*[\\/]bin[\\/]codex.exe$/);
  assert.equal(restarted.status().restartNeeded, false);
  assert.equal(restarted.status().packageName, "local-backend.tar.gz");
  await restarted.resume();
  assert.equal(f.calls.some((call) => call.url), false);
  await restarted.select("disabled");
  assert.equal(f.manager("disabled").startup().codex, "original.exe");
});

test("custom replacement preserves the running version and survives a failed import", async () => {
  const f = fixture();
  const previous = f.installed("custom"), manager = f.manager("custom");
  const before = readFileSync(path.join(f.root, "custom.json"), "utf8");
  f.withoutHost = true;
  await assert.rejects(manager.installCustom(f.archive), /缺少/);
  assert.equal(readFileSync(path.join(f.root, "custom.json"), "utf8"), before);
  assert.equal(manager.status().channel, "custom");
  assert.equal(manager.startup().codex, previous);
  f.withoutHost = false;
  await manager.installCustom(f.archive);
  assert.equal(manager.startup().codex, previous);
  assert.notEqual(f.manager("custom").startup().codex, previous);
});

test("custom rejects unsafe paths and links before extraction", async () => {
  for (const entry of ["../outside", "/", "/absolute", "C:/escape", "bin/../escape", "bin/.. /escape", "bin/file:stream", "bin/CON", "bin/file.", "bin\\escape"]) {
    const f = fixture(); f.extraction = entry;
    await assert.rejects(f.manager().installCustom(f.archive), /不安全/);
    assert.equal(f.calls.some((call) => call.args?.[0] === "-xzf"), false, entry);
  }
  for (const type of ["l", "h", "p"]) {
    const f = fixture(); f.listing = type + "rwxrwxrwx unsafe";
    await assert.rejects(f.manager().installCustom(f.archive), /链接或特殊文件/);
    assert.equal(f.calls.some((call) => call.args?.[0] === "-xzf"), false);
  }
});

test("custom verifies target and manifest digests before executing the package", async () => {
  const valid = () => ({ target, files: ["codex.exe", "codex-code-mode-host.exe"].map((name) => ({ file: "bin/" + name, sha256: digest("fixture") })) });
  for (const failure of ["target", "digest", "missing", "path"]) {
    const f = fixture(), manifest = valid();
    if (failure === "target") manifest.target = "aarch64-apple-darwin";
    if (failure === "digest") manifest.files[0].sha256 = "0".repeat(64);
    if (failure === "missing") manifest.files.pop();
    if (failure === "path") manifest.files.push({ file: "../outside", sha256: digest("fixture") });
    f.manifest = manifest;
    await assert.rejects(f.manager().installCustom(f.archive), /不匹配|校验/);
    assert.equal(f.calls.some((call) => call.command?.endsWith("codex.exe")), false);
    assert.equal(existsSync(path.join(f.root, "custom.json")), false);
  }
  const f = fixture(); f.manifest = valid();
  await f.manager().installCustom(f.archive);
  assert.ok(existsSync(path.join(f.root, "custom.json")));
});

test("custom refuses invalid inputs, missing installations and concurrent changes", async () => {
  const f = fixture(), manager = f.manager();
  for (const file of [undefined, 1, path.join(f.root, "missing.tar.gz"), path.join(f.root, "file.zip")]) await assert.rejects(manager.installCustom(file), /tar.gz/);
  await assert.rejects(manager.select("custom"), /请先选择/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.manager("custom").startup().channel, "disabled");
  let entered = false;
  f.versionGate = (signal) => new Promise((resolve, reject) => {
    entered = true;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const install = manager.installCustom(f.archive);
  await until(() => entered);
  await assert.rejects(manager.installCustom(f.archive), /正在安装/);
  await assert.rejects(manager.select("disabled"), /正在安装/);
  manager.close();
  await assert.rejects(install);
  assert.equal(existsSync(path.join(f.root, "custom.json")), false);
  await assert.rejects(manager.installCustom(f.archive), /正在关闭/);
});


test("custom import cancels an unfinished Preview before publishing its own package", async () => {
  const f = fixture(); f.installed("release");
  let building = false, cancelled = false;
  f.buildGate = (signal) => new Promise((resolve, reject) => {
    building = true;
    signal.addEventListener("abort", () => { cancelled = true; reject(signal.reason); }, { once: true });
  });
  const manager = f.manager();
  await manager.select("preview");
  await until(() => building);
  await manager.installCustom(f.archive);
  assert.equal(cancelled, true);
  assert.equal(manager.status().channel, "custom");
  assert.equal(manager.status().phase, "ready");
  assert.equal(existsSync(path.join(f.root, "preview.json")), false);
  assert.match(f.manager("custom").startup().codex, /custom-/);
});
