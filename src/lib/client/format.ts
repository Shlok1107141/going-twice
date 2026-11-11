import type { AuctionEvent, Lot, Paddle, State } from "./types";

export function money(n: number | undefined): string {
  const v = n ?? 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** Next bid amount per the API contract: max(startPrice, highBid + increment). */
export function nextBid(lot: Lot): number {
  return Math.max(lot.startPrice, lot.highBid + lot.increment);
}

export function headroom(p: Paddle): number {
  return Math.max(0, p.holdAmount - p.committed);
}

export function findPaddle(state: State, id?: string): Paddle | undefined {
  return id ? state.paddles.find((p) => p.id === id) : undefined;
}

export function paddleLabel(p: Paddle | undefined): string {
  if (!p) return "";
  return `#${p.number} ${p.name}${p.kind === "agent" ? " (AI agent)" : ""}`;
}

/** The lot on stage: the current lot, else the first pending lot, else the last lot. */
export function stageLot(state: State): Lot | undefined {
  return (
    state.lots.find((l) => l.id === state.currentLotId) ??
    state.lots.find((l) => l.status === "pending") ??
    state.lots[state.lots.length - 1]
  );
}

export function isBidEvent(e: AuctionEvent): boolean {
  return e.type === "bid" || e.type === "agent-bid";
}
