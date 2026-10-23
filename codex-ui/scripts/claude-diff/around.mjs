// node around.mjs <A|B> <chunk> <needle> [out]: the top-level declaration holding the first occurrence of
// needle, written to out (default <out>/around.txt), with its name and length printed.
import fs from "node:fs";
import { out, parse, readChunk } from "./lib.mjs";
const [v, chunk, needle, file = out("around.txt")] = process.argv.slice(2);
const src = readChunk(v, chunk);
const at = src.indexOf(needle);
if (at < 0) { console.log("needle not found"); process.exit(1); }
for (const n of parse(src).body) if (n.start <= at && at < n.end) {
  let name = n.id?.name;
  if (n.type === "VariableDeclaration") name = n.declarations.find((d) => d.start <= at && at < d.end)?.id.name;
  fs.writeFileSync(file, src.slice(n.start, n.end));
  console.log(`${name ?? n.type} ${n.end - n.start} chars → ${file}`);
}
