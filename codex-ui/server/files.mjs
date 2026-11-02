// What the page asks of this machine's files that the app-server has no RPC for, and Claude's
// desktop host answers: the sizes of the files a reply sends, sent audio and video streamed to
// their players, the editors a file opens in, and opening a file or showing it in its folder.
// A path is a local absolute one (no UNC share, which could leak credentials on lookup).

import { execFile, spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

/** Claude's main-process editor table (um), each found by its URL protocol. */
export const EDITORS = [
  { id: "vscode", name: "VS Code", protocols: ["vscode", "vscode-insiders"] },
  { id: "cursor", name: "Cursor", protocols: ["cursor"] },
  { id: "zed", name: "Zed", protocols: ["zed"] },
  { id: "windsurf", name: "Windsurf", protocols: ["windsurf"] },
];

/** The sent media Claude plays in place (shared-28 bk video, Ck audio), and the 图像 page's generated PNGs. */
export const MEDIA = {
  png: "image/png",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
};

export function localPath(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.includes("\0") || /^[\\/]{2}/.test(value) || !path.isAbsolute(value)) return null;
  return path.normalize(value);
}

/**
 * The editor link Claude opens (openInEditor): `<protocol>://file/<path>:<line>`, slashes forward,
 * refused when the path holds %, #, ? or does not survive URI encoding unchanged.
 */
export function editorUrl(protocol, file, line) {
  const slashed = file.replaceAll(path.win32.sep, "/");
  if (/[%#?]/.test(slashed)) return null;
  const encoded = encodeURIComponent(slashed).replace(/%2F/g, "/");
  if (decodeURIComponent(encoded) !== slashed || /["\s<>|^&]/.test(encoded)) return null;
  return `${protocol}://file/${encoded}${Number.isInteger(line) && line > 0 ? `:${line}` : ""}`;
}

/** An HTTP Range header's one span over `size` bytes: { start, end }, null for none, false when unsatisfiable. */
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!match[1] && Number(match[2]) === 0) start = size;
  return start > end || start >= size ? false : { start, end };
}

// Claude's default-app gate (openSessionFileInDefaultApp, before its "Allow Claude to open this
// file?" prompt): a file a reply names opens in the system's app only inside the session folder,
// away from git hooks and agent config, never as a type that runs, through a symlink, or under a
// name with characters that hide what it is.
const RUNS =
  ".bat,.cmd,.com,.exe,.msi,.ps1,.vb,.vbs,.vbe,.js,.jse,.wsf,.wsh,.wsc,.jnlp,.scr,.hta,.lnk,.pif,.reg,.cpl,.msc,.url,.wsb,.chm,.xll,.application,.appref-ms,.settingcontent-ms,.search-ms,.library-ms,.diagcab,.appinstaller,.desktop,.app,.command,.tool,.terminal,.fileloc,.inetloc,.webloc,.scpt,.scptd,.applescript,.workflow,.action,.osax,.term,.ftploc,.afploc,.vncloc,.mobileconfig,.sh,.bash,.zsh,.py,.pyw,.pyz,.pyzw,.pl,.rb,.dmg,.pkg,.mpkg,.jar,.bin,.prefpane,.saver,.sparsebundle,.sparseimage,.iso,.img,.cdr,.toast,.smi,.vhd,.vhdx".split(
    ",",
  );
const HOOK_DIRS = new Set([".git", ".hg", ".claude", ".husky", ".githooks", "githooks", ".lefthook", ".lefthook-local"]);
const HOOK_SHORT_NAMES = /^(git|hg|claude|husky|githoo|leftho)~\d+$/;
const AGENT_CONFIG = new Set([".mcp.json", ".claude.json"]);
const HOOK_CONFIG =
  /^(\.pre-commit-config\.ya?ml|\.?lefthook(-local)?\.(ya?ml|toml|json)|\.lintstagedrc(\..+)?|lint-staged\.config\..+|package\.ya?ml|\.huskyrc(\..+)?|husky\.config\..+|\.commitlintrc(\..+)?|commitlint\.config\..+|\.?nano-staged\.(json|[cm]?js)|nano-staged\.config\.[cm]?js)$/;
const HIDING = /[\p{Cc}\p{Zl}\p{Zp}]|\p{Default_Ignorable_Code_Point}/u;
const joiner = (code) => code === 0x200c || code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f) || (code >= 0xe0100 && code <= 0xe01ef);
const trimEnd = (name) => name.replace(/[. ]+$/, "");

/** A path segment as the file system matches it: folded, no trailing dots or spaces, no stream. */
function segment(name) {
  let folded = name.normalize("NFKC").toLowerCase();
  if (folded === "." || folded === ".." || /[\\/]/.test(folded)) folded = name.toLowerCase();
  return trimEnd(trimEnd(folded).split(":")[0]);
}

/** Whether `parts` passes through a hook folder; `.claude/worktrees/<name>` is a checkout, not config. */
function hookFolder(parts, ancestry) {
  let carved = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const afterCarve = carved;
    carved = false;
    if (part === ".claude" && parts[i + 1] === "worktrees" && i + 2 < parts.length) {
      i++;
      carved = true;
    } else if (ancestry && !afterCarve ? HOOK_DIRS.has(part) || HOOK_SHORT_NAMES.test(part) : HOOK_DIRS.has(part) || /~\d/.test(part)) return true;
  }
  return false;
}

