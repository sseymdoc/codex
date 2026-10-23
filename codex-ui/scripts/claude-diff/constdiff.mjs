// node constdiff.mjs <chunk> <name...>: for an A top-level constant (string, template, object, array),
// whether the same source text exists in the B chunk, else the closest constant there by class-token
// overlap and the tokens only on each side.
import { parse, readChunk } from "./lib.mjs";
const [chunk, ...names] = process.argv.slice(2);
function load(v) {
  const src = readChunk(v, chunk);
  const ast = parse(src);
  const consts = new Map();
  for (const n of ast.body)
    if (n.type === "VariableDeclaration")
      for (const d of n.declarations)
        if (d.id.type === "Identifier" && d.init && /Literal|Template|Object|Array|Call|Identifier/.test(d.init.type)) consts.set(d.id.name, src.slice(d.init.start, d.init.end));
  return { src, consts };
}
const A = load("A"), B = load("B");
// Identifiers are minified per build: compare with ${…} references and bare names masked.
const mask = (s) => s.replace(/\$\{[^}]*\}/g, "${}");
const toks = (s) => new Set(mask(s).split(/[\s"'`{},:()[\]]+/).filter((t) => t.length > 1 && !/^\$\{\}$/.test(t)));
for (const name of names) {
  const a = A.consts.get(name);
  if (a === undefined) { console.log(`${name}: not a constant in A`); continue; }
  const exact = [...B.consts].find(([, v]) => mask(v) === mask(a));
  if (exact) { console.log(`${name} = ${exact[0]}  same  ${a.slice(0, 140)}`); continue; }
  const ta = toks(a);
  let best = null;
  for (const [bn, v] of B.consts) {
    const tb = toks(v);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const score = inter / Math.max(1, ta.size + tb.size - inter);
    if (!best || score > best.score) best = { bn, v, tb, score };
  }
  const onlyA = [...ta].filter((t) => !best.tb.has(t));
  const onlyB = [...best.tb].filter((t) => !ta.has(t));
  console.log(`${name} ~ ${best.bn} (${best.score.toFixed(2)})  A: ${a.slice(0, 200)}`);
  console.log(`      B: ${best.v.slice(0, 200)}`);
  if (onlyA.length) console.log(`      - ${onlyA.join(" ").slice(0, 300)}`);
  if (onlyB.length) console.log(`      + ${onlyB.join(" ").slice(0, 300)}`);
}
