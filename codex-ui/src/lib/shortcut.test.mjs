// Run with `pnpm test` (Node >= 22.18 strips the TypeScript types of shortcut.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { shortcutKeys, shortcutText } from "./shortcut.ts";

test("shortcutKeys orders modifiers and names keys like CDS Shortcut on Windows", () => {
  assert.deepEqual(shortcutKeys("shift+ctrl+k", false), [["Ctrl", "Shift", "K"]]);
  assert.deepEqual(shortcutKeys("Ctrl + Shift + ]", false), [["Ctrl", "Shift", "]"]]);
  assert.deepEqual(shortcutKeys("cmd+enter", false), [["Ctrl", "⏎"]]);
  assert.deepEqual(shortcutKeys("Shift+F3", false), [["Shift", "F3"]]);
  assert.deepEqual(shortcutKeys("esc esc", false), [["Esc"], ["Esc"]]);
  assert.deepEqual(shortcutKeys("/fork", false), [["/fork"]]);
  assert.deepEqual(shortcutKeys("  ", false), []);
});

test("shortcutText joins keys with + and steps with 然后", () => {
  assert.equal(shortcutText("Ctrl + O", false), "Ctrl+O");
  assert.equal(shortcutText("alt+shift+tab", false), "Alt+Shift+Tab");
  assert.equal(shortcutText("Esc Esc", false), "Esc 然后 Esc");
});

test("on a Mac, ctrl is ⌘, control is ⌃, in ⌃ ⌥ ⇧ ⌘ order without +", () => {
  assert.deepEqual(shortcutKeys("ctrl+shift+k", true), [["⇧", "⌘", "K"]]);
  assert.deepEqual(shortcutKeys("cmd+alt+control+f", true), [["⌃", "⌥", "⌘", "F"]]);
  assert.equal(shortcutText("ctrl+shift+]", true), "⇧⌘]");
  assert.equal(shortcutText("control+shift+tab", true), "⌃⇧Tab");
  assert.equal(shortcutText("alt+enter", true), "⌥⏎");
  assert.equal(shortcutText("esc esc", true), "Esc 然后 Esc");
  assert.equal(shortcutText("control+tab", false), "Ctrl+Tab");
});