const segments = (value) => value.split(/[\\/]+/).map(segment).filter(Boolean);
const outside = (rel) => !rel || path.isAbsolute(rel) || rel === ".." || rel.startsWith(`..${path.sep}`);

const MAX_WRITE = 8 * 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The files pane's editor saving (Claude 4.4212 writeSessionFile): a regular file inside the
 * session's folder (after resolving links, so a link cannot reach outside it), at most 8 MiB, and
 * only while the file still holds the bytes it was opened with (`expected`, their SHA-256);
 * otherwise `{ conflict: true }` and nothing is written. Written in place, keeping the file's
 * inode and mode. This is the UI writing past Codex's sandbox, so nothing else may pass.
 */
export async function writeSessionFile(cwd, { path: file, text, expected } = {}) {
  const target = localPath(file);
  if (!target || typeof text !== "string" || typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected)) throw new Error("无效的保存请求。");
  if (Buffer.byteLength(text) > MAX_WRITE) throw new Error("文件过大，无法在此保存（上限 8 MiB）。");
  const root = await realpath(cwd).catch(() => null);
  const real = await realpath(target).catch(() => null);
  if (!root || !real || outside(path.relative(root, real))) throw new Error("只能保存此会话工作目录中的文件。");
  if (!(await lstat(real)).isFile()) throw new Error("只能保存普通文件。");
  if (sha256(await readFile(real)) !== expected) return { conflict: true };
  await writeFile(real, text);
  return { conflict: false, sha: sha256(Buffer.from(text)) };
}

/** Why `file` may not open in its default app from session folder `root`, or null when it may. */
export async function defaultAppRefusal(file, root) {
  let real, top;
  try {
    [real, top] = await Promise.all([realpath(file), realpath(root)]);
  } catch {
    return "not found";
  }
  const rel = path.relative(top, real);
  if (outside(rel)) return "outside the session folder";
  const parts = segments(rel);
  const last = parts.at(-1) ?? "";
  if (hookFolder(segments(top), true) || hookFolder(parts, false) || AGENT_CONFIG.has(last) || HOOK_CONFIG.test(last)) return "executable config";
  if (path.extname(file).toLowerCase() !== path.extname(real).toLowerCase()) return "symlink target type differs";
  if ([...real].some((char) => !joiner(char.codePointAt(0)) && HIDING.test(char))) return "unsafe characters in path";
  const name = path.basename(real);
  if (/[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\x00-\x1F\x7F\\/:]|[.\s]$/.test(name)) return "unsafe file name";
  const lower = name.toLowerCase();
  const ext = (path.extname(lower) || (lower.startsWith(".") ? lower : "")).normalize("NFKC").toLowerCase();
  if (RUNS.some((run) => lower.endsWith(run)) || RUNS.includes(ext)) return "executable file type";
  const info = await lstat(real).catch(() => null);
  return !info || info.isSymbolicLink() || !info.isFile() ? "not a plain file" : null;
}

