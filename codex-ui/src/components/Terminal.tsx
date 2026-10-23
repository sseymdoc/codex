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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { openTerminal, supports } from "../lib/codex";
import { closePane, innerClose, layoutOf, openPane } from "../lib/panes";
import { readPref, useStore, writePref } from "../lib/store";
import { appendComposerText } from "./Composer";
import { PaneEmpty, PaneFrame } from "./Panes";
import { codeFontFamily, codeThemeOf } from "./Settings";
import { Button, Icon, MenuItem, MenuSep, Popover, Submenu, useReducedMotion } from "./ui";

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
}

/** Live shells, least recently used first; each view keeps its tab order and active tab. */
const shells = new Map<string, Shell>();
const views = new Map<string, { ids: string[]; active: string | null }>();
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

function newTab(key: string, cwd: string | null = null) {
  const view = viewOf(key);
  if (view.ids.length >= MAX_SHELLS) return;
  // Past the cap the oldest terminal of another view goes (c6bf19e8f: 16 kept).
  for (const old of shells.values()) if (shells.size >= MAX_SHELLS && old.key !== key) closeTab(old.id);
  const used = new Set(view.ids.map((id) => shells.get(id)?.n));
  let n = 1;
  while (used.has(n)) n += 1;
  const shell: Shell = { id: crypto.randomUUID(), key, n, name: null, title: null, cwd, exited: null, enterAt: 0, term: null, fit: null, host: null, proc: null };
  shells.set(shell.id, shell);
  view.ids.push(shell.id);
  view.active = shell.id;
  emit();
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
  const text = term.getSelection().replace(/\s+$/, "");
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

function spawn(shell: Shell, cwd: string) {
  const term = shell.term;
  if (!term) return;
  shell.proc = openTerminal(
    shell.cwd ?? cwd,
    { rows: term.rows, cols: term.cols },
    (bytes) => term.write(bytes),
    (code) => {
      shell.proc = null;
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

/** The shell's terminal moved into `container`, created and spawned on first show. */
function attach(shell: Shell, container: HTMLElement, cwd: string, reduce: boolean) {
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
  const { term, fit, host } = shell;
  container.replaceChildren(host);
  term.open(host); // a no-op once opened
  term.options.theme = themeFor(container);
  fit.fit();
  term.refresh(0, term.rows - 1);
  if (!shell.proc && shell.exited === null) spawn(shell, cwd);
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
  useEffect(() => {
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
  }, [termKey]);
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
    term?.focus();
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
