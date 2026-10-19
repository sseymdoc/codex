// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of settings.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize, rank, searchSettings } from "./settings.ts";

const row = (display, anchor, text = display, phrase = false) => ({ text, display, anchor, phrase });

const sections = [
  {
    id: "general",
    name: "General",
    rows: [row("Appearance", "a"), row("Theme", "t"), row("Transcript text size", "s"), row("Transcript text size", "s", "font size", true), row("Transcript width", "w"), row("Motion", "m")],
  },
  {
    id: "codex",
    name: "Codex",
    rows: [row("Code font", "f"), row("Code font", "f", "editor font", true), row("Appearance", "ca"), row("Default transcript view", "v")],
  },
  { id: "connectors", name: "Connectors", rows: [row("Apps", "apps")], keywords: ["mcp", "integrations", "tools"], open: true },
];

test("normalize folds case, diacritics and separators", () => {
  assert.equal(normalize("  Café_Code--Font  "), "cafe code font");
});

test("rank: exact, prefix, word start, contained, missing", () => {
  assert.deepEqual(
    ["transcript width", "trans", "wid", "idth", "zzz"].map((query) => rank("Transcript width", query)),
    [0, 1, 2, 3, -1],
  );
});

test("a page found by name comes first, rows found elsewhere after it", () => {
  const hits = searchSettings(sections, "codex");
  assert.deepEqual(hits[0], { kind: "hit", section: "codex" });
  assert.equal(hits.length, 1);
  const transcript = searchSettings(sections, "transcript");
  assert.deepEqual(transcript, [
    { kind: "hit", section: "general" },
    { kind: "child", section: "general", via: "Transcript text size", anchor: "s" },
    { kind: "child", section: "general", via: "Transcript width", anchor: "w" },
    { kind: "hit", section: "codex", via: "Default transcript view", anchor: "v" },
  ]);
});

test("three rows at most, then +N", () => {
  const many = [{ id: "p", name: "Page", rows: ["ta", "tb", "tc", "td", "te"].map((label) => row(label, label)) }];
  const hits = searchSettings(many, "t");
  assert.deepEqual(hits, [{ kind: "hit", section: "p", via: "ta", anchor: "ta" }]);
  assert.deepEqual(searchSettings(many, "page").length, 1);
  const two = [{ id: "p", name: "Page", rows: ["xa", "xb", "xc", "xd", "xe"].map((label) => row(`xx ${label}`, label)) }];
  assert.deepEqual(searchSettings(two, "xx").at(-1), { kind: "more", section: "p", count: 2 });
});

test("a phrase matches only from a word start and ranks after labels", () => {
  assert.deepEqual(searchSettings(sections, "font"), [
    { kind: "hit", section: "codex", via: "Code font", anchor: "f" },
    { kind: "hit", section: "general", via: "Transcript text size", anchor: "s" },
  ]);
  assert.deepEqual(searchSettings(sections, "ditor"), []);
});

test("a label shown under one page is not repeated under the next, keywords come last", () => {
  assert.deepEqual(searchSettings(sections, "appearance"), [{ kind: "hit", section: "general", via: "Appearance", anchor: "a" }]);
  assert.deepEqual(searchSettings(sections, "mcp"), [{ kind: "hit", section: "connectors", via: "mcp" }]);
});
