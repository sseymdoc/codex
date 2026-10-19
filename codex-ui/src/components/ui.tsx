// CDS atoms (claude.ai audit W5, W7, W8, W12, W17; Claude Desktop 2.42304.0.0 shared-frame where
// the audit is silent): the button ladder, menus with submenus, the page's one tooltip layer,
// dialogs, segmented control, switch, checkbox, status dots and Dots, the spinner, skeleton
// groups, ShimmerText, grapheme reveal, the drop scrim, the usage ring, the spark mark, shortcut
// keycaps and the reduced-motion switch.

import { Check, ChevronDown, ChevronRight, Copy, Files, Folder, Image as ImageIcon, X } from "lucide-react";
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
      versions: { electron: string; chrome: string };
      getDesktopSettings(): Promise<CodexDesktopSettings>;
      /** A refused or unsupported hotkey keeps the previous one and reports why. */
      setDesktopSettings(patch: Partial<CodexDesktopSettings>): Promise<{ ok: true } | { ok: false; error: string }>;
      /** Quick Entry window only: the prompt to start a session with, or null to close it. */
      quickEntry(text: string | null): void;
      /** Quick Entry window only: the card's size, so the window moves back on screen. */
      quickSkooch(width: number, height: number): void;
      /** The page listens now: runs what a jump-list launch of a closed app asked for. */
      ready(): void;
      /** Opens the app menu at the pointer (the chrome bar's 菜单 button). */
      popupMenu(): void;
      setMenuState(state: CodexDesktopMenuState): void;
      /** Whether a turn runs in any session (keepAwake holds the computer awake meanwhile). */
      setWorking(on: boolean): void;
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
 * "bottom" puts the tooltip below (pane and title-row buttons). Pass `data-touch-size` to let an
 * xs button grow to the control height on touch screens.
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
  /** Present or absent: React would print `false` as data-touch-size="false". */
  "data-touch-size"?: true;
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
  panel.style.maxHeight = capped ? `${room}px` : "";
  panel.style.overflowY = capped ? "auto" : "";
  const start = placement.endsWith("start") ? anchor.left : anchor.right - width;
  panel.style.left = `${Math.min(Math.max(margin, start), window.innerWidth - margin - width)}px`;
  panel.style.top = `${up ? anchor.top - gap - Math.min(height, room) : anchor.bottom + gap}px`;
}

/**
 * Closes on outside click and Escape; `open` is owned by the caller. The panel carries the
 * anchor's [data-density], takes focus when opened from the keyboard (arrow keys, Home and End
 * then move between items) and hands it back to the trigger when it closes. An anchor button
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
  const trigger = useRef<HTMLElement | null>(null);
  const focusInside = useRef(false);
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
  // Place next to the anchor and follow it while the page scrolls or resizes.
  useLayoutEffect(() => {
    const node = panel.current;
    if (!open || !node) return;
    const density = root.current?.closest("[data-density]")?.getAttribute("data-density");
    if (density) node.dataset.density = density;
    const update = () => {
      const anchorEl = root.current?.firstElementChild;
      if (anchorEl) place(node, anchorEl.getBoundingClientRect(), placement);
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
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
  useEffect(() => {
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      trigger.current = active && root.current?.contains(active) ? active : null;
      // A text field anchor keeps the caret; a button hands focus to the menu.
      if (trigger.current && !trigger.current.matches("input, textarea, [contenteditable]")) panel.current?.focus({ preventScroll: true });
    } else if (focusInside.current) {
      // The focused item went away with the panel: give focus back to the trigger.
      focusInside.current = false;
      if (document.activeElement === document.body || document.activeElement === null) trigger.current?.focus({ preventScroll: true });
    }
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
            onFocus={() => (focusInside.current = true)}
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
  // This menu's own rows: those of an open submenu are the submenu's.
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")].filter((item) => item.closest(".popover") === menu);
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
      {/* W5: the check is a 20px glyph at wght 566.5 (lucide 1.9) in the accent; it leads the
          trailing group (XS: check, value, shortcut). */}
      {checked !== undefined && <span className="menu-check">{checked && <Check size={20} strokeWidth={1.9} />}</span>}
      {value !== undefined && <span className={`menu-value${numeric(value)}`}>{value}</span>}
      {kbd && <span className={`kbd${numeric(kbd)}`}>{shortcutText(kbd)}</span>}
      {chevron && <ChevronRight size={16} className="menu-chevron" />}
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
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string; disabled?: boolean }[];
  placeholder?: string;
  onChange(value: T): void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      className="menu-select-menu"
      anchor={
        <Button variant="ghost" className="menu-select" aria-haspopup="menu" aria-expanded={open} aria-label={`${label}：${current?.label ?? placeholder}`} onClick={() => setOpen(!open)}>
          <span className="menu-select-value">{current?.label ?? placeholder}</span>
          <ChevronDown size={16} className="caret" />
        </Button>
      }
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

