import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stop } from "./process.mjs";

export const BACKEND_REPOSITORY = "https://github.com/sseymdoc/codex.git";
const RELEASE_API = "https://api.github.com/repos/sseymdoc/codex/releases/latest";
const CHANNELS = ["disabled", "release", "preview", "custom"];

export function backendChannel(value) {
  return CHANNELS.includes(value) ? value : "disabled";
}

export function backendTarget(platform = process.platform, arch = process.arch) {
  const cpu = { x64: "x86_64", arm64: "aarch64" }[arch];
  const os = { win32: "pc-windows-msvc", darwin: "apple-darwin", linux: "unknown-linux-gnu" }[platform];
  if (!cpu || !os) throw new Error("实验型后端暂不支持此系统或处理器。");
  return `${cpu}-${os}`;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function command(command, args, { cwd, env, signal, log }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: "pipe" });
    const output = log && createWriteStream(log, { flags: "a" });
    output?.once("error", (error) => { stop(child, true); reject(error); });
    let stdout = "", tail = "";
    const abort = () => stop(child, true);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (chunk) => { stdout += chunk; tail = (tail + chunk).slice(-4000); output?.write(chunk); });
    child.stderr.on("data", (chunk) => { tail = (tail + chunk).slice(-4000); output?.write(chunk); });
    child.once("error", (error) => { output?.write(`${error.message}\n`); reject(error); });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      output?.end();
      if (signal?.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(`${command} 执行失败（${code}）：${tail.trim()}`));
      else resolve(stdout.trim());
    });
  });
}

