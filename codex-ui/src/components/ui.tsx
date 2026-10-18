// CDS atoms (claude.ai audit W5, W7, W8, W12, W17; Claude Desktop 2.42304.0.0 shared-frame where
// the audit is silent): the button ladder, menus with submenus, the page's one tooltip layer,
// dialogs, segmented control, switch, status dots and Dots, the spinner, skeleton groups,
// ShimmerText, grapheme reveal, the drop scrim, the usage ring, the spark mark and the
// reduced-motion switch.

import { Check, ChevronDown, ChevronRight, Copy, Files, Folder, Image as ImageIcon, X } from "lucide-react";
import {
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
import { readPref } from "../lib/store";

declare global {
  /** Settings → 通用 → 系统 in the desktop shell (desktop/main.mjs keeps them in window-state.json). */
  interface CodexDesktopSettings {
    /** System tray icon; off: closing the window quits. */
    menuBar: boolean;
    /** The Quick Entry global hotkey. */
    quickEntry: boolean;
    /** Electron accelerator, default "Ctrl+Alt+Space". */
    quickEntryShortcut: string;
  }

  interface Window {
    /** The desktop shell's bridge, exactly what desktop/preload.cjs exposes; absent in a browser. */
    codexDesktop?: {
      setTheme(theme: "light" | "dark" | "system"): void;
      attention(on: boolean): void;
      relaunch(): void;
      setAuthWindow(signedIn: boolean): void;
      versions: { electron: string; chrome: string };
      getDesktopSettings(): Promise<CodexDesktopSettings>;
      /** A refused or unsupported hotkey keeps the previous one and reports why. */
      setDesktopSettings(patch: Partial<CodexDesktopSettings>): Promise<{ ok: true } | { ok: false; error: string }>;
      /** Quick Entry window only: the prompt to start a session with, or null to close it. */
      quickEntry(text: string | null): void;
      /** Jump list「新建会话」(empty prompt) and Quick Entry; returns the unsubscribe. */
      onNewSession(callback: (prompt: string) => void): () => void;
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
 * Sizes follow the density: comfortable xs / sm / md / lg = 24 / 28 / 32 / 40 tall (radii 6 / 7 /
 * 8 / 10), compact 20 / 20 / 24 / 28. An icon-only button takes `label` as its accessible name
 * and tooltip; `kbd` adds a shortcut to it. Icon-only md / xs glyphs are sized by the density.
 * Pass `data-touch-size` to let an xs button grow to the control height on touch screens.
 */
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  label,
  tip,
  kbd,
  muted,
  ink2,
  active,
  className = "",
  children,
  ...rest
}: ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  label?: string;
  tip?: string;
  kbd?: string;
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
      {...rest}
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
 * The panel sits in a portal (like Base UI's [data-cds-portal], z 120) at a fixed position 4px
 * off the anchor, so scroll containers never clip it. It flips to the other side when that side
 * has no room, stays inside the window and below a self-drawn title row.
 */
function place(panel: HTMLElement, anchor: DOMRect, placement: Placement) {
  const gap = 4;
  const margin = 8;
  const top = Math.max(margin, titlebarInset());
  const { width, height } = panel.getBoundingClientRect();
  const below = window.innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - top;
  let up = placement.startsWith("top");
  if (up && height > above && below > above) up = false;
  else if (!up && height > below && above > below) up = true;
  const y = up ? anchor.top - gap - height : Math.min(anchor.bottom + gap, window.innerHeight - margin - height);
  const start = placement.endsWith("start") ? anchor.left : anchor.right - width;
  const left = Math.min(Math.max(margin, start), window.innerWidth - margin - width);
  panel.style.top = `${Math.max(top, y)}px`;
  panel.style.left = `${left}px`;
}

/**
 * Closes on outside click and Escape; `open` is owned by the caller. The panel carries the
 * anchor's [data-density], takes focus when opened from the keyboard (arrow keys, Home and End
 * then move between items) and hands it back to the trigger when it closes.
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
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
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
  /** Current value shown muted before a submenu chevron. */
  value?: ReactNode;
  kbd?: string;
  /** Radio items reserve the icon-sized check column; leave undefined for plain items. */
  checked?: boolean;
  /** A checkbox item: the check shows only while on. */
  toggle?: boolean;
  danger?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  highlighted?: boolean;
  onClick(): void;
}) {
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
      {value !== undefined && <span className="menu-value">{value}</span>}
      {kbd && <span className="kbd">{kbd}</span>}
      {/* W5: the check is a 20px glyph at wght 566.5 (lucide 1.9) in the accent. */}
      {checked !== undefined && (!toggle || checked) && <span className="menu-check">{checked && <Check size={20} strokeWidth={1.9} />}</span>}
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
 * A submenu trigger row: hover or click opens the nested menu toward inline-start,
 * its top edge on the row, flipping to the other side when there is no room.
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
  useLayoutEffect(() => {
    const menu = host.current?.closest<HTMLElement>(".popover");
    const row = host.current?.firstElementChild as HTMLElement | null;
    const sub = panel.current;
    if (!open || !menu || !row || !sub) return;
    const menuRect = menu.getBoundingClientRect();
    // Top edge on the row, nudged up when the panel would run off the bottom of the window.
    const top = row.getBoundingClientRect().top - menuRect.top - 4;
    const room = window.innerHeight - 8 - (menuRect.top + top + sub.offsetHeight);
    sub.style.setProperty("--sub-top", `${top + Math.min(0, room)}px`);
    sub.dataset.side = menuRect.left - sub.offsetWidth - 4 < 8 ? "end" : "start";
  }, [open]);
  const hover = (next: boolean) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 80 : 160);
  };
  return (
    <div ref={host} onPointerEnter={() => hover(true)} onPointerLeave={() => hover(false)}>
      <MenuItem icon={icon} label={label} value={value} chevron highlighted={open} onClick={() => setOpen(!open)} />
      {open && (
        <div
          ref={panel}
          className={`popover submenu ${className}`}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") setOpen(false);
            moveFocus(event);
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
 * The page's one tooltip: any element with data-tip (and data-tip-kbd) gets it after a
 * 500ms hover, at once when moving between tooltips or focusing by keyboard.
 */
export function TooltipLayer() {
  const el = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; kbd?: string; target: HTMLElement } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let lastHidden = 0;
    const show = (target: HTMLElement) => {
      const text = target.dataset.tip;
      if (!text || !target.isConnected) return;
      setTip({ text, kbd: target.dataset.tipKbd, target });
      setOpen(true);
    };
    const hide = () => {
      clearTimeout(timer);
      if (current) lastHidden = performance.now();
      current = null;
      setOpen(false);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = (event.target as Element | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
      if (target === current) return;
      clearTimeout(timer);
      if (!target) return hide();
      const warm = current !== null || performance.now() - lastHidden < 300;
      current = target;
      if (warm) show(target);
      else timer = window.setTimeout(() => show(target), 500);
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

  // 5.5px below the trigger (above when there is no room), clamped to the viewport.
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || !tip) return;
    const anchor = tip.target.getBoundingClientRect();
    const { width, height } = node.getBoundingClientRect();
    const below = anchor.bottom + 5.5 + height < window.innerHeight - 8;
    const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8);
    node.style.left = `${left}px`;
    node.style.top = `${below ? anchor.bottom + 5.5 : anchor.top - 5.5 - height}px`;
  }, [tip]);

  return (
    <div ref={el} className="tooltip" role="tooltip" data-open={(open && tip) || undefined} aria-hidden={!open}>
      <span className="tooltip-text">{tip?.text}</span>
      {tip?.kbd && <kbd className="kbd">{tip.kbd}</kbd>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Open dialogs, bottom to top: only the top one answers Escape, the one below it blurs. */
const dialogStack: HTMLElement[] = [];

/**
 * Dialog sizes: sm 400, md 520, lg 720, xl 880, 2xl 1024, 3xl 1152. Portaled to <body> and
 * centred; Esc closes the top one; Tab stays inside; focus returns to whatever opened it.
 * `alert` is a confirmation (delete, discard …, CDS ConfirmationDialog): a heading-sized medium
 * title, no close button and no dismissal by clicking outside, so the footer must offer cancel.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
  alert = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  alert?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const opener = document.activeElement as HTMLElement | null;
    const below = dialogStack.at(-1);
    below?.setAttribute("data-nested-dialog-open", "");
    dialogStack.push(node);
    node.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, .btn-primary")?.focus();
    return () => {
      dialogStack.splice(dialogStack.indexOf(node), 1);
      if (below && dialogStack.at(-1) === below) below.removeAttribute("data-nested-dialog-open");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
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
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
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
          ref={panel}
          onKeyDown={trap}
        >
          <div className="dialog-head">
            <div>
              <h2 className={`dialog-title ${alert ? "fw-medium" : "fw-semibold"}`}>{title}</h2>
              {description && <p className="dialog-desc">{description}</p>}
            </div>
            {/* No tooltip on the close button, as in CDS. */}
            {!alert && <Button variant="ghost" muted icon={<X size={20} />} label="关闭" tip="" onClick={onClose} />}
          </div>
          {children && <div className="dialog-body scroll-fade-y">{children}</div>}
          {footer && <div className="dialog-foot">{footer}</div>}
        </div>
      </div>
      <div className="dialog-drag-strip" aria-hidden="true" />
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Controls

/** SegmentedControl: sm / lg rungs of the density, 1px track padding, thumb one radius in. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange(value: T): void;
  size?: "sm" | "lg";
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div
      className={`segmented ${size === "lg" ? "segmented-lg" : ""}`}
      role="radiogroup"
      onKeyDown={onKeyDown}
      style={{ ["--count" as string]: options.length, ["--index" as string]: index }}
    >
      <span className="segmented-thumb" aria-hidden="true" />
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
      aria-label="加载中"
      style={delay ? ({ "--placeholder-reveal-delay": delay } as CSSProperties) : undefined}
    >
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ "--i": index } as CSSProperties} onAnimationStart={syncPhase} />
      ))}
    </div>
  );
}

/** CDS Spinner: sm 12 / 1.5, md 16 / 1.75, lg 20 / 2 stroke; muted unless `inherit` takes the text color. */
export function Spinner({ size = 12, inherit = false }: { size?: number; inherit?: boolean }) {
  const stroke = size <= 12 ? 1.5 : size <= 16 ? 1.75 : 2;
  return (
    <span
      className="spinner"
      data-inherit={inherit || undefined}
      style={{ width: size, height: size, "--spinner-w": `${stroke}px` } as CSSProperties}
      aria-label="加载中"
    />
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
        <span className="drop-scrim-icons">
          <span>
            <span className="drop-rise" style={{ "--rise-delay": "60ms" } as CSSProperties}>
              <ImageIcon size={24} />
            </span>
          </span>
          <span>
            <span className="drop-rise">
              <Files size={24} />
            </span>
          </span>
          <span>
            <span className="drop-rise" style={{ "--rise-delay": "120ms" } as CSSProperties}>
              <Folder size={24} />
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

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** Height-animated disclosure using the CDS grid 0fr -> 1fr technique. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={`collapse ${open ? "open" : ""}`}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}
