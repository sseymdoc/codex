// node idmatch.mjs <chunk> <name...>: the i18n ids an A function uses, and which B chunks / top-level
// functions hold each id now (functions found by the nearest enclosing declaration).
import { allChunks, chunkName, parse, readChunk, zhTable } from "./lib.mjs";
const [chunk, ...names] = process.argv.slice(2);
const zh = zhTable();
const srcA = readChunk("A", chunk);
const astA = parse(srcA);
const ex = srcA.slice(srcA.lastIndexOf("export{"));
const local = (n) => ex.match(new RegExp(`([\\w$]+) as ${n.replace(/\$/g, "\\$")}[,}]`))?.[1] ?? n;
function bodyOf(ast, src, name) {
  for (const node of ast.body) {
    if (node.type === "FunctionDeclaration" && node.id?.name === name) return src.slice(node.start, node.end);
    if (node.type === "VariableDeclaration") for (const d of node.declarations) if (d.id.name === name && d.init) return src.slice(d.init.start, d.init.end);
  }
  return null;
}
const bSrc = allChunks("B");
const parsed = new Map();
function enclosing(file, index) {
  if (!parsed.has(file)) parsed.set(file, parse(bSrc.get(file)));
  for (const node of parsed.get(file).body) if (node.start <= index && index < node.end) {
    if (node.type === "FunctionDeclaration") return node.id.name;
    if (node.type === "VariableDeclaration") for (const d of node.declarations) if (d.start <= index && index < d.end) return d.id.name;
    return node.type;
  }
  return "?";
}
for (const name of names) {
  const body = bodyOf(astA, srcA, local(name));
  if (!body) { console.log(`${name}: not found`); continue; }
  const ids = [...new Set([...body.matchAll(/id:"([A-Za-z0-9+/]{10})"/g)].map((m) => m[1]))];
  console.log(`== ${name} (${ids.length} ids)`);
  for (const id of ids) {
    const where = [];
    for (const [f, s] of bSrc) { const i = s.indexOf(`id:"${id}"`); if (i >= 0) where.push(`${chunkName(f)}:${enclosing(f, i)}`); }
    const text = zh.get(id);
    console.log(`  ${id}  ${text ? `${text.en} | ${text.zh}` : "?"}  →  ${where.join(", ") || "GONE"}`);
  }
}
