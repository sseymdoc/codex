// Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findIonDist, readFontFaces } from "./claude-fonts.mjs";

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