export function createBackendManager({ root, channel = "disabled", env = process.env, platform = process.platform, arch = process.arch, fetch = globalThis.fetch, run = command, onChange = () => {} }) {
  root = path.resolve(root);
  const exe = platform === "win32" ? ".exe" : "";
  const bin = (directory) => path.join(directory, "bin", `codex${exe}`);
  const log = path.join(root, "preview-build.log");
  let selected = backendChannel(channel), phase = "idle", message = "", controller, job;
  let restartNeeded = false, closed = false, releaseController, releaseJob, releaseTimer;
  let running;
  const record = (name) => { try { return JSON.parse(readFileSync(path.join(root, `${name}.json`), "utf8")); } catch { return null; } };
  const installed = (name) => {
    const folder = record(name)?.directory;
    if (!/^(release|preview|custom)-[a-z0-9-]+$/i.test(folder)) return null;
    const directory = path.join(root, folder);
    try {
      if (![bin(directory), path.join(directory, "bin", `codex-code-mode-host${exe}`)].every((file) => statSync(file).isFile())) return null;
      return bin(directory);
    } catch { return null; }
  };
  const available = () => selected === "disabled" ? null : installed(selected) || (selected === "preview" ? installed("release") : null);
  running = available();
  if (selected !== "disabled" && !running) selected = "disabled";

  // Silent updates only change the on-disk package; explicit selections own visible restart state.
  const status = () => ({ channel: selected, phase, message, restartNeeded, logAvailable: existsSync(log),
    packageName: selected === "custom" ? record("custom")?.packageName ?? null : null });
  const update = (nextPhase, text) => { phase = nextPhase; message = text; restartNeeded = available() !== running; onChange(status()); };
  const options = (signal, cwd) => ({ cwd, signal, log, env: { ...env, PATH: [path.join(env.USERPROFILE || env.HOME || "", ".cargo", "bin"), env.PATH || ""].join(path.delimiter), GIT_TERMINAL_PROMPT: "0", CARGO_TERM_COLOR: "never" } });
  const publish = (name, directory, extra) => {
    const file = path.join(root, `${name}.json`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ directory: path.basename(directory), ...extra }));
    renameSync(`${file}.tmp`, file);
  };
  const response = async (url, signal) => {
    const result = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]), headers: { "User-Agent": "codex-ui", Accept: "application/vnd.github+json" } });
    if (!result.ok) throw new Error(result.status === 404 && url === RELEASE_API
      ? "sseymdoc/codex 尚未发布 Release 后端安装包。"
      : `下载失败（HTTP ${result.status}）。`);
    return result;
  };
  const download = async (url, file, expected, signal) => {
    if (!/^[a-f0-9]{64}$/i.test(expected || "")) throw new Error("发布文件缺少有效的 SHA-256 校验值。");
    if (existsSync(file) && await sha256(file) === expected.toLowerCase()) return;
    const result = await response(url, signal);
    await pipeline(Readable.fromWeb(result.body), createWriteStream(`${file}.part`), { signal });
    if (await sha256(`${file}.part`) !== expected.toLowerCase()) throw new Error("下载文件的 SHA-256 校验失败，已保留原后端。");
    await rename(`${file}.part`, file);
  };
  const safeEntry = (entry) => {
    if (entry.startsWith("/")) return false;
    const name = entry.replace(/^\.\//, "").replace(/\/$/, "");
    return name === "" || name === "." || (!name.includes("\\") && name.split("/").every((part) =>
      part && part !== "." && part !== ".." && !/[:\x00-\x1f]/.test(part)
      && (platform !== "win32" || (!/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))));
  };
  const unpack = async (archive, directory, signal, silent = false) => {
    const opts = { ...options(signal, directory), log: silent ? undefined : log };
    const entries = await run("tar", ["-tzf", archive], opts);
    if (!entries || entries.split(/\r?\n/).some((entry) => !safeEntry(entry))) throw new Error("后端包包含不安全的文件路径。");
    const listing = await run("tar", ["-tvzf", archive], opts);
    if (listing.split(/\r?\n/).some((entry) => entry && !/^[d-]/.test(entry))) throw new Error("后端包包含不支持的链接或特殊文件。");
    await run("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", directory], opts);
    const required = ["codex", "codex-code-mode-host"].map((name) => `bin/${name}${exe}`);
    if (!required.every((name) => statSync(path.join(directory, name), { throwIfNoEntry: false })?.isFile())) throw new Error("后端包缺少主程序或配套程序。");
    const manifestPath = path.join(directory, "codex-backend.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse((await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""));
      if (manifest.target !== backendTarget(platform, arch)) throw new Error("后端包与当前系统或处理器不匹配。");
      if (!Array.isArray(manifest.files) || !required.every((name) => manifest.files.some((file) => file.file === name))) throw new Error("后端包的文件校验清单不完整。");
      for (const file of manifest.files) {
        signal.throwIfAborted();
        if (typeof file.file !== "string" || !safeEntry(file.file) || !/^[a-f0-9]{64}$/i.test(file.sha256 || "")) throw new Error("后端包的文件校验清单无效。");
        if (await sha256(path.join(directory, file.file)) !== file.sha256.toLowerCase()) throw new Error("后端包的 SHA-256 校验失败，已保留原后端。");
      }
    }
    await run(bin(directory), ["--version"], { ...opts, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    signal.throwIfAborted();
  };
  const release = async (signal, silent = false) => {
    if (!silent && installed("release")) return;
    if (!silent) update("download", "正在下载 Release 后端…");
    const target = backendTarget(platform, arch);
    const metadata = await (await response(RELEASE_API, signal)).json();
    const asset = metadata.assets?.find((asset) => asset.name === `codex-package-${target}.tar.gz`);
    if (!asset || !asset.browser_download_url?.startsWith("https://github.com/sseymdoc/codex/releases/download/")) throw new Error(`最新 Release 缺少 ${target} 的完整后端包。`);
    const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || "")?.[1];
    if (silent && digest && JSON.parse(await readFile(path.join(root, "release.json"), "utf8")).sha256 === digest) return;
    const directory = await mkdtemp(path.join(root, "release-"));
    const archive = path.join(directory, "backend.tar.gz");
    await download(asset.browser_download_url, archive, digest, signal);
    await unpack(archive, directory, signal, silent);
    signal.throwIfAborted();
    publish("release", directory, { tag: metadata.tag_name, sha256: digest });
  };
  const prepareV8 = async (source, target, signal) => {
    const lock = await readFile(path.join(source, "codex-rs", "Cargo.lock"), "utf8");
    const version = /\[\[package\]\]\s*name = "v8"\s*version = "([\d.]+)"/.exec(lock)?.[1];
    if (!version) throw new Error("源码中未找到 V8 依赖版本。");
    const directory = path.join(root, `v8-${version}-${target}`);
    await mkdir(directory, { recursive: true });
    const profile = `ptrcomp_sandbox_release_${target}`;
    const manifestName = `rusty_v8_${profile}.sha256`;
    const trusted = await readFile(path.join(source, "third_party", "v8", `rusty_v8_${version.replaceAll(".", "_")}_release_manifests.sha256`), "utf8");
    const expected = trusted.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find(([, name]) => name === manifestName)?.[0];
    const base = `https://github.com/openai/codex/releases/download/rusty-v8-v${version}/`;
    const manifest = path.join(directory, manifestName);
    await download(base + manifestName, manifest, expected, signal);
    const checksums = (await readFile(manifest, "utf8")).trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/));
    const archiveName = platform === "win32" ? `rusty_v8_${profile}.lib.gz` : `librusty_v8_${profile}.a.gz`;
    const bindingName = `src_binding_${profile}.rs`;
    for (const name of [archiveName, bindingName]) await download(base + name, path.join(directory, name), checksums.find(([, file]) => file === name)?.[0], signal);
    return { V8_FROM_SOURCE: "0", RUSTY_V8_ARCHIVE: path.join(directory, archiveName), RUSTY_V8_SRC_BINDING_PATH: path.join(directory, bindingName) };
  };
  // ripgrep is not built from source: take the version and digest the source's package builder pins.
  const prepareRg = async (source, signal) => {
    const manifest = JSON.parse((await readFile(path.join(source, "scripts", "codex_package", "rg"), "utf8")).replace(/^#!.*/, ""));
    const entry = manifest.platforms?.[`${{ win32: "windows", darwin: "macos", linux: "linux" }[platform]}-${{ x64: "x86_64", arm64: "aarch64" }[arch]}`];
    const url = entry?.providers?.map((provider) => provider.url).find((url) => url?.startsWith("https://github.com/BurntSushi/ripgrep/releases/download/"));
    if (!url || !/^[a-f0-9]{64}$/.test(entry.digest) || !/^\w[\w.-]*\/rg(?:\.exe)?$/.test(entry.path)) throw new Error("源码中未找到 ripgrep 的固定版本。");
    const directory = path.join(root, `rg-${entry.digest}`);
    await mkdir(directory, { recursive: true });
    const archive = path.join(directory, path.basename(url));
    await download(url, archive, entry.digest, signal);
    await run("tar", ["-xf", archive, "-C", directory, entry.path], options(signal, directory));
    return path.join(directory, entry.path);
  };
  // `fresh` pulls the source's latest commit first; false when the installed Preview already has it.
  const preview = async (signal, fresh = false) => {
    if (!fresh && installed("preview")) return;
    update("build", fresh ? "正在获取最新 Preview 源码…" : "Release 已就绪，正在准备并编译最新 Preview 源码…");
    const source = path.join(root, "source");
    const opts = options(signal, root);
    await run("git", ["--version"], opts);
    await run("cargo", ["--version"], opts);
    if (!existsSync(path.join(source, ".git"))) {
      const checkout = await mkdtemp(path.join(root, "source-"));
      await run("git", ["clone", "--config", "core.longpaths=true", "--depth", "1", BACKEND_REPOSITORY, checkout], opts);
      signal.throwIfAborted();
      await rename(checkout, source);
    } else if (fresh) {
      await run("git", ["fetch", "--depth", "1", "origin", "HEAD"], { ...opts, cwd: source });
      await run("git", ["reset", "--hard", "FETCH_HEAD"], { ...opts, cwd: source });
    }
    const commit = await run("git", ["rev-parse", "HEAD"], { ...opts, cwd: source });
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("无法确认 Preview 源码版本。");
    if (fresh && installed("preview") && record("preview").commit === commit) return false;
    if (fresh) update("build", "正在编译最新 Preview 源码…");
    const target = backendTarget(platform, arch);
    const v8 = await prepareV8(source, target, signal);
    const rg = await prepareRg(source, signal);
    const packages = ["codex-cli", "codex-code-mode-host", ...(platform === "win32" ? ["codex-windows-sandbox", "codex-windows-sandbox-service"] : [])];
    const args = ["build", "--release", "--locked", "--target", target, ...packages.flatMap((name) => ["-p", name]), "--bins"];
    const build = path.join(root, "build");
    await run("cargo", args, { ...opts, cwd: path.join(source, "codex-rs"), env: { ...opts.env, ...v8, CARGO_TARGET_DIR: build } });
    signal.throwIfAborted();
    const directory = await mkdtemp(path.join(root, "preview-"));
    await mkdir(path.join(directory, "bin"));
    const names = ["codex", "codex-code-mode-host", ...(platform === "win32" ? ["codex-command-runner", "codex-windows-sandbox-setup", "codex-windows-sandbox-service", "codex-windows-managed-deny-probe"] : [])];
    for (const name of names) await copyFile(path.join(build, target, "release", name + exe), path.join(directory, "bin", name + exe));
    // codex-path as in the official packages; the bridge puts it first on PATH.
    await mkdir(path.join(directory, "codex-path"));
    await copyFile(rg, path.join(directory, "codex-path", `rg${exe}`));
    await run(bin(directory), ["--version"], opts);
    signal.throwIfAborted();
    publish("preview", directory, { commit });
  };
  const checkRelease = () => {
    if (closed || selected !== "release" || ["download", "build", "install"].includes(phase)) return;
    if (releaseJob) return releaseJob;
    releaseController = new AbortController();
    releaseJob = release(releaseController.signal, true).catch(() => {}).finally(() => { releaseJob = null; });
    return releaseJob;
  };
  const watchRelease = () => {
    if (closed || selected !== "release" || releaseTimer) return;
    releaseTimer = setInterval(checkRelease, 6 * 60 * 60 * 1000);
    releaseTimer.unref?.();
  };
  const stopRelease = () => {
    clearInterval(releaseTimer);
    releaseTimer = null;
    releaseController?.abort();
  };
  return {
    status,
    startup: () => ({ codex: running || env.CODEX_BIN || undefined, channel: selected }),
    logFile: () => log,
    /** `fresh` (检查更新): Release asks for the latest package, Preview pulls and rebuilds the latest source. */
    async select(value, fresh = false) {
      if (closed) throw new Error("应用正在关闭。");
      if (!CHANNELS.includes(value)) throw new Error("无效的后端档位。");
      if (["download", "install"].includes(phase)) throw new Error("正在安装后端，请稍候再切换。");
      const previous = selected;
      stopRelease();
      if (releaseJob) await releaseJob;
      controller?.abort();
      const previousJob = job;
      if (previousJob) await previousJob;
      selected = value;
      if (value === "disabled") { update("idle", "已禁用实验型后端，重启后使用原后端。"); return; }
      mkdirSync(root, { recursive: true });
      controller = new AbortController();
      const signal = controller.signal;
      try {
        if (value === "custom") {
          if (!installed("custom")) throw new Error("请先选择自定义后端的 tar.gz 包。");
          update("ready", "自定义后端已就绪，重启应用后使用。");
          return;
        }
        if (fresh && value === "release" && installed("release")) {
          update("download", "正在检查 Release 更新…");
          await release(signal, true);
        } else if (value === "release" || !installed("preview")) await release(signal);
      }
      catch (error) { selected = previous; update("error", error.message); watchRelease(); throw error; }
      // A silent update may already have put the latest package on disk: it waits for a restart too.
      const latest = (what) => available() !== running ? `${what}已是最新版本，重启应用后使用。` : `${what}已是最新版本。`;
      if (value === "preview") {
        job = preview(signal, fresh).then((built) => update("ready", built === false ? latest("Preview ") : "Preview 已编译安装，重启应用后使用。"), (error) => {
          if (!signal.aborted) update("error", `Preview 编译失败，已保留 Release。请检查 Git、Rust 和 C++ 构建工具。${error.message.slice(-400)}`);
        }).finally(() => { job = null; });
      } else { update("ready", fresh ? latest("Release ") : "Release 已安装，重启应用后使用。"); watchRelease(); }
    },
    async installCustom(file) {
      if (closed) throw new Error("应用正在关闭。");
      if (["download", "install"].includes(phase)) throw new Error("正在安装后端，请稍候再选择。");
      if (typeof file !== "string" || !/\.tar\.gz$/i.test(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error("请选择有效的 tar.gz 后端包。");
      const previous = selected, previousJob = job;
      stopRelease();
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      update("install", "正在校验并安装自定义后端包…");
      try {
        if (releaseJob) await releaseJob;
        if (previousJob) await previousJob;
        signal.throwIfAborted();
        await mkdir(root, { recursive: true });
        job = (async () => {
          const directory = await mkdtemp(path.join(root, "custom-"));
          const archive = path.join(directory, "backend.tar.gz");
          await copyFile(file, archive);
          const digest = await sha256(archive);
          signal.throwIfAborted();
          await unpack(archive, directory, signal);
          signal.throwIfAborted();
          publish("custom", directory, { packageName: path.basename(file), sha256: digest });
          selected = "custom";
          update("ready", "自定义后端已安装，重启应用后使用。");
        })();
        await job;
      } catch (error) {
        selected = previous;
        if (!closed) { update("error", error.message); watchRelease(); }
        throw error;
      } finally { job = null; }
    },
    resume() {
      if (selected === "release") { watchRelease(); return checkRelease(); }
      if (selected === "preview" && !installed("preview")) void this.select("preview").catch(() => {});
    },
    close() { closed = true; stopRelease(); controller?.abort(); },
  };
}
