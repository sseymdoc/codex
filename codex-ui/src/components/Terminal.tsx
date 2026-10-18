// Built-in terminal (U23): shells over process/spawn (codex.ts openTerminal), in tabs, docked
// under the session column with the height dragged from the top edge. Claude Desktop
// 2.42304.0.0 facts: the 终端 pane toggle and Ctrl+` (⌘J on macOS) from cc43287c9 uW; xterm
// options from c6bf19e8f Gr (block cursor, blink on, 13px, scrollback 10000, minimum contrast
// 3; terminals kept alive across remounts, at most 16, oldest evicted; reduced motion turns the
// blink off, Nr); the tab strip from cccc2cf0a (新建 / 重命名 / 关闭 / 关闭其他终端; a double
// click on the strip opens one, Delete or Backspace closes the focused tab, a middle click
// closes; a tab is named by the shell's title, its last path segment, he()); ANSI colors from
// c5d464fa3 claude-light / claude-dark; the cursor overlay from cf718f694 B (1ch × 1lh at 50%,
// `blink` 1s linear, in pages.css).
// ponytail: no "a command is still running" confirmation on close (the shell's foreground
// process is not reported), no drag to reorder and no overflow menu (the strip scrolls).

import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import { Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { openTerminal, supports } from "../lib/codex";
import { writePref } from "../lib/store";
import { Button, MenuItem, MenuSep, Popover, useReducedMotion } from "./ui";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const HEIGHT_KEY = "codex-ui:terminal-h";
const MAX_SHELLS = 16;

// c5d464fa3: terminal.ansi* of the claude-light / claude-dark themes (bright green, yellow,
// magenta and cyan reuse the base color there).
const LIGHT: ITheme = {
  black: "#1a1a1a",
  brightBlack: "#666666",
  white: "#999999",
  brightWhite: "#d6d6d6",
  red: "#ff3a30",
  brightRed: "#ff5047",
  green: "#1e9e3c",
  brightGreen: "#1e9e3c",
  yellow: "#98801f",
  brightYellow: "#98801f",
  blue: "#0073e6",
  brightBlue: "#0078f0",
  magenta: "#cd2054",
  brightMagenta: "#cd2054",
  cyan: "#8e6bd9",
  brightCyan: "#8e6bd9",
  selectionBackground: "#0073e640",
};
const DARK: ITheme = {
  black: "#262626",
  brightBlack: "#525252",
  white: "#a6a6a6",
  brightWhite: "#ededed",
  red: "#ff3a30",
  brightRed: "#ff5047",
  green: "#32d74b",
  brightGreen: "#32d74b",
  yellow: "#ffd014",
  brightYellow: "#ffd014",
  blue: "#0099ff",
  brightBlue: "#0087ee",
  magenta: "#ff2c56",
  brightMagenta: "#ff2c56",
  cyan: "#b796ff",
  brightCyan: "#b796ff",
  selectionBackground: "#0099ff4d",
};

/** Page background and ink from the host's CSS; xterm's own cursor is clear (the overlay draws it). */
function themeFor(host: HTMLElement): ITheme {
  const css = getComputedStyle(host);
  const dark = document.documentElement.classList.contains("dark");
  return { ...(dark ? DARK : LIGHT), background: css.backgroundColor, foreground: css.color, cursor: "rgba(0, 0, 0, 0)", cursorAccent: css.color };
}

interface Shell {
  id: string;
  /** The view it belongs to: a thread id, or "draft". */
  key: string;
  /** 终端 N, numbered per view. */
  n: number;
  name: string | null;
  /** The shell's window title (OSC 0 / 2). */
  title: string | null;
  exited: number | null;
  term: Terminal | null;
  fit: FitAddon | null;
  host: HTMLDivElement | null;
  proc: ReturnType<typeof openTerminal> | null;
}

/** Live shells, oldest first; each view keeps its tab order and active tab. */
const shells = new Map<string, Shell>();
const views = new Map<string, { ids: string[]; active: string | null; made: number }>();
let shown = new Set<string>();
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
  if (!view) views.set(key, (view = { ids: [], active: null, made: 0 }));
  return view;
}

function setShown(key: string, on: boolean) {
  shown = new Set(shown);
  if (on) shown.add(key);
  else shown.delete(key);
  emit();
}

