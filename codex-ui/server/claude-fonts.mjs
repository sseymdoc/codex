// Claude Desktop's own type, read from the Claude Desktop installed on this computer. codex-ui
// ships none of it: the Anthropic faces are Anthropic's. /claude-fonts.css is every @font-face
// rule of Claude's main window (the stylesheets ion-dist/index.html links) with its files moved
// under /claude-fonts/, and /third-party-notices.txt the font licence text Settings shows.
// Without Claude Desktop the stylesheet is empty and tokens.css's fallback chains apply.

import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const WINDOWS_APPS = path.join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files", "WindowsApps");
const TYPES = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };

/** ion-dist of the newest Claude Desktop package (Claude_<version>_<arch>__<publisher>) in `apps`, or null. */
export function findIonDist(apps = WINDOWS_APPS) {
  let names;
  try {
    names = readdirSync(apps).filter((name) => /^Claude_\d/.test(name));
  } catch {
    return null;
  }
  const version = (name) => name.split("_")[1].split(".").map(Number);
  names.sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    const i = x.findIndex((part, index) => part !== y[index]);
    return i === -1 ? 0 : (y[i] ?? 0) - x[i];
  });
  for (const name of names) {
    const dir = path.join(apps, name, "app", "resources", "ion-dist");
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

/** The @font-face rules of ion-dist's main window, re-rooted under /claude-fonts/, and the files they name. */
export function readFontFaces(ionDist) {
  const html = readFileSync(path.join(ionDist, "index.html"), "utf8");
  const rules = new Set();
  const files = new Set();
  for (const [, sheet] of html.matchAll(/<link rel="stylesheet"[^>]*href="\/(assets\/[\w./-]+\.css)"/g)) {
    for (const rule of readFileSync(path.join(ionDist, sheet), "utf8").match(/@font-face\{[^}]*\}/g) ?? []) {
      rules.add(
        rule.replaceAll(/url\(\/assets\/v1\/([\w.-]+)\)/g, (_, file) => {
          files.add(file);
          return `url(/claude-fonts/${file})`;
        }),
      );
    }
  }
  return { css: [...rules].join("\n"), files };
}

let found; // undefined until first asked; null without Claude Desktop (restart to pick one up)

function claudeFonts() {
  if (found === undefined || (found && !existsSync(found.dir))) {
    const dir = findIonDist();
    try {
      found = dir ? { dir, ...readFontFaces(dir) } : null;
    } catch {
      found = null;
    }
  }
  return found;
}

/** The @font-face rules, their URLs under `origin` (the quick window is a file:// page). */
export function claudeFontCss(origin = "") {
  return claudeFonts()?.css.replaceAll("url(/claude-fonts/", `url(${origin}/claude-fonts/`) ?? "";
}

/** Answers /claude-fonts.css, /claude-fonts/<file> and /third-party-notices.txt; false for any other path. */
export function serveClaudeFonts(req, res) {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const name = pathname.startsWith("/claude-fonts/") ? pathname.slice("/claude-fonts/".length) : null;
  if (name === null && pathname !== "/claude-fonts.css" && pathname !== "/third-party-notices.txt") return false;
  const fonts = claudeFonts();
  if (req.method !== "GET" && req.method !== "HEAD") res.writeHead(405).end();
  else if (pathname === "/claude-fonts.css") reply(req, res, "text/css; charset=utf-8", "no-cache", claudeFontCss());
  else if (!fonts || (name !== null && !fonts.files.has(name))) res.writeHead(404).end();
  else if (name !== null) reply(req, res, TYPES[path.extname(name)] ?? "application/octet-stream", "public, max-age=31536000, immutable", { file: path.join(fonts.dir, "assets", "v1", name) });
  else reply(req, res, "text/plain; charset=utf-8", "no-cache", { file: path.join(fonts.dir, "third-party-notices.txt") });
  return true;
}

function reply(req, res, type, cache, body) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") res.end();
  else if (typeof body === "string") res.end(body);
  else createReadStream(body.file).on("error", () => res.destroy()).pipe(res);
}
