// CDS atoms (claude.ai audit W5, W7, W8, W12, W17; Claude Desktop 2.42304.0.0 shared-frame where
// the audit is silent): the button ladder, menus with submenus, the page's one tooltip layer,
// dialogs, segmented control, switch, checkbox, status dots and Dots, the spinner, skeleton
// groups, ShimmerText, grapheme reveal, the drop scrim, the usage ring, the spark mark, shortcut
// keycaps and the reduced-motion switch.

import type { BrowserEvent, BrowserRequest } from "../lib/browser";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type AnimationEvent,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { shortcutKeys, shortcutText } from "../lib/shortcut";
import { safePolygon, type PolygonPoint } from "../lib/tooltip";
import { readPref } from "../lib/store";

declare global {
  /** Desktop-shell settings (desktop/main.mjs keeps them in window-state.json; runOnStartup is the OS login item). */
  interface CodexDesktopSettings {
    /** System tray icon; off: closing the window quits. */
    menuBar: boolean;
    /** The Quick Entry global hotkey. */
    quickEntry: boolean;
    /** Electron accelerator, default "Ctrl+Alt+Space". */
    quickEntryShortcut: string;
    /** Flash the taskbar button when something needs the user and the window is not focused (default off). */
    drawAttention: boolean;
    /** Keep the computer from idle-sleeping while a turn runs (default on). */
    keepAwake: boolean;
    /** Keep it awake on battery power too (default on). */
    keepAwakeOnBattery: boolean;
    /** Start with the system, in the tray (default off). */
    runOnStartup: boolean;
    /** Managed experimental backend; switching takes effect after a restart. */
    backendChannel: "disabled" | "release" | "preview" | "custom";
    toolAccessMode: "on-demand" | "all";
    connectorSearch: boolean;
  }

  interface CodexBackendState {
    channel: CodexDesktopSettings["backendChannel"];
    phase: "idle" | "download" | "build" | "install" | "ready" | "error";
    message: string;
    restartNeeded: boolean;
    logAvailable: boolean;
    packageName?: string | null;
  }

  /** A system notification; clicking it opens `threadId`. */
  interface CodexDesktopNotification {
    /** A newer notification with the same tag replaces it; closeNotification(tag) withdraws it. */
    tag: string;
    title: string;
    body: string;
    threadId: string;
    /** The RequestId its 允许一次 button answers (onNotificationAction); no button without it. */
    allowOnce?: string | number;
    silent?: boolean;
    urgency?: "low" | "normal";
  }

  /** What the app menu shows when it opens: 关闭会话, the 侧边栏 check, 返回 / 前进. */
  interface CodexDesktopMenuState {
    session: boolean;
    sidebar: boolean;
    back: boolean;
    forward: boolean;
  }

  /** The Windows jump list: sessions waiting on the user, recent folders, the latest session. */
  interface CodexDesktopJumpList {
    waiting: { id: string; title: string }[];
    folders: string[];
    last: { id: string; title: string } | null;
  }

  interface Window {
    /** The desktop shell's bridge, exactly what desktop/preload.cjs exposes; absent in a browser. */
    codexDesktop?: {
      setTheme(theme: "light" | "dark" | "system"): void;
      /** Ignored unless drawAttention is on. */
      attention(on: boolean): void;
      relaunch(): void;
      setAuthWindow(signedIn: boolean): void;
      browserRequest(request: BrowserRequest): Promise<unknown>;
      onBrowserState(callback: (event: BrowserEvent) => void): () => void;
      versions: { electron: string; chrome: string };
      getDesktopSettings(): Promise<CodexDesktopSettings>;
      /** A refused or unsupported hotkey keeps the previous one and reports why. */
      setDesktopSettings(patch: Partial<CodexDesktopSettings>): Promise<{ ok: true } | { ok: false; error: string }>;
      getBackendState(): Promise<CodexBackendState>;
      onBackendState(callback: (state: CodexBackendState) => void): () => void;
      openBackendLog(): Promise<string>;
      /** Quick Entry window only: the prompt to start a session with, or null to close it. */
      quickEntry(text: string | null): void;
      /** Quick Entry window only: the card's size, so the window moves back on screen. */
      quickSkooch(width: number, height: number): void;
      /** The page listens now: runs what a jump-list launch of a closed app asked for. */
      ready(): void;
      /** Opens the app menu at the pointer (the chrome bar's 菜单 button). */
      popupMenu(): void;
      setMenuState(state: CodexDesktopMenuState): void;
      /** Sessions running a turn and the background commands still running, one key each (keepAwake, the quit prompt). */
      setWorking(sessions: number, shells: string[]): void;
      notify(notification: CodexDesktopNotification): void;
      closeNotification(tag: string): void;
      /** null clears it (signed out). */
      setJumpList(list: CodexDesktopJumpList | null): void;
      /** Jump list and Quick Entry: a new session, with a prompt to send and a folder to start in ("" for none). */
      onNewSession(callback: (prompt: string, cwd: string) => void): () => void;
      /** Jump list, a notification click: open this session. */
      onOpenThread(callback: (threadId: string) => void): () => void;
      /** An app menu item, or a key the shell took (Ctrl+W: closeSession). */
      onMenuCommand(callback: (command: string) => void): () => void;
      /** A notification's 允许一次 for this RequestId. */
      onNotificationAction(callback: (action: { action: "allow_once"; requestId: string | number }) => void): () => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Reduced motion (07 §7.4)

/** Settings → 外观 → 动效: "system" follows the OS, "reduce" always reduces. */
export const MOTION_KEY = "codex-ui:motion";

/** Writes <html data-reduce-motion="true"> from the setting and the OS (theme-init.js does the first paint). */
export function applyMotion() {
  const reduce = readPref(MOTION_KEY, ["system", "reduce"], "system") === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) document.documentElement.dataset.reduceMotion = "true";
  else delete document.documentElement.dataset.reduceMotion;
}

function subscribeMotion(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
  return () => observer.disconnect();
}

const reducedNow = () => document.documentElement.dataset.reduceMotion === "true";

/** True while motion is reduced, by the setting or the OS. JS-driven motion checks this. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, reducedNow);
}

/**
 * onAnimationStart for looping indicators: pins the loop to the document clock, so every copy on
 * the page pulses in step however late it mounted (CDS js:cds-phase-sync).
 */
export function syncPhase(event: AnimationEvent<Element>) {
  for (const animation of (event.target as Element).getAnimations()) animation.startTime = 0;
}

// ---------------------------------------------------------------------------
// Button

type ButtonVariant = "primary" | "secondary" | "ghost" | "brand" | "danger";
type ButtonSize = "xs" | "sm" | "md" | "lg";

/**
 * The press squish (shared-frame hs / Bl): every side moves in by h / 32 px (0.5–1.5), however
 * wide the button, down to .8 at most; the paint layer reads the scale from these variables.
 */
function setPress(button: HTMLElement) {
  const { offsetWidth: w, offsetHeight: h } = button;
  if (!w || !h) return;
  const inset = Math.min(1.5, Math.max(0.5, h / 32));
  button.style.setProperty("--cds-btn-press-sx", String(Math.max(0.8, 1 - (2 * inset) / w)));
  button.style.setProperty("--cds-btn-press-sy", String(Math.max(0.8, 1 - (2 * inset) / h)));
}

/**
 * Sizes follow the density: comfortable xs / sm / md / lg = 24 / 28 / 32 / 40 tall (radii 6 / 7 /
 * 8 / 10), compact 20 / 20 / 24 / 28; glyphs follow the size (base.css). An icon-only button
 * takes `label` as its accessible name and tooltip; `kbd` adds a shortcut to it, `tipSide`
 * "bottom" puts the tooltip below (pane and title-row buttons).
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  label,
  tip,
  kbd,
  tipSide,
  muted,
  ink2,
  active,
  className = "",
  children,
  onPointerDownCapture,
  onKeyDown,
  ...rest
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  label?: string;
  tip?: string;
  kbd?: string;
  tipSide?: "bottom";
  muted?: boolean;
  ink2?: boolean;
  active?: boolean;
}) {
  const iconOnly = !!icon && (children === undefined || children === null || children === false);
  const classes = [
    "btn",
    `btn-${variant}`,
    size === "md" ? "" : `btn-${size}`,
    iconOnly ? "btn-icon" : "",
    muted ? "btn-muted" : "",
    ink2 ? "btn-ink2" : "",
    active ? "btn-active" : "",
    className,
  ];
  return (
    <button
      type="button"
      className={classes.filter(Boolean).join(" ")}
      aria-label={iconOnly ? label : undefined}
      data-tip={tip ?? (iconOnly ? label : undefined)}
      data-tip-kbd={kbd}
      data-tip-side={tipSide}
      {...rest}
      onPointerDownCapture={(event) => {
        setPress(event.currentTarget);
        onPointerDownCapture?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === " " && !event.repeat) setPress(event.currentTarget);
        onKeyDown?.(event);
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Menus

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

const titlebarInset = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--titlebar-inset")) || 0;

/**
 * The panel sits in a portal (like Base UI's [data-cds-portal], z 120) at a fixed position 6px
 * off the anchor (CDS Menu / Popover sideOffset), so scroll containers never clip it. It flips
 * to the other side when that side has no room and stays inside the window and below a
 * self-drawn title row; taller than the room on its side, it is capped there and scrolls (Base
 * UI's available-height cap).
 */
function place(panel: HTMLElement, anchor: DOMRect, placement: Placement) {
  const gap = 6;
  const margin = 8;
  const top = Math.max(margin, titlebarInset());
  // Once capped, the panel's full height is its scrollHeight.
  const height = panel.style.maxHeight ? panel.scrollHeight : panel.offsetHeight;
  const width = panel.offsetWidth;
  const below = window.innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - top;
  let up = placement.startsWith("top");
  if (up && height > above && below > above) up = false;
  else if (!up && height > below && above > below) up = true;
  const room = Math.max(0, up ? above : below);
  const capped = height > room;
  // Content that changed since the last placement keeps an upward panel's end, by the anchor,
  // where it was: uncapped the panel grows up, capped it scrolls by as much (the model list
  // unfolding above its row leaves the row under the pointer).
  const changed = !!panel.dataset.height && panel.dataset.height !== String(height);
  panel.style.maxHeight = capped ? `${room}px` : "";
  panel.style.overflowY = capped ? "auto" : "";
  if (up && capped && changed) panel.scrollTop = panel.scrollHeight - panel.clientHeight - Number(panel.dataset.fromEnd);
  Object.assign(panel.dataset, { height, fromEnd: panel.scrollHeight - panel.clientHeight - panel.scrollTop });
  const start = placement.endsWith("start") ? anchor.left : anchor.right - width;
  panel.style.left = `${Math.min(Math.max(margin, start), window.innerWidth - margin - width)}px`;
  panel.style.top = `${up ? anchor.top - gap - Math.min(height, room) : anchor.bottom + gap}px`;
}

/**
 * Closes on outside click and Escape; `open` is owned by the caller. The panel carries the
 * anchor's [data-density], takes focus when opened from the keyboard (arrow keys, Home and End
 * then move between items) and hands it back to where it was when it closes. An anchor button
 * gets aria-haspopup and aria-expanded, as a Base UI Menu.Trigger does (its open fill keys on
 * both).
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = "bottom-start",
  className = "",
  children,
}: {
  open: boolean;
  onClose(): void;
  anchor: ReactNode;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  // Place next to the anchor and follow it while the page scrolls or resizes, and as the panel's
  // own size changes (floating-ui autoUpdate's elementResize): a line that appears, such as the
  // effort slider's Max warning, grows the panel away from the anchor instead of over it. Rows
  // that come or go re-place it too, since a capped panel keeps its size as they do.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!open || !node) return;
    const density = root.current?.closest("[data-density]")?.getAttribute("data-density");
    if (density) node.dataset.density = density;
    const update = () => {
      const anchorEl = root.current?.firstElementChild;
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      // Base UI's positioner exposes it too (a field select's list is as wide as the field).
      node.style.setProperty("--anchor-width", `${rect.width}px`);
      place(node, rect, placement);
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(node);
    const rows = new MutationObserver(update);
    rows.observe(node, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      resize.disconnect();
      rows.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);
  useLayoutEffect(() => {
    const anchorEl = root.current?.firstElementChild;
    if (!(anchorEl instanceof HTMLButtonElement)) return;
    if (!anchorEl.hasAttribute("aria-haspopup")) anchorEl.setAttribute("aria-haspopup", "menu");
    anchorEl.setAttribute("aria-expanded", String(open));
  }, [open]);
  // As the panel goes, focus goes back where it was when the menu opened (the trigger, or the
  // row under a context menu), as Base UI's focus manager hands it back. Layout cleanups run
  // before the commit's layout effects, so a dialog an item opened takes that as its opener
  // instead of the item on its way out.
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body || panel.current?.contains(active)) opener?.focus({ preventScroll: true });
    };
  }, [open]);
  useEffect(() => {
    const active = document.activeElement;
    // A text field anchor keeps the caret; a button hands focus to the menu.
    if (open && active && root.current?.contains(active) && !active.matches("input, textarea, [contenteditable]")) panel.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div className="popover-root" ref={root}>
      {anchor}
      {open &&
        createPortal(
          <div
            ref={panel}
            className={`popover ${className}`}
            role="menu"
            tabIndex={-1}
            onKeyDown={moveFocus}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  // This menu's own rows and controls that stand in a row's place ([data-menu-stop], the model
  // menu's effort slider): those of an open submenu are the submenu's.
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(".menu-item:not(:disabled), [data-menu-stop]")].filter((item) => item.closest(".popover") === menu);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    event.key === "Home" ? 0
    : event.key === "End" ? last
    : index === -1 ? (event.key === "ArrowDown" ? 0 : last)
    : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next].focus();
}

export function MenuItem({
  icon,
  label,
  hint,
  value,
  kbd,
  checked,
  toggle,
  danger,
  disabled,
  chevron,
  highlighted,
  trailing,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  /** Current value: a muted footnote after the label (before a submenu chevron). */
  value?: ReactNode;
  /** Drawn as the Shortcut text variant: "Ctrl + O" shows Ctrl+O. */
  kbd?: string;
  /** Radio and checkbox items reserve the icon-sized check column; leave undefined for plain items. */
  checked?: boolean;
  /** A checkbox item (menuitemcheckbox) rather than a radio one. */
  toggle?: boolean;
  danger?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  highlighted?: boolean;
  /** Drawn last: a key that does what the row does (no control of its own inside the row's button). */
  trailing?: ReactNode;
  onClick(): void;
}) {
  // Digits line up (shared-frame US: tabular-nums for a numeric hint or shortcut).
  const numeric = (text: ReactNode) => (typeof text === "string" && /^\d+$/.test(text) ? " tabular" : "");
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : toggle ? "menuitemcheckbox" : "menuitemradio"}
      aria-checked={checked}
      className={`menu-item ${hint ? "two-line" : ""} ${danger ? "danger" : ""}`}
      data-highlighted={highlighted || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {hint && <span className="menu-hint">{hint}</span>}
      </span>
      {/* W5: the check is a 20px glyph at wght 566.7 (shared-frame: Check, size auto, bold) in the
          accent; it leads the trailing group (XS: check, value, shortcut). */}
      {checked !== undefined && <span className="menu-check">{checked && <Icon name="Check" size="md" bold />}</span>}
      {value !== undefined && <span className={`menu-value${numeric(value)}`}>{value}</span>}
      {kbd && <span className={`kbd${numeric(kbd)}`}>{shortcutText(kbd)}</span>}
      {chevron && <Icon name="CaretRight" size="sm" className="menu-chevron" />}
      {trailing}
    </button>
  );
}

