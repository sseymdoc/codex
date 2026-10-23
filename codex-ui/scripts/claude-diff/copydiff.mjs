// node copydiff.mjs <fileA> <fileB>: defaultMessage / id pairs only in one of two function bodies,
// with the zh-Hans text when the id/en/zh table exists.
import fs from "node:fs";
import { zhTable } from "./lib.mjs";
const [a, b] = process.argv.slice(2).map((f) => fs.readFileSync(f, "utf8"));
const zh = zhTable();
const ids = (s) => new Map([...s.matchAll(/defaultMessage:"((?:[^"\\]|\\.)*)",id:"([^"]+)"/g)].map((m) => [m[2], m[1]]));
const A = ids(a), B = ids(b);
for (const [id, en] of A) if (!B.has(id)) console.log(`- ${id}  ${en}  | ${zh.get(id)?.zh ?? "?"}`);
for (const [id, en] of B) if (!A.has(id)) console.log(`+ ${id}  ${en}  | ${zh.get(id)?.zh ?? "?"}`);
console.log(`(${A.size} → ${B.size} strings)`);
