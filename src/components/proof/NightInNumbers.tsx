"use client";

import { useState } from "react";
import { money } from "@/lib/client/format";
import type { State } from "@/lib/client/types";

function nightStats(state: State) {
  const sold = state.lots.filter((l) => l.status === "sold");
  const price = (l: (typeof sold)[number]) => l.finalPrice ?? l.highBid;
  const raised = sold.reduce((a, l) => a + price(l), 0);
  const withFmv = sold.filter((l) => !!l.fmv);
  const above = withFmv.reduce((a, l) => a + Math.max(0, price(l) - (l.fmv ?? 0)), 0);
  const firstCapture = state.ledger.find((r) => r.kind === "captured" && r.status.toUpperCase() !== "FAILED")?.ts;
  const settled = [...state.ledger].reverse().find((r) => r.kind === "payout" || r.kind === "receipt")?.ts;
  const settleMs = firstCapture !== undefined && settled !== undefined && settled >= firstCapture ? settled - firstCapture : undefined;
  return {
    soldCount: sold.length,
    raised,
    apiCalls: state.ledger.length,
    above: state.auctionType === "charity" && withFmv.length > 0 ? above : undefined,
    settleMs,
  };
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function NightInNumbers({ state, tone = "light", compact = false, className = "" }: { state: State; tone?: "light" | "dark"; compact?: boolean; className?: string }) {
  const n = nightStats(state);
  const t = state.totals;
  const dark = tone === "dark";
  const tiles: [string, string, string?][] = [
    ["Lots sold", String(n.soldCount), `of ${state.lots.length}`],
    ["Total raised", money(n.raised)],
    ["Held", money(t.held), "authorized on paddles"],
    ["Captured", money(t.captured), "charged to winners"],
    ["Released", money(t.voided), "returned to bidders"],
    ["Paid out", money(t.paidOut), "sent onward"],
    ["PayPal API calls", String(n.apiCalls), "ledger rows"],
    ["Time to settle", n.settleMs !== undefined ? duration(n.settleMs) : "—", "first capture to last receipt"],
  ];
  if (n.above !== undefined) tiles.splice(2, 0, ["Above estimate", money(n.above), "given over fair value"]);
  const muted = dark ? "text-[var(--t-muted)]" : "text-muted";
  const strong = dark ? "text-[var(--t-text)]" : "text-ink";
  return (
    <section aria-label="The night in numbers" className={className}>
      <h3 className={`display text-xl ${strong}`}>The night in numbers</h3>
      <dl className={`mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 ${compact ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        {tiles.map(([label, value, hint]) => (
          <div key={label} className={`rounded-lg border ${compact ? "px-3 py-2" : "px-4 py-3"} ${dark ? "border-[var(--t-line)] bg-[var(--t-panel)]" : "border-line bg-sunken/50"}`}>
            <dt className={`eyebrow text-[11px] ${muted}`}>{label}</dt>
            <dd className={`num display mt-0.5 ${compact ? "text-xl" : "text-2xl"} ${strong}`}>{value}</dd>
            {hint && !compact && <p className={`mt-0.5 text-[11px] leading-tight ${muted}`}>{hint}</p>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Stage close card: arrives after a pause so the SOLD moment is never cut off; dismissible. */
export function NightInNumbersOverlay({ state, href }: { state: State; href?: string }) {
  const [hidden, setHidden] = useState(false);
  if (state.status !== "closed" || hidden) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 motion-safe:animate-[gt-rise_0.7s_var(--ease)_4s_both] sm:p-[1.4vw]">
      <div className="pointer-events-auto relative max-h-[78vh] w-full max-w-5xl overflow-y-auto rounded-xl border border-[var(--t-line)] bg-[var(--t-bg)]/95 p-4 shadow-2xl backdrop-blur sm:p-5">
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="Dismiss the night in numbers"
          className="absolute right-3 top-3 rounded px-2 py-1 text-sm text-[var(--t-muted)] hover:text-[var(--t-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay-on-dark"
        >
          Dismiss
        </button>
        <NightInNumbers state={state} tone="dark" compact />
        {href && (
          <a href={href} className="mt-4 inline-flex items-center gap-2 rounded-md bg-[var(--t-text)] px-5 py-2.5 text-sm font-medium text-[var(--t-bg)] transition-opacity hover:opacity-90">
            See every PayPal call for this auction <span aria-hidden>&rarr;</span>
          </a>
        )}
      </div>
    </div>
  );
}
