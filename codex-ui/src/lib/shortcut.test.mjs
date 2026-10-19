// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of shortcut.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutKeys, shortcutText } from "./shortcut.ts";

test("shortcutKeys orders modifiers and names keys like CDS Shortcut on Windows", () => {
  assert.deepEqual(shortcutKeys("shift+ctrl+k"), [["Ctrl", "Shift", "K"]]);
  assert.deepEqual(shortcutKeys("Ctrl + Shift + ]"), [["Ctrl", "Shift", "]"]]);
  assert.deepEqual(shortcutKeys("cmd+enter"), [["Ctrl", "⏎"]]);
  assert.deepEqual(shortcutKeys("Shift+F3"), [["Shift", "F3"]]);
  assert.deepEqual(shortcutKeys("esc esc"), [["Esc"], ["Esc"]]);
  assert.deepEqual(shortcutKeys("/fork"), [["/fork"]]);
  assert.deepEqual(shortcutKeys("  "), []);
});

test("shortcutText joins keys with + and steps with 然后", () => {
  assert.equal(shortcutText("Ctrl + O"), "Ctrl+O");
  assert.equal(shortcutText("alt+shift+tab"), "Alt+Shift+Tab");
  assert.equal(shortcutText("Esc Esc"), "Esc 然后 Esc");
});
