export function SandboxBadge({ className = "", tone = "light" }: { className?: string; tone?: "light" | "dark" }) {
  const look =
    tone === "dark"
      ? "border-clay-on-dark/50 text-clay-on-dark"
      : "border-clay/40 bg-clay-soft/60 text-clay-ink";
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium tracking-wide ${look} ${className}`}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      Sandbox &middot; no real money
    </span>
  );
}
