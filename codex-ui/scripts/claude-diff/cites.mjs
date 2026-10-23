// node cites.mjs <file...>: "chunk name" lines for every Claude function a codex-ui comment cites
// ("c227f4d5e `bQ`", "shared-5 Kd / wg", "cc43287c9 kP, Lp"), deduplicated.
import fs from "node:fs";
const out = new Set();
const NAME = "`?([A-Za-z_$][\\w$]{0,5})`?";
const re = new RegExp(`\\b(c[0-9a-f]{8}|shared-\\d+)\\s+${NAME}((?:\\s*(?:/|,)\\s*${NAME})*)`, "g");
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(re)) {
    const names = [m[2], ...[...(m[3] ?? "").matchAll(/`?([A-Za-z_$][\w$]{0,5})`?/g)].map((x) => x[1])];
    for (const n of names) if (!/^(and|or|the|in|is|at|on|to|of|as|it|its|for|via|by|a)$/.test(n)) out.add(`${m[1]} ${n}`);
  }
}
console.log([...out].sort().join("\n"));
