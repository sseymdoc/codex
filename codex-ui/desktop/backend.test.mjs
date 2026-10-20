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
  const bytes = Buffer.from("verified release archive");
  let extraction = "bin/codex.exe\nbin/codex-code-mode-host.exe";
  let listing = "-rwxr-xr-x codex.exe\n-rwxr-xr-x codex-code-mode-host.exe";
  let badDigest = false, missingRelease = false, failBuild = false;
  let buildGate, cloneGate;
  const place = (directory, name) => { mkdirSync(path.join(directory, "bin"), { recursive: true }); writeFileSync(path.join(directory, "bin", name), "fixture"); };
  const installed = (channel) => {
    const directory = `${channel}-Fixture`;
    for (const name of ["codex.exe", "codex-code-mode-host.exe"]) place(path.join(root, directory), name);
    writeFileSync(path.join(root, `${channel}.json`), JSON.stringify({ directory }));
    return path.join(root, directory, "bin", "codex.exe");
  };
  const fetch = async (url) => {
    calls.push({ url });
    if (url.endsWith("releases/latest")) return missingRelease ? new Response("", { status: 404 }) : Response.json({ tag_name: "backend-v1", assets: [{ name: `codex-package-${target}.tar.gz`, digest: "sha256:" + (badDigest ? "0".repeat(64) : digest(bytes)), browser_download_url: `https://github.com/sseymdoc/codex/releases/download/backend-v1/codex-package-${target}.tar.gz` }] });
    if (url.includes("sseymdoc/codex/releases/download/")) return new Response(bytes);
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
      if (args[0] === "-xzf") for (const name of ["codex.exe", "codex-code-mode-host.exe"]) place(options.cwd, name);
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
    if (command === "git" && args[0] === "rev-parse") return "a".repeat(40);
    if (command === "cargo" && args[0] === "build") {
      if (failBuild) throw new Error("compiler unavailable");
      if (buildGate) await buildGate(options.signal);
      const output = path.join(options.env.CARGO_TARGET_DIR, target, "release");
      mkdirSync(output, { recursive: true });
      for (const name of ["codex", "codex-code-mode-host", "codex-command-runner", "codex-windows-sandbox-setup", "codex-windows-sandbox-service", "codex-windows-managed-deny-probe"]) writeFileSync(path.join(output, name + ".exe"), "preview fixture");
    }
    return "fixture";
  };
  const manager = (channel) => createBackendManager({ root, channel, env: { CODEX_BIN: "original.exe" }, platform: "win32", arch: "x64", fetch, run, onChange: (state) => events.push(state) });
  return { root, calls, events, installed, manager, set badDigest(value) { badDigest = value; }, set missingRelease(value) { missingRelease = value; }, set extraction(value) { extraction = value; }, set listing(value) { listing = value; }, set failBuild(value) { failBuild = value; }, set buildGate(value) { buildGate = value; }, set cloneGate(value) { cloneGate = value; }, set rgDigest(value) { rgDigest = value; } };
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
