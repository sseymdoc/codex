// Built-in terminal (U23): shells over process/spawn (codex.ts openTerminal), in tabs, in the
// right-hand 终端 pane (lib/panes.ts). Claude Desktop 2.42304.0.0 facts: the toggle and Ctrl+`
// (also ⌘J on macOS) from cc43287c9 uW / shared-19 W7; xterm options from c6bf19e8f Gr (block
// cursor in the theme's cursor blue, 12px, scrollback 10000, minimum contrast 3; terminals kept
// alive across remounts, at most 16, oldest evicted; reduced motion stops the blink); the font is
// the code font (Settings → 代码字体); padding 8 0 8 8 (c6bf19e8f 3577-3594). Tabs (cccc2cf0a Vy,
// cfe7c4b3b compact preset): 终端 when alone, else 终端 N with the lowest free N; the shell's
// title follows in muted text; a lone tab cannot be closed (close the pane instead); a double
// click on the strip opens one, Delete / Backspace or a middle click closes. A shell that exits
// cleanly, or right after Enter (`exit`), closes its tab (cccc2cf0a 2310-2326); otherwise
// 「Shell 已退出」offers 重启 Shell (c6bf19e8f 3626-3650). Settings (cccc2cf0a HO, cf718f694
// defaults) and the context menus (Qy / Zy) as the real pane has them. Colors from the code theme
// (Settings → 代码外观; Claude Light / Dark by default).
// ponytail: no "a command is still running" confirmation on close (the shell's foreground
// process is not reported), no drag to reorder and no overflow menu (the strip scrolls).

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { use, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import type { TerminalOutput, TerminalTabInfo } from "../../context/terminal-tools.mjs";
import { desktopError } from "../../context/desktop-tools.mjs";
import { openTerminal, supports } from "../lib/codex";
import { closePane, innerClose, layoutOf, openPane } from "../lib/panes";
import { getState, readPref, toast, useStore, writePref } from "../lib/store";
import { terminalText, type TermRow } from "../lib/terminal";
import { appendComposerText } from "./Composer";
import { PaneEmpty, PaneFrame } from "./Panes";
import { codeFontFamily, codeThemeOf } from "./Settings";
import { Button, ColumnFocus, Icon, MenuItem, MenuSep, Popover, Submenu, useReducedMotion } from "./ui";

export const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const TERMINAL_KBD = MAC ? "⌘ + J" : "Ctrl + `";
const MAX_SHELLS = 16;

/** The palette of the page's mode's code theme (cf718f694 Te(), Settings → 代码外观); the host around xterm takes its background. */
function themeFor(host: HTMLElement): ITheme {
  const { term } = codeThemeOf(document.documentElement.classList.contains("dark") ? "dark" : "light");
  host.style.background = term.background;
  return term;
}

/** 12px at the default root size (cccc2cf0a my(): 12 × root / 16). */
const fontSize = () => Math.round((12 * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)) / 16);

// Settings (cf718f694: block cursor, blinking, copy on select off, 10000 lines).
type CursorStyle = "block" | "bar" | "underline";
const CURSORS: [CursorStyle, string][] = [
  ["block", "方块"],
  ["bar", "竖线"],
  ["underline", "下划线"],
];
const SCROLLBACKS = ["1000", "5000", "10000"] as const;
const settings = {
  cursor: readPref<CursorStyle>("codex-ui:terminal-cursor", ["block", "bar", "underline"], "block"),
  blink: readPref("codex-ui:terminal-blink", ["on", "off"], "on") === "on",
  copyOnSelect: readPref("codex-ui:terminal-copy-on-select", ["on", "off"], "off") === "on",
  scrollback: Number(readPref("codex-ui:terminal-scrollback", SCROLLBACKS, "10000")),
};

const lines = (n: number) => `${n.toLocaleString("zh-CN")} 行`;

interface Shell {
  id: string;
  /** The view it belongs to: a thread id, or "draft". */
  key: string;
  /** 终端 N: the lowest number free in its view when it opened (c03935b01 Rt). */
  n: number;
  name: string | null;
  /** The shell's window title (OSC 0 / 2). */
  title: string | null;
  /** Folder it starts in; null: the view's. */
  cwd: string | null;
  exited: number | null;
  /** When Enter was last typed: an exit within 2s of it (`exit`) closes the tab. */
  enterAt: number;
  term: Terminal | null;
  fit: FitAddon | null;
  host: HTMLDivElement | null;
  proc: ReturnType<typeof openTerminal> | null;
  /** Codex opened it, or ran a command in it (stop_terminal_tab may stop only these). */
  agent: boolean;
  /** Called whenever output has been parsed or the shell exits (read_terminal's waits). */
  waiters: Set<() => void>;
}

