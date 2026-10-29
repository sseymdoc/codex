// ChatGPT 26.1023's own schedule code (rrule.js plus pl/ml/gl/_l/hl/tl), cut out of the installed
// Codex app's app.asar for tests to compare against. Null when that build is not installed.
import { closeSync, openSync, readdirSync, readSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { findCodexAsar } from "../../server/orbit.mjs";

/** 26.1023 itself where a newer build sits beside it (its minified names differ), else the installed app. */
function asar() {
  if (process.platform === "win32" && !process.env.CODEX_ORBIT_ASAR) {
    const root = path.join(process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files", "WindowsApps");
    let names = [];
    try { names = readdirSync(root); } catch {}
    const pinned = names.find((name) => /^OpenAI\.Codex_26\.1023\.\d+\.\d+_x64__/.test(name));
    if (pinned) return Promise.resolve(path.join(root, pinned, "app", "resources", "app.asar"));
  }
  return findCodexAsar();
}

const PIECES = [
  ["var no=[`MO`", "var dc=`automations`"], // rrule.js, then q/ac/sc/cc/lc/uc
  ["gc=300,", ",Cc=!1"], // jitter span and the key sets
  ["function pl({rrule", "function yl("], // pl, ml, hl, gl, _l, vl
  ["var Ml={MO:", "function Hl("], // Nl, Pl, Fl and their helpers
  ["function tl(", "function nl("], // automation.toml writer
];

function source(file) {
  const fd = openSync(file, "r");
  try {
    const read = (size, at) => { const bytes = Buffer.alloc(size); readSync(fd, bytes, 0, size, at); return bytes; };
    const head = read(16, 0);
    const files = JSON.parse(read(head.readUInt32LE(12), 16).toString("utf8")).files?.[".vite"]?.files?.build?.files ?? {};
    const base = 8 + head.readUInt32LE(4);
    for (const [name, entry] of Object.entries(files)) {
      if (!/^src-[\w-]+\.js$/.test(name) || entry.unpacked || typeof entry.size !== "number") continue;
      const text = read(entry.size, base + Number(entry.offset)).toString("utf8");
      if (text.includes("function pl({rrule:e,now:t})")) return text;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

let cached;
/** `{ pl, ml, gl, _l, hl, tl, K }` from the installed app, or null. */
export async function chatgptOracle() {
  if (cached !== undefined) return cached;
  cached = null;
  const file = await asar().catch(() => null);
  let text = null;
  try { text = file && source(file); } catch {}
  if (!text) return null;
  const parts = [];
  for (const [from, to] of PIECES) {
    const start = text.indexOf(from), end = start < 0 ? -1 : text.indexOf(to, start);
    if (end < 0) return null;
    parts.push(from === "gc=300," ? `var ${text.slice(start, end)};` : text.slice(start, end));
  }
  const tslib = {
    __assign: Object.assign,
    __spreadArray: (to, from) => to.concat(Array.prototype.slice.call(from)),
    __extends: (child, parent) => { Object.setPrototypeOf(child, parent); child.prototype = Object.create(parent.prototype, { constructor: { value: child, writable: true, configurable: true } }); },
  };
  const automations = { ya: (rrule) => rrule?.trim() || "FREQ=HOURLY;INTERVAL=24;BYMINUTE=0", ga: (automation) => automation.kind === "cron" };
  cached = new Function("D", "n", "f", `var pc=1;\n${parts.join("\n")}\nreturn { pl, ml, gl, _l, hl, tl, K };`)(tslib, automations, { createHash });
  return cached;
}
