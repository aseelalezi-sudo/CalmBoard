import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { IconX } from "./icons";

/* ---------- Button ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger" | "glow";
  size?: "sm" | "md" | "lg";
};
export function Btn({ variant = "outline", size = "md", className, children, ...rest }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus-ring disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98]",
        size === "sm" && "h-8 px-3 text-[12px]",
        size === "md" && "h-9 px-4 text-[13px]",
        size === "lg" && "h-11 px-5 text-[14px]",
        variant === "primary" &&
          "bg-linear-to-r from-indigo-600 to-violet-600 text-white shadow-[0_4px_18px_rgba(99,102,241,0.25)] hover:brightness-110 dark:from-indigo-500 dark:to-violet-500 dark:shadow-[0_0_22px_rgba(139,92,246,0.22)]",
        variant === "glow" &&
          "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-[0_4px_20px_rgba(99,102,241,0.32)] hover:shadow-[0_4px_28px_rgba(139,92,246,0.38)] hover:brightness-105",
        variant === "ghost" &&
          "bg-transparent text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/5",
        variant === "outline" &&
          "border border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:border-white/10 dark:bg-white/3 dark:text-zinc-300 dark:hover:bg-white/7 dark:hover:text-white dark:hover:border-white/20",
        variant === "danger" &&
          "bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20",
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
    neutral: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/6 dark:text-zinc-400 dark:border-white/10",
    indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/25",
    cyan: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/25",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/25",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/25",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
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
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-1.5 font-mono text-[10px] text-slate-600 dark:border-white/10 dark:bg-white/6 dark:text-zinc-400">
      {children}
    </kbd>
  );
}

/* ---------- Progress bar ---------- */
export function Bar({ value, className, gradient = true }: { value: number; className?: string; gradient?: boolean }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/6", className)}>
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
          className="text-slate-200 dark:text-white/7"
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
        <div>
          {label ?? (
            <span className="text-[15px] font-bold text-slate-900 dark:text-white tabular-nums">
              {Math.round(value)}%
            </span>
          )}
        </div>
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
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/60 dark:bg-zinc-950/70 backdrop-blur-md animate-fade"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative w-full rounded-2xl border border-slate-200 bg-white/95 dark:border-white/10 dark:bg-zinc-900/95 shadow-[0_24px_80px_rgba(0,0,0,0.2)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_40px_rgba(99,102,241,0.08)] backdrop-blur-xl animate-pop",
          wide ? "max-w-[560px]" : "max-w-[460px]",
        )}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-white/7 px-5 py-4">
          {icon && (
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-linear-to-br from-indigo-500/10 to-violet-500/10 text-indigo-600 dark:from-indigo-500/20 dark:to-violet-500/20 dark:text-violet-300 border border-indigo-200/70 dark:border-white/10">
              {icon}
            </span>
          )}
          <h3 className="flex-1 text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h3>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-500 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <IconX size={15} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
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
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
        {label}
      </span>
      {children}
    </Component>
  );
}
export const inputCls =
  "w-full h-10 rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:border-white/10 dark:bg-white/4 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-indigo-400/50 dark:focus:bg-white/6";
export const areaCls =
  "w-full min-h-[90px] rounded-xl border border-slate-200 bg-white p-3.5 text-[13.5px] leading-relaxed text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] dark:border-white/10 dark:bg-white/4 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-indigo-400/50 dark:focus:bg-white/6 resize-none";
export const selectCls =
  "w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 outline-none transition focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white dark:focus:border-indigo-400/50 [&>option]:bg-white dark:[&>option]:bg-zinc-900";

/* ---------- Toggle ---------- */
export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5.5 w-10 rounded-full transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "bg-linear-to-r from-indigo-500 to-violet-500 shadow-[0_0_12px_rgba(99,102,241,0.35)]"
          : "bg-slate-300 dark:bg-white/10",
      )}
      style={{ height: 22 }}
    >
      <span
        className={cn(
          "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-300",
          checked ? "start-[21px]" : "start-[3px]",
        )}
      />
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-400 shadow-sm dark:border-white/10 dark:bg-white/3 dark:text-zinc-500 dark:shadow-[0_0_30px_rgba(99,102,241,0.06)]">
        {icon}
      </div>
      <h4 className="mt-4 text-[14px] font-semibold text-slate-900 dark:text-white">{title}</h4>
      {hint && (
        <p className="mt-1 max-w-[300px] text-[12.5px] leading-relaxed text-slate-500 dark:text-zinc-500">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Section heading ---------- */
export function SectionTitle({ children, count, action }: { children: ReactNode; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <h3 className="text-[15px] font-semibold text-slate-900 dark:text-white">{children}</h3>
        {count !== undefined && (
          <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 tabular-nums">
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/* ---------- Glass card ---------- */
export function Card({ children, className, glow }: { children: ReactNode; className?: string; glow?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-sm shadow-sm dark:border-white/7 dark:bg-white/2.5 dark:shadow-none",
        glow && "shadow-[0_8px_30px_rgba(99,102,241,0.08)] dark:shadow-[0_0_40px_rgba(99,102,241,0.07)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
