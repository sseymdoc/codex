// CDS atoms: button ladder, popover menu, dialog, segmented pill, status dots,
// the usage ring meter and skeleton lines.

import { Check, Copy, X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "xs" | "sm" | "md" | "lg";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${icon && !children ? "btn-icon" : ""} ${className}`} {...rest}>
      {icon}
      {children && <span className="btn-label">{children}</span>}
    </button>
  );
}

/** Closes on outside click and Escape; `open` is owned by the caller. */
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
  placement?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
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
  return (
    <div className="popover-root" ref={root}>
      {anchor}
      {open && <div className={`popover popover-${placement} ${className}`}>{children}</div>}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  checked,
  danger,
  disabled,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button type="button" className={`menu-item ${danger ? "danger" : ""}`} disabled={disabled} onClick={onClick}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {hint && <span className="menu-hint">{hint}</span>}
      </span>
      {checked && <Check size={14} className="menu-check" />}
    </button>
  );
}

export function MenuSection({ title }: { title: string }) {
  return <div className="menu-section">{title}</div>;
}

export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose(): void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const focusable = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select, button.btn-primary");
    focusable?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" ref={panel}>
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">{title}</h2>
            {description && <p className="dialog-desc">{description}</p>}
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange(value: T): void;
}) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <div className="segmented" role="radiogroup" style={{ ["--count" as string]: options.length, ["--index" as string]: index }}>
      <span className="segmented-thumb" />
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
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-thumb" />
    </button>
  );
}

/** running: the agent is working (clay halo); clay: it waits on you; unread: a reply you have not seen. */
export function StatusDot({ kind }: { kind: "ready" | "running" | "error" | "clay" | "idle" | "unread" }) {
  return <span className={`status-dot status-${kind}`} aria-hidden="true" />;
}

/**
 * CDS Usage Ring Meter: the arc draws in on mount, breathes with a comet when the
 * value rises, and beats faster as it nears the limit (75% / 90% / 100%).
 */
export function UsageRing({
  value,
  size = 18,
  stroke = 2.5,
  title,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  title?: string;
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
    <span className="urm" data-entrance={shimmer ? undefined : "draw"} data-beat={beat || undefined} title={title} style={style}>
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

/** Placeholder lines with the CDS 105° sweep. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="加载中">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="skeleton-line" style={{ "--i": index } as CSSProperties} />
      ))}
    </div>
  );
}

export function QuietDots() {
  return (
    <span className="quiet-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
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
    <button
      type="button"
      className="icon-btn icon-btn-sm"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      {copied ? <Check size={14} className="copied" /> : <Copy size={14} />}
    </button>
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
