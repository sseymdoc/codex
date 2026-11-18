// node uses.mjs <module-prefix> <exportName> [n=4]: where other B chunks use that export (by the local
// name they import it as), with some context.
import { allChunks } from "./lib.mjs";
const [mod, name, n = "4"] = process.argv.slice(2);
const esc = (s) => s.replace(/[$]/g, "\\$");
for (const [f, s] of allChunks("B")) {
  for (const m of s.matchAll(new RegExp(`import\\{([^}]*)\\}from"\\./${mod}-[\\w-]{8}\\.js"`, "g"))) {
    const hit = m[1].split(",").map((p) => p.trim().split(" as ")).find(([e]) => e === name);
    if (!hit) continue;
    const local = hit[1] ?? hit[0];
    let k = 0;
    for (const x of s.matchAll(new RegExp(`[^\\w$]${esc(local)}[^\\w$]`, "g"))) {
      if (x.index < m.index + m[0].length) continue;
      if (k++ >= Number(n)) break;
      console.log(`${f} (${local}): …${s.slice(Math.max(0, x.index - 180), x.index + 100).replace(/\n/g, " ")}…`);
    }
  }
}
