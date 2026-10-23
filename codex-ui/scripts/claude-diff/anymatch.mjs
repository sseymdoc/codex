// node anymatch.mjs <chunk> <name...>: like fnmatch.mjs, but looks for each A function's counterpart in
// any B chunk: candidate chunks are the ones holding most of the function's i18n ids and long string
// literals; the best function there by string overlap is reported and its body written to
// <out>/<chunk>.<name>.{A,B}.txt (so tokdiff.mjs / copydiff.mjs work on it).
import fs from "node:fs";
import { allChunks, chunkName, functions, out, readChunk } from "./lib.mjs";
const [chunk, ...names] = process.argv.slice(2);
const A = functions(readChunk("A", chunk));
const bSrc = allChunks("B");
const parsed = new Map();
for (const name of names) {
  const a = A.get(name);
  if (!a) { console.log(`${name}: not in A`); continue; }
  const probes = [...a.strs].filter((s) => /^[A-Za-z0-9+/]{10}$/.test(s) || s.length >= 24);
  const hits = new Map();
  for (const [f, s] of bSrc) {
    let n = 0;
    for (const p of probes) if (s.includes(`"${p}"`) || s.includes(`\`${p}\``)) n++;
    if (n) hits.set(f, n);
  }
  const cands = [...hits].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f]) => f);
  let best = null;
  for (const f of cands) {
    if (!parsed.has(f)) parsed.set(f, functions(bSrc.get(f)));
    for (const [bn, b] of parsed.get(f)) {
      let inter = 0;
      for (const s of a.strs) if (b.strs.has(s)) inter++;
      const score = inter / Math.max(1, a.strs.size + b.strs.size - inter);
      if (!best || score > best.score) best = { f, bn, b, score };
    }
  }
  if (!best || best.score === 0) { console.log(`${name}: no match (${probes.length} probes)`); continue; }
  const onlyA = [...a.strs].filter((s) => !best.b.strs.has(s));
  const onlyB = [...best.b.strs].filter((s) => !a.strs.has(s));
  console.log(`${name} -> ${chunkName(best.f)} ${best.bn}  overlap ${best.score.toFixed(2)}  (${a.body.length} → ${best.b.body.length} chars)`);
  for (const s of onlyA) console.log(`   - ${s.slice(0, 200)}`);
  for (const s of onlyB) console.log(`   + ${s.slice(0, 200)}`);
  fs.writeFileSync(out(`${chunk}.${name}.A.txt`), a.body);
  fs.writeFileSync(out(`${chunk}.${name}.B.txt`), best.b.body);
}
