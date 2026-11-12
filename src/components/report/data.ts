// Turns the auction State (GET /api/state) into AG Studio data sources, and builds a clearly
// labelled SAMPLE state for when the auction has no data yet.

import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { State } from "@/lib/auction/types";
import { defaultSettings } from "@/lib/auction/auctionTypes";

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: { format: USD } }),
    ...(hide && { hide }),
  }));

/** Ledger kinds, named as the money-flow stages the PTA chair thinks in. */
export const STAGE: Record<string, string> = {
  authorized: "Held",
  captured: "Captured",
  voided: "Released",
  payout: "Paid out",
  receipt: "Receipt",
};

export const hasReportData = (s: State | null): boolean =>
  !!s && (s.lots.some((l) => l.status === "sold") || s.ledger.length > 0 || s.paddles.length > 0);

export function buildGalaData(state: State): AgDataSourcesDefinition {
  const paddleName = (id?: string) => state.paddles.find((p) => p.id === id)?.name ?? "";
  const bidCount = (lotId: string) =>
    state.events.filter((e) => e.lotId === lotId && (e.type === "bid" || e.type === "agent-bid")).length;
  const iso = (ts: number) => new Date(ts).toISOString();

  const lots = state.lots.map((l) => {
    const evs = state.events.filter((e) => e.lotId === l.id).sort((a, b) => a.ts - b.ts);
    const sold = evs.find((e) => e.type === "sold");
    const secs = evs.length > 1 && sold ? Math.max(0, Math.round((sold.ts - evs[0].ts) / 1000)) : null;
    const price = l.finalPrice ?? 0;
    const known = l.fmv != null && l.finalPrice != null;
    return {
      id: l.id,
      title: `${l.emoji} ${l.title}`,
      status: l.status,
      startPrice: l.startPrice,
      finalPrice: l.finalPrice ?? null,
      fmv: l.fmv ?? null,
      aboveFmv: known ? Math.max(0, price - (l.fmv as number)) : null,
      beatFmv: known ? (price > (l.fmv as number) ? "Above estimate" : "At or below estimate") : "No estimate",
      winner: paddleName(l.winnerPaddleId) || "Unsold",
      bids: bidCount(l.id),
      secondsToSold: secs,
    };
  });

  const events = state.events.map((e) => ({
    id: e.id,
    ts: iso(e.ts),
    type: e.type,
    lot: state.lots.find((l) => l.id === e.lotId)?.title ?? "",
    paddle: paddleName(e.paddleId),
    text: e.text,
    count: 1,
  }));

  const ledger = state.ledger.map((r) => ({
    id: r.id,
    ts: iso(r.ts),
    stage: STAGE[r.kind] ?? r.kind,
    kind: r.kind,
    amount: r.amount,
    paypalId: r.paypalId ?? "",
    status: r.status,
    paddle: paddleName(r.paddleId),
    note: r.note ?? "",
  }));

  const paddles = state.paddles.map((p) => ({
    id: p.id,
    paddle: `#${p.number} ${p.name}`,
    kind: p.kind,
    status: p.status,
    hold: p.holdAmount,
    committed: p.committed,
    captured: p.capturedAmount ?? 0,
  }));

  return {
    description:
      "Going Twice gala report. Lots are charity auction items; every paddle is a PayPal authorization hold. " +
      "Money flows Held -> Captured (winners, never more than the hold) -> Released (unused holds voided) -> Paid out (to the PTA treasurer). " +
      "Amounts are USD. Above-estimate donation is final price minus the item's estimated fair market value.",
    sources: [
      {
        id: "lots",
        description: "One row per lot. aboveFmv is the portion of the final price above the estimated fair market value (the tax-deductible donation part).",
        data: lots,
        fields: fields([
          ["id", "Lot ID", "textFormat", true],
          ["title", "Lot", "textFormat"],
          ["status", "Lot Status", "textFormat"],
          ["startPrice", "Opening Bid", "currencyFormat"],
          ["finalPrice", "Final Price", "currencyFormat"],
          ["fmv", "Estimated Value (FMV)", "currencyFormat"],
          ["aboveFmv", "Above-FMV Donation", "currencyFormat"],
          ["beatFmv", "Versus Estimate", "textFormat"],
          ["winner", "Winner", "textFormat"],
          ["bids", "Bids", "integerFormat"],
          ["secondsToSold", "Seconds to Sold", "integerFormat"],
        ]),
      },
      {
        id: "events",
        name: "Bids and Events",
        description: "The auction event log: bids, agent bids, going-once/twice calls, sales. count is always 1, so sum it to count events.",
        data: events,
        fields: fields([
          ["id", "Event ID", "textFormat", true],
          ["ts", "Time", "dateTimeFormat"],
          ["type", "Event Type", "textFormat"],
          ["lot", "Event Lot", "textFormat"],
          ["paddle", "Event Paddle", "textFormat"],
          ["text", "Event Text", "textFormat"],
          ["count", "Event Count", "integerFormat"],
        ]),
      },
      {
        id: "ledger",
        name: "PayPal Ledger",
        description: "PayPal money movements. stage is Held, Captured, Released, Paid out or Receipt. Sum amount by stage for the money flow.",
        data: ledger,
        fields: fields([
          ["id", "Ledger ID", "textFormat", true],
          ["ts", "Ledger Time", "dateTimeFormat"],
          ["stage", "Money Stage", "textFormat"],
          ["kind", "Ledger Kind", "textFormat"],
          ["amount", "Ledger Amount", "currencyFormat"],
          ["paypalId", "PayPal ID", "textFormat"],
          ["status", "PayPal Status", "textFormat"],
          ["paddle", "Ledger Paddle", "textFormat"],
          ["note", "Ledger Note", "textFormat"],
        ]),
      },
      {
        id: "paddles",
        description: "One row per bidder paddle: hold is the PayPal authorization, committed the current winning bids, captured what was charged.",
        data: paddles,
        fields: fields([
          ["id", "Paddle ID", "textFormat", true],
          ["paddle", "Paddle", "textFormat"],
          ["kind", "Bidder Kind", "textFormat"],
          ["status", "Hold Status", "textFormat"],
          ["hold", "Hold", "currencyFormat"],
          ["committed", "Committed", "currencyFormat"],
          ["captured", "Captured", "currencyFormat"],
        ]),
      },
    ],
  };
}

