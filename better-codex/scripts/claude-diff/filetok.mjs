// node filetok.mjs <a.txt> <b.txt>: class tokens and i18n ids only in one of two extracted bodies.
import fs from "node:fs";
import { tokens } from "./lib.mjs";
const [a, b] = process.argv.slice(2).map((f) => tokens(fs.readFileSync(f, "utf8")));
console.log(`- ${[...a].filter((t) => !b.has(t)).join(" ")}`);
console.log(`+ ${[...b].filter((t) => !a.has(t)).join(" ")}`);
