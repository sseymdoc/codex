// Generates src/styles/claude.generated.css: the rules of Claude Desktop's own stylesheets that
// codex-ui's Claude-markup components use (the dframe sidebar and frame, written with Claude's class
// names and data attributes so each rule compares one to one with Claude's).
//
//   node scripts/claude-css.mjs [--claude <ion-dist/assets/v1>] [--check]
//
// Kept: every rule of c6a992d55-*.css (Tailwind theme, utilities, CDS components) and
// shared-styles-*.css (dframe) whose selector's classes all occur in the sources below, with the
// @property, theme variables and @keyframes they reference. @layer wrappers are dropped (codex-ui's
// CSS is unlayered; order is kept), other at-rules stay. Claude's Icon is a span with an inline
// font-size, so span[style*=font-size] becomes codex-ui's Icon, span[data-cds="Icon"]. --check exits 1
// when the output would change.
// Also reported: class names the sources share with codex-ui's own CSS, and --cds-* tokens the kept
// rules read that tokens.css does not define.

import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, "$1")), "..");
const SOURCES = ["src/components/Sidebar.tsx", "src/components/Frame.tsx"];
const OUT = "src/styles/claude.generated.css";
const OWN_CSS = ["tokens.css", "base.css", "shell.css", "pages.css", "browser.css", "settings.css", "transcript.css", "composer.css"].map((f) => `src/styles/${f}`);

const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
function claudeDir() {
  const given = opt("--claude");
  if (given) return given;
  const base = "C:/Program Files/WindowsApps";
  const installs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^Claude_\d/.test(d)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  if (!installs.length) throw new Error("Claude Desktop not found; pass --claude <ion-dist/assets/v1>");
  return `${base}/${installs.at(-1)}/app/resources/ion-dist/assets/v1`;
}
const DIR = claudeDir();
const sheet = (prefix) => {
  const file = fs.readdirSync(DIR).find((f) => f.startsWith(prefix) && f.endsWith(".css"));
  if (!file) throw new Error(`${prefix}*.css not in ${DIR}`);
  return { file, root: postcss.parse(fs.readFileSync(path.join(DIR, file), "utf8")) };
};

// Class tokens the sources mention: every string literal and template piece (with the strings in
// its ${…} parts), split on whitespace.
const used = new Set();
const addTokens = (text) => { for (const token of text.split(/\s+/)) if (token) used.add(token); };
for (const rel of SOURCES) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
    let text = m[1] ?? m[2] ?? m[3];
    if (m[3] !== undefined) {
      for (const part of text.matchAll(/\$\{([^}]*)\}/g)) for (const s of part[1].matchAll(/"([^"]*)"|'([^']*)'/g)) addTokens(s[1] ?? s[2]);
      text = text.replace(/\$\{[^}]*\}/g, " ");
    }
    addTokens(text);
  }
}

const unescape = (s) => s.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1");
function classesOf(selector) {
  // Class tokens outside attribute brackets and :not(): a rule like Claude's base
  // button:not(.hide-focus-ring):focus-visible styles everything but that class, so it is not kept.
  const out = [];
  let depth = 0;
  const nots = []; // paren depth at which each open :not( started
  let parens = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (depth === 0 && selector.startsWith(":not(", i)) { nots.push(parens); parens++; i += 4; }
    else if (depth === 0 && c === "(") parens++;
    else if (depth === 0 && c === ")") { parens--; if (nots.at(-1) === parens) nots.pop(); }
    else if (c === "." && depth === 0 && !nots.length) {
      let j = i + 1;
      while (j < selector.length && (/[\w-]/.test(selector[j]) || selector[j] === "\\" || selector.charCodeAt(j) > 127)) j += selector[j] === "\\" ? 2 : 1;
      out.push(unescape(selector.slice(i + 1, j)));
      i = j - 1;
    }
  }
  return out;
}

