// The Codex desktop app's dot character runtime (orbit-characters: a WASM engine and the iframe
// that hosts it, webview/assets/orbit-character-<hash>/), read as it is from the app's own
// installed package: codex-ui ships none of it. Files are served from that one folder only, by
// the names the frame itself loads, so its relative imports keep working under the bridge.
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
};
// The frame's own policy (frame.html), sent as a header too.
const FRAME_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; frame-ancestors 'self'";

/** The installed Codex app's app.asar: CODEX_ORBIT_ASAR, else the newest MSIX (Windows) or the app bundle (macOS). */
export async function findCodexAsar(env = process.env) {
  if (env.CODEX_ORBIT_ASAR) return env.CODEX_ORBIT_ASAR;
  if (process.platform === "darwin") return "/Applications/Codex.app/Contents/Resources/app.asar";
  if (process.platform !== "win32") return null;
  const root = path.join(env.ProgramW6432 || env.ProgramFiles || "C:\\Program Files", "WindowsApps");
  const version = (name) => /^OpenAI\.Codex_(\d+)\.(\d+)\.(\d+)\.(\d+)_x64__/.exec(name)?.slice(1).map(Number);
  const names = (await readdir(root).catch(() => [])).filter(version)
    .sort((a, b) => version(b).reduce((order, part, i) => order || part - version(a)[i], 0));
  if (names.length) return path.join(root, names[0], "app", "resources", "app.asar");
  // WindowsApps may not list for this user; the package manager knows where it is.
  const location = await new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "(Get-AppxPackage -Name OpenAI.Codex | Sort-Object Version -Descending | Select-Object -First 1).InstallLocation"],
  { windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve(error ? "" : String(stdout).trim())));
  return location ? path.join(location, "app", "resources", "app.asar") : null;
}

/**
 * The runtime in one archive: its folder's entries, where file data starts, and the resource
 * bundle id the desktop app stamps on saved characters (bundle.json's orbit-characters.data hash).
 */
async function readArchive(file) {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(16);
    await handle.read(head, 0, 16, 0);
    const length = head.readUInt32LE(12);
    const json = Buffer.alloc(length);
    await handle.read(json, 0, length, 16);
    const assets = JSON.parse(json.toString("utf8")).files?.webview?.files?.assets?.files ?? {};
    const folder = Object.keys(assets).find((name) => /^orbit-character-[0-9a-f]+$/.test(name) && assets[name].files);
    if (!folder) return null;
    const root = assets[folder];
    // The frame sits in a folder of its own, named by its build.
    const frame = Object.keys(root.files).find((name) => root.files[name].files?.["frame.html"]);
    const archive = { file, base: 8 + head.readUInt32LE(4), folder, root, frame, bundleId: null };
    const bundle = entry(archive, "runtime/bundle.json");
    if (bundle && !bundle.unpacked) {
      const bytes = Buffer.alloc(bundle.size);
      await handle.read(bytes, 0, bundle.size, archive.base + Number(bundle.offset));
      const sha = JSON.parse(bytes.toString("utf8")).files?.["orbit-characters.data"]?.sha256;
      archive.bundleId = typeof sha === "string" && /^[0-9a-f]{64}$/.test(sha) ? sha : null;
    }
    return archive.bundleId && archive.frame ? archive : null;
  } finally {
    await handle.close();
  }
}

function entry(archive, relative) {
  let node = archive.root;
  for (const part of relative.split("/")) node = node?.files?.[part];
  return node && !node.files && typeof node.size === "number" ? node : null;
}

export function createOrbitFiles({ locate = findCodexAsar } = {}) {
  let found;
  let cached = null;
  async function archive() {
    found ??= locate().catch(() => null);
    const file = await found;
    if (!file) return null;
    let info;
    try { info = await stat(file); } catch { found = undefined; return null; }
    if (cached?.file !== file || cached.mtimeMs !== info.mtimeMs) cached = { file, mtimeMs: info.mtimeMs, archive: await readArchive(file).catch(() => null) };
    return cached.archive;
  }
  return {
    /** The character frame's page and the runtime's bundle id; nulls without the app. */
    async info() {
      const found = await archive();
      return found ? { bundleId: found.bundleId, frame: `/api/dots/orbit/files/${found.folder}/${found.frame}/frame.html` } : { bundleId: null, frame: null };
    },
    /** Streams `<folder>/<relative>`; false when there is no such file. */
    async serve(res, requested) {
      const found = await archive();
      const match = /^([\w-]+)\/((?:[\w-][\w.-]*\/)*[\w-][\w.-]*)$/.exec(requested);
      const type = match && TYPES[path.extname(match[2])];
      if (!found || !match || match[1] !== found.folder || !type || match[2].split("/").includes("..")) return false;
      const node = entry(found, match[2]);
      if (!node) return false;
      const source = node.unpacked
        ? createReadStream(path.join(`${found.file}.unpacked`, "webview", "assets", found.folder, ...match[2].split("/")))
        : node.size === 0 ? null : createReadStream(found.file, { start: found.base + Number(node.offset), end: found.base + Number(node.offset) + node.size - 1 });
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": node.size,
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        ...(type.startsWith("text/html") ? { "Content-Security-Policy": FRAME_CSP } : {}),
      });
      if (!source) {
        res.end();
        return true;
      }
      source.on("error", () => res.destroy()).pipe(res);
      return true;
    },
  };
}
