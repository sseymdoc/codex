// Shortcut labels as CDS Shortcut draws them (Claude Desktop 2.42304.0.0 shared-frame ks, Hs / Us /
// Gs with the Windows tables Ls / zs): "ctrl+shift+k" and "Ctrl + Shift + K" both give Ctrl Shift K;
// whitespace separates the steps of a sequence ("esc esc"). On a Mac, as Claude's Mac tables:
// ⌃ ⌥ ⇧ ⌘ with no + between them, "ctrl" (the page's Ctrl-or-⌘ binding) as ⌘ and "control" (the
// Control key itself, as in Ctrl+Tab) as ⌃.

export const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MODIFIERS = ["ctrl", "control", "alt", "option", "shift", "cmd", "command", "meta"];
const MAC_ORDER = ["control", "alt", "option", "shift", "ctrl"];
const MAC_LABELS: Record<string, string> = { ctrl: "⌘", control: "⌃", alt: "⌥", option: "⌥", shift: "⇧", cmd: "⌘", command: "⌘", meta: "⌘" };
const MODIFIER_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  cmd: "Ctrl",
  command: "Ctrl",
  meta: "Ctrl",
};
const KEY_LABELS: Record<string, string> = {
  space: "Space",
  enter: "⏎",
  return: "⏎",
  delete: "Backspace",
  backspace: "Backspace",
  escape: "Esc",
  esc: "Esc",
  tab: "Tab",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "Page Up",
  pagedown: "Page Down",
  home: "Home",
  end: "End",
  insert: "Insert",
  plus: "+",
};

function keyLabel(key: string): string {
  if (Object.hasOwn(KEY_LABELS, key)) return KEY_LABELS[key];
  return /^f\d+$/.test(key) || key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

/** Each step's key labels, modifiers first in Ctrl, Alt, Shift order (Cmd counts as Ctrl; ⌃ ⌥ ⇧ ⌘ on a Mac). */
export function shortcutKeys(keys: string, mac = MAC): string[][] {
  const steps = keys.trim().replace(/\s*\+\s*/g, "+");
  if (!steps) return [];
  const rank = (key: string) => (mac ? MAC_ORDER : MODIFIERS).indexOf(key === "cmd" || key === "command" || key === "meta" ? "ctrl" : key);
  return steps.split(/\s+/).map((step) => {
    const parts = step.toLowerCase().split("+").filter(Boolean);
    const mods = parts.filter((key) => MODIFIERS.includes(key)).sort((a, b) => rank(a) - rank(b));
    return [...mods.map((key) => (mac ? MAC_LABELS : MODIFIER_LABELS)[key]), ...parts.filter((key) => !MODIFIERS.includes(key)).map(keyLabel)];
  });
}

/** The text variant (menu rows, tooltips): Ctrl+Shift+K (⇧⌘K on a Mac), steps joined by “然后”. */
export function shortcutText(keys: string, mac = MAC): string {
  return shortcutKeys(keys, mac)
    .map((step) => step.join(mac ? "" : "+"))
    .join(" 然后 ");
}
