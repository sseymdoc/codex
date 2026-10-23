// node tokdiff.mjs <chunk> <name...>: after fnmatch.mjs / anymatch.mjs wrote <out>/<chunk>.<name>.{A,B}.txt,
// the class tokens and i18n ids present in only one version of each function (string merges don't count).
import fs from "node:fs";
import { out, tokens } from "./lib.mjs";
const [chunk, ...names] = process.argv.slice(2);
for (const name of names) {
  let a, b;
  try {
    a = tokens(fs.readFileSync(out(`${chunk}.${name}.A.txt`), "utf8"));
    b = tokens(fs.readFileSync(out(`${chunk}.${name}.B.txt`), "utf8"));
  } catch { console.log(`${name}: no files`); continue; }
  const gone = [...a].filter((t) => !b.has(t)), added = [...b].filter((t) => !a.has(t));
  console.log(`${name}: ${gone.length ? `- ${gone.join(" ")}` : ""}${gone.length && added.length ? "  " : ""}${added.length ? `+ ${added.join(" ")}` : ""}${!gone.length && !added.length ? "same tokens" : ""}`);
}
