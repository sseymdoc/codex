import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { stop } from "../server/process.mjs";

export const BACKEND_REPOSITORY = "https://github.com/sseymdoc/codex.git";
const RELEASE_API = "https://api.github.com/repos/sseymdoc/codex/releases/latest";
const CHANNELS = ["disabled", "release", "preview"];

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
  let running;
  const installed = (name) => {
    try {
      const record = JSON.parse(readFileSync(path.join(root, `${name}.json`), "utf8"));
      if (!/^(release|preview)-[a-z0-9-]+$/i.test(record.directory)) return null;
      const directory = path.join(root, record.directory);
      if (![bin(directory), path.join(directory, "bin", `codex-code-mode-host${exe}`)].every((file) => statSync(file).isFile())) return null;
      return bin(directory);
    } catch { return null; }
  };
  const available = () => selected === "disabled" ? null : installed(selected) || (selected === "preview" ? installed("release") : null);
  running = available();
  if (selected !== "disabled" && !running) selected = "disabled";

  const status = () => ({ channel: selected, phase, message, restartNeeded: available() !== running, logAvailable: existsSync(log) });
  const update = (nextPhase, text) => { phase = nextPhase; message = text; onChange(status()); };
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
  const release = async (signal) => {
    if (installed("release")) return;
    update("download", "正在下载 Release 后端…");
    const target = backendTarget(platform, arch);
    const metadata = await (await response(RELEASE_API, signal)).json();
    const asset = metadata.assets?.find((asset) => asset.name === `codex-package-${target}.tar.gz`);
    if (!asset || !asset.browser_download_url?.startsWith("https://github.com/sseymdoc/codex/releases/download/")) throw new Error(`最新 Release 缺少 ${target} 的完整后端包。`);
    const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest || "")?.[1];
    const directory = await mkdtemp(path.join(root, "release-"));
    const archive = path.join(directory, "backend.tar.gz");
    await download(asset.browser_download_url, archive, digest, signal);
    const opts = options(signal, directory);
    const entries = await run("tar", ["-tzf", archive], opts);
    if (!entries || entries.split(/\r?\n/).some((entry) => /(^[/\\]|^[a-z]:|(?:^|[/\\])\.\.(?:[/\\]|$))/i.test(entry))) throw new Error("后端包包含不安全的文件路径。");
    const listing = await run("tar", ["-tvzf", archive], opts);
    if (listing.split(/\r?\n/).some((entry) => entry && !/^[d-]/.test(entry))) throw new Error("后端包包含不支持的链接或特殊文件。");
    await run("tar", ["-xzf", archive, "--no-same-owner", "--no-same-permissions", "-C", directory], opts);
    for (const name of ["codex", "codex-code-mode-host"]) if (!statSync(path.join(directory, "bin", name + exe)).isFile()) throw new Error("后端包缺少主程序或配套程序。");
    await run(bin(directory), ["--version"], opts);
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
  const preview = async (signal) => {
    if (installed("preview")) return;
    update("build", "Release 已就绪，正在准备并编译最新 Preview 源码…");
    const source = path.join(root, "source");
    const opts = options(signal, root);
    await run("git", ["--version"], opts);
    await run("cargo", ["--version"], opts);
    if (!existsSync(path.join(source, ".git"))) await run("git", ["clone", "--depth", "1", BACKEND_REPOSITORY, source], opts);
    else {
      await run("git", ["fetch", "--depth", "1", "origin", "HEAD"], { ...opts, cwd: source });
      await run("git", ["checkout", "--detach", "FETCH_HEAD"], { ...opts, cwd: source });
    }
    const commit = await run("git", ["rev-parse", "HEAD"], { ...opts, cwd: source });
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("无法确认 Preview 源码版本。");
    const target = backendTarget(platform, arch);
    const v8 = await prepareV8(source, target, signal);
    const packages = ["codex-cli", "codex-code-mode-host", ...(platform === "win32" ? ["codex-windows-sandbox", "codex-windows-sandbox-service"] : [])];
    const args = ["build", "--release", "--locked", "--target", target, ...packages.flatMap((name) => ["-p", name]), "--bins"];
    const build = path.join(root, "build");
    await run("cargo", args, { ...opts, cwd: path.join(source, "codex-rs"), env: { ...opts.env, ...v8, CARGO_TARGET_DIR: build } });
    signal.throwIfAborted();
    const directory = await mkdtemp(path.join(root, "preview-"));
    await mkdir(path.join(directory, "bin"));
    const names = ["codex", "codex-code-mode-host", ...(platform === "win32" ? ["codex-command-runner", "codex-windows-sandbox-setup", "codex-windows-sandbox-service", "codex-windows-managed-deny-probe"] : [])];
    for (const name of names) await copyFile(path.join(build, target, "release", name + exe), path.join(directory, "bin", name + exe));
    await run(bin(directory), ["--version"], opts);
    signal.throwIfAborted();
    publish("preview", directory, { commit });
  };
  return {
    status,
    startup: () => ({ codex: running || env.CODEX_BIN || undefined, channel: selected }),
    logFile: () => log,
    async select(value) {
      if (!CHANNELS.includes(value)) throw new Error("无效的后端档位。");
      if (phase === "download") throw new Error("正在安装 Release，请稍候再切换。");
      const previous = selected;
      controller?.abort();
      const previousJob = job;
      if (previousJob) await previousJob;
      selected = value;
      if (value === "disabled") { update("idle", "已禁用实验型后端，重启后使用原后端。"); return; }
      mkdirSync(root, { recursive: true });
      controller = new AbortController();
      const signal = controller.signal;
      try { if (value === "release" || !installed("preview")) await release(signal); }
      catch (error) { selected = previous; update("error", error.message); throw error; }
      if (value === "preview") {
        job = preview(signal).then(() => update("ready", "Preview 已编译安装，重启应用后使用。"), (error) => {
          if (!signal.aborted) update("error", `Preview 编译失败，已保留 Release。请检查 Git、Rust 和 C++ 构建工具。${error.message.slice(-400)}`);
        }).finally(() => { job = null; });
      } else update("ready", "Release 已安装，重启应用后使用。");
    },
    resume() { if (selected === "preview" && !installed("preview")) void this.select("preview").catch(() => {}); },
    close() { controller?.abort(); },
  };
}
