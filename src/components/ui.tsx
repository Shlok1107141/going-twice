import type { ReactNode } from "react";

/* Shared class recipes so every page uses the same buttons, fields and panels. */
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-200 disabled:cursor-not-allowed";
export const btn = {
  primary: `${btnBase} bg-ink px-5 py-2.5 text-[15px] text-canvas hover:bg-ink-2 disabled:bg-line-strong disabled:text-ink-2`,
  accent: `${btnBase} bg-clay-ink px-5 py-2.5 text-[15px] text-white hover:bg-[#8f4426] disabled:bg-line-strong disabled:text-ink-2`,
  secondary: `${btnBase} border border-line-strong bg-surface px-5 py-2.5 text-[15px] text-ink hover:border-ink-2 hover:bg-sunken disabled:opacity-50`,
  quiet: `${btnBase} px-3 py-2 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50`,
  danger: `${btnBase} bg-danger px-4 py-2 text-sm text-white hover:bg-[#87301f] disabled:opacity-50`,
  small: `${btnBase} border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink hover:border-ink-2 hover:bg-sunken disabled:border-line disabled:bg-sunken disabled:text-muted`,
};

export const field =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 text-base text-ink placeholder:text-muted transition-colors focus:border-ink focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1";
export const fieldLabel = "block text-sm font-medium text-ink-2";
export const panel = "rounded-xl border border-line bg-surface p-6 shadow-soft";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow text-clay-ink ${className}`}>{children}</p>;
}

/** Page title block: eyebrow, serif title, optional lede and right-aligned actions. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">{title}</h1>
        {lede && <p className="mt-3 text-base leading-relaxed text-ink-2">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Section heading used inside panels. */
export function SectionTitle({ id, children, hint }: { id?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="display text-2xl text-ink">
        {children}
      </h2>
      {hint && <p className="mt-1 text-sm leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

const tone: Record<string, string> = {
  open: "bg-clay-soft text-clay-ink",
  live: "bg-clay-soft text-clay-ink",
  pending: "bg-sunken text-ink-2",
  lobby: "bg-sunken text-ink-2",
  unsold: "bg-sunken text-muted",
  sold: "bg-sage-soft text-sage",
  captured: "bg-sage-soft text-sage",
  held: "bg-agent-soft text-agent",
  voided: "bg-sunken text-muted",
  closed: "bg-ink text-canvas",
  failed: "bg-danger-soft text-danger",
  pending_retry: "bg-danger-soft text-danger",
};

export function Pill({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${tone[value.toLowerCase()] ?? "bg-sunken text-ink-2"}`}>
      {label ?? value.replace(/[-_]/g, " ").toLowerCase()}
    </span>
  );
}
