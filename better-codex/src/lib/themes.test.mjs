// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of themes.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_THEMES } from "./themes.ts";

test("every code theme carries a full set of colors, Claude's own first in each mode", () => {
  assert.equal(CODE_THEMES.length, 28);
  assert.equal(new Set(CODE_THEMES.map((theme) => theme.value)).size, CODE_THEMES.length);
  for (const mode of ["light", "dark"]) assert.equal(CODE_THEMES.find((theme) => theme.mode === mode)?.value, `claude-${mode}`);
  const color = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
  for (const theme of CODE_THEMES) {
    for (const [name, value] of Object.entries(theme.code)) assert.match(value, name === "comment-style" ? /^(?:italic|normal)$/ : color, `${theme.value} ${name}`);
    assert.equal(Object.keys(theme.code).length, 17, theme.value);
    for (const [name, value] of Object.entries(theme.term)) assert.match(value, color, `${theme.value} ${name}`);
    assert.equal(Object.keys(theme.term).length, 21, theme.value);
  }
});
