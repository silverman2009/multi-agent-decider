import type {
  DecisionStatus,
  StepStatus,
} from "@/lib/types";

// ─── Class helpers ───────────────────────────────────────────────────────────

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ─── Buttons & inputs ────────────────────────────────────────────────────────

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_VARIANT: Record<string, string> = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700",
  ghost: "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100",
  danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
};
const BTN_SIZE: Record<string, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANT;
  size?: keyof typeof BTN_SIZE;
  loading?: boolean;
}) {
  return (
    <button
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-4 text-zinc-400">{hint}</span>}
    </label>
  );
}

// ─── Surfaces ────────────────────────────────────────────────────────────────

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-zinc-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-bold text-zinc-800">{title}</h2>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-zinc-900">{value}</div>
      {hint && <div className="mt-1 text-[11px] text-zinc-400">{hint}</div>}
    </div>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "emerald"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    red: "border-red-200 bg-red-50 text-red-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
  return <div className={cn("rounded-lg border px-3 py-2 text-sm leading-6", tones[tone])}>{children}</div>;
}

const TONES: Record<string, string> = {
  zinc: "bg-zinc-100 text-zinc-600",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  violet: "bg-violet-100 text-violet-700",
  sky: "bg-sky-100 text-sky-700",
};

export function Badge({ tone = "zinc", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <span className={cn("inline-block rounded-md px-2 py-0.5 text-[11px] font-medium", TONES[tone])}>
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-emerald-600" : "bg-zinc-300"
      )}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(-18px)" : "translateX(-2px)" }}
      />
    </button>
  );
}

// ─── Domain formatting ───────────────────────────────────────────────────────

export const STATUS_META: Record<DecisionStatus, { label: string; tone: keyof typeof TONES }> = {
  pending: { label: "در صف", tone: "zinc" },
  orchestrating: { label: "تحلیل ارکستراتور", tone: "blue" },
  executing: { label: "اجرای عامل‌ها", tone: "sky" },
  judging: { label: "جمع‌بندی داور", tone: "violet" },
  completed: { label: "تکمیل شد", tone: "emerald" },
  failed: { label: "ناموفق", tone: "red" },
};

export const STEP_STATUS_META: Record<StepStatus, { label: string; tone: keyof typeof TONES }> = {
  pending: { label: "در انتظار", tone: "zinc" },
  running: { label: "در حال اجرا", tone: "sky" },
  retrying: { label: "تلاش مجدد…", tone: "amber" },
  completed: { label: "کامل شد", tone: "emerald" },
  failed: { label: "خطا", tone: "red" },
};

export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fa-IR");
  } catch {
    return iso;
  }
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} میلی‌ثانیه`;
  return `${(ms / 1000).toFixed(1)} ثانیه`;
}
