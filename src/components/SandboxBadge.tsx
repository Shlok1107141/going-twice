/** Quiet, neutral environment marker: a tiny dot and the word "Sandbox". Used identically on every page. */
export function SandboxBadge({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  return (
    <span
      title="PayPal sandbox: no real money moves"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${tone === "dark" ? "text-[var(--t-muted)]" : "text-muted"} ${className}`}
    >
      <span aria-hidden className="h-1 w-1 rounded-full bg-current" />
      Sandbox
    </span>
  );
}
