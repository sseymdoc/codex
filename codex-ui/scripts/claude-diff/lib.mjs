// Shared setup for the claude-diff scripts. The two Claude Desktop builds come from the environment:
// CLAUDE_DIFF_A (old) and CLAUDE_DIFF_B (new), each an ion-dist `assets/v1` folder. Output goes to
// CLAUDE_DIFF_OUT (default <os tmp>/claude-diff), the id/en/zh table is read from CLAUDE_DIFF_ZH
// (default <out>/id-en-zh.tsv) and is optional.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as acorn from "acorn";

export const OUT = path.resolve(process.env.CLAUDE_DIFF_OUT || path.join(os.tmpdir(), "claude-diff"));
fs.mkdirSync(OUT, { recursive: true });
export const out = (name) => path.join(OUT, name);

export function dir(v) {
  const d = process.env[`CLAUDE_DIFF_${v}`];
  if (!d) throw new Error(`set CLAUDE_DIFF_${v} to an ion-dist assets/v1 folder`);
  if (!fs.existsSync(d)) throw new Error(`CLAUDE_DIFF_${v}: ${d} does not exist`);
  return d;
}
// A chunk's name is its file name without the 8-character hash ("shared-5-DXoxd-Km.js" → "shared-5").
export const chunkName = (f) => f.replace(/-[\w-]{8}\.js$/, "");
// The file name of a chunk ("c227f4d5e" → "c227f4d5e-DhqumBwo.js"), or undefined.
export const chunkFile = (v, chunk) => fs.readdirSync(dir(v)).find((f) => f.endsWith(".js") && chunkName(f) === chunk);
export function readChunk(v, chunk) {
  const file = chunkFile(v, chunk);
  if (!file) throw new Error(`no chunk ${chunk} in ${v} (${dir(v)})`);
  return fs.readFileSync(path.join(dir(v), file), "utf8");
}
// Every .js chunk of a build, file name → source.
export const allChunks = (v) => new Map(fs.readdirSync(dir(v)).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(path.join(dir(v), f), "utf8")]));

export const parse = (src) => acorn.parse(src, { ecmaVersion: "latest", sourceType: "module" });

export const strsOf = (body) => {
  const strs = new Set();
  for (const m of body.matchAll(/"((?:[^"\\]|\\.){3,})"|`((?:[^`\\]|\\.){3,})`/g)) strs.add(m[1] ?? m[2]);
  return strs;
};
// Top-level functions of a chunk (declarations, and consts holding a function, call or arrow), name →
// { body, strs }. Export names map to their local bindings (export{local as name}).
export function functions(src) {
  const ast = parse(src);
  const fns = new Map();
  const add = (name, node) => {
    const body = src.slice(node.start, node.end);
    fns.set(name, { body, strs: strsOf(body) });
  };
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && node.id) add(node.id.name, node);
    if (node.type === "VariableDeclaration")
      for (const d of node.declarations) if (d.id.type === "Identifier" && d.init && /Function|Call|Arrow/.test(d.init.type)) add(d.id.name, d.init);
  }
  const ex = src.slice(src.lastIndexOf("export{"));
  for (const m of ex.matchAll(/([\w$]+) as ([\w$]+)/g)) if (fns.has(m[1]) && !fns.has(m[2])) fns.set(m[2], fns.get(m[1]));
  return fns;
}

// Class tokens and i18n ids (`id:<10 chars>`) of a body's string literals.
export const tokens = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const s = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, " ");
    if (/^[A-Za-z0-9+/]{10}$/.test(s)) { out.add(`id:${s}`); continue; }
    for (const t of s.split(/\s+/)) if (t && /[a-z]/.test(t) && !/[{}();=]/.test(t)) out.add(t);
  }
  return out;
};

// id → { en, zh } from the table zh-table.mjs writes; empty when there is none.
export function zhTable() {
  const file = process.env.CLAUDE_DIFF_ZH || out("id-en-zh.tsv");
  if (!fs.existsSync(file)) return new Map();
  return new Map(fs.readFileSync(file, "utf8").split("\n").map((l) => l.split("\t")).map(([id, en, zh]) => [id, { en, zh }]));
}