/**
 * The page's one tooltip (CDS Tooltip): any element with data-tip (and data-tip-kbd) gets it
 * 300ms after the pointer reaches it, every trigger waiting on its own (CDS mounts no
 * TooltipGroup), and at once when focused by keyboard. It sits 4px above the trigger, below for
 * data-tip-side="bottom", flipping when that side has no room.
 */
export function TooltipLayer() {
  const el = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; kbd?: string; detail?: string; target: HTMLElement } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const show = (target: HTMLElement) => {
      const text = target.dataset.tip;
      if (!text || !target.isConnected) return;
      setTip({ text, kbd: target.dataset.tipKbd, detail: target.dataset.tipDetail, target });
      setOpen(true);
    };
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setOpen(false);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
      if (target === current) return;
      hide();
      if (!target) return;
      current = target;
      timer = window.setTimeout(() => show(target), 300);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches?.(":focus-visible") && target.dataset?.tip) {
        current = target;
        show(target);
      }
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
    };
  }, []);

  // Zp side "top", sideOffset 4: centred on the trigger, clamped to the window and kept below a
  // self-drawn title row.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !tip) return;
    const gap = 4;
    const anchor = tip.target.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = node;
    const fitsAbove = anchor.top - gap - height >= Math.max(8, titlebarInset());
    const fitsBelow = anchor.bottom + gap + height <= window.innerHeight - 8;
    const below = tip.target.dataset.tipSide === "bottom" ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    node.dataset.side = below ? "bottom" : "top";
    node.style.left = `${Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8)}px`;
    node.style.top = `${below ? anchor.bottom + gap : anchor.top - gap - height}px`;
  }, [tip]);

  const kbd = tip?.kbd && <kbd className="kbd">{shortcutText(tip.kbd)}</kbd>;
  return (
    <div ref={el} className="tooltip" role="tooltip" data-open={(open && tip) || undefined} data-detail={tip?.detail ? "" : undefined} aria-hidden={!open}>
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
            {closeButton && <Button variant="ghost" icon={<X size={20} />} label="关闭" tip="" onClick={onClose} />}
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
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange(value: T): void;
  size?: "sm" | "md" | "lg";
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
    <div ref={root} className={`segmented ${size === "md" ? "" : `segmented-${size}`}`} role="radiogroup" onKeyDown={onKeyDown}>
      <span ref={thumb} className="segmented-thumb" aria-hidden="true" />
      {options.map((option, i) => (
        <button
          key={option.value}
          type="button"
          role="radio"
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
      <span className="checkbox-box">{checked && <Check strokeWidth={2.25} aria-hidden="true" />}</span>
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
      <span className="sr-only">正在加载</span>
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
              <ImageIcon size={28} strokeWidth={1.6} />
            </span>
          </span>
          <span>
            <span className="drop-rise">
              <Files size={28} strokeWidth={1.6} />
            </span>
          </span>
          <span>
            <span className="drop-rise" style={{ "--rise-delay": "120ms" } as CSSProperties}>
              <Folder size={28} strokeWidth={1.6} />
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
      icon={copied ? <Check size={16} style={{ color: "var(--cds-success)" }} /> : <Copy size={16} />}
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
