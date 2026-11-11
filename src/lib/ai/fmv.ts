// Pure pricing code. The AI never sets money: FMV, opening bid and increment come from here.
import type { Condition } from "./vision";

export const CONDITION_FACTOR: Record<Condition, number> = { new: 1, "like-new": 0.8, good: 0.65, fair: 0.45 };

export type Pricing = { fmv: number; startPrice: number; increment: number };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function incrementFor(fmv: number): number {
  return fmv < 100 ? 5 : fmv < 500 ? 10 : 25;
}

/** Median of matched new prices x condition factor; opening bid = 40% of FMV rounded down to $5. */
export function computePricing(prices: number[], condition: Condition): Pricing | null {
  const ok = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (ok.length === 0) return null;
  const fmv = Math.round(median(ok) * (CONDITION_FACTOR[condition] ?? 0.65));
  const startPrice = Math.max(5, Math.floor((fmv * 0.4) / 5) * 5);
  return { fmv, startPrice, increment: incrementFor(fmv) };
}