/** Live shells, least recently used first; each view keeps its tab order and active tab. */
const shells = new Map<string, Shell>();
const views = new Map<string, { ids: string[]; active: string | null }>();
const passiveDisplays = new Set<string>();
export function deferTerminalFocus(key: string): () => void {
  passiveDisplays.add(key);
  return () => { passiveDisplays.delete(key); };
}
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

function viewOf(key: string) {
  let view = views.get(key);
  if (!view) views.set(key, (view = { ids: [], active: null }));
  return view;
}

/** Eight hex digits: short enough for a #terminal/<tab_id> link, unique among the live shells. */
function tabId(): string {
  for (;;) {
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    if (!shells.has(id)) return id;
  }
}

function newTab(key: string, cwd: string | null = null, name: string | null = null, agent = false): Shell | null {
  const view = viewOf(key);
  if (view.ids.length >= MAX_SHELLS) return null;
  // Past the cap the oldest terminal of another view goes (c6bf19e8f: 16 kept).
  for (const old of shells.values()) if (shells.size >= MAX_SHELLS && old.key !== key) closeTab(old.id);
  const used = new Set(view.ids.map((id) => shells.get(id)?.n));
  let n = 1;
  while (used.has(n)) n += 1;
  const shell: Shell = { id: tabId(), key, n, name, title: null, cwd, exited: null, enterAt: 0, term: null, fit: null, host: null, proc: null, agent, waiters: new Set() };
  shells.set(shell.id, shell);
  view.ids.push(shell.id);
  view.active = shell.id;
  emit();
  return shell;
}

/** The last tab takes the pane with it. */
function closeTab(id: string) {
  const shell = shells.get(id);
  if (!shell) return;
  shells.delete(id);
  shell.proc?.kill();
  shell.term?.dispose();
  const view = viewOf(shell.key);
  const at = view.ids.indexOf(id);
  view.ids.splice(at, 1);
  if (view.active === id) view.active = view.ids[Math.min(at, view.ids.length - 1)] ?? null;
  if (view.ids.length === 0) closePane("terminal", shell.key);
  emit();
}

function activate(id: string) {
  const shell = shells.get(id);
  if (!shell) return;
  // Most recently used last, so eviction takes the oldest.
  shells.delete(id);
  shells.set(id, shell);
  viewOf(shell.key).active = id;
  emit();
}

/** Display tools may select a running or exited shell, but may never initialize one. */
export function terminalTargets(key: string) {
  return (views.get(key)?.ids ?? []).flatMap(id => {
    const shell = shells.get(id);
    return shell && (shell.proc !== null || shell.exited !== null) ? [{ id, label: shell.name ?? `终端 ${shell.n}` }] : [];
  });
}

export function terminalWouldStart(key: string): boolean {
  const active = views.get(key)?.active;
  const shell = active ? shells.get(active) : undefined;
  return !shell || (shell.proc === null && shell.exited === null);
}

export function selectTerminal(key: string, id?: string): boolean {
  const targets = terminalTargets(key);
  const target = id ?? (targets.find(target => target.id === views.get(key)?.active) ?? targets[0])?.id;
  if (!target || !targets.some(item => item.id === target)) return false;
  activate(target);
  return true;
}

export function toggleTerminal(key: string) {
  if (layoutOf(key).open.includes("terminal")) return closePane("terminal", key);
  if (viewOf(key).ids.length === 0) newTab(key);
  openPane("terminal", key);
}

/** 在终端中打开: a new tab in `cwd`, the pane shown. */
export function openTerminalTab(key: string, cwd: string) {
  newTab(key, cwd);
  openPane("terminal", key);
}

const tabLabel = (shell: Shell, solo: boolean) => shell.name ?? (solo ? "终端" : `终端 ${shell.n}`);

/** The title after the name (cf718f694 he): a path shows its last segment; Windows' *.exe titles are skipped. */
function describe(shell: Shell): string | null {
  const title = shell.title;
  if (!title || /\.exe$/i.test(title)) return null;
  const path = /^(?:\S+:\s?)?(~|\S*[/\\]\S*)$/.exec(title)?.[1];
  return (path ? path.split(/[/\\]/).findLast((part) => part !== "") : title) || null;
}

