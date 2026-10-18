// CDS atoms (claude.ai audit W5, W7): the button ladder, menus with submenus, the page's
// one tooltip layer, dialogs, segmented control, switch, status dots, the usage ring,
// skeleton lines and the spark mark.

import { Check, ChevronRight, Copy, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type ButtonVariant = "primary" | "secondary" | "ghost" | "brand" | "danger";
type ButtonSize = "xs" | "sm" | "md" | "lg";

/**
 * Sizes xs / sm / md / lg = 24 / 28 / 32 / 40 tall with 6 / 7 / 8 / 10 radii. An icon-only
 * button takes `label` as its accessible name and tooltip; `kbd` adds a shortcut to it.
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

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

/**
 * The panel sits in a portal (like Base UI's [data-cds-portal], z 120) at a fixed position
 * 4px off the anchor, so scroll containers never clip it. It flips to the other side when
 * that side has no room and stays inside the window.
 */
function place(panel: HTMLElement, anchor: DOMRect, placement: Placement) {
  const gap = 4;
  const margin = 8;
  const { width, height } = panel.getBoundingClientRect();
  const below = window.innerHeight - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  let up = placement.startsWith("top");
  if (up && height > above && below > above) up = false;
  else if (!up && height > below && above > below) up = true;
  const top = up ? Math.max(margin, anchor.top - gap - height) : Math.min(anchor.bottom + gap, window.innerHeight - margin - height);
  const start = placement.endsWith("start") ? anchor.left : anchor.right - width;
  const left = Math.min(Math.max(margin, start), window.innerWidth - margin - width);
  panel.style.top = `${Math.max(margin, top)}px`;
  panel.style.left = `${left}px`;
}

/** Closes on outside click and Escape; `open` is owned by the caller. Arrow keys move between items. */
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
  // Follow the anchor while the page scrolls or resizes under an open menu.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = root.current?.firstElementChild;
      if (trigger && panel.current) place(panel.current, trigger.getBoundingClientRect(), placement);
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);
  return (
    <div className="popover-root" ref={root}>
      {anchor}
      {open &&
        createPortal(
          <div ref={panel} className={`popover ${className}`} role="menu" onKeyDown={moveFocus}>
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

function moveFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(".menu-item:not(:disabled)")];
  if (!items.length) return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement as HTMLElement);
  const step = event.key === "ArrowDown" ? 1 : -1;
  items[(index + step + items.length) % items.length].focus();
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
  /** Radio items reserve the 20px check column; leave undefined for plain items. */
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
      {checked !== undefined && (!toggle || checked) && <span className="menu-check">{checked && <Check size={18} strokeWidth={2.2} />}</span>}
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

const FOCUSABLE = "button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Dialog sizes: sm 400, md 520, lg 720, xl 880. Esc closes; Tab stays inside. */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, .btn-primary");
    first?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
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
  return (
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog dialog-${size}`} role="dialog" aria-modal="true" ref={panel} onKeyDown={trap}>
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">{title}</h2>
            {description && <p className="dialog-desc">{description}</p>}
          </div>
          <Button variant="ghost" size="sm" muted icon={<X size={16} />} label="关闭" onClick={onClose} />
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** SegmentedControl: sm 28 / r7 or lg 40 / r10, 1px track padding, thumb one radius in. */
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
  return (
    <div
      className={`segmented ${size === "lg" ? "segmented-lg" : ""}`}
      role="radiogroup"
      style={{ ["--count" as string]: options.length, ["--index" as string]: index }}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segmented-item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange(value: boolean): void; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />;
}

export type DotKind = "idle" | "running" | "blocked" | "unread" | "ready" | "error" | "clay";

/** 6px session dot: idle gray, running accent (blinking), blocked yellow. */
export function StatusDot({ kind }: { kind: DotKind }) {
  return <span className="status-dot" data-kind={kind} aria-hidden="true" />;
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

/**
 * CDS Usage Ring Meter: the arc draws in on mount, breathes with a comet when the
 * value rises, and beats faster as it nears the limit (75% / 90% / 100%).
 */
export function UsageRing({
  value,
  size = 18,
  stroke = 2.5,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const percent = Math.min(100, Math.max(0, value));
  const beat = percent >= 100 ? 3 : percent >= 90 ? 2 : percent >= 75 ? 1 : 0;
  const [shimmer, setShimmer] = useState(0);
  const previous = useRef(percent);
  useEffect(() => {
    if (percent > previous.current + 0.5) setShimmer((count) => count + 1);
    previous.current = percent;
  }, [percent]);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const style = {
    "--urm-size": `${size}px`,
    "--urm-color": `var(--cds-chart-${beat === 0 ? 1 : beat === 1 ? 4 : 8})`,
    "--ring-c": circumference,
    "--urm-travel": `${percent * 3.6}deg`,
  } as CSSProperties;
  return (
    <span className="urm" data-entrance={shimmer ? undefined : "draw"} data-beat={beat || undefined} style={style}>
      <span className="urm__glow" />
      <span className="urm__hover">
        <span className="urm__beat-glow" />
        <span className="urm__beat">
          <span key={shimmer} className="urm__breath" data-shimmer={shimmer ? "" : undefined}>
            <svg className="urm__ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              <circle className="urm__track" cx={center} cy={center} r={radius} strokeWidth={stroke} />
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
            <svg className="urm__comet" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              <circle cx={center} cy={center} r={radius} strokeWidth={stroke} strokeDasharray={`${circumference * 0.08} ${circumference}`} />
            </svg>
            {children && <span className="urm__label">{children}</span>}
          </span>
        </span>
      </span>
    </span>
  );
}

/** Placeholder lines that breathe (cds-skeleton-breathe), 90ms apart. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="加载中">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="加载中" />;
}

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