const kept = []; // [{ sheet, node (cloned rule), path: [at-rule params] }]
const varsRead = new Set();
const animations = new Set();
function collect({ file, root }) {
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const selectors = rule.selectors.filter((sel) => {
      const classes = classesOf(sel);
      return classes.length > 0 && classes.every((c) => used.has(c));
    });
    if (!selectors.length) return;
    // Nested rules (CSS nesting) keep their parents' selectors as they are.
    const chain = [];
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) chain.unshift(p);
    if (chain.some((p) => p.type === "rule")) return; // ponytail: Claude's sheets ship flattened; nested rules would need their parent selector rewritten.
    const clone = rule.clone({ selectors: selectors.map((sel) => sel.replace(/span\[style\*=("?)font-size\1\]/g, 'span[data-cds="Icon"]')) });
    clone.walkDecls((d) => {
      for (const v of d.value.matchAll(/var\((--[\w-]+)/g)) varsRead.add(v[1]);
      if (d.prop.startsWith("--")) varsRead.add(d.prop);
      if (/^animation(-name)?$/.test(d.prop)) for (const name of d.value.split(/[\s,]+/)) animations.add(name);
    });
    kept.push({ file, clone, at: chain.filter((p) => p.type === "atrule" && p.name !== "layer").map((p) => `@${p.name} ${p.params}`) });
  });
}
const main = sheet("c6a992d55-");
const frame = sheet("shared-styles-");
collect(main);
collect(frame);

// Theme variables (@layer theme :root,:host) the kept rules read, transitively.
const themeDecls = new Map();
main.root.walkAtRules("layer", (layer) => {
  if (layer.params !== "theme") return;
  layer.walkRules((rule) => rule.walkDecls((d) => d.prop.startsWith("--") && themeDecls.set(d.prop, d.value)));
});
const ownCss = OWN_CSS.map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n");
const ownVars = new Set([...ownCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
const theme = new Map();
const queue = [...varsRead];
while (queue.length) {
  const name = queue.pop();
  if (theme.has(name) || !themeDecls.has(name) || ownVars.has(name)) continue;
  const value = themeDecls.get(name);
  theme.set(name, value);
  for (const v of value.matchAll(/var\((--[\w-]+)/g)) queue.push(v[1]);
  for (const v of value.matchAll(/var\((--[\w-]+)/g)) varsRead.add(v[1]);
}

// @property registrations and @keyframes.
const props = [];
const frames = [];
for (const { root } of [main, frame])
  root.walkAtRules((at) => {
    if (at.name === "property" && varsRead.has(at.params.trim())) props.push(at.clone());
    if (/keyframes$/.test(at.name) && animations.has(at.params.trim())) frames.push(at.clone());
  });

// Output.
const lines = [
  "/* Generated by scripts/claude-css.mjs from Claude Desktop's ion-dist stylesheets",
  `   (${main.file}, ${frame.file}): the rules codex-ui's Claude-markup components use.`,
  "   Do not edit; change the markup or the script and run it again. */",
  "",
];
if (theme.size) lines.push(":root {", ...[...theme].map(([k, v]) => `  ${k}: ${v};`), "}", "");
for (const p of props) lines.push(p.toString(), "");
let open = [];
for (const { clone, at } of kept) {
  let same = 0;
  while (same < open.length && same < at.length && open[same] === at[same]) same++;
  while (open.length > same) { open.pop(); lines.push("  ".repeat(open.length) + "}"); }
  for (const a of at.slice(same)) { lines.push("  ".repeat(open.length) + `${a} {`); open.push(a); }
  const pad = "  ".repeat(open.length);
  lines.push(pretty(clone, pad));
}
while (open.length) { open.pop(); lines.push("  ".repeat(open.length) + "}"); }
for (const f of frames) lines.push("", pretty(f, ""));
const css = lines.join("\n") + "\n";

/** One rule or at-rule per block, a declaration per line. */
function pretty(node, pad) {
  node.raws.before = "";
  node.raws.between = node.type === "decl" ? ": " : " ";
  if (node.type === "rule") node.selector = node.selectors.join(`,\n${pad}`);
  node.walk?.((child) => {
    let depth = 1;
    for (let p = child.parent; p && p !== node; p = p.parent) depth++;
    const inner = pad + "  ".repeat(depth);
    child.raws.before = `\n${inner}`;
    if (child.type === "decl") child.raws.between = ": ";
    else {
      child.raws.between = " ";
      child.raws.after = `\n${inner}`;
      if (child.type === "rule") child.selector = child.selectors.join(`,\n${inner}`);
    }
  });
  node.raws.after = `\n${pad}`;
  node.raws.semicolon = true;
  node.walk?.((child) => { if (child.nodes) child.raws.semicolon = true; });
  return pad + node.toString();
}

const outPath = path.join(ROOT, OUT);
if (argv.includes("--check")) {
  const now = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
  if (now !== css) { console.error(`${OUT} is out of date; run node scripts/claude-css.mjs`); process.exit(1); }
} else fs.writeFileSync(outPath, css);

// Reports.
const ownClasses = new Set([...ownCss.matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => unescape(m[1])));
const keptClasses = new Set(kept.flatMap(({ clone }) => clone.selectors.flatMap(classesOf)));
const clash = [...keptClasses].filter((c) => ownClasses.has(c));
const definedHere = new Set(kept.flatMap(({ clone }) => clone.nodes.filter((d) => d.type === "decl" && d.prop.startsWith("--")).map((d) => d.prop)));
const registered = new Set(props.map((p) => p.params.trim()));
const missing = [...varsRead].filter((v) => !ownVars.has(v) && !theme.has(v) && !definedHere.has(v) && !registered.has(v)).sort();
console.log(`${kept.length} rules, ${theme.size} theme vars, ${props.length} @property, ${frames.length} @keyframes → ${OUT}`);
if (clash.length) console.log("classes also styled by codex-ui CSS:", clash.join(" "));
if (missing.length) console.log("variables read that nothing defines (most have a fallback):", missing.join(" "));