function applyOptions(term: Terminal, reduce: boolean) {
  term.options.cursorStyle = settings.cursor;
  term.options.cursorBlink = settings.blink && !reduce;
  term.options.scrollback = settings.scrollback;
}

function setSettings(patch: Partial<typeof settings>) {
  Object.assign(settings, patch);
  writePref("codex-ui:terminal-cursor", settings.cursor);
  writePref("codex-ui:terminal-blink", settings.blink ? "on" : "off");
  writePref("codex-ui:terminal-copy-on-select", settings.copyOnSelect ? "on" : "off");
  writePref("codex-ui:terminal-scrollback", String(settings.scrollback));
  emit();
}

/** 将所选内容附加为上下文: the selection goes into the composer as a code block. */
function attachSelection(term: Terminal) {
  const text = term.getSelection().trimEnd();
  if (text) appendComposerText(`\`\`\`\n${text}\n\`\`\`\n`);
}

const paste = (term: Terminal) => void navigator.clipboard.readText().then((text) => text && term.paste(text));

/** Ctrl+Shift+C / V copy and paste, Ctrl+Shift+L attaches the selection (cccc2cf0a Qy); xterm gets the rest. */
function onTermKey(term: Terminal, event: KeyboardEvent): boolean {
  if (event.type !== "keydown" || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return true;
  if (event.code === "KeyC") {
    if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
  } else if (event.code === "KeyV") paste(term);
  else if (event.code === "KeyL") attachSelection(term);
  else return true;
  event.preventDefault();
  return false;
}

const notify = (shell: Shell) => shell.waiters.forEach((waiter) => waiter());

function spawn(shell: Shell, cwd: string) {
  const term = shell.term;
  if (!term) return;
  shell.proc = openTerminal(
    shell.cwd ?? cwd,
    { rows: term.rows, cols: term.cols },
    (bytes) => term.write(bytes, () => notify(shell)),
    (code) => {
      shell.proc = null;
      notify(shell);
      if (!shells.has(shell.id)) return;
      if (code === 0 || Date.now() - shell.enterAt <= 2000) return closeTab(shell.id);
      shell.exited = code;
      emit();
    },
  );
}

function restart(shell: Shell, cwd: string) {
  shell.exited = null;
  shell.term?.reset();
  spawn(shell, cwd);
  emit();
}

/**
 * The code faces can be web fonts (anthropic-mono; OpenDyslexic Mono typed as 代码字体) and xterm
 * measures its cells only when fontFamily changes: once they have loaded, change it and back.
 */
function measureOnLoad(shell: Shell) {
  const { term } = shell;
  const font = term?.options.fontFamily;
  if (!term || !font) return;
  void document.fonts.load(`${fontSize()}px ${font}`).then(
    () => {
      if (!shells.has(shell.id) || term.options.fontFamily !== font) return; // closed or changed meanwhile
      term.options.fontFamily = `${font} `;
      term.options.fontFamily = font;
      shell.fit?.fit();
    },
    () => {},
  );
}

/**
 * The shell's terminal and process, created on first need: when its tab is first shown, or when a
 * terminal tool types into a tab nobody has looked at yet (xterm parses output before it is opened).
 */
function ensureShell(shell: Shell, cwd: string, reduce: boolean) {
  if (!shell.term || !shell.fit || !shell.host) {
    shell.host = document.createElement("div");
    shell.host.style.height = "100%";
    const term = new Terminal({
      cursorStyle: settings.cursor,
      cursorBlink: settings.blink && !reduce,
      cursorInactiveStyle: "outline",
      fontFamily: codeFontFamily(),
      fontSize: fontSize(),
      scrollback: settings.scrollback,
      minimumContrastRatio: 3,
    });
    shell.term = term;
    shell.fit = new FitAddon();
    term.loadAddon(shell.fit);
    term.onTitleChange((title) => {
      shell.title = title.trim() || null;
      emit();
    });
    term.onSelectionChange(() => {
      if (settings.copyOnSelect && term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
    });
    term.attachCustomKeyEventHandler((event) => onTermKey(term, event));
    term.onData((data) => {
      if (shell.exited !== null) return;
      if (data.includes("\r")) shell.enterAt = Date.now();
      shell.proc?.write(data);
    });
    term.onResize(({ rows, cols }) => shell.proc?.resize(rows, cols));
    measureOnLoad(shell);
  }
  if (!shell.proc && shell.exited === null) spawn(shell, cwd);
}

/** The shell's terminal moved into `container`, created and spawned on first show. */
function attach(shell: Shell, container: HTMLElement, cwd: string, reduce: boolean) {
  ensureShell(shell, cwd, reduce);
  const { term, fit, host } = shell;
  if (!term || !fit || !host) return;
  container.replaceChildren(host);
  term.open(host); // a no-op once opened
  term.options.theme = themeFor(container);
  fit.fit();
  term.refresh(0, term.rows - 1);
}

// ---------------------------------------------------------------------------
// The terminal tools (codex_ui_desktop, DesktopTools.ts) and #terminal/<tab_id> links: only the
// tabs of the chat that asks; a tab of another chat reads as missing.

const stateOf = (shell: Shell): TerminalTabInfo["state"] => (shell.proc ? "running" : shell.exited !== null ? "exited" : "not_started");

function infoOf(shell: Shell, folder: string): TerminalTabInfo {
  return { tab_id: shell.id, label: shell.name ?? `终端 ${shell.n}`, state: stateOf(shell), folder: shell.cwd ?? folder, selected: views.get(shell.key)?.active === shell.id, codex: shell.agent };
}

function ownTab(key: string, id: string): Shell {
  const shell = shells.get(id);
  if (!shell || shell.key !== key) throw desktopError("TARGET_NOT_FOUND", "No terminal tab with that tab_id in this chat; list_terminal_tabs lists them.");
  return shell;
}

/** The pane shown on `shell` without the terminal taking keyboard focus from the user. */
function reveal(shell: Shell) {
  const release = deferTerminalFocus(shell.key);
  activate(shell.id);
  openPane("terminal", shell.key);
  requestAnimationFrame(() => requestAnimationFrame(release));
  setTimeout(release, 1000);
}

export function terminalTabs(key: string, folder: string): TerminalTabInfo[] {
  return (views.get(key)?.ids ?? []).flatMap((id) => {
    const shell = shells.get(id);
    return shell ? [infoOf(shell, folder)] : [];
  });
}

/** The tab a run_in_terminal names, as its card shows it; it must still take input. */
export function terminalTab(key: string, id: string, folder: string): TerminalTabInfo {
  const shell = ownTab(key, id);
  if (shell.exited !== null) throw desktopError("TAB_EXITED", "The shell in that tab has exited; run the command in a new tab (omit tab_id) or ask the user to restart it.");
  return infoOf(shell, folder);
}

/** A new tab with its shell started, for open_terminal_tab and run_in_terminal without a tab_id. */
function toolTab(key: string, folder: string, title?: string, cwd?: string): Shell {
  // Tools never close another chat's shell to make room, as the user's + would.
  if (shells.size >= MAX_SHELLS || viewOf(key).ids.length >= MAX_SHELLS) throw desktopError("TOO_MANY_TERMINALS", `All ${MAX_SHELLS} terminals are in use; ask the user to close one, or use an existing tab.`);
  const shell = newTab(key, cwd ?? folder, title ?? null, true)!;
  ensureShell(shell, folder, false);
  return shell;
}

export function openToolTab(key: string, folder: string, title?: string, cwd?: string): TerminalTabInfo {
  const shell = toolTab(key, folder, title, cwd);
  reveal(shell);
  return infoOf(shell, folder);
}

/** Types `command` and Enter into the tab (a new one without `id`) and shows it. */
export function typeInTab(key: string, folder: string, command: string, { id, title, cwd }: { id?: string; title?: string; cwd?: string }): TerminalTabInfo {
  let shell: Shell;
  if (id) {
    shell = ownTab(key, id);
    if (shell.exited !== null) throw desktopError("TAB_EXITED", "The shell in that tab exited before the command was typed; nothing was typed.");
    ensureShell(shell, folder, false);
  } else shell = toolTab(key, folder, title, cwd);
  shell.agent = true;
  shell.proc?.write(`${command}\r`);
  reveal(shell);
  return infoOf(shell, folder);
}

/** Resolves once output has gone quiet for 400 ms after arriving (true), or at the end of `ms` (false while still printing). */
function settle(shell: Shell, ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined, seen = false;
    const finish = (settled: boolean) => {
      clearTimeout(quiet);
      clearTimeout(limit);
      shell.waiters.delete(onOutput);
      signal.removeEventListener("abort", abort);
      resolve(settled);
    };
    const onOutput = () => {
      seen = true;
      clearTimeout(quiet);
      quiet = setTimeout(() => finish(true), 400);
    };
    const abort = () => finish(false);
    const limit = setTimeout(() => finish(!seen), ms);
    shell.waiters.add(onOutput);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** The tab's last lines as plain text, after an optional wait for output. */
export async function readTab(key: string, id: string, folder: string, count: number, waitMs: number, signal: AbortSignal): Promise<{ tab: TerminalTabInfo; output: TerminalOutput }> {
  const shell = ownTab(key, id);
  const settled = waitMs > 0 ? await settle(shell, waitMs, signal) : undefined;
  const term = shell.term;
  const rows: TermRow[] = [];
  if (term) {
    // Writes are parsed asynchronously: an empty write's callback runs after everything before it.
    await new Promise<void>((resolve) => term.write("", resolve));
    const buffer = term.buffer.active;
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y);
      if (line) rows.push({ text: line.translateToString(true), wrapped: line.isWrapped });
    }
  }
  const screen = term?.buffer.active.type === "alternate" ? "alternate" : "normal";
  return { tab: infoOf(shell, folder), output: { ...terminalText(rows, count), screen, ...(settled !== undefined && { settled }) } };
}

/** Ctrl+C, or the end of the shell, in a tab Codex opened or typed into. */
export function stopTab(key: string, id: string, folder: string, mode: "interrupt" | "kill"): { tab: TerminalTabInfo; outcome: "interrupted" | "killed" | "not_running" } {
  const shell = ownTab(key, id);
  if (!shell.agent) throw desktopError("USER_TAB", "That tab is the user's own; ask them to stop what runs in it.");
  const tab = infoOf(shell, folder);
  if (!shell.proc) return { tab, outcome: "not_running" };
  if (mode === "kill") shell.proc.kill();
  else shell.proc.write(String.fromCharCode(3));
  return { tab, outcome: mode === "kill" ? "killed" : "interrupted" };
}

/** A #terminal/<tab_id> link: the pane on that tab, if it is one of this view's. */
export function showTerminalTab(key: string, id: string): boolean {
  const shell = shells.get(id);
  if (!shell || shell.key !== key) return false;
  activate(id);
  openPane("terminal", key);
  return true;
}

// content.tsx sends the links' clicks here, so the transcript needs no import of this pane.
if (typeof window !== "undefined") {
  window.addEventListener("codex:open-terminal", (event) => {
    const id = (event as CustomEvent<{ id: string }>).detail?.id;
    if (id && !showTerminalTab(getState().activeId ?? "draft", id)) toast("neutral", "此终端标签页已关闭，或不属于此会话。");
  });
}

const usePaneOpen = (key: string) => useStore((s) => s.panes[key]?.open.includes("terminal") ?? false);

/** Titlebar pane toggle (cc43287c9 uW: icon CommandLinePrompt, toggleTerminal; tooltip below). */
export function TerminalToggle({ termKey }: { termKey: string }) {
  const open = usePaneOpen(termKey);
  if (!supports("process/spawn")) return null;
  return (
    <Button
      variant="ghost"
      icon={<Icon name="CommandLinePrompt" size={18} />}
      label="终端"
      kbd={TERMINAL_KBD}
      tipSide="bottom"
      active={open}
      aria-pressed={open}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => toggleTerminal(termKey)}
    />
  );
}

