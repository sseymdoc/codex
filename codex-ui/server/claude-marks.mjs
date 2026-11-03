// Claude Desktop's working mark, the clay sprite of its status line and jump-to-latest key
// (ion-dist cc39db724), read from the Claude Desktop installed on this computer like its fonts
// (claude-fonts.mjs): codex-ui ships none of it. /claude-marks.json lists every sheet of the
// chunk the mark imports (frames, ms per frame, loop seams, rest frame, and the webp: a data:
// URL, or /claude-marks/<file> for the ones ion-dist keeps beside the chunk). Without Claude
// Desktop it is {} and the mark stays a static clay dot (src/components/WorkingMark.tsx).

import { ionDistHere, ionFiles, ionStamp, reply } from "./claude-fonts.mjs";

// ponytail: found by its chunk name, the same in 2.42304.0, 2.42304.2 and 4.4212.0. A build that renames
// the module leaves the dot; then look for `as SHEET_URLS}` instead, off the request path (a cold
// WindowsApps install takes ~40s to open every chunk).
const CHUNK = /^c8677db5f-[\w-]+\.js$/;

const esc = (name) => name.replaceAll("$", "\\$");

/** The working-mark sheets of an ion-dist, read from its chunk's tables without running it: the JSON /claude-marks.json answers and the files it names. */
export function readMarks(ionDist) {
  const dist = ionFiles(ionDist);
  const chunk = dist.list("assets/v1").find((file) => CHUNK.test(file));
  if (!chunk) return null;
  const src = dist.read(`assets/v1/${chunk}`).toString("utf8");
  const local = (exported) => new RegExp(`([\\w$]+) as ${exported}[,}]`).exec(src)?.[1] ?? "";
  const object = (exported) => new RegExp(`[,;\\s]${esc(local(exported))}=\\{([^}]*)\\}`).exec(src)?.[1] ?? "";

  const info = {};
  for (const [, key, frames, speed, seams, rest] of src.matchAll(/"?([\w.]+)"?:\{frames:(\d+),speed:([\d.]+)(?:,seams:\[([\d,]*)\])?(?:,rest:(\d+))?\}/g)) {
    info[key] = { frames: Number(frames), speed: Number(speed), ...(seams && { seams: seams.split(",").map(Number) }), ...(rest !== undefined && { rest: Number(rest) }) };
  }
  const urls = new Map([...src.matchAll(/([\w$]+)=new URL\("([^"]+)",[^)]*\)\.href/g)].map(([, name, url]) => [name, url]));
  const aliases = Object.fromEntries([...object("ALIASES").matchAll(/"([\w.]+)":"([\w.]+)"/g)].map(([, alias, key]) => [alias, key]));
  const frame = Number(new RegExp(`[,;\\s]${esc(local("SHEET_FRAME"))}=(\\d+)`).exec(src)?.[1]);

  const sheets = {};
  const files = new Set();
  for (const [, key, name] of object("SHEET_URLS").matchAll(/"?([\w.]+)"?:([\w$]+)/g)) {
    const url = urls.get(name);
    const meta = info[key] ?? info[aliases[key]];
    const file = url && /^\/assets\/v1\/([\w.-]+\.webp)$/.exec(url)?.[1];
    if (!meta || !(file || url?.startsWith("data:image/webp;"))) continue;
    if (file) files.add(file);
    sheets[key] = { ...meta, url: file ? `/claude-marks/${file}` : url };
  }
  return frame && Object.keys(sheets).length ? { json: JSON.stringify({ frame, sheets }), files, dir: ionDist, dist } : null;
}

let found; // undefined until first asked; null without Claude Desktop (restart to pick one up)

function claudeMarks() {
  if (found === undefined || (found && ionStamp(found.dir) !== found.stamp)) {
    const dir = ionDistHere();
    try {
      const marks = dir ? readMarks(dir) : null;
      found = marks && { ...marks, stamp: ionStamp(dir) };
    } catch {
      found = null;
    }
  }
  return found;
}

/** Answers /claude-marks.json and /claude-marks/<file>; false for any other path. */
export function serveClaudeMarks(req, res) {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const name = pathname.startsWith("/claude-marks/") ? pathname.slice("/claude-marks/".length) : null;
  if (name === null && pathname !== "/claude-marks.json") return false;
  const marks = claudeMarks();
  if (req.method !== "GET" && req.method !== "HEAD") res.writeHead(405).end();
  else if (name === null) reply(req, res, "application/json; charset=utf-8", "no-cache", marks?.json ?? "{}");
  else if (!marks?.files.has(name)) res.writeHead(404).end();
  else reply(req, res, "image/webp", "public, max-age=31536000, immutable", () => marks.dist.stream(`assets/v1/${name}`));
  return true;
}