/** Clearly labelled sample auction (client side only, never sent anywhere). */
export function sampleState(): State {
  const t0 = Date.now() - 55 * 60_000;
  const m = (min: number) => t0 + min * 60_000;
  const paddles: State["paddles"] = [
    { id: "p1", number: 1, name: "Maya (sample)", kind: "human", holdAmount: 400, committed: 0, status: "captured", capturedAmount: 310 },
    { id: "p2", number: 2, name: "Pick Agent (sample)", kind: "agent", holdAmount: 300, committed: 0, status: "captured", capturedAmount: 180 },
    { id: "p3", number: 3, name: "Dev (sample)", kind: "human", holdAmount: 250, committed: 0, status: "captured", capturedAmount: 120 },
    { id: "p4", number: 4, name: "Priya (sample)", kind: "human", holdAmount: 200, committed: 0, status: "voided", capturedAmount: 0 },
    { id: "p5", number: 5, name: "Bidder Bot (sample)", kind: "agent", holdAmount: 150, committed: 0, status: "voided", capturedAmount: 0 },
  ];
  const lots: State["lots"] = [
    { id: "l1", title: "Principal for a Day", description: "", emoji: "\u{1F393}", startPrice: 40, increment: 10, status: "sold", highBid: 180, winnerPaddleId: "p2", finalPrice: 180, phase: "sold", fmv: 60 },
    { id: "l2", title: "Weekend Cabin Stay", description: "", emoji: "\u{1F3D5}️", startPrice: 100, increment: 20, status: "sold", highBid: 310, winnerPaddleId: "p1", finalPrice: 310, phase: "sold", fmv: 280 },
    { id: "l3", title: "Class Pizza Party", description: "", emoji: "\u{1F355}", startPrice: 30, increment: 5, status: "sold", highBid: 120, winnerPaddleId: "p3", finalPrice: 120, phase: "sold", fmv: 90 },
    { id: "l4", title: "Signed Soccer Ball", description: "", emoji: "⚽", startPrice: 20, increment: 5, status: "unsold", highBid: 0, phase: "bidding", fmv: 45 },
  ];
  const ev = (id: string, min: number, type: State["events"][number]["type"], lotId: string, paddleId: string | undefined, text: string) => ({
    id, ts: m(min), type, lotId, paddleId, text,
  });
  const events: State["events"] = [
    ev("e1", 2, "system", "l1", undefined, "Lot 1 open"),
    ev("e2", 3, "bid", "l1", "p3", "Dev bids $40"),
    ev("e3", 3, "agent-bid", "l1", "p2", "Pick Agent bids $60"),
    ev("e4", 4, "bid", "l1", "p3", "Dev bids $120"),
    ev("e5", 4, "agent-bid", "l1", "p2", "Pick Agent bids $180"),
    ev("e6", 6, "sold", "l1", "p2", "Sold for $180"),
    ev("e7", 12, "system", "l2", undefined, "Lot 2 open"),
    ev("e8", 13, "bid", "l2", "p4", "Priya bids $100"),
    ev("e9", 13, "bid", "l2", "p1", "Maya bids $200"),
    ev("e10", 14, "agent-bid", "l2", "p5", "Bidder Bot bids $220"),
    ev("e11", 15, "bid", "l2", "p1", "Maya bids $310"),
    ev("e12", 18, "sold", "l2", "p1", "Sold for $310"),
    ev("e13", 26, "system", "l3", undefined, "Lot 3 open"),
    ev("e14", 27, "bid", "l3", "p3", "Dev bids $30"),
    ev("e15", 27, "bid", "l3", "p4", "Priya bids $80"),
    ev("e16", 28, "bid", "l3", "p3", "Dev bids $120"),
    ev("e17", 30, "sold", "l3", "p3", "Sold for $120"),
    ev("e18", 40, "system", "l4", undefined, "Lot 4 open, no bids"),
  ];
  const lr = (id: string, min: number, kind: State["ledger"][number]["kind"], paddleId: string | undefined, amount: number, status: string) => ({
    id, ts: m(min), kind, paddleId, amount, status, paypalId: `SAMPLE-${id.toUpperCase()}`,
  });
  const ledger: State["ledger"] = [
    lr("a1", 0, "authorized", "p1", 400, "CREATED"),
    lr("a2", 0, "authorized", "p2", 300, "CREATED"),
    lr("a3", 1, "authorized", "p3", 250, "CREATED"),
    lr("a4", 1, "authorized", "p4", 200, "CREATED"),
    lr("a5", 1, "authorized", "p5", 150, "CREATED"),
    lr("c1", 45, "captured", "p1", 310, "COMPLETED"),
    lr("c2", 45, "captured", "p2", 180, "COMPLETED"),
    lr("c3", 45, "captured", "p3", 120, "COMPLETED"),
    lr("v1", 46, "voided", "p1", 90, "VOIDED"),
    lr("v2", 46, "voided", "p2", 120, "VOIDED"),
    lr("v3", 46, "voided", "p3", 130, "VOIDED"),
    lr("v4", 46, "voided", "p4", 200, "VOIDED"),
    lr("v5", 46, "voided", "p5", 150, "VOIDED"),
    lr("o1", 47, "payout", undefined, 610, "SUCCESS"),
  ];
  return {
    status: "closed",
    demoMode: true,
    lots,
    paddles,
    events,
    caption: { text: "Sample gala data", ts: Date.now() },
    ledger,
    totals: { held: 1300, captured: 610, voided: 690, paidOut: 610 },
    receipts: [],
    auctionType: "charity",
    settings: defaultSettings("charity"),
  };
}
