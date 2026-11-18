// node fnmatch.mjs <chunk>[:<chunkB>] <name...>: for each A function name, the B function whose string
// literals overlap most, the overlap, and the strings only in one side. "<chunkA>:<chunkB>" matches an
// A chunk against a different B chunk. Writes the bodies to <out>/<chunk>.<name>.{A,B}.txt for diffing.
import fs from "node:fs";
import { functions, out, readChunk } from "./lib.mjs";
const [pair, ...names] = process.argv.slice(2);
const [chunk, chunkB = chunk] = pair.split(":");
const A = functions(readChunk("A", chunk)), B = functions(readChunk("B", chunkB));
const norm = (s) => s.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (w) => (/^(className|children|aria-[a-z]+|data-[a-z-]+|true|false|null|void|return|let|var|function|if|else|for|of|in|new|typeof|style)$/.test(w) ? w : "X"));
for (const name of names) {
  const a = A.get(name);
  if (!a) { console.log(`${name}: not in A`); continue; }
  let best = null;
  for (const [bn, b] of B) {
    let inter = 0;
    for (const s of a.strs) if (b.strs.has(s)) inter++;
    const score = inter / Math.max(1, a.strs.size + b.strs.size - inter);
    if (!best || score > best.score) best = { bn, score, b };
  }
  if (!best || best.score === 0) { console.log(`${name}: no match`); continue; }
  const onlyA = [...a.strs].filter((s) => !best.b.strs.has(s));
  const onlyB = [...best.b.strs].filter((s) => !a.strs.has(s));
  const same = norm(a.body) === norm(best.b.body);
  console.log(`${name} -> ${best.bn}  overlap ${best.score.toFixed(2)}  ${same ? "same shape" : `shape differs (${a.body.length} → ${best.b.body.length} chars)`}`);
  for (const s of onlyA) console.log(`   - ${s.slice(0, 200)}`);
  for (const s of onlyB) console.log(`   + ${s.slice(0, 200)}`);
  fs.writeFileSync(out(`${chunk}.${name}.A.txt`), a.body);
  fs.writeFileSync(out(`${chunk}.${name}.B.txt`), best.b.body);
}
