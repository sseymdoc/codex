// node classes.mjs <file>: the class-like string literals of an extracted body, in order, with a little
// left context (the prop or call they belong to). ${…} kept as written.
import fs from "node:fs";
const src = fs.readFileSync(process.argv[2], "utf8");
for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
  const s = m[1] ?? m[2];
  if (!/[a-z]-|^(flex|grid|block|contents|hidden|relative|absolute|truncate|rounded|isolate)\b/.test(s) || /^[A-Za-z0-9+/]{10}$/.test(s)) continue;
  const ctx = src.slice(Math.max(0, m.index - 40), m.index).replace(/\s+/g, " ");
  console.log(`${ctx.padStart(40)} | ${s}`);
}
