// Run with `pnpm test`.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findIonDist, findMacIonDist, ionFiles, readFontFaces, STAND_INS } from "./claude-fonts.mjs";
import { readMarks } from "./claude-marks.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the stand-ins cover Claude's families with files public/fonts has", () => {
  const families = new Set([...STAND_INS.matchAll(/font-family:([^;]+);/g)].map((m) => m[1]));
  for (const family of ["Anthropicons-Variable", "anthropic-sans", "anthropic-mono", "Anthropic Serif Fallback Georgia", "OpenDyslexic", "OpenDyslexic Mono"]) {
    assert.ok(families.has(family), family);
  }
  for (const [, file] of STAND_INS.matchAll(/url\(\/fonts\/([^)]+)\)/g)) assert.ok(existsSync(path.join(ROOT, "public", "fonts", file)), file);
});

test("every icon src draws has a Phosphor stand-in (src/fonts/icons.json, then build-icons.py)", () => {
  const ui = readFileSync(path.join(ROOT, "src", "components", "ui.tsx"), "utf8");
  const glyphs = new Set([...ui.matchAll(/(\w+): 0x[0-9a-f]+/g)].map((m) => m[1]));
  const icons = JSON.parse(readFileSync(path.join(ROOT, "src", "fonts", "icons.json"), "utf8"));
  const missing = new Set();
  for (const file of readdirSync(path.join(ROOT, "src"), { recursive: true })) {
    if (!/\.tsx?$/.test(file)) continue;
    for (const [, name] of readFileSync(path.join(ROOT, "src", file), "utf8").matchAll(/"(\w+)"/g)) {
      if (glyphs.has(name) && !(name in icons)) missing.add(name);
    }
  }
  assert.deepEqual([...missing], []);
});

test("the newest Claude package's main-window @font-face rules move under /claude-fonts/", () => {
  const apps = mkdtempSync(path.join(tmpdir(), "claude-fonts-"));
  try {
    const install = (name, html, sheets = {}) => {
      const dist = path.join(apps, name, "app", "resources", "ion-dist");
      mkdirSync(path.join(dist, "assets", "v1"), { recursive: true });
      writeFileSync(path.join(dist, "index.html"), html);
      for (const [file, css] of Object.entries(sheets)) writeFileSync(path.join(dist, "assets", "v1", file), css);
      return dist;
    };
    install("Claude_2.9.0.0_x64__pub", "<html></html>");
    const newest = install(
      "Claude_2.10.0.0_x64__pub",
      '<link rel="preload" href="/assets/v1/a.woff2" as="font"><link rel="stylesheet" crossorigin href="/assets/v1/main.css">',
      {
        "main.css":
          '.x{color:red}@font-face{font-family:anthropic-sans;src:url(/assets/v1/a.woff2)format("woff2");font-weight:300 800}' +
          "@font-face{font-family:Fallback;src:local(Georgia)}@font-face{font-family:anthropic-sans;src:url(/assets/v1/a.woff2)format(\"woff2\");font-weight:300 800}",
        "other.css": '@font-face{font-family:unused;src:url(/assets/v1/b.woff2)format("woff2")}',
      },
    );
    mkdirSync(path.join(apps, "Claude_3.0.0.0_x64__pub")); // mid-install: no ion-dist yet
    mkdirSync(path.join(apps, "NotClaude_9.0.0.0_x64__pub"));

    assert.equal(findIonDist(apps), newest);
    const { css, files } = readFontFaces(newest);
    assert.equal(
      css,
      '@font-face{font-family:anthropic-sans;src:url(/claude-fonts/a.woff2)format("woff2");font-weight:300 800}\n@font-face{font-family:Fallback;src:local(Georgia)}',
    );
    assert.deepEqual([...files], ["a.woff2"]);
    assert.equal(findIonDist(path.join(apps, "missing")), null);
  } finally {
    rmSync(apps, { recursive: true, force: true });
  }
});

/** An asar archive as Electron writes one: a size pickle, the header pickle (each file's size and offset), then the files. */
function writeAsar(file, tree) {
  const data = [];
  let offset = 0;
  const node = (value) => {
    if (typeof value !== "string") return { files: Object.fromEntries(Object.entries(value).map(([name, child]) => [name, node(child)])) };
    const bytes = Buffer.from(value);
    data.push(bytes);
    offset += bytes.length;
    return { size: bytes.length, offset: String(offset - bytes.length) };
  };
  const json = Buffer.from(JSON.stringify(node(tree)));
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const sizes = Buffer.alloc(8);
  sizes.writeUInt32LE(4, 0);
  sizes.writeUInt32LE(header.length, 4);
  writeFileSync(file, Buffer.concat([sizes, header, ...data]));
}

test("macOS: Claude.app's ion-dist.asar gives its fonts and working mark as a folder would", async () => {
  const apps = mkdtempSync(path.join(tmpdir(), "claude-asar-"));
  try {
    const resources = path.join(apps, "Claude.app", "Contents", "Resources");
    mkdirSync(resources, { recursive: true });
    const asar = path.join(resources, "ion-dist.asar");
    writeAsar(asar, {
      "index.html": '<link rel="stylesheet" crossorigin href="/assets/v1/main.css">',
      "third-party-notices.txt": "licences",
      assets: { v1: {
        "main.css": '@font-face{font-family:anthropic-sans;src:url(/assets/v1/a.woff2)format("woff2")}',
        "a.woff2": "wOF2-font",
        "c8677db5f-X.js": 'var e={"default.in":{frames:16,speed:33.3333}},t=new URL("/assets/v1/m.webp",""+import.meta.url).href,E=48,k={"default.in":t};export{E as SHEET_FRAME,k as SHEET_URLS};',
        "m.webp": "RIFF-webp",
      } },
    });
    assert.equal(findMacIonDist([path.join(apps, "missing"), apps]), asar);
    assert.equal(findMacIonDist([path.join(apps, "missing")]), null);

    const { css, files } = readFontFaces(asar);
    assert.equal(css, '@font-face{font-family:anthropic-sans;src:url(/claude-fonts/a.woff2)format("woff2")}');
    assert.deepEqual([...files], ["a.woff2"]);
    const marks = readMarks(asar);
    assert.deepEqual(JSON.parse(marks.json), { frame: 48, sheets: { "default.in": { frames: 16, speed: 33.3333, url: "/claude-marks/m.webp" } } });

    const dist = ionFiles(asar);
    assert.equal(dist.read("third-party-notices.txt").toString(), "licences");
    assert.deepEqual(dist.list("assets/v1").sort(), ["a.woff2", "c8677db5f-X.js", "m.webp", "main.css"]);
    let streamed = "";
    for await (const chunk of dist.stream("assets/v1/m.webp")) streamed += chunk;
    assert.equal(streamed, "RIFF-webp");
    for (const rel of ["assets/v1/none.css", "assets", "constructor", "assets/v1/__proto__"]) assert.throws(() => dist.read(rel), /ENOENT/, rel);
  } finally {
    rmSync(apps, { recursive: true, force: true });
  }
});
