"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode, ButtonHTMLAttributes, CSSProperties, HTMLAttributes, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { IconX } from "./icons";

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "glow" | "success" | "warning";
  size?: "sm" | "md" | "lg";
};
export function Btn({ variant = "outline", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 focus-ring disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]",
        size === "sm" && "h-10 px-3 text-[12px] sm:h-8",
        size === "md" && "h-9 px-4 text-[13px]",
        size === "lg" && "h-11 px-5 text-[14px]",
        variant === "primary" &&
          "bg-linear-to-r from-[#6366f1] via-indigo-600 to-[#8b5cf6] text-white shadow-md shadow-indigo-500/25 hover:shadow-lg hover:shadow-indigo-500/35 hover:brightness-105 active:scale-[0.98]",
        variant === "glow" &&
          "bg-linear-to-r from-indigo-500 via-violet-500 to-purple-600 text-white shadow-[0_4px_18px_rgba(99,102,241,0.3)] hover:shadow-[0_6px_26px_rgba(139,92,246,0.45)] hover:brightness-110 active:scale-[0.98]",
        variant === "outline" &&
          "border border-line bg-surface/80 text-ink-soft hover:border-accent/40 hover:bg-raised hover:text-ink shadow-xs active:scale-[0.98]",
        variant === "ghost" && "bg-transparent text-ink-soft hover:bg-raised hover:text-ink active:scale-[0.98]",
        variant === "danger" &&
          "border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-600 hover:shadow-md hover:shadow-rose-500/25 active:scale-[0.98]",
        variant === "success" &&
          "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500 hover:text-white hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/25 active:scale-[0.98]",
        variant === "warning" &&
          "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500 hover:text-white hover:border-amber-600 hover:shadow-md hover:shadow-amber-500/25 active:scale-[0.98]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Badge ---------- */
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "indigo" | "cyan" | "amber" | "emerald" | "rose" | "violet";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line bg-raised text-ink-soft",
    indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-4 shadow-xs transition-colors",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Avatar ---------- */
export function Avatar({
  src,
  name,
  size = 28,
  ring,
}: {
  src?: string | null;
  name?: string;
  size?: number;
  ring?: boolean;
}) {
  if (src) {
    // Avatar providers are tenant/user-configurable external URLs; keep native loading to avoid requiring remotePatterns for every provider.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || ""}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={cn("rounded-full object-cover shrink-0", ring && "ring-2 ring-zinc-950")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-linear-to-br from-indigo-500 to-violet-500 grid place-items-center text-white font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {(name || "?").charAt(0)}
    </div>
  );
}

/* ---------- Kbd ---------- */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-raised px-1.5 font-mono text-[10px] text-ink-soft",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ---------- Screen header ---------- */
export function ScreenHeader({
  title,
  description,
  icon,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            aria-hidden="true"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-xl font-bold tracking-tight text-ink sm:text-[22px]">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 max-w-3xl text-[12.5px] leading-5 text-ink-soft">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
    </header>
  );
}

/* ---------- Screen toolbar ---------- */
export function ScreenToolbar({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/90 p-2 shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type SegmentedTabItem = {
  value?: string;
  id?: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
};

export function SegmentedTabs({
  value,
  items,
  onChange,
  label,
  className,
  stretch = false,
}: {
  value: string;
  items: SegmentedTabItem[];
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  stretch?: boolean;
}) {
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => !item.disabled);
    const current = enabled.findIndex(({ itemIndex }) => itemIndex === index);
    if (current < 0) return;
    const rtl = document.documentElement.dir === "rtl";
    const delta = event.key === "ArrowRight" ? (rtl ? -1 : 1) : event.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? enabled.length - 1
          : (current + delta + enabled.length) % enabled.length;
    const next = enabled[nextIndex];
    if (!next) return;
    const targetVal = next.item.value ?? next.item.id ?? "";
    onChange(targetVal);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next.itemIndex]?.focus({ preventScroll: true });
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "flex max-w-full overflow-x-auto rounded-xl border border-line bg-raised/80 p-1 shadow-xs backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        stretch && "w-full",
        className,
      )}
    >
      {items.map((item, index) => {
        const itemVal = item.value ?? item.id ?? "";
        item.value = itemVal;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            tabIndex={value === item.value ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(itemVal)}
            onKeyDown={(event) => moveFocus(event, index)}
            className={cn(
              "flex h-8.5 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[12px] font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 active:scale-[0.98]",
              stretch && "flex-1",
              value === item.value
                ? "bg-surface text-accent font-bold shadow-xs ring-1 ring-black/5 dark:ring-white/10"
                : "text-ink-soft hover:bg-surface/50 hover:text-ink",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Screen state ---------- */
export function ScreenState({
  title,
  description,
  icon,
  action,
  tone = "empty",
  framed = true,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: "loading" | "empty" | "error" | "permission";
  framed?: boolean;
  className?: string;
}) {
  const isError = tone === "error";
  return (
    <div
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      className={cn(
        "px-5 py-10 text-center",
        framed && "rounded-2xl border border-line bg-surface shadow-sm",
        framed && isError && "border-rose-500/25 bg-rose-500/5",
        framed && tone === "permission" && "border-amber-500/25 bg-amber-500/5",
        className,
      )}
    >
      {tone === "loading" ? (
        <span
          className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-accent/20 border-t-accent"
          aria-hidden
        />
      ) : (
        icon && (
          <span
            aria-hidden="true"
            className={cn(
              "mx-auto grid h-11 w-11 place-items-center rounded-xl border border-line bg-raised text-ink-soft",
              isError && "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300",
              tone === "permission" && "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}
          >
            {icon}
          </span>
        )
      )}
      <h2 className={cn("mt-3 text-[14px] font-semibold text-ink", isError && "text-rose-700 dark:text-rose-300")}>
        {title}
      </h2>
      {description && <p className="mx-auto mt-1 max-w-xl text-[12.5px] leading-5 text-ink-soft">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ---------- Progress bar ---------- */
export function Bar({ value, className, gradient = true }: { value: number; className?: string; gradient?: boolean }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-700 ease-out",
          gradient ? "bg-linear-to-r from-indigo-500 to-violet-500" : "bg-violet-500 dark:bg-violet-400",
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ---------- Progress ring (SVG) ---------- */
export function Ring({
  value,
  size = 72,
  stroke = 7,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, Math.max(0, value)) / 100) * c;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="currentColor"
          className="text-line"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#ringGrad)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          className="transition-all duration-1000 ease-out drop-shadow-[0_0_8px_rgba(99,102,241,0.4)] dark:drop-shadow-[0_0_8px_rgba(99,102,241,0.6)]"
        />
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6366F1" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>{label ?? <span className="text-[15px] font-bold text-ink tabular-nums">{Math.round(value)}%</span>}</div>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  open,
  onClose,
  title,
  icon,
  description,
  children,
  footer,
  wide,
  size,
  contentScrollable = true,
  contentClassName,
  panelClassName,
  panelStyle,
  closeLabel = "Close",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: "default" | "wide" | "large" | "workspace";
  contentScrollable?: boolean;
  contentClassName?: string;
  panelClassName?: string;
  panelStyle?: CSSProperties;
  closeLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !panelRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-60 flex items-center justify-center p-2 sm:p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-slate-900/60 dark:bg-zinc-950/70 backdrop-blur-md animate-fade"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={panelStyle}
        className={cn(
          "relative flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface/98 shadow-[0_24px_80px_rgba(0,0,0,0.2)] backdrop-blur-xl animate-pop sm:max-h-[calc(100dvh-2rem)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(99,102,241,0.08)]",
          size === "workspace"
            ? "max-w-[980px]"
            : size === "large"
              ? "max-w-[900px]"
              : size === "wide" || wide
                ? "max-w-[560px]"
                : "max-w-[460px]",
          panelClassName,
        )}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5 sm:py-4">
          {icon && (
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-linear-to-br from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:from-indigo-500/20 dark:to-violet-500/20 dark:text-violet-300 border border-indigo-200/70 dark:border-white/10">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 id={titleId} className="truncate text-[15px] font-semibold text-ink">
              {title}
            </h3>
            {description && <p className="mt-0.5 truncate text-[11.5px] text-ink-soft">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-ink-faint transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:h-8 sm:w-8"
          >
            <IconX size={15} />
          </button>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 p-4 sm:p-5",
            contentScrollable && "overflow-y-auto overscroll-contain",
            contentClassName,
          )}
        >
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-line bg-surface px-4 py-3 sm:px-5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Form primitives ---------- */
export function Field({
  label,
  children,
  as: Component = "label",
}: {
  label: string;
  children: ReactNode;
  as?: "label" | "div";
}) {
  return (
    <Component className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </Component>
  );
}
export const inputCls =
  "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-[13.5px] text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)] aria-invalid:border-rose-500 aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,#f43f5e_14%,transparent)] disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint";
export const areaCls =
  "min-h-[90px] w-full resize-none rounded-xl border border-line bg-surface p-3.5 text-[13.5px] leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)] aria-invalid:border-rose-500 aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,#f43f5e_14%,transparent)] disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint";
export const selectCls =
  "h-9.5 w-full cursor-pointer rounded-xl border border-line bg-surface px-3 py-0 text-[13px] leading-9 text-ink shadow-xs outline-none transition hover:border-accent/45 focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_14%,transparent)] aria-invalid:border-rose-500 aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,#f43f5e_14%,transparent)] disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint [&>option]:bg-surface [&>option]:text-ink";

export const selectSmCls =
  "h-8 cursor-pointer rounded-lg border border-line bg-surface px-2.5 py-0 text-[12px] leading-8 font-medium text-ink shadow-xs outline-none transition hover:border-accent/45 focus:border-accent focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_14%,transparent)] disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint [&>option]:bg-surface [&>option]:text-ink";

export const dropdownSurfaceCls =
  "dropdown-surface max-h-[min(380px,calc(100dvh-5rem))] w-[min(300px,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface shadow-[0_18px_52px_rgba(15,23,42,0.18)] ring-1 ring-line dark:shadow-[0_22px_60px_rgba(0,0,0,0.62)]";

export const dropdownItemCls =
  "dropdown-option flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-[12.5px] font-medium text-ink-soft hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:bg-accent/10 focus-visible:text-accent focus-visible:ring-2 focus-visible:ring-accent/40 transition-all duration-150 active:scale-[0.99]";

export const dropdownDangerItemCls =
  "dropdown-option flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start text-[12.5px] font-medium text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 focus-visible:outline-none focus-visible:bg-rose-500/10 focus-visible:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-400/40 transition-all duration-150 active:scale-[0.99]";

export const dropdownSectionLabelCls =
  "px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-indigo-500 dark:text-indigo-400";

export function handleDropdownMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
    ),
  ).filter((item) => item.offsetParent !== null);
  if (items.length === 0) return;

  event.preventDefault();
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? currentIndex < 0
            ? 0
            : (currentIndex + 1) % items.length
          : currentIndex <= 0
            ? items.length - 1
            : currentIndex - 1;

  items[nextIndex]?.focus({ preventScroll: true });
  items[nextIndex]?.scrollIntoView({ block: "nearest" });
}

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="grid h-10 w-11 shrink-0 place-items-center rounded-xl transition-all duration-200 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cn(
          "relative h-[22px] w-10 rounded-full transition-all duration-300 shadow-inner",
          checked ? "bg-linear-to-r from-[#6366f1] to-[#8b5cf6] shadow-[0_0_12px_rgba(99,102,241,0.35)]" : "bg-line",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-md transition-all duration-300",
            checked ? "start-[21px]" : "start-[3px]",
          )}
        />
      </span>
    </button>
  );
}

/* ---------- Empty state ---------- */
export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <ScreenState
      tone="empty"
      framed={false}
      icon={icon}
      title={title}
      description={hint}
      action={action}
      className="py-16"
    />
  );
}

/* ---------- Section heading ---------- */
export function SectionTitle({
  children,
  count,
  action,
}: {
  children: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <h3 className="text-[15px] font-semibold text-ink">{children}</h3>
        {count !== undefined && (
          <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-medium text-ink-soft tabular-nums">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/* ---------- Glass card ---------- */
type CardProps = HTMLAttributes<HTMLDivElement> & { glow?: boolean };

export function Card({ children, className, glow, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cn(
        "rounded-2xl border border-line bg-surface/80 backdrop-blur-sm shadow-sm dark:shadow-none",
        glow && "shadow-[0_8px_30px_rgba(99,102,241,0.08)] dark:shadow-[0_0_40px_rgba(99,102,241,0.07)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