function newTab(key: string) {
  const view = viewOf(key);
  if (view.ids.length >= MAX_SHELLS) return;
  // Past the cap the oldest terminal of another view goes (c6bf19e8f: 16 kept).
  for (const old of shells.values()) if (shells.size >= MAX_SHELLS && old.key !== key) closeTab(old.id);
  const shell: Shell = { id: crypto.randomUUID(), key, n: ++view.made, name: null, title: null, exited: null, term: null, fit: null, host: null, proc: null };
  shells.set(shell.id, shell);
  view.ids.push(shell.id);
  view.active = shell.id;
  emit();
}

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
  if (view.ids.length === 0 && shown.has(shell.key)) setShown(shell.key, false);
  else emit();
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
  if (shown.has(key)) return setShown(key, false);
  if (viewOf(key).ids.length === 0) newTab(key);
  setShown(key, true);
}

/** A path-like title shows its last segment (cccc2cf0a he()). */
function tabLabel(shell: Shell): string {
  if (shell.name) return shell.name;
  const path = shell.title ? /^(?:\S+:\s?)?(~|\S*[/\\]\S*)$/.exec(shell.title)?.[1] : undefined;
  return (path ? path.split(/[/\\]/).findLast((part) => part !== "") : shell.title) || `终端 ${shell.n}`;
}

/** The shell's terminal moved into `container`, created and spawned on first show. */
function attach(shell: Shell, container: HTMLElement, cwd: string, blink: boolean) {
  if (!shell.term || !shell.fit || !shell.host) {
    shell.host = document.createElement("div");
    shell.host.style.height = "100%";
    shell.term = new Terminal({
      cursorStyle: "block",
      cursorBlink: blink,
      cursorInactiveStyle: "outline",
      fontFamily: getComputedStyle(container).fontFamily,
      fontSize: 13,
      scrollback: 10000,
      minimumContrastRatio: 3,
    });
    shell.fit = new FitAddon();
    shell.term.loadAddon(shell.fit);
    shell.term.onTitleChange((title) => {
      shell.title = title.trim() || null;
      emit();
    });
  }
  const { term, fit, host } = shell;
  container.replaceChildren(host);
  term.open(host); // a no-op once opened
  term.options.theme = themeFor(container);
  fit.fit();
  term.refresh(0, term.rows - 1);
  if (!shell.proc && shell.exited === null) {
    shell.proc = openTerminal(
      cwd,
      { rows: term.rows, cols: term.cols },
      (bytes) => term.write(bytes),
      (code) => {
        shell.exited = code;
        term.write(`\r\n\x1b[2m[进程已退出，代码 ${code}]\x1b[0m\r\n`);
        emit();
      },
    );
    term.onData((data) => shell.exited === null && shell.proc?.write(data));
    term.onResize(({ rows, cols }) => shell.proc?.resize(rows, cols));
  }
}

function savedHeight(): number {
  try {
    return Number(localStorage.getItem(HEIGHT_KEY)) || 240;
  } catch {
    return 240;
  }
}

const useShown = (key: string) => useSyncExternalStore(subscribe, () => shown.has(key));

/** Titlebar pane toggle (cc43287c9 uW: icon CommandLinePrompt, toggleTerminal). */
export function TerminalToggle({ termKey }: { termKey: string }) {
  const open = useShown(termKey);
  if (!supports("process/spawn")) return null;
  return (
    <Button
      variant="ghost"
      icon={<SquareTerminal size={18} />}
      label="终端"
      kbd={MAC ? "⌘ + J" : "Ctrl + `"}
      active={open}
      aria-pressed={open}
      onClick={() => toggleTerminal(termKey)}
    />
  );
}

/** Ctrl+` (⌘J on macOS) shows or hides this view's terminal, even from inside it. */
export function useTerminalShortcut(termKey: string) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = MAC ? event.metaKey && !event.ctrlKey && event.key.toLowerCase() === "j" : event.ctrlKey && !event.metaKey && event.code === "Backquote";
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

export function TerminalPanel({ termKey, cwd }: { termKey: string; cwd: string }) {
  const open = useShown(termKey);
  if (!open || !supports("process/spawn")) return null;
  return <TerminalBody termKey={termKey} cwd={cwd} />;
}

