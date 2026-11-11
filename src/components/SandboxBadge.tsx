export function SandboxBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border-2 border-dashed border-rose-700 bg-rose-50 px-3 py-1 text-xs font-extrabold uppercase tracking-widest text-rose-800 ${className}`}
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-rose-600" />
      Sandbox &mdash; no real money
    </span>
  );
}
