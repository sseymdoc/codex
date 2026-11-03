// Claude Desktop's own type, read from the Claude Desktop installed on this computer. codex-ui
// ships none of it: the Anthropic faces are Anthropic's. /claude-fonts.css is every @font-face
// rule of Claude's main window (the stylesheets ion-dist/index.html links) with its files moved
// under /claude-fonts/, and /third-party-notices.txt the font licence text Settings shows.
// Without Claude Desktop the stylesheet is STAND_INS instead and the notices are codex-ui's own
// (public/third-party-notices.txt). ion-dist is a folder in the Windows package and an asar
// archive in macOS's Claude.app (ionFiles reads either).

import fs, { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const WINDOWS_APPS = path.join(process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files", "WindowsApps");
const MAC_APPS = ["/Applications", path.join(homedir(), "Applications")];
// Electron's own fs reads into an .asar as a folder; the archive itself takes the unpatched one.
const rawFs = process.versions.electron ? createRequire(import.meta.url)("original-fs") : fs;
const TYPES = { ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf" };

/** codex-ui's open-licensed faces (public/fonts) under the families Claude's rules define, for a
 *  computer without Claude Desktop: Phosphor Icons at the Anthropicons codepoints
 *  (src/fonts/build-icons.py), Geist and Geist Mono for Anthropic Sans and Mono on Anthropic's
 *  line metrics, and OpenDyslexic. Anthropic Serif has no stand-in: Claude's own metric-matched
 *  local fallbacks take its place. */
export const STAND_INS = [
  '@font-face{font-family:Anthropicons-Variable;src:url(/fonts/codex-icons.woff2)format("woff2");font-weight:400 700;font-display:block}',
  '@font-face{font-family:anthropic-sans;src:url(/fonts/Geist-Variable.woff2)format("woff2");font-weight:100 900;font-style:normal;font-display:swap;ascent-override:99.3%;descent-override:25.8%;line-gap-override:0%}',
  '@font-face{font-family:anthropic-sans;src:url(/fonts/Geist-Italic-Variable.woff2)format("woff2");font-weight:100 900;font-style:italic;font-display:swap;ascent-override:99.3%;descent-override:25.8%;line-gap-override:0%}',
  '@font-face{font-family:anthropic-mono;src:url(/fonts/GeistMono-Variable.woff2)format("woff2");font-weight:100 900;font-style:normal;font-display:swap;ascent-override:99.3%;descent-override:25.8%;line-gap-override:0%}',
  '@font-face{font-family:anthropic-mono;src:url(/fonts/GeistMono-Italic-Variable.woff2)format("woff2");font-weight:100 900;font-style:italic;font-display:swap;ascent-override:99.3%;descent-override:25.8%;line-gap-override:0%}',
  "@font-face{font-family:Anthropic Serif Fallback Georgia;src:local(Georgia);size-adjust:104.79%;ascent-override:94.71%;descent-override:24.57%;line-gap-override:0%;unicode-range:U+20-7E,U+A0-B4,U+B6-17F,U+2012-2015,U+2018-2022,U+2026,U+2030,U+2032-2034,U+2039-203A,U+2044}",
  "@font-face{font-family:Anthropic Serif Fallback Times;src:local(Times New Roman),local(TimesNewRomanPSMT),local(Liberation Serif),local(LiberationSerif);size-adjust:114.99%;ascent-override:86.31%;descent-override:22.39%;line-gap-override:0%;unicode-range:U+20-7E,U+A0-B4,U+B6-17F,U+2012-2015,U+2018-2022,U+2026,U+2030,U+2032-2034,U+2039-203A,U+2044}",
  "@font-face{font-family:Anthropic Serif Fallback DejaVu;src:local(DejaVu Serif),local(DejaVuSerif);size-adjust:90.15%;ascent-override:110.1%;descent-override:28.56%;line-gap-override:0%;unicode-range:U+20-7E,U+A0-B4,U+B6-17F,U+2012-2015,U+2018-2022,U+2026,U+2030,U+2032-2034,U+2039-203A,U+2044}",
  "@font-face{font-family:Anthropic Serif Fallback Noto;src:local(Noto Serif),local(NotoSerif),local(NotoSerif-Regular);size-adjust:97.12%;ascent-override:102.19%;descent-override:26.51%;line-gap-override:0%;unicode-range:U+20-7E,U+A0-B4,U+B6-17F,U+2012-2015,U+2018-2022,U+2026,U+2030,U+2032-2034,U+2039-203A,U+2044}",
  '@font-face{font-family:OpenDyslexic;src:url(/fonts/OpenDyslexic-Regular.woff2)format("woff2");font-weight:400;font-style:normal;font-display:swap}',
  '@font-face{font-family:OpenDyslexic;src:url(/fonts/OpenDyslexic-Bold.woff2)format("woff2");font-weight:700;font-style:normal;font-display:swap}',
  '@font-face{font-family:OpenDyslexic;src:url(/fonts/OpenDyslexic-Italic.woff2)format("woff2");font-weight:400;font-style:italic;font-display:swap}',
  '@font-face{font-family:OpenDyslexic;src:url(/fonts/OpenDyslexic-BoldItalic.woff2)format("woff2");font-weight:700;font-style:italic;font-display:swap}',
  '@font-face{font-family:OpenDyslexic Mono;src:url(/fonts/OpenDyslexicMono-Regular.woff2)format("woff2");font-weight:400;font-style:normal;font-display:swap}',
  '@font-face{font-family:OpenDyslexicMono;src:url(/fonts/OpenDyslexicMono-Regular.woff2)format("woff2");font-weight:400;font-style:normal;font-display:swap}',
].join("\n");

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

/** macOS: the ion-dist.asar of the Claude.app in `apps` (/Applications, then ~/Applications), or null. */
export function findMacIonDist(apps = MAC_APPS) {
  for (const dir of apps) {
    const file = path.join(dir, "Claude.app", "Contents", "Resources", "ion-dist.asar");
    if (rawFs.existsSync(file)) return file;
  }
  return null;
}

/**
 * What ion-dist was when read: an update replaces Claude.app's ion-dist.asar at the same path, and
 * offsets read from the old one's header would serve another file's bytes. Null once it is gone.
 */
export function ionStamp(ionDist) {
  const info = rawFs.statSync(ionDist, { throwIfNoEntry: false });
  return info ? `${info.ino}:${info.size}:${info.mtimeMs}` : null;
}

/** This computer's ion-dist, or null. */
export const ionDistHere = () => (process.platform === "darwin" ? findMacIonDist() : findIonDist());

const missing = (rel) => Object.assign(new Error(`ENOENT: ${rel}`), { code: "ENOENT" });

/**
 * ion-dist's files by path under it ("assets/v1/x.css"): read (a Buffer), list (a folder's names)
 * and stream. A path ending .asar is the archive: its JSON header names each file's offset after
 * the header, an unpacked one lies in <archive>.unpacked.
 */
export function ionFiles(ionDist) {
  if (!ionDist.endsWith(".asar")) {
    return {
      read: (rel) => readFileSync(path.join(ionDist, rel)),
      list: (rel) => readdirSync(path.join(ionDist, rel)),
      stream: (rel) => createReadStream(path.join(ionDist, rel)),
    };
  }
  const fd = rawFs.openSync(ionDist, "r");
  let header, base;
  try {
    const sizes = Buffer.alloc(8);
    rawFs.readSync(fd, sizes, 0, 8, 0);
    const pickle = Buffer.alloc(sizes.readUInt32LE(4));
    rawFs.readSync(fd, pickle, 0, pickle.length, 8);
    header = JSON.parse(pickle.toString("utf8", 8, 8 + pickle.readUInt32LE(4)));
    base = 8 + pickle.length;
  } finally {
    rawFs.closeSync(fd);
  }
  const entry = (rel) => rel.split("/").filter(Boolean).reduce((node, name) => (node?.files && Object.hasOwn(node.files, name) ? node.files[name] : undefined), header);
  const file = (rel) => {
    const found = entry(rel);
    if (!found || found.files || typeof found.size !== "number") throw missing(rel);
    return found.unpacked ? { unpacked: path.join(`${ionDist}.unpacked`, ...rel.split("/")) } : { start: base + Number(found.offset), size: found.size };
  };
  return {
    read(rel) {
      const at = file(rel);
      if (at.unpacked) return rawFs.readFileSync(at.unpacked);
      const bytes = Buffer.alloc(at.size);
      const fd = rawFs.openSync(ionDist, "r");
      try {
        rawFs.readSync(fd, bytes, 0, at.size, at.start);
      } finally {
        rawFs.closeSync(fd);
      }
      return bytes;
    },
    list(rel) {
      const found = entry(rel);
      if (!found?.files) throw missing(rel);
      return Object.keys(found.files);
    },
    stream(rel) {
      const at = file(rel);
      if (at.unpacked) return rawFs.createReadStream(at.unpacked);
      return at.size ? rawFs.createReadStream(ionDist, { start: at.start, end: at.start + at.size - 1 }) : Readable.from([]);
    },
  };
}

/** The @font-face rules of ion-dist's main window, re-rooted under /claude-fonts/, and the files they name. */
export function readFontFaces(ionDist) {
  const dist = ionFiles(ionDist);
  const html = dist.read("index.html").toString("utf8");
  const rules = new Set();
  const files = new Set();
  for (const [, sheet] of html.matchAll(/<link rel="stylesheet"[^>]*href="\/(assets\/[\w./-]+\.css)"/g)) {
    for (const rule of dist.read(sheet).toString("utf8").match(/@font-face\{[^}]*\}/g) ?? []) {
      rules.add(
        rule.replaceAll(/url\(\/assets\/v1\/([\w.-]+)\)/g, (_, file) => {
          files.add(file);
          return `url(/claude-fonts/${file})`;
        }),
      );
    }
  }
  return { css: [...rules].join("\n"), files, dist };
}

let found; // undefined until first asked; null without Claude Desktop (restart to pick one up)

function claudeFonts() {
  if (found === undefined || (found && ionStamp(found.dir) !== found.stamp)) {
    const dir = ionDistHere();
    try {
      found = dir ? { dir, stamp: ionStamp(dir), ...readFontFaces(dir) } : null;
    } catch {
      found = null;
    }
  }
  return found;
}

/** The @font-face rules (Claude Desktop's, else STAND_INS), their URLs under `origin` (the quick window is a file:// page). */
export function claudeFontCss(origin = "") {
  return (claudeFonts()?.css ?? STAND_INS).replaceAll("url(/", `url(${origin}/`);
}

/** Answers /claude-fonts.css, /claude-fonts/<file> and Claude's /third-party-notices.txt; false for any other path. */
export function serveClaudeFonts(req, res) {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const name = pathname.startsWith("/claude-fonts/") ? pathname.slice("/claude-fonts/".length) : null;
  if (name === null && pathname !== "/claude-fonts.css" && pathname !== "/third-party-notices.txt") return false;
  const fonts = claudeFonts();
  if (!fonts && pathname === "/third-party-notices.txt") return false; // codex-ui's own, for the stand-ins
  if (req.method !== "GET" && req.method !== "HEAD") res.writeHead(405).end();
  else if (pathname === "/claude-fonts.css") reply(req, res, "text/css; charset=utf-8", "no-cache", claudeFontCss());
  else if (!fonts || (name !== null && !fonts.files.has(name))) res.writeHead(404).end();
  else if (name !== null) reply(req, res, TYPES[path.extname(name)] ?? "application/octet-stream", "public, max-age=31536000, immutable", () => fonts.dist.stream(`assets/v1/${name}`));
  else reply(req, res, "text/plain; charset=utf-8", "no-cache", () => fonts.dist.stream("third-party-notices.txt"));
  return true;
}

/** `body`: the text, or a function opening the file's stream. */
export function reply(req, res, type, cache, body) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
  if (req.method === "HEAD") res.end();
  else if (typeof body === "string") res.end(body);
  else {
    let stream;
    try {
      stream = body();
    } catch {
      return void res.destroy();
    }
    stream.on("error", () => res.destroy()).pipe(res);
  }
}