function stat(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

function launch(command, args, options = {}) {
  const child = spawn(command, args, { detached: true, stdio: "ignore", ...options });
  child.on("error", () => {});
  child.unref();
}

/** A URL or file handed to the system, as a double click would. */
function shellOpen(target) {
  // explorer.exe reads a comma as a separator, so the target goes quoted (no Windows path or
  // editor link holds a quote).
  if (process.platform === "win32") launch("explorer.exe", [`"${target}"`], { windowsVerbatimArguments: true });
  else launch(process.platform === "darwin" ? "open" : "xdg-open", [target]);
}

function registered(protocol) {
  // macOS asks LaunchServices for the URL's handler (JXA, no Apple Events); Windows its registry.
  if (process.platform === "darwin") {
    const script = `ObjC.import("AppKit"); if ($.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("${protocol}://")).isNil()) throw 0`;
    return new Promise((resolve) => execFile("osascript", ["-l", "JavaScript", "-e", script], (error) => resolve(!error)));
  }
  const key = ["HKCR", protocol, "shell", "open", "command"].join(path.win32.sep);
  return new Promise((resolve) => execFile("reg.exe", ["query", key, "/ve"], { windowsHide: true }, (error) => resolve(!error)));
}

let editors, editorsAt = 0;
const EDITORS_TTL = 60_000; // an editor installed while codex-ui runs shows up within a minute

/** The editors installed, as Claude lists them (getInstalledEditors: by a registered URL protocol). */
export function installedEditors() {
  if (editors && Date.now() - editorsAt < EDITORS_TTL) return editors;
  editorsAt = Date.now();
  editors =
    process.platform !== "win32" && process.platform !== "darwin"
      ? Promise.resolve([])
      : Promise.all(
          EDITORS.map(async ({ id, name, protocols }) => {
            for (const protocol of protocols) if (await registered(protocol)) return { id, name, protocol };
            return null;
          }),
        ).then((found) => found.filter(Boolean));
  return editors;
}

const json = (res, body) => res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end(JSON.stringify(body));
const fail = (res, status, message) => res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(message);

function media(req, res, file) {
  const type = MEDIA[path.extname(file).slice(1).toLowerCase()];
  const info = type && stat(file);
  if (!info?.isFile()) return fail(res, 404, "No such media file.");
  const range = byteRange(req.headers.range, info.size);
  if (range === false) return void res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
  const { start, end } = range ?? { start: 0, end: info.size - 1 };
  const head = { "Content-Type": type, "Content-Length": String(Math.max(0, end - start + 1)), "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  res.writeHead(range ? 206 : 200, range ? { ...head, "Content-Range": `bytes ${start}-${end}/${info.size}` } : head);
  if (req.method === "HEAD" || end < start) return void res.end();
  const stream = createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

/** /api/files/*, false for a route it does not have. The bridge has checked the origin and the token. */
export function handleFiles(req, res, url) {
  const route = url.pathname.slice("/api/files/".length);
  const get = req.method === "GET" || req.method === "HEAD";
  if (route === "sizes" && get) {
    const sizes = {};
    for (const value of url.searchParams.getAll("path").slice(0, 200)) {
      const info = localPath(value) && stat(value);
      sizes[value] = info?.isFile() ? info.size : null;
    }
    return void json(res, sizes);
  }
  if (route === "editors" && get) return void installedEditors().then((list) => json(res, list.map(({ id, name }) => ({ id, name }))));
  const file = localPath(url.searchParams.get("path"));
  if (route === "media" && get) return file ? void media(req, res, file) : void fail(res, 400, "Not a local path.");
  if ((route === "open" || route === "reveal") && req.method === "POST") {
    if (!file || !stat(file)) return void fail(res, 404, "No such file.");
    if (route === "reveal") {
      // explorer.exe takes /select,"<path>" as one argument; a Windows path holds no quote.
      if (process.platform === "win32") launch("explorer.exe", [`/select,"${file}"`], { windowsVerbatimArguments: true });
      else if (process.platform === "darwin") launch("open", ["-R", file]);
      else launch("xdg-open", [path.dirname(file)]);
      return void res.writeHead(204).end();
    }
    const editor = url.searchParams.get("editor");
    if (editor === "default") {
      const root = localPath(url.searchParams.get("root"));
      return void (root ? defaultAppRefusal(file, root) : Promise.resolve("no session folder")).then((refusal) => {
        if (refusal) return fail(res, 403, `Blocked: ${refusal}.`);
        shellOpen(file);
        res.writeHead(204).end();
      });
    }
    return void installedEditors().then((list) => {
      const found = list.find((entry) => entry.id === editor);
      const link = found && editorUrl(found.protocol, file, Number(url.searchParams.get("line")));
      if (!link) return fail(res, 400, "Cannot open this in that editor.");
      shellOpen(link);
      res.writeHead(204).end();
    });
  }
  return false;
}