function TabName({ shell, onDone }: { shell: Shell; onDone(): void }) {
  const [value, setValue] = useState(tabLabel(shell));
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
      className="term-tab-input"
      autoFocus
      value={value}
      maxLength={80}
      aria-label="终端名称"
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

function TerminalBody({ termKey, cwd }: { termKey: string; cwd: string }) {
  useSyncExternalStore(subscribe, () => version);
  const panel = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [height] = useState(savedHeight);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const reduce = useReducedMotion();
  const view = viewOf(termKey);
  const active = view.active ? shells.get(view.active) : undefined;

  useLayoutEffect(() => {
    const container = host.current;
    if (!container || !active) return;
    attach(active, container, cwd, !reduce);
    const { term, fit } = active;
    term?.focus();
    const resize = new ResizeObserver(() => container.clientHeight > 0 && fit?.fit());
    resize.observe(container);
    const theme = new MutationObserver(() => term && (term.options.theme = themeFor(container)));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cwd only matters for a new shell
  }, [active?.id]);

  useEffect(() => {
    for (const id of view.ids) {
      const term = shells.get(id)?.term;
      if (term) term.options.cursorBlink = !reduce;
    }
  }, [view, reduce]);

  const setHeight = (next: number) => {
    const el = panel.current;
    if (!el) return;
    const max = (el.parentElement?.clientHeight ?? 600) * 0.7;
    const h = Math.round(Math.min(max, Math.max(120, next)));
    el.style.setProperty("--term-h", `${h}px`);
    writePref(HEIGHT_KEY, String(h));
  };

  const focusTab = (id: string | null | undefined) =>
    id && requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-term-tab="${id}"]`)?.focus());

  const onMenu = (event: MouseEvent, id: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, id });
  };

  return (
    <section ref={panel} className="term-panel" aria-label="终端" style={{ ["--term-h" as string]: `${height}px` }}>
      <div
        className="term-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
        tabIndex={0}
        data-active={dragging || undefined}
        onPointerDown={(event) => {
          drag.current = { y: event.clientY, h: panel.current?.offsetHeight ?? height };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => drag.current && setHeight(drag.current.h + drag.current.y - event.clientY)}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? 16 : event.key === "ArrowDown" ? -16 : 0;
          if (!step) return;
          event.preventDefault();
          setHeight((panel.current?.offsetHeight ?? height) + step);
        }}
      />
      <div className="term-head">
        <div
          className="term-tabs"
          role="tablist"
          aria-label="终端标签"
          onDoubleClick={(event) => event.target === event.currentTarget && newTab(termKey)}
        >
          {view.ids.map((id, index) => {
            const shell = shells.get(id);
            if (!shell) return null;
            const selected = id === view.active;
            return (
              <div
                key={id}
                className="term-tab"
                data-selected={selected || undefined}
                onContextMenu={(event) => onMenu(event, id)}
                onMouseDown={(event) => event.button === 1 && event.preventDefault()}
                onAuxClick={(event) => event.button === 1 && closeTab(id)}
              >
                {editing === id ? (
                  <TabName shell={shell} onDone={() => setEditing(null)} />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    className="term-tab-label"
                    data-term-tab={id}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => activate(id)}
                    onDoubleClick={() => setEditing(id)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        const next = view.ids[(index + (event.key === "ArrowRight" ? 1 : -1) + view.ids.length) % view.ids.length];
                        activate(next);
                        focusTab(next);
                      } else if ((event.key === "Delete" || event.key === "Backspace") && !event.repeat) {
                        event.preventDefault();
                        closeTab(id);
                        focusTab(viewOf(termKey).active);
                      }
                    }}
                  >
                    <span className="term-tab-text">{tabLabel(shell)}</span>
                    {shell.exited !== null && <span className="term-tab-note">已退出</span>}
                  </button>
                )}
                <button type="button" className="term-tab-close" tabIndex={-1} aria-label="关闭终端" data-tip="关闭终端" onClick={() => closeTab(id)}>
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
        <Button variant="ghost" muted icon={<Plus size={16} />} label="新建终端" disabled={view.ids.length >= MAX_SHELLS} onClick={() => newTab(termKey)} />
        <Button variant="ghost" muted icon={<X size={16} />} label="关闭面板" onClick={() => setShown(termKey, false)} />
      </div>
      <div ref={host} className="term-host" />
      <Popover
        open={!!menu}
        onClose={() => setMenu(null)}
        anchor={<span className="rail-menu-anchor" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />}
      >
        <MenuItem
          label="重命名终端"
          onClick={() => {
            if (menu) setEditing(menu.id);
            setMenu(null);
          }}
        />
        <MenuSep />
        <MenuItem
          label="关闭终端"
          onClick={() => {
            if (menu) closeTab(menu.id);
            setMenu(null);
          }}
        />
        <MenuItem
          label="关闭其他终端"
          disabled={view.ids.length < 2}
          onClick={() => {
            if (menu) for (const id of [...view.ids]) if (id !== menu.id) closeTab(id);
            if (menu) activate(menu.id);
            setMenu(null);
          }}
        />
      </Popover>
    </section>
  );
}