export function MenuSection({ title }: { title: string }) {
  return <div className="menu-section">{title}</div>;
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />;
}

/**
 * A submenu trigger row (Base UI SubmenuTrigger): hovering 100ms or clicking opens the nested
 * menu toward inline-end, 2px off the parent menu with its top edge on the row; it flips to
 * inline-start and slides up when the window has no room. → or Enter on the row opens it on its
 * first item, ← inside it goes back to the row.
 */
export function Submenu({
  icon,
  label,
  value,
  className = "",
  children,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  /** The pointer last moved toward the submenu's side. */
  const heading = useRef(false);
  const focusFirst = useRef(false);
  const row = () => host.current?.firstElementChild as HTMLElement | null;
  const firstItem = () => panel.current?.querySelector<HTMLElement>(".menu-item:not(:disabled)");
  useLayoutEffect(() => {
    const menu = host.current?.closest<HTMLElement>(".popover");
    const rowEl = row();
    const sub = panel.current;
    if (!open || !menu || !rowEl || !sub) return;
    const menuRect = menu.getBoundingClientRect();
    // The row's top, moved up as far as the window bottom needs (in the menu's scrolled frame).
    const y = Math.max(8, Math.min(rowEl.getBoundingClientRect().top, window.innerHeight - 8 - sub.offsetHeight));
    sub.style.setProperty("--sub-top", `${y - menuRect.top + menu.scrollTop}px`);
    sub.dataset.side = menuRect.right + 2 + sub.offsetWidth > window.innerWidth - 8 ? "start" : "end";
    if (focusFirst.current) firstItem()?.focus();
    focusFirst.current = false;
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = () => {
    if (panel.current?.contains(document.activeElement)) row()?.focus();
    setOpen(false);
  };
  // Opens after 100ms and closes at once, unless the pointer is on its way to the submenu.
  // ponytail: 160ms of grace stands in for Base UI's safe polygon; port the triangle if
  // diagonal moves still drop the submenu.
  const hover = (next: boolean) => {
    clearTimeout(timer.current);
    if (next) timer.current = window.setTimeout(() => setOpen(true), 100);
    else if (heading.current) timer.current = window.setTimeout(close, 160);
    else close();
  };
  return (
    <div
      ref={host}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onPointerMove={(event) => {
        heading.current = panel.current?.dataset.side === "start" ? event.movementX < 0 : event.movementX > 0;
      }}
      onKeyDown={(event) => {
        if (event.target !== row() || (event.key !== "ArrowRight" && event.key !== "Enter")) return;
        event.preventDefault();
        event.stopPropagation();
        if (open) firstItem()?.focus();
        else {
          focusFirst.current = true;
          setOpen(true);
        }
      }}
    >
      <MenuItem icon={icon} label={label} value={value} chevron highlighted={open} onClick={() => setOpen(!open)} />
      {open && (
        <div
          ref={panel}
          className={`popover submenu ${className}`}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else moveFocus(event);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A W5 menu in place of a native <select>: a ghost trigger with the value and a caret. */
export function MenuSelect<T extends string>({
  label,
  value,
  options,
  placeholder = "—",
  field = false,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  placeholder?: string;
  /** A full-width outlined field (CDS Select's outline variant) with its list as wide. */
  field?: boolean;
  disabled?: boolean;
  onChange(value: T): void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const trigger = {
    "aria-haspopup": "menu",
    "aria-expanded": open && !disabled,
    "aria-label": `${label}：${current?.label ?? placeholder}`,
    disabled,
    onClick: () => setOpen(!open),
    children: (
      <>
        <span className="menu-select-value">{current?.label ?? placeholder}</span>
        <Icon name="CaretDown" size="sm" className="caret" />
      </>
    ),
  } as const;
  return (
    <Popover
      open={open && !disabled}
      onClose={() => setOpen(false)}
      placement={field ? "bottom-start" : "bottom-end"}
      className={field ? "menu-select-menu menu-select-field-menu" : "menu-select-menu"}
      anchor={field ? <button type="button" className="input menu-select-field" {...trigger} /> : <Button variant="ghost" className="menu-select" {...trigger} />}
    >
      {options.map((option) => (
        <MenuItem
          key={option.value}
          label={option.label}
          hint={option.hint}
          checked={option.value === value}
          disabled={option.disabled}
          onClick={() => {
            setOpen(false);
            if (option.value !== value) onChange(option.value);
          }}
        />
      ))}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Tooltip

type TipLabel = { text: string; kbd?: string; detail?: string; multiline: boolean };
type Tip = TipLabel & { id: number; target: HTMLElement; instant: boolean };

const tipLabel = (target: HTMLElement): TipLabel => ({
  text: target.dataset.tip ?? "",
  kbd: target.dataset.tipKbd,
  detail: target.dataset.tipDetail,
  multiline: target.dataset.tipMultiline !== undefined,
});
const sameLabel = (a: TipLabel, b: TipLabel) => a.text === b.text && a.kbd === b.kbd && a.detail === b.detail && a.multiline === b.multiline;

// Zp side "top", sideOffset 4: centred on the trigger, clamped to the window and kept below a
// self-drawn title row. data-tip-side="right" (side "inline-end") sits 4px past the trigger's end,
// centred on its middle, flipping to the start when the window has no room.
function placeTip(node: HTMLElement, target: HTMLElement) {
  const gap = 4;
  const anchor = target.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = node;
  if (target.dataset.tipSide === "right") {
    const right = anchor.right + gap + width <= window.innerWidth - 8 || anchor.left - gap - width < 8;
    node.dataset.side = right ? "right" : "left";
    node.style.left = `${right ? anchor.right + gap : anchor.left - gap - width}px`;
    node.style.top = `${Math.max(Math.max(8, titlebarInset()), Math.min(anchor.top + anchor.height / 2 - height / 2, window.innerHeight - height - 8))}px`;
    return;
  }
  const fitsAbove = anchor.top - gap - height >= Math.max(8, titlebarInset());
  const fitsBelow = anchor.bottom + gap + height <= window.innerHeight - 8;
  const below = target.dataset.tipSide === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
  node.dataset.side = below ? "bottom" : "top";
  node.style.left = `${Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8)}px`;
  node.style.top = `${below ? anchor.bottom + gap : anchor.top - gap - height}px`;
}

/** The tooltip's exit (--cds-dur-snap): a trigger re-entered within it takes its tooltip back. */
const TIP_EXIT_MS = 120;

/**
 * The page's one tooltip, standing in for every CDS Tooltip (shared-frame Zp on Base UI's
 * Tooltip): any element with data-tip (and data-tip-kbd / -detail / -multiline) is a trigger.
 * - It opens once the pointer has rested on the trigger for 300ms (data-tip-group="700" sets a
 *   group's own wait), at once when the trigger takes keyboard focus. It sits 4px above the
 *   trigger, below for data-tip-side="bottom" or to its right for "right", flipping when that side
 *   has no room, and follows the trigger and its label while open.
 * - The tooltip can be hovered: leaving the trigger towards it keeps it (safePolygon), leaving the
 *   tooltip closes it. One to the side can't (Claude's, the session row's title, sets hoverable
 *   false: shared-18 aD). A press anywhere but on the tooltip (or inside a data-tip-reason, a disabled
 *   control's reason), Escape, or the trigger's blur closes it; the pointer then has to leave the
 *   trigger and come back.
 * - Inside a data-tip-group (CDS TooltipGroup: Base UI Tooltip.Provider, closeDelay 200, timeout
 *   400; the innermost one counts) a pointer leaving closes it 200ms later, and once one has
 *   shown, another trigger of the group opens on arrival with no fade either way, until 400ms
 *   after the group's last one closed.
 * - Each new tooltip replaces the previous one at once (Zp closeInstant), as does the scroll of a
 *   box around a hover-opened trigger. A trigger that goes away, loses its data-tip or opens its
 *   menu closes it; one clipped out of sight hides it (data-[anchor-hidden]).
 */
export function TooltipLayer() {
  const el = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let seq = 0;
    let cur: HTMLElement | null = null; // the trigger whose tooltip shows
    let curBy: "hover" | "focus" = "hover";
    let label: TipLabel | null = null;
    let under: HTMLElement | null = null; // the innermost trigger under the pointer
    let pending: HTMLElement | null = null;
    let openTimer = 0;
    let closeTimer = 0;
    let polygon: ReturnType<typeof safePolygon> | null = null;
    let exiting: { target: HTMLElement; at: number } | null = null;
    // The group whose tooltip showed last, with that trigger, until 400ms after it closed.
    let group: Element | null = null;
    let groupTrigger: HTMLElement | null = null;
    let groupTimer = 0;
    let frame = 0;
    // The trigger's clipping boxes, and whether it is out of all sight (floating-ui hide).
    let clips: Element[] = [];
    let clipped = false;
    const groupOf = (target: Element) => target.closest("[data-tip-group]");
    // The wait before opening: a group's own (data-tip-group="700"), else its nearest outer
    // group's, as a CDS TooltipGroup inherits it; 300 by default.
    const delayOf = (target: Element) => {
      for (let g = groupOf(target); g; g = g.parentElement?.closest("[data-tip-group]") ?? null) {
        const ms = g.getAttribute("data-tip-group");
        if (ms) return Number(ms);
      }
      return 300;
    };

    // The group forgets its trigger 400ms after that tooltip went (Base UI delay group timeout).
    const release = (target: HTMLElement) => {
      if (groupTrigger !== target) return;
      clearTimeout(groupTimer);
      groupTimer = window.setTimeout(() => {
        group = null;
        groupTrigger = null;
      }, 400);
    };
    // `hover`: the pointer took it away, so coming back during the exit takes it back.
    const close = (instant = false, hover = false) => {
      clearTimeout(closeTimer);
      polygon = null;
      if (!cur) return;
      const target = cur;
      cur = null;
      exiting = hover && !instant ? { target, at: performance.now() } : null;
      cancelAnimationFrame(frame);
      setTip((prev) => (prev && prev.instant !== instant ? { ...prev, instant } : prev));
      setOpen(false);
      release(target);
    };
    const closeLater = () => {
      if (!cur) return;
      clearTimeout(closeTimer);
      if (groupOf(cur)) closeTimer = window.setTimeout(() => close(false, true), 200);
      else close(false, true);
    };
    // Each frame while open: the trigger is still there, still labelled and its menu shut; the
    // tooltip keeps up with its label and position.
    const watch = () => {
      const target = cur;
      const node = el.current;
      if (!target) return;
      if (!target.isConnected || !target.dataset.tip || target.getAttribute("aria-expanded") === "true") return close();
      const next = tipLabel(target);
      if (label && !sameLabel(label, next)) {
        label = next;
        setTip((prev) => (prev && prev.target === target ? { ...prev, ...next } : prev));
      }
      const r = target.getBoundingClientRect();
      const gone = (b: { top: number; right: number; bottom: number; left: number }) => r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right;
      const out = gone({ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }) || clips.some((box) => gone(box.getBoundingClientRect()));
      if (out !== clipped) {
        clipped = out;
        setHidden(out);
      }
      if (node) placeTip(node, target);
      frame = requestAnimationFrame(watch);
    };
    const show = (target: HTMLElement, by: "hover" | "focus") => {
      clearTimeout(openTimer);
      pending = null;
      if (target === cur) {
        clearTimeout(closeTimer);
        return;
      }
      // A trigger whose menu is open keeps quiet, even as its label changes under a resting pointer.
      if (!target.dataset.tip || !target.isConnected || target.getAttribute("aria-expanded") === "true") return;
      clearTimeout(closeTimer);
      polygon = null;
      const g = groupOf(target);
      // Another trigger of the group showed moments ago: no fade either way (isInstantPhase).
      const instant = !!g && g === group && groupTrigger !== target;
      const back = !cur && exiting?.target === target && performance.now() - exiting.at < TIP_EXIT_MS;
      if (cur) release(cur);
      if (g) {
        clearTimeout(groupTimer);
        group = g;
        groupTrigger = target;
      }
      cur = target;
      curBy = by;
      exiting = null;
      label = tipLabel(target);
      const next = label;
      setTip((prev) => (back && prev?.target === target ? { ...prev, ...next, instant: false } : { ...next, id: ++seq, target, instant }));
      setOpen(true);
      clipped = false;
      setHidden(false);
      clips = [];
      for (let box = target.parentElement; box; box = box.parentElement) if (getComputedStyle(box).overflow !== "visible") clips.push(box);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(watch);
    };
    const enter = (target: HTMLElement) => {
      if (target === cur) {
        // Back on the trigger before the close ran: it stays.
        clearTimeout(closeTimer);
        polygon = null;
        return;
      }
      // No wait while the group remembers a tooltip, or to take back one still fading out.
      const g = groupOf(target);
      if ((g && g === group) || (!cur && exiting?.target === target && performance.now() - exiting.at < TIP_EXIT_MS)) {
        show(target, "hover");
        return;
      }
      // The wait starts with the pointer's first move on it (restMs; Base UI's mouseenter waits
      // for one).
      clearTimeout(openTimer);
      openTimer = 0;
      pending = target;
    };
    const leave = (target: HTMLElement, point: PolygonPoint) => {
      if (target === pending) {
        clearTimeout(openTimer);
        pending = null;
      }
      const node = el.current;
      if (target !== cur) return;
      if (!node || node.dataset.side === "right" || node.dataset.side === "left") return closeLater();
      const handler = safePolygon(point.x, point.y, node.dataset.side, () => {
        if (polygon !== handler) return;
        polygon = null;
        closeLater();
      });
      polygon = handler;
      handler(point, target, node);
    };

    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const node = event.target as Element;
      // On the tooltip: a pending close waits no more (Base UI popup hover).
      if (el.current?.contains(node)) clearTimeout(closeTimer);
      const next = node.closest?.<HTMLElement>("[data-tip]") ?? null;
      if (next === under) return;
      const prev = under;
      under = next;
      if (prev) leave(prev, { x: event.clientX, y: event.clientY, target: prev, related: node, leave: true });
      if (next) enter(next);
    };
    const onOut = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const node = event.target as Node;
      const to = event.relatedTarget as Node | null;
      const popup = el.current;
      // Off the tooltip (to the trigger, the trigger takes it from there).
      if (popup?.contains(node) && !(to && popup.contains(to)) && cur && !(to && cur.contains(to))) {
        if (polygon) polygon({ x: event.clientX, y: event.clientY, target: node, related: to, leave: true }, cur, popup);
        else close(false, true);
      }
      // Out of the window: no pointerover follows.
      if (!to && under) {
        const prev = under;
        under = null;
        leave(prev, { x: event.clientX, y: event.clientY, target: prev, related: null, leave: true });
      }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      // Each move restarts the wait, all but a tremor (movement² < 2) once it runs; a closed or
      // pressed trigger stays shut until the pointer comes back (pending, blockMouseMove).
      const target = under;
      if (target && target === pending && !(openTimer && event.movementX ** 2 + event.movementY ** 2 < 2)) {
        clearTimeout(openTimer);
        openTimer = window.setTimeout(() => show(target, "hover"), delayOf(target));
      }
      if (!polygon || !cur || !el.current) return;
      polygon({ x: event.clientX, y: event.clientY, target: event.target as Node, leave: false }, cur, el.current);
    };
    const onDown = (event: PointerEvent) => {
      // A press on the tooltip isn't an outside press; one on the trigger closes it too
      // (closeOnClick), but for a disabled control's reason (DisabledReasonTooltip, closeOnClick false).
      const node = event.target as Node;
      if (el.current?.contains(node) || cur?.closest("[data-tip-reason]")?.contains(node)) return;
      clearTimeout(openTimer);
      pending = null;
      close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) close();
    };
    const onScroll = (event: Event) => {
      const box = event.target as Node;
      if (cur && curBy === "hover" && box !== cur && box.contains?.(cur)) close(true);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches?.(":focus-visible") && target.dataset?.tip) show(target, "focus");
    };
    const onBlur = (event: FocusEvent) => {
      const to = event.relatedTarget as Node | null;
      if (cur && cur.contains(event.target as Node) && !(to && (cur.contains(to) || el.current?.contains(to)))) close();
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
      clearTimeout(groupTimer);
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  useLayoutEffect(() => {
    if (el.current && tip) placeTip(el.current, tip.target);
  }, [tip]);

  const kbd = tip?.kbd && <kbd className="kbd">{shortcutText(tip.kbd)}</kbd>;
  return (
    <div
      key={tip?.id ?? 0}
      ref={el}
      className="tooltip"
      role="tooltip"
      data-open={(open && tip) || undefined}
      data-instant={tip?.instant ? "" : undefined}
      data-anchor-hidden={(open && hidden) || undefined}
      data-detail={tip?.detail ? "" : undefined}
      data-multiline={tip?.multiline ? "" : undefined}
      data-lines={tip?.target.dataset.tipLines}
      aria-hidden={!open}
    >
      {tip?.detail ? (
        // Zp with detail: the label row (text + shortcut), then an 11/14 secondary line (data-tip-detail).
        <>
          <span className="tooltip-line">
            <span className="tooltip-text">{tip.text}</span>
            {kbd}
          </span>
          <span className="tooltip-detail">{tip.detail}</span>
        </>
      ) : (
        <>
          <span className="tooltip-text">{tip?.text}</span>
          {kbd}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog

/** Tabbable: a roving item at tabindex -1 (Segmented's other options) is skipped like Tab skips it. */
const FOCUSABLE = ":is(button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]):not([tabindex^='-'])";

/** Open dialogs, bottom to top: only the top one answers Escape, the one below it blurs. */
const dialogStack: HTMLElement[] = [];

const EXIT: KeyframeAnimationOptions = { duration: 200, easing: "cubic-bezier(0.165, 0.84, 0.44, 1)", fill: "forwards" };

/**
 * The exit (Base UI data-ending-style over base ease-out: the panel to opacity 0 / scale .98, the
 * scrim to clear). Callers unmount a dialog at once (a footer button just clears state), so an
 * inert copy plays the exit where it stood. Call it while the dialog is still in the page.
 */
function playExit(backdrop: HTMLElement) {
  if (reducedNow()) return;
  // A detached node forgets its scroll offsets: note them now.
  const offsets = [...backdrop.querySelectorAll("*")].map((el) => el.scrollTop);
  queueMicrotask(() => {
    // StrictMode's rehearsal unmount leaves the dialog in the page.
    if (backdrop.isConnected) return;
    const ghost = backdrop.cloneNode(true) as HTMLElement;
    const card = ghost.firstElementChild as HTMLElement;
    ghost.inert = true;
    ghost.style.transition = card.style.transition = "none";
    document.body.append(ghost);
    ghost.querySelectorAll("*").forEach((el, i) => {
      if (offsets[i]) el.scrollTop = offsets[i];
    });
    ghost.animate({ backgroundColor: "transparent" }, EXIT);
    card.animate({ opacity: 0, scale: "0.98" }, EXIT);
    setTimeout(() => ghost.remove(), 200);
  });
}

/**
 * Dialog sizes: sm 400, md 520 (default), lg 720, xl 880, 2xl 1024, 3xl 1152. Portaled to <body>
 * and centred; Esc closes the top one; Tab stays inside; focus returns to whatever opened it and
 * the dialog fades out however it was closed. Head, body and footer scroll together.
 * `alert` is a confirmation (delete, discard …, CDS ConfirmationDialog): a heading-sized medium
 * title, no close button and no dismissal by clicking outside, so the footer must offer cancel.
 * `closeButton` overrides whether the head shows its X (default: all but alerts). Initial focus
 * goes to [data-autofocus], else the first field, else the primary or danger button, with its
 * ring showing even after a click; else, plainly, to the first tabbable (the X when shown) or the
 * panel itself.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  alert = false,
  closeButton = !alert,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  alert?: boolean;
  closeButton?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    const below = dialogStack.at(-1);
    below?.setAttribute("data-nested-dialog-open", "");
    dialogStack.push(node);
    const first = node.querySelector<HTMLElement>("[data-autofocus]") ?? node.querySelector<HTMLElement>("input, textarea, select, .btn-primary, .btn-danger");
    if (first) {
      // CDS focuses with focusVisible and marks it data-initial-focus, so the ring shows.
      first.setAttribute("data-initial-focus", "");
      first.addEventListener("blur", () => first.removeAttribute("data-initial-focus"), { once: true });
      first.focus({ focusVisible: true });
    } else {
      // CDS Dialog.Popup (shared-frame b_) leaves initialFocus to Base UI: DialogPopup (vendor-frame
      // Hf, default iu) has its focus manager (Qs) take the first tabbable, else the popup itself
      // (tabIndex -1), with a plain focus. 字体许可 (cea462098) lands on its close button.
      (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    }
    return () => {
      dialogStack.splice(dialogStack.indexOf(node), 1);
      if (below && dialogStack.at(-1) === below) below.removeAttribute("data-nested-dialog-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      if (node.parentElement) playExit(node.parentElement);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dialogStack.at(-1) === panel.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const box = event.currentTarget;
    const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
    // Qs: with nothing to tab to the panel keeps focus; Shift+Tab off the panel itself wraps to the end.
    const first = items[0] ?? box;
    const last = items.at(-1) ?? box;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === box)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <>
      {/* An alert asks for an answer: a click outside does not dismiss it (Esc still does). */}
      <div className="dialog-backdrop" onPointerDown={(event) => !alert && event.target === event.currentTarget && onClose()}>
        <div
          className={`dialog dialog-${size}`}
          role={alert ? "alertdialog" : "dialog"}
          aria-modal="true"
          data-alert={alert || undefined}
          tabIndex={-1}
          ref={panel}
          onKeyDown={trap}
        >
          <span className="scroll-fade-strip-top" aria-hidden="true" />
          <div className="dialog-head">
            <div>
              <h2 className={`dialog-title ${alert ? "fw-medium" : "fw-semibold"}`}>{title}</h2>
              {description && <p className="dialog-desc">{description}</p>}
            </div>
            {/* Ghost, primary ink, no tooltip (CDS CloseButton). */}
            {closeButton && <Button variant="ghost" icon={<Icon name="X" size={20} />} label="关闭" tip="" onClick={onClose} />}
          </div>
          {children && <div className="dialog-body">{children}</div>}
          {footer && <div className="dialog-foot">{footer}</div>}
          <span className="scroll-fade-strip-bottom" aria-hidden="true" />
        </div>
      </div>
      <div className="dialog-drag-strip" aria-hidden="true" />
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Controls

/**
 * SegmentedControl (shared-frame hO): as wide as its options; md (the density's control) by
 * default, sm / lg on the ladder; 1px track padding. The thumb is measured to the checked option
 * and slides there (FLIP over base, ease-snap), and follows the control when it resizes.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  disabled = false,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange(value: T): void;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  label?: string;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const at = useRef<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const node = root.current;
    const bar = thumb.current;
    if (!node || !bar) return;
    const place = (slide: boolean) => {
      const item = node.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!item?.offsetWidth) return;
      const from = at.current;
      const to = { left: item.offsetLeft, width: item.offsetWidth };
      if (from?.left === to.left && from.width === to.width) return;
      at.current = to;
      bar.style.width = `${to.width}px`;
      bar.style.transform = `translateX(${to.left}px)`;
      bar.style.visibility = "inherit";
      if (slide && from && !reducedNow())
        bar.animate(
          { transform: [`translateX(${from.left}px) scaleX(${from.width / to.width})`, `translateX(${to.left}px) scaleX(1)`] },
          { duration: 200, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
        );
    };
    place(true);
    const observer = new ResizeObserver(() => place(false));
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div ref={root} className={`segmented ${size === "md" ? "" : `segmented-${size}`}`} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} onKeyDown={disabled ? undefined : onKeyDown}>
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" />
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          disabled={disabled}
          aria-checked={option.value === value}
          tabIndex={i === index ? 0 : -1}
          className="segmented-item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Switch: --cds-switch-h tall (20 comfortable / 16 compact), 1.8 times as wide. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * CDS Checkbox: a --cds-checkbox box (20 comfortable / 16 compact) that fills with the accent
 * under a check; `label` follows it and names it.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
} & Pick<ComponentProps<"button">, "id" | "aria-describedby" | "aria-required" | "aria-invalid" | "aria-labelledby">) {
  return (
    <button {...rest} type="button" role="checkbox" aria-checked={checked} className="checkbox" disabled={disabled} onClick={() => onChange(!checked)}>
      <span className="checkbox-box">{checked && <Icon name="Check" size="sm" bold />}</span>
      {label !== undefined && <span>{label}</span>}
    </button>
  );
}

export type DotKind = "idle" | "running" | "blocked" | "unread" | "ready" | "error" | "clay";

/** 6px session dot: idle gray, running accent (blinking, in step page-wide), blocked yellow. */
export function StatusDot({ kind }: { kind: DotKind }) {
  return <span className="status-dot" data-kind={kind} aria-hidden="true" onAnimationStart={syncPhase} />;
}

/** CDS Dots: three 3px dots lit in turn (a session working, a setting saving). */
export function Dots() {
  return (
    <span className="dots" aria-hidden="true" onAnimationStart={syncPhase}>
      <i />
      <i />
      <i />
    </span>
  );
}

/** Codex's spark: eight rays in clay. The working line ticks it round in nine frames. */
export function Spark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 2.5v19M2.5 12h19M7.2 7.2l9.6 9.6M16.8 7.2l-9.6 9.6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Icon (shared-frame Jo): a glyph of Claude's Anthropicons-Variable, the face
// server/claude-fonts.mjs serves from the Claude Desktop installed here. Without Claude Desktop
// it serves Phosphor stand-ins at the same codepoints instead, so a name drawn here needs a line
// in src/fonts/icons.json and a rebuilt codex-icons.woff2 (src/fonts/build-icons.py).

/** Codepoints (shared-frame Qa.icons). Claude only appends to this registry, so a name keeps its glyph across Claude updates. */
const GLYPHS = {
  Activity: 0xe000, Add: 0xe001, AddCircle: 0xe002, AddLarge: 0xe134, Agent: 0xe003, AgentSimple: 0xe11b, AgentsSimple: 0xe11c, Alarm: 0xe004, AlignCenter: 0xe151,
  AlignEnd: 0xe152, AlignStart: 0xe153, AlignStretch: 0xe138, Android: 0xe005, Ant: 0xe006, Apple: 0xe007, Archive: 0xe008, ArrowBendUpLeft: 0xe185,
  ArrowBendUpRight: 0xe0d8, ArrowClockwise: 0xe11d, ArrowCounterClockwise: 0xe11e, ArrowDown: 0xe009, ArrowDownCircle: 0xe00a, ArrowDownLeft: 0xe129,
  ArrowDownRight: 0xe12a, ArrowInSquare: 0xe00b, ArrowLeft: 0xe00c, ArrowLeftCircle: 0xe00d, ArrowLine: 0xe139, ArrowOutSquare: 0xe00e, ArrowReturn: 0xe00f,
  ArrowRight: 0xe010, ArrowRightCircle: 0xe011, ArrowSplitRight: 0xe012, ArrowUp: 0xe013, ArrowUpCircle: 0xe014, ArrowUpLeft: 0xe12b, ArrowUpRight: 0xe015,
  ArrowsOut: 0xe016, Artifacts: 0xe017, Atom: 0xe018, Attachment: 0xe019, Bank: 0xe12c, Batch: 0xe01a, Beaker: 0xe01b, Binoculars: 0xe01c, Bluetooth: 0xe115,
  BluetoothSlash: 0xe116, Book: 0xe01d, BookClosed: 0xe01e, BookText: 0xe01f, Bookmark: 0xe117, BookmarkFilled: 0xe137, Box: 0xe020, BrowseSelect: 0xe021,
  Bullhorn: 0xe022, Cache: 0xe023, Calendar: 0xe024, Camera: 0xe025, Capacity: 0xe026, CaretDown: 0xe027, CaretDownUp: 0xe028, CaretLeft: 0xe029, CaretRight: 0xe02a,
  CaretUp: 0xe02b, CaretUpDown: 0xe02c, ChangesPlusMinus: 0xe02d, ChangesPlusMinusFilled: 0xe02e, Chart: 0xe02f, ChartLine: 0xe030, Chat: 0xe031, ChatAdd: 0xe032,
  ChatAddFilled: 0xe033, ChatDelete: 0xe034, ChatDeleteFilled: 0xe035, ChatFilled: 0xe036, ChatSimple: 0xe037, ChatSimpleFilled: 0xe038, Chats: 0xe039,
  ChatsFilled: 0xe03a, Check: 0xe03b, CheckCircle: 0xe03c, CheckCircleFilled: 0xe03d, CheckDouble: 0xe03e, Checklist: 0xe03f, ChecklistFilled: 0xe040, Circle: 0xe186,
  CirclesAdd: 0xe18a, Clipboard: 0xe041, ClipboardArrow: 0xe042, Clock: 0xe043, Cloud: 0xe044, CloudFilled: 0xe045, CloudSlash: 0xe046, CloudSlashFilled: 0xe047,
  Code: 0xe048, CodeBlock: 0xe049, CodeBrackets: 0xe04a, CodeFilled: 0xe04b, CoffeeCup: 0xe04c, Collapse: 0xe04d, Collection: 0xe18b, CommandCard: 0xe04e,
  CommandLine: 0xe04f, CommandLineFilled: 0xe050, CommandLinePrompt: 0xe051, Comment: 0xe181, CommentFilled: 0xe182, Compact: 0xe052, Computer: 0xe053,
  ComputerClassic: 0xe118, Concierge: 0xe054, Connectors: 0xe055, Copy: 0xe056, CornerBottomLeft: 0xe154, CornerBottomRight: 0xe155, CornerTopLeft: 0xe156,
  CornerTopRight: 0xe157, Create: 0xe057, CreditCard: 0xe058, Crop: 0xe13a, Cursor: 0xe059, CursorFilled: 0xe05a, DNA: 0xe05b, Database: 0xe05c, Diagram: 0xe13b,
  Disconnect: 0xe05d, Dispatch: 0xe05e, DollarSign: 0xe05f, DotsCircle: 0xe060, DotsHorizontal: 0xe061, DotsVertical: 0xe062, Download: 0xe063, Dropdown: 0xe13c,
  Edit: 0xe064, EditFilled: 0xe131, Email: 0xe065, Eraser: 0xe13d, Evals: 0xe066, Expand: 0xe067, ExtendedThinking: 0xe068, Eye: 0xe069, EyeDropper: 0xe13e,
  EyeFrame: 0xe123, EyeSlash: 0xe06a, Fastforward: 0xe06b, File: 0xe06c, FileAdd: 0xe06d, FileUpload: 0xe06e, Files: 0xe06f, Filter: 0xe070, Flag: 0xe071, Folder: 0xe072,
  FolderLink: 0xe184, FolderOpen: 0xe073, FolderPlus: 0xe074, Frame: 0xe124, FrameHash: 0xe13f, Ghost: 0xe075, GhostFilled: 0xe076, Gift: 0xe077, GitBranch: 0xe078,
  GitCommit: 0xe079, GitDiff: 0xe07a, GitFork: 0xe07b, GitMerge: 0xe07c, GitMergeConflict: 0xe07d, GitMergeQueue: 0xe111, GitMergedSimple: 0xe07e, GitPullRequest: 0xe07f,
  GitPullRequestClosed: 0xe080, GitPullRequestDraft: 0xe081, Github: 0xe187, Globe: 0xe082, Goal: 0xe12d, GraduationCap: 0xe083, Grid: 0xe084, Hammer: 0xe125,
  Hand: 0xe085, HandHeart: 0xe086, Haptics: 0xe087, Heading1: 0xe140, Heading2: 0xe141, Heading3: 0xe142, HealthConnect: 0xe126, Heart: 0xe127, Help: 0xe088,
  History: 0xe089, Home: 0xe08a, ID: 0xe08b, Image: 0xe08c, Images: 0xe188, Indent: 0xe08d, Info: 0xe08f, InfoSimple: 0xe08e, Interactive: 0xe090, JustifyCenter: 0xe143,
  JustifyEnd: 0xe158, JustifySpaceBetween: 0xe159, JustifyStart: 0xe15a, Key: 0xe091, Keyboard: 0xe092, Laptop: 0xe093, LaptopFilled: 0xe094, LaptopSlash: 0xe095,
  LetterSpacing: 0xe15b, Library: 0xe096, Lightbulb: 0xe097, Lightning: 0xe098, LineHeight: 0xe144, LineSegment: 0xe145, Link: 0xe099, LinkSimple: 0xe09a, Linux: 0xe119,
  ListAdd: 0xe09b, ListBullet: 0xe09c, ListCard: 0xe18c, ListNumbered: 0xe09d, Location: 0xe09e, LocationQuestionMark: 0xe09f, LocationSlash: 0xe0a0, Lock: 0xe0a1,
  LockOpen: 0xe0a2, LockShield: 0xe0a3, Logout: 0xe0a4, Mailbox: 0xe0a5, MapPin: 0xe0a6, Mcp: 0xe0a7, Memory: 0xe0a8, MemorySlash: 0xe133, Mention: 0xe0a9, Menu: 0xe0aa,
  Microphone: 0xe0ab, MicrophoneFilled: 0xe0ac, MicrophoneSlash: 0xe0ad, MinimizeBottomLeft: 0xe11f, MinimizeBottomRight: 0xe120, MinimizeTopLeft: 0xe121,
  MinimizeTopRight: 0xe122, Minus: 0xe0ae, MobilePhone: 0xe0af, Moon: 0xe0b0, MoonFilled: 0xe0b1, MoonStars: 0xe0b2, Note: 0xe0b3, Notification: 0xe0b4,
  NotificationSlash: 0xe0b5, Orbit: 0xe112, Organization: 0xe0b6, Outdent: 0xe146, Owl: 0xe0b7, Palette: 0xe0b8, PaletteFilled: 0xe0b9, PaperPlane: 0xe0ba, Pause: 0xe0bb,
  Phone: 0xe0bc, Pin: 0xe0bd, PinFilled: 0xe0be, PinSlash: 0xe0bf, Placeholder: 0xe0c0, Play: 0xe0c1, PlayCircle: 0xe0c2, PlayCircleFilled: 0xe0c3, PlayFilled: 0xe0c4,
  Plugin: 0xe0c5, Press: 0xe0c6, Pro: 0xe0c7, ProgressQuarter: 0xe12e, Prohibit: 0xe0c8, Projects: 0xe0c9, ProjectsFilled: 0xe0ca, ProjectsX: 0xe0cb, Prompt: 0xe0cc,
  Quote: 0xe132, Recording: 0xe0cd, Reorder: 0xe0cf, Research: 0xe0d0, Scale: 0xe128, Screenshare: 0xe0d1, Scroll: 0xe0d2, Search: 0xe0d3, SearchCircle: 0xe0d4,
  Select: 0xe0d5, Settings: 0xe0d6, Shapes: 0xe0d7, Share: 0xe0da, ShareAndroid: 0xe0d9, ShieldSearch: 0xe0db, Shuffle: 0xe0dc, SideBottom: 0xe179, SideLeft: 0xe17a,
  SideRight: 0xe17b, SideTop: 0xe17c, Sidebar: 0xe0dd, SidebarClose: 0xe0de, SidebarOpen: 0xe0df, SidebarRight: 0xe113, Sigma: 0xe147, Signpost: 0xe0e0,
  SlashShortcutCommand: 0xe0e1, Slides: 0xe0e2, Smiley: 0xe177, SmileyAdd: 0xe178, Sort: 0xe0e3, Speaker: 0xe0e4, SpeakerSlash: 0xe189, Spinner: 0xe0e5,
  Spreadsheet: 0xe0e6, Star: 0xe0e7, StarFilled: 0xe0e8, StarSlash: 0xe0e9, Stop: 0xe0ea, StopCircle: 0xe0eb, StopFilled: 0xe0ec, Styles: 0xe0ed, Sun: 0xe0ee,
  SunFilled: 0xe0ef, SunHorizon: 0xe0f0, Table: 0xe148, TableCellSplit: 0xe15c, TableCellsMerge: 0xe15d, TableColumnDelete: 0xe15e, TableColumnInsertLeft: 0xe15f,
  TableColumnInsertRight: 0xe160, TableRowDelete: 0xe161, TableRowInsertAbove: 0xe162, TableRowInsertBelow: 0xe163, Tasks: 0xe0f1, Team: 0xe0f2, Temperature: 0xe0f3,
  TemperatureSimple: 0xe0f4, TextAa: 0xe0f5, TextAlignCenter: 0xe149, TextAlignJustify: 0xe14a, TextAlignLeft: 0xe14b, TextAlignRight: 0xe14c, TextBold: 0xe0f6,
  TextHighlight: 0xe14d, TextItalics: 0xe0f7, TextT: 0xe14e, TextUnderline: 0xe0f8, ThumbsDown: 0xe0f9, ThumbsDownFilled: 0xe0fa, ThumbsUp: 0xe0fb,
  ThumbsUpFilled: 0xe0fc, Ticket: 0xe135, Timer: 0xe0fd, Toggles: 0xe0fe, Token: 0xe0ff, Tool: 0xe100, Trash: 0xe101, Trust: 0xe102, Upload: 0xe103,
  UsageGaugeHigh: 0xe12f, UsageGaugeMiddle: 0xe130, User: 0xe104, UserCircle: 0xe105, Users: 0xe106, Verified: 0xe107, Voice: 0xe108, Warning: 0xe109,
  WarningCircle: 0xe10a, WarningShield: 0xe10b, WindowNew: 0xe136, Windows: 0xe11a, Workspace: 0xe10c, Wrench: 0xe10d, WrenchFilled: 0xe10e, X: 0xe10f, XCircle: 0xe110,
  ZoomIn: 0xe14f, ZoomOut: 0xe150,
} as const;

export type IconName = keyof typeof GLYPHS;
export type IconSize = "xs" | "sm" | "md" | "lg" | "xl" | "xxl";

/** shared-frame Co: each size's px and stroke, regular and strong (bold). */
const ICON_STEPS: Record<IconSize, [px: number, regular: number, strong: number]> = {
  xs: [12, 0.8, 0.8],
  sm: [16, 1, 1.25],
  md: [20, 1.2, 1.5],
  lg: [24, 1.4, 1.4],
  xl: [28, 1.6, 1.6],
  xxl: [32, 1.8, 1.8],
};

/** shared-frame Uo: the wght (400–700) that draws `stroke` at `px`, on the 16 master up to 18px and the 20 master above. */
function iconWeight(px: number, stroke: number): number {
  const master = px <= 18 ? 16 : 20;
  const [lo, hi] = master === 16 ? [0.8, 1.25] : [1.125, 1.8];
  const wght = 400 + (300 * ((stroke * master) / px - lo)) / (hi - lo);
  return Math.round(Math.max(400, Math.min(700, wght)) * 10) / 10;
}

/**
 * Without a size the slot sizes the glyph (--cds-icon by density, --btn-icon in a button). A size
 * (a step, or px like customSize, which takes the nearest step's stroke, the larger on a tie) is
 * the glyph's own default, which a slot's rule still overrides. `bold` needs a size.
 */
export function Icon({ name, size, bold = false, style, ...props }: { name: IconName; size?: IconSize | number; bold?: boolean } & Omit<ComponentProps<"span">, "children">) {
  let own: CSSProperties | undefined;
  if (size !== undefined) {
    const px = typeof size === "number" ? size : ICON_STEPS[size][0];
    const steps = Object.values(ICON_STEPS);
    const [, regular, strong] = typeof size === "number" ? steps.reduce((a, b) => (Math.abs(b[0] - px) <= Math.abs(a[0] - px) ? b : a)) : ICON_STEPS[size];
    own = { "--icon-size": `${px}px`, "--icon-wght": iconWeight(px, bold ? strong : regular) } as CSSProperties;
  }
  return (
    <span data-cds="Icon" aria-hidden="true" {...props} style={own || style ? { ...own, ...style } : undefined}>
      {String.fromCodePoint(GLYPHS[name])}
    </span>
  );
}

/** By extension (shared-9 og / sg, Aq's md and html overrides); anything else is a document. */
const FILE_GLYPHS: Record<string, IconName> = Object.fromEntries(
  (
    [
      ["Archive", "zip tar gz bz2 xz 7z rar tgz"],
      ["Slides", "ppt pptx"],
      ["Database", "jsonl parquet db sqlite sqlite3"],
      ["Spreadsheet", "csv tsv xls xlsx"],
      [
        "Code",
        "js jsx gs ts tsx py rb go rs c cpp h hpp java kt swift sh bash zsh json yaml yml toml xml css scss sql graphql proto lua r cs vue pl php " +
          "python javascript typescript csharp rust ruby kotlin dart scala perl elixir haskell clojure groovy less plaintext",
      ],
      ["Image", "ico svg png jpg jpeg gif bmp webp mermaid mmd"],
      ["Scroll", "skill plugin"],
      ["Note", "md markdown"],
      ["Globe", "html htm xhtml"],
    ] as const
  ).flatMap(([glyph, exts]) => exts.split(" ").map((ext) => [ext, glyph])),
);

/** A file's type glyph (shared-9 cg, which c280f9bbb B draws while its colour icon set is flagged off). */
export function fileGlyph(path: string): IconName {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (name.includes("SKILL.md")) return "Scroll";
  const dot = name.lastIndexOf(".");
  return (dot >= 0 && FILE_GLYPHS[name.slice(dot + 1).toLowerCase()]) || "File";
}

// ---------------------------------------------------------------------------
// Usage ring (c403c4b83 UsageRingMotion)

type Beat = 1 | 2 | 3;
type RingMotion = { entrance: "draw" | "quiet" | null; beat: Beat | null; queued: Beat | null; shimmer: number | null };

const RING_LEDGER = "codex-ui:usageRingMotion";
/** Beat lengths (cb979c293): warning, critical, limit. */
const BEAT_MS: Record<Beat, number> = { 1: 2300, 2: 1450, 3: 2450 };
const RING_COLORS = ["var(--cds-fill-accent)", "var(--cds-fill-warning)", "var(--cds-fill-danger)", "var(--cds-fill-danger)"];

type Ledger = Record<string, { drawn: boolean; beats: number[] }>;

function readLedger(): Ledger {
  try {
    return JSON.parse(localStorage.getItem(RING_LEDGER) ?? "{}") as Ledger;
  } catch {
    return {};
  }
}

/** Marks a usage window drawn with every band up to `band` played; keeps the latest 100 windows. */
function writeLedger(key: string, band: number) {
  const ledger = readLedger();
  const beats = [1, 2, 3].filter((b) => b <= band || ledger[key]?.beats.includes(b));
  delete ledger[key];
  ledger[key] = { drawn: true, beats };
  const keys = Object.keys(ledger);
  for (const old of keys.slice(0, Math.max(0, keys.length - 100))) delete ledger[old];
  try {
    localStorage.setItem(RING_LEDGER, JSON.stringify(ledger));
  } catch {
    // Private mode: the ring just draws again next time.
  }
}

const QUIET: RingMotion = { entrance: null, beat: null, queued: null, shimmer: null };

/**
 * CDS Usage Ring Meter. A usage window (`motionKey`, e.g. `${limitId}:${resetsAt}`) draws in the
 * first time this machine shows it (900ms overshoot, the glow flaring) and enters quietly after
 * that; warning (75%) / critical (90%) / limit (100%) each beat once per window. When `streaming`
 * turns on at 15% or more the ring breathes and a comet runs to the arc's end. Nothing moves
 * when motion is reduced.
 */
export function UsageRing({
  value,
  size = 18,
  stroke = 2,
  motionKey,
  streaming = false,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  motionKey?: string;
  streaming?: boolean;
  children?: ReactNode;
}) {
  const percent = Math.min(100, Math.max(0, value));
  const band = percent >= 100 ? 3 : percent >= 90 ? 2 : percent >= 75 ? 1 : 0;
  const reduced = useReducedMotion();
  const [motion, setMotion] = useState<RingMotion>(QUIET);
  const seen = useRef<{ key?: string; band: number } | null>(null);
  const wasStreaming = useRef(streaming);

  useLayoutEffect(() => {
    if (reduced) return;
    const entry = motionKey ? readLedger()[motionKey] : undefined;
    const unplayed = motionKey && band > 0 && !entry?.beats.includes(band) ? (band as Beat) : null;
    const first = seen.current === null || seen.current.key !== motionKey;
    const rose = !first && band > (seen.current?.band ?? 0);
    seen.current = { key: motionKey, band };
    if (first) setMotion((m) => ({ ...m, entrance: motionKey && !entry?.drawn ? "draw" : "quiet", beat: null, queued: unplayed }));
    else if (rose && unplayed) setMotion((m) => (m.entrance ? { ...m, queued: unplayed } : { ...m, beat: unplayed }));
    else return;
    if (motionKey) writeLedger(motionKey, band);
  }, [motionKey, band, reduced]);

  // The entrance clears after 1200ms (draw) / 200ms (quiet); a beat queued behind it plays then.
  useEffect(() => {
    if (!motion.entrance) return;
    const timer = setTimeout(() => setMotion((m) => ({ ...m, entrance: null, beat: m.queued, queued: null })), motion.entrance === "draw" ? 1200 : 200);
    return () => clearTimeout(timer);
  }, [motion.entrance]);

  useEffect(() => {
    if (!motion.beat) return;
    const timer = setTimeout(() => setMotion((m) => ({ ...m, beat: null })), BEAT_MS[motion.beat]);
    return () => clearTimeout(timer);
  }, [motion.beat]);

  useEffect(() => {
    if (streaming && !wasStreaming.current && !reduced && percent >= 15) setMotion((m) => ({ ...m, shimmer: (m.shimmer ?? 0) + 1 }));
    wasStreaming.current = streaming;
  }, [streaming, reduced, percent]);

  useEffect(() => {
    if (motion.shimmer === null) return;
    const timer = setTimeout(() => setMotion((m) => ({ ...m, shimmer: null })), 2000);
    return () => clearTimeout(timer);
  }, [motion.shimmer]);

  const shown = reduced ? QUIET : motion;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const style = {
    "--urm-size": `${size}px`,
    "--urm-color": RING_COLORS[band],
    "--ring-c": circumference,
    "--urm-travel": `${Math.max(0, percent * 3.6 - 36)}deg`,
  } as CSSProperties;
  return (
    <span
      className="urm"
      style={style}
      data-entrance={shown.entrance ?? undefined}
      data-beat={shown.beat ?? undefined}
      data-shimmer={shown.shimmer === null ? undefined : ""}
      aria-hidden="true"
    >
      <span className="urm__hover">
        <span className="urm__beat">
          <span className="urm__glow" />
          <span className="urm__beat-glow" />
          <span className="urm__hover-glow" />
          <span className="urm__breath">
            <svg className="urm__ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
              <circle data-ring-track cx={center} cy={center} r={radius} strokeWidth={stroke} />
              <circle
                data-ring-arc
                cx={center}
                cy={center}
                r={radius}
                strokeWidth={stroke}
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - percent / 100)}
              />
            </svg>
            {shown.shimmer !== null && percent >= 15 && (
              <svg key={shown.shimmer} className="urm__comet" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={center} cy={center} r={radius} strokeWidth={stroke} strokeDasharray={`${circumference * 0.1} ${circumference}`} />
              </svg>
            )}
            {children && <span className="urm__label">{children}</span>}
          </span>
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Loading and working

/**
 * SkeletonGroup lines. hold="delayed" (default) stays invisible until --placeholder-reveal-delay
 * (.5s) so a quick load never flashes; "none" shows at once. `delay` overrides the reveal delay
 * (the transcript passes "2s"). Lines breathe in a 90ms wave once revealed.
 */
export function Skeleton({ lines = 3, hold = "delayed", delay }: { lines?: number; hold?: "delayed" | "none"; delay?: string }) {
  return (
    <div
      className="skeleton"
      data-hold={hold}
      role="status"
      style={delay ? ({ "--placeholder-reveal-delay": delay } as CSSProperties) : undefined}
    >
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ "--i": index } as CSSProperties} onAnimationStart={syncPhase} />
      ))}
      <span className="sr-only">加载中</span>
    </div>
  );
}

/**
 * CDS Spinner: sm 12 / 1.5, md 16 / 1.75, lg 20 / 2 stroke; muted unless `inherit` takes the text
 * color. Decorative unless given a `label`, which makes it a status announcing that text.
 */
export function Spinner({ size = 12, inherit = false, label }: { size?: number; inherit?: boolean; label?: string }) {
  const stroke = size <= 12 ? 1.5 : size <= 16 ? 1.75 : 2;
  const spinner = (
    <span
      className="spinner"
      data-inherit={inherit || undefined}
      style={{ width: size, height: size, "--spinner-w": `${stroke}px` } as CSSProperties}
      aria-hidden="true"
    />
  );
  if (!label) return spinner;
  return (
    <span className="spinner-status" role="status">
      {spinner}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * ShimmerText: light sweeping across working text (3s). Chromium lays a masked clone over the
 * text; other engines shimmer the text's own background — CSS picks the path. Text changes keep
 * the sweep's phase, so don't key it by its text. Reduced motion and forced colors show plain text.
 */
export function ShimmerText({
  children,
  active = true,
  variant = "default",
  delay,
  paused,
  className = "",
}: {
  children: ReactNode;
  active?: boolean;
  variant?: "default" | "secondary" | "muted";
  /** Start offset in ms. */
  delay?: number;
  paused?: boolean;
  className?: string;
}) {
  if (!active) return <span className={className || undefined}>{children}</span>;
  const style =
    delay !== undefined || paused
      ? ({ "--st-delay": delay === undefined ? undefined : `${delay}ms`, "--st-play": paused ? "paused" : undefined } as CSSProperties)
      : undefined;
  return (
    <span className={`shimmer ${className}`} data-variant={variant === "default" ? undefined : variant} style={style}>
      {children}
      <span className="shimmer-clone" aria-hidden="true">
        {children}
      </span>
    </span>
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A status label that, once its text changes, resolves grapheme by grapheme out of a 6px blur
 * (90ms each, 30ms apart). The first text shows as is.
 */
export function GraphemeReveal({ text }: { text: string }) {
  const initial = useRef(text);
  const changed = useRef(false);
  if (text !== initial.current) changed.current = true;
  if (!changed.current) return <>{text}</>;
  return (
    <span key={text} data-revealing="">
      {Array.from(graphemes.segment(text), ({ segment }, i) => (
        <span key={i} className="grapheme" style={{ "--i": i } as CSSProperties}>
          {segment}
        </span>
      ))}
    </span>
  );
}

/**
 * The window-wide drop target (W17 ChatComposerDropScrim): mount it while files are dragged over
 * the page. Over the composer card, use `.drop-panel[data-target="on|off"]` inside the card.
 */
export function DropScrim({ label }: { label: string }) {
  return createPortal(
    <div className="drop-scrim" aria-hidden="true">
      <div className="drop-scrim-ring">
        {/* Icon size xl: 28px. */}
        <span className="drop-scrim-icons">
          <span>
            <span className="drop-rise" style={{ "--rise-delay": "60ms" } as CSSProperties}>
              <Icon name="Image" size="xl" />
            </span>
          </span>
          <span>
            <span className="drop-rise">
              <Icon name="Files" size="xl" />
            </span>
          </span>
          <span>
            <span className="drop-rise" style={{ "--rise-delay": "120ms" } as CSSProperties}>
              <Icon name="Folder" size="xl" />
            </span>
          </span>
        </span>
        <span className="drop-scrim-label">{label}</span>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Image preview (W17 chat image preview, cd5136de8)

const PREVIEW = "chat-image-preview";
const CLOSING = "vt-image-preview-closing";
const NO_ORIGIN = "vt-image-preview-no-origin";
/** The latest viewImage / closeImage call; an older one stops touching names and classes. */
let previewGen = 0;
/** Transitions holding html.vt-image-preview-active. */
let previewHolds = 0;
/** A thumbnail named for an opening morph, until the name moves to the big image. */
let namedSource: HTMLElement | null = null;
/** The thumbnail hidden while its image is open (the image flew out of it). */
let hiddenSource: HTMLElement | null = null;

function beginPreview() {
  namedSource?.style.removeProperty("view-transition-name");
  namedSource = null;
  return ++previewGen;
}

function showSource() {
  if (hiddenSource) hiddenSource.style.visibility = "";
  hiddenSource = null;
}

/** Paging the preview: the thumbnail of the image now shown is the hidden one (c4b054ed5 originEl). */
export function hideSource(source: HTMLElement | null) {
  showSource();
  if (!source) return;
  source.style.visibility = "hidden";
  hiddenSource = source;
}

/** Holds html.vt-image-preview-active (and -crossfade) for one transition; returns the release. */
function holdPreview(crossfade: boolean) {
  const root = document.documentElement;
  previewHolds += 1;
  root.classList.add("vt-image-preview-active");
  root.classList.toggle("vt-image-preview-crossfade", crossfade);
  return () => {
    previewHolds -= 1;
    if (!previewHolds) root.classList.remove("vt-image-preview-active", "vt-image-preview-crossfade");
  };
}

function previewTransition(update: () => void | Promise<void>, done: () => void) {
  const transition = document.startViewTransition(update);
  transition.ready.catch(() => {});
  transition.updateCallbackDone.catch(() => {});
  void transition.finished.catch(() => {}).finally(done);
}

/** The corners an image shows: its own, or those of a clipping ancestor up to five levels up. */
function shownRadius(element: Element, fallback: string) {
  let node: Element | null = element;
  for (let level = 0; node && level < 5; level++, node = node.parentElement) {
    const style = getComputedStyle(node);
    const clips = node.tagName === "IMG" || style.overflow === "hidden" || style.overflow === "clip";
    if (clips && style.borderRadius !== "0px" && style.borderRadius !== "") return style.borderRadius;
  }
  return fallback;
}

function onScreen(element: Element) {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
}

const previewTarget = () => document.querySelector<HTMLElement>("[data-image-preview-target]");

// ponytail: the thumbnail's own corners only; cd5136de8 also insets the morph by an
// object-fit: contain letterbox, which no thumbnail here has. Port it if one does.
function setSourceShape(source: HTMLElement) {
  document.documentElement.style.setProperty("--vt-image-preview-source-radius", shownRadius(source, "0.5rem"));
}

const canMorph = () => typeof document.startViewTransition === "function" && !reducedNow();

/**
 * Opens the full-window image preview. `open` renders it synchronously (inside flushSync), its
 * big image marked [data-image-preview-target]. The thumbnail `source` morphs into it (.35s) and
 * stays hidden while it is open; with no source the page cross-fades (.18s); without View
 * Transitions or with motion reduced it just opens.
 */
export function viewImage(source: HTMLElement | null, open: () => void) {
  const gen = beginPreview();
  showSource();
  if (!canMorph()) return open();
  if (!source) return previewTransition(open, holdPreview(true));
  document.documentElement.classList.remove(CLOSING, NO_ORIGIN);
  setSourceShape(source);
  const release = holdPreview(false);
  namedSource = source;
  source.style.setProperty("view-transition-name", PREVIEW, "important");
  let target: HTMLElement | null = null;
  previewTransition(
    async () => {
      open();
      target = previewTarget();
      // Up to 100ms for the big image to decode, so the new snapshot has it drawn.
      const decoded = target instanceof HTMLImageElement ? target.decode().catch(() => {}) : undefined;
      await Promise.race([decoded, new Promise((resolve) => setTimeout(resolve, 100))]);
      source.style.removeProperty("view-transition-name");
      if (namedSource === source) namedSource = null;
      if (gen !== previewGen) return;
      if (target) {
        target.style.setProperty("view-transition-name", PREVIEW, "important");
        document.documentElement.style.setProperty("--vt-image-preview-target-radius", shownRadius(target, "0.375rem"));
      }
      source.style.visibility = "hidden";
      hiddenSource = source;
    },
    () => {
      release();
      if (gen === previewGen) target?.style.removeProperty("view-transition-name");
    },
  );
}

/**
 * Closes the preview: `close` unmounts it synchronously. The big image morphs back into `source`
 * (.25s), or fades out in place when the thumbnail has scrolled out of view; with no source the
 * page cross-fades; without a big image, View Transitions or motion it just closes.
 */
export function closeImage(source: HTMLElement | null, close: () => void) {
  const gen = beginPreview();
  const target = previewTarget();
  if (!canMorph() || (source && !target)) {
    showSource();
    return close();
  }
  if (!source || !target) {
    showSource();
    return previewTransition(close, holdPreview(true));
  }
  const root = document.documentElement;
  const visible = onScreen(source);
  root.classList.add(CLOSING);
  root.classList.toggle(NO_ORIGIN, !visible);
  setSourceShape(source);
  const release = holdPreview(false);
  target.style.setProperty("view-transition-name", PREVIEW, "important");
  previewTransition(
    () => {
      close();
      if (gen !== previewGen) return;
      showSource();
      if (visible) source.style.setProperty("view-transition-name", PREVIEW, "important");
    },
    () => {
      release();
      if (namedSource !== source) source.style.removeProperty("view-transition-name");
      if (gen === previewGen) root.classList.remove(CLOSING, NO_ORIGIN);
    },
  );
}

// ---------------------------------------------------------------------------
// Small pieces

export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      variant="ghost"
      size="xs"
      muted
      icon={copied ? <Icon name="Check" size={16} style={{ color: "var(--cds-success)" }} /> : <Icon name="Copy" size={16} />}
      label={copied ? "已复制" : label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    />
  );
}

/**
 * CDS Shortcut, keycap variant: one cap per key, "Ctrl + Shift + K" or "ctrl+shift+k" draws
 * Ctrl Shift K; a space separates the steps of a sequence ("esc esc": Esc 然后 Esc). Pass one
 * binding; put “或” between alternatives yourself.
 */
export function Kbd({ children }: { children: string | number }) {
  return (
    <span className="kbd-caps">
      {shortcutKeys(String(children)).map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="kbd-then">然后</span>}
          {step.map((key, j) => (
            <kbd key={j} className="kbd-cap">
              {key}
            </kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

/** Height-animated disclosure using the CDS grid 0fr -> 1fr technique. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`collapse ${open ? "open" : ""}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}
