// The installed ChatGPT desktop app's own schedule code (rrule.js plus its next run, jittered next run,
// heartbeat interval, jitter span, one-shot test and automation.toml writer), loaded out of its
// app.asar for tests to compare against. Null when the app is missing or its build no longer has these
// where they are looked for (26.1027's webpack main-process bundle: early-bootstrap.js and its chunks).
import { closeSync, openSync, readSync } from "node:fs";
import { createRequire } from "node:module";
import { findCodexAsar } from "../../server/orbit.mjs";

/** The asar's root package.json version and its .vite/build scripts by name. */
function build(file) {
  const fd = openSync(file, "r");
  try {
    const read = (size, at) => { const bytes = Buffer.alloc(size); readSync(fd, bytes, 0, size, at); return bytes; };
    const head = read(16, 0);
    const tree = JSON.parse(read(head.readUInt32LE(12), 16).toString("utf8")).files ?? {};
    const base = 8 + head.readUInt32LE(4);
    const text = (entry) => read(entry.size, base + Number(entry.offset)).toString("utf8");
    const scripts = {};
    for (const [name, entry] of Object.entries(tree[".vite"]?.files?.build?.files ?? {})) {
      if (/\.js$/.test(name) && !entry.unpacked && typeof entry.size === "number") scripts[name] = text(entry);
    }
    let version = null;
    try { version = JSON.parse(text(tree["package.json"])).version ?? null; } catch {}
    return { version, scripts };
  } finally {
    closeSync(fd);
  }
}

// Index of the quote or backtick that closes the string or template literal opening at `at`.
function quoteEnd(text, at) {
  const quote = text[at];
  let i = at + 1;
  while (i < text.length && text[i] !== quote) {
    if (text[i] === "\\") i += 2;
    else if (quote === "`" && text[i] === "$" && text[i + 1] === "{") i = blockEnd(text, i + 1);
    else i += 1;
  }
  return i;
}

// Index just past the `}` closing the block that opens at `open`. Regex literals are not expected in
// the bodies cut out here; a cut that goes wrong fails to compile and the oracle is null.
function blockEnd(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "{") depth += 1;
    else if (c === "}") { if (--depth === 0) return i + 1; }
    else if (c === '"' || c === "'" || c === "`") i = quoteEnd(text, i);
  }
  return text.length;
}

/** The name of the function declaration that holds `needle`. */
function owner(source, needle) {
  const at = source.indexOf(needle);
  return at < 0 ? null : /^function (\w+)\(/.exec(source.slice(source.lastIndexOf("function ", at)))?.[1] ?? null;
}

/** The inline `function(…){…}` expression that holds `needle`. */
function inline(source, needle) {
  const at = source.indexOf(needle);
  if (at < 0) return null;
  const start = source.lastIndexOf("function(", at);
  return start < 0 ? null : source.slice(start, blockEnd(source, source.indexOf("{", start)));
}

// electron stands in as a do-nothing value: the schedule code never touches it, other top-level code may.
const ELECTRON = new Proxy(function () {}, {
  get: (_, key) => (key === "then" || typeof key === "symbol" ? undefined : ELECTRON),
  apply: () => ELECTRON,
  construct: () => ELECTRON,
});
const TSLIB = {
  __assign: Object.assign,
  __spreadArray: (to, from) => to.concat(Array.prototype.slice.call(from)),
  __extends: (child, parent) => { Object.setPrototypeOf(child, parent); child.prototype = Object.create(parent.prototype, { constructor: { value: child, writable: true, configurable: true } }); },
};
const nodeRequire = createRequire(import.meta.url);
function external(name) {
  if (name === "electron") return ELECTRON;
  try { return nodeRequire(name); } catch (error) { if (name === "tslib") return TSLIB; throw error; }
}

function load({ version, scripts }) {
  const entry = scripts["early-bootstrap.js"];
  // The entry ends by running the app (`var o=r(74456);module.exports=o})();`): export its require instead.
  const tail = /var (\w+)=(\w+)\(\d+\);module\.exports=\1\}\)\(\);/;
  if (!entry || !tail.test(entry)) return null;
  const module = { exports: {} };
  new Function("module", "exports", "require", entry.replace(tail, "module.exports=$2})();"))(module, module.exports, external);
  const require = module.exports;
  if (typeof require !== "function" || !require.m) return null;
  for (const [name, text] of Object.entries(scripts)) {
    if (!/^early-bootstrap-\d+-\w+\.js$/.test(name)) continue;
    const chunk = {};
    new Function("exports", "require", text)(chunk, external);
    Object.assign(require.m, chunk.modules ?? {});
  }
  const id = Object.keys(require.m).find((key) => {
    const text = Function.prototype.toString.call(require.m[key]);
    return text.includes("({rrule:e,now:t})") && text.includes("automation.toml");
  });
  if (!id) return null;
  const source = Function.prototype.toString.call(require.m[id]);
  const head = /^\w*\((\w+),(\w+),(\w+)\)\{/.exec(source);
  const rrule = /(\w+)\.(\w+)\.optionsToString\(/.exec(source);
  const parts = {
    pl: /function (\w+)\(\{rrule:e,now:t\}\)/.exec(source)?.[1],
    ml: /function (\w+)\(\{automation:e,jitterSalt:/.exec(source)?.[1],
    gl: owner(source, ".SECONDLY:return null}"),
    hl: owner(source, "options.count===1}catch{return!1}"),
    _l: inline(source, ".options.count)return 0;"),
    tl: inline(source, "version = "),
    K: rrule && `${rrule[1]}.${rrule[2]}`,
  };
  if (!head || Object.values(parts).some((part) => !part)) return null;
  const expose = `;${head[2]}.__oracle={${Object.entries(parts).map(([key, value]) => `${key}:${value}`).join(",")}}`;
  const body = source.slice(head[0].length, -1);
  require.m[id] = new Function("require", `return function(${head.slice(1).join(",")}){${body}${expose}}`)(external);
  const oracle = require(id).__oracle;
  return oracle && { ...oracle, version };
}

let cached;
/** `{ pl, ml, gl, _l, hl, tl, K, version }` from the installed app, or null. */
export async function chatgptOracle() {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const file = await findCodexAsar();
    cached = file ? load(build(file)) : null;
  } catch {}
  return cached;
}