/** Ctrl+` (also ⌘J on macOS, shared-19 W7) shows or hides this view's terminal, even from inside it. */
export function useTerminalShortcut(termKey: string) {
  const focused = use(ColumnFocus);
  useEffect(() => {
    if (!focused) return;
    const onKey = (event: KeyboardEvent) => {
      const hit = (event.ctrlKey && !event.metaKey && event.code === "Backquote") || (MAC && event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "j");
      if (!hit || event.altKey || event.shiftKey || event.isComposing || !supports("process/spawn")) return;
      event.preventDefault();
      event.stopPropagation();
      toggleTerminal(termKey);
    };
    // Capture phase: xterm would otherwise take the key as input.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [termKey, focused]);
}

function TabName({ shell, initial, onDone }: { shell: Shell; initial: string; onDone(): void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) {
      shell.name = value.trim() || null;
      emit();
    }
    onDone();
  };
  return (
    <input
      className="pane-tab-input"
      autoFocus
      value={value}
      maxLength={80}
      aria-label="重命名终端"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
    />
  );
}

export function TerminalPane({ view: key, cwd }: { view: string; cwd: string }) {
  useSyncExternalStore(subscribe, () => version);
  const strip = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** id: a tab's menu; null: the terminal's own (right click inside it). */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string | null } | null>(null);
  const reduce = useReducedMotion();
  const view = viewOf(key);
  const active = view.active ? shells.get(view.active) : undefined;
  const solo = view.ids.length < 2;

  // A pane opened without a shell (from a menu) starts one.
  useEffect(() => {
    if (viewOf(key).ids.length === 0) newTab(key);
  }, [key]);

  // Ctrl+\ closes the active tab while it has company (cccc2cf0a Rg canClose).
  useEffect(() => {
    innerClose.set("terminal", () => {
      const current = viewOf(key);
      if (current.ids.length < 2 || !current.active) return false;
      closeTab(current.active);
      return true;
    });
    return () => void innerClose.delete("terminal");
  }, [key]);

  useLayoutEffect(() => {
    const container = host.current;
    if (!container || !active) return;
    attach(active, container, cwd, reduce);
    const { term, fit } = active;
    if (!passiveDisplays.has(key)) term?.focus();
    const resize = new ResizeObserver(() => container.clientHeight > 0 && fit?.fit());
    resize.observe(container);
    // The palette follows <html class> and 代码外观 (--code-* on <html style>); the code font follows
    // 代码字体 (--cds-font-mono-override, also on <html style>).
    const page = new MutationObserver(() => {
      if (!term) return;
      const theme = themeFor(container);
      if (term.options.theme !== theme) term.options.theme = theme;
      const font = codeFontFamily();
      if (term.options.fontFamily !== font) {
        term.options.fontFamily = font;
        fit?.fit();
        measureOnLoad(active);
      }
    });
    page.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => {
      resize.disconnect();
      page.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cwd only matters for a new shell
  }, [active?.id]);

  useEffect(() => {
    for (const id of view.ids) {
      const term = shells.get(id)?.term;
      if (term) applyOptions(term, reduce);
    }
  });

  const focusTab = (id: string | null | undefined) => id && requestAnimationFrame(() => strip.current?.querySelector<HTMLElement>(`[data-term-tab="${id}"]`)?.focus());

  const openMenu = (event: MouseEvent, id: string | null) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, id });
  };
  const act = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const menuShell = menu?.id ? shells.get(menu.id) : undefined;
  const term = active?.term ?? null;
  const selection = menu?.id === null && !!term?.hasSelection();

  const tabs = (
    <div ref={strip} className="pane-strip" onDoubleClick={(event) => event.target === event.currentTarget && newTab(key)}>
      <div className="pane-tabs" data-tip-group="700" role="tablist" aria-label="终端标签页" onDoubleClick={(event) => event.target === event.currentTarget && newTab(key)}>
        {view.ids.map((id, index) => {
          const shell = shells.get(id);
          if (!shell) return null;
          const selected = id === view.active;
          const label = tabLabel(shell, solo);
          const desc = describe(shell);
          return (
            <div
              key={id}
              className="pane-tab"
              data-selected={selected || undefined}
              onContextMenu={(event) => openMenu(event, id)}
              onMouseDown={(event) => event.button === 1 && event.preventDefault()}
              onAuxClick={(event) => event.button === 1 && !solo && closeTab(id)}
            >
              {editing === id ? (
                <TabName shell={shell} initial={label} onDone={() => setEditing(null)} />
              ) : (
                <button
                  type="button"
                  role="tab"
                  className="pane-tab-label"
                  data-term-tab={id}
                  data-tip={shell.title ?? undefined}
                  data-tip-side="bottom"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => activate(id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      const next = view.ids[(index + (event.key === "ArrowRight" ? 1 : -1) + view.ids.length) % view.ids.length];
                      activate(next);
                      focusTab(next);
                    } else if ((event.key === "Delete" || event.key === "Backspace") && !event.repeat && !solo) {
                      event.preventDefault();
                      closeTab(id);
                      focusTab(viewOf(key).active);
                    }
                  }}
                >
                  <span className="pane-tab-text">
                    {label}
                    {desc && (
                      <span className="pane-tab-desc">
                        <span className="sr-only">, </span>
                        {desc}
                      </span>
                    )}
                  </span>
                </button>
              )}
              {!solo && (
                <button type="button" className="pane-tab-close" tabIndex={-1} aria-label="关闭终端" data-tip="关闭终端" data-tip-side="bottom" onClick={() => closeTab(id)}>
                  <Icon name="X" size="xs" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Button variant="ghost" size="sm" icon={<Icon name="Add" size={16} />} label="新建终端" tipSide="bottom" disabled={view.ids.length >= MAX_SHELLS} onClick={() => newTab(key)} />
    </div>
  );

  const settingsMenu = (close: () => void) => (
    <>
      <Submenu label="光标样式" value={CURSORS.find(([style]) => style === settings.cursor)?.[1]}>
        {CURSORS.map(([style, name]) => (
          <MenuItem
            key={style}
            label={name}
            checked={settings.cursor === style}
            onClick={() => {
              close();
              setSettings({ cursor: style });
            }}
          />
        ))}
      </Submenu>
      {/* cccc2cf0a $N: reduced motion stops the blink, so the switch is off limits and says why. */}
      <span className="reason-tip" data-tip-reason="" data-tip={reduce ? "减弱动态效果开启时无法使用。如需使用，请在系统设置中关闭减弱动态效果，并在设置中将“动效”设为“系统”。" : undefined}>
        <MenuItem label="光标闪烁" toggle checked={settings.blink} disabled={reduce} onClick={() => setSettings({ blink: !settings.blink })} />
      </span>
      <MenuItem label="选中即复制" toggle checked={settings.copyOnSelect} onClick={() => setSettings({ copyOnSelect: !settings.copyOnSelect })} />
      <Submenu label="回滚缓冲区" value={lines(settings.scrollback)}>
        {SCROLLBACKS.map((n) => (
          <MenuItem
            key={n}
            label={lines(Number(n))}
            checked={settings.scrollback === Number(n)}
            onClick={() => {
              close();
              setSettings({ scrollback: Number(n) });
            }}
          />
        ))}
      </Submenu>
    </>
  );

  return (
    <PaneFrame view={key} pane="terminal" title={tabs} menu={settingsMenu} closeKbd={MAC}>
      <div className="term-body">
        <div ref={host} className="term-host" onContextMenu={(event) => openMenu(event, null)} />
        {active && active.exited !== null && (
          <div className="term-exited">
            <PaneEmpty title="Shell 已退出">
              <Button variant="secondary" size="sm" onClick={() => restart(active, cwd)}>
                重启 shell
              </Button>
            </PaneEmpty>
          </div>
        )}
      </div>
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={<span className="pane-menu-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />}>
        {menu?.id ? (
          <>
            <MenuItem label="重命名终端" onClick={act(() => setEditing(menu.id))} />
            <MenuItem label="清空终端" disabled={!menuShell?.term} onClick={act(() => menuShell?.term?.clear())} />
            {!solo && (
              <>
                <MenuSep />
                <MenuItem label="关闭终端" onClick={act(() => menu.id && closeTab(menu.id))} />
                <MenuItem
                  label="关闭其他终端"
                  onClick={act(() => {
                    for (const id of [...view.ids]) if (id !== menu.id) closeTab(id);
                    if (menu.id) activate(menu.id);
                  })}
                />
              </>
            )}
          </>
        ) : (
          <>
            {selection && term && (
              <>
                <MenuItem label="将所选内容作为上下文附加" kbd="Ctrl + Shift + L" onClick={act(() => attachSelection(term))} />
                <MenuSep />
              </>
            )}
            <MenuItem label="复制" kbd="Ctrl + Shift + C" disabled={!selection} onClick={act(() => term && void navigator.clipboard.writeText(term.getSelection()))} />
            <MenuItem label="粘贴" kbd="Ctrl + Shift + V" disabled={!term} onClick={act(() => term && paste(term))} />
            <MenuSep />
            <MenuItem label="全选" disabled={!term} onClick={act(() => term?.selectAll())} />
            <MenuSep />
            <MenuItem label="清空终端" disabled={!term} onClick={act(() => term?.clear())} />
          </>
        )}
      </Popover>
    </PaneFrame>
  );
}
