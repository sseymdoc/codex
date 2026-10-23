// node exists.mjs <cites-file>: for each "chunk name", whether the name is a top-level binding (or an
// export alias) in the A chunk and in the B chunk, and what kind of binding.
import fs from "node:fs";
import { chunkFile, parse, readChunk } from "./lib.mjs";
const cache = new Map();
function bindings(v, chunk) {
  const key = v + chunk;
  if (cache.has(key)) return cache.get(key);
  const file = chunkFile(v, chunk);
  const map = new Map();
  if (file) {
    const src = readChunk(v, chunk);
    const ast = parse(src);
    for (const n of ast.body) {
      if (n.type === "FunctionDeclaration" && n.id) map.set(n.id.name, "fn");
      if (n.type === "ClassDeclaration" && n.id) map.set(n.id.name, "class");
      if (n.type === "VariableDeclaration")
        for (const d of n.declarations) if (d.id.type === "Identifier") map.set(d.id.name, d.init ? d.init.type.replace("Expression", "").replace("Literal", "lit") : "var");
    }
    const ex = src.slice(src.lastIndexOf("export{"));
    for (const m of ex.matchAll(/([\w$]+) as ([\w$]+)/g)) if (map.has(m[1]) && !map.has(m[2])) map.set(m[2], `export→${m[1]}:${map.get(m[1])}`);
  }
  const r = { file: !!file, map };
  cache.set(key, r);
  return r;
}
for (const line of fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/)) {
  const [chunk, name] = line.split(" ");
  const a = bindings("A", chunk), b = bindings("B", chunk);
  const fa = a.file ? a.map.get(name) ?? "-" : "nochunk";
  const fb = b.file ? b.map.get(name) ?? "-" : "nochunk";
  console.log(`${chunk} ${name}\tA:${fa}\tB:${fb}`);
}
