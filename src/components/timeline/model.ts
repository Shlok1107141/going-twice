import type { State } from "@/lib/client/types";

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
export const HONOR_MS = 3 * DAY;
export const EXPIRY_MS = 29 * DAY;
export const NIGHT_ID = "night";
export const CLOCK_ID = "clock";

export type Kind = "honor" | "validity" | "bid" | "capture" | "void" | "lot" | "lot-open" | "marker";

export type TLResource = {
  id: string;
  name: string;
  paddleNo?: number;
  who: "human" | "agent" | "night" | "clock";
  amount?: number;
};

export type TLEvent = {
  id: string;
  resourceId: string;
  startDate: Date;
  endDate: Date;
  name: string;
  kind: Kind;
  tip: string;
  /** Bryntum: zero-duration events render as milestones. */
  duration?: number;
};

export type Rec = {
  id: string;
  level: "urgent" | "soon" | "amber";
  title: string;
  detail: string;
  action: "close" | "none";
  paddleId?: string;
};

export type Model = {
  resources: TLResource[];
  events: TLEvent[];
  authAt: number | null; // earliest authorization (anchor for honor/expiry markers)
  recs: Rec[];
  healthy: number;
  closeReady: boolean;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function span(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 6) / 10} h`;
  return `${Math.round((ms / DAY) * 10) / 10} d`;
}

export function buildModel(state: State, now: number): Model {
  const resources: TLResource[] = [];
  const events: TLEvent[] = [];
  const recs: Rec[] = [];
  let authAt: number | null = null;
  let healthy = 0;

  // Run of show: one bar per lot on the "Auction night" row.
  const opened = (lotId: string) => state.events.filter((e) => e.lotId === lotId).sort((a, b) => a.ts - b.ts)[0]?.ts;
  const lotRows = state.lots.filter((l) => l.status !== "pending");
  if (lotRows.length) resources.push({ id: NIGHT_ID, name: "Auction night", who: "night" });
  for (const lot of lotRows) {
    const soldEv = state.events.find((e) => e.lotId === lot.id && e.type === "sold");
    const end = lot.status === "open" ? now : (soldEv?.ts ?? now);
    const start = Math.min(opened(lot.id) ?? end - 60_000, end - 1000);
    const price = lot.finalPrice ?? lot.highBid;
    events.push({
      id: `lot-${lot.id}`,
      resourceId: NIGHT_ID,
      startDate: new Date(start),
      endDate: new Date(end),
      name: `${lot.emoji} ${lot.title}${lot.status === "sold" ? ` · ${money(price)}` : lot.status === "unsold" ? " · passed" : ""}`,
      kind: lot.status === "open" ? "lot-open" : "lot",
      tip: `${lot.title}: ${lot.status}${price ? `, ${money(price)}` : ""}`,
    });
  }

  for (const p of state.paddles) {
    resources.push({ id: p.id, name: p.name, paddleNo: p.number, who: p.kind, amount: p.holdAmount });
    const rows = state.ledger.filter((r) => r.paddleId === p.id);
    const auth = rows.find((r) => r.kind === "authorized");
    const cap = rows.find((r) => r.kind === "captured");
    const voided = rows.find((r) => r.kind === "voided");
    if (auth) {
      const a = auth.ts;
      authAt = authAt === null ? a : Math.min(authAt, a);
      const closedAt = cap?.ts ?? voided?.ts;
      events.push({
        id: `h-${p.id}`, resourceId: p.id, startDate: new Date(a), endDate: new Date(a + HONOR_MS),
        name: `Honor period · ${money(p.holdAmount)} hold`, kind: "honor",
        tip: "Honor period (3 days): capture success is highest.",
      });
      events.push({
        id: `v-${p.id}`, resourceId: p.id, startDate: new Date(a + HONOR_MS), endDate: new Date(a + EXPIRY_MS),
        name: "Valid until expiry (capture depends on risk checks)", kind: "validity",
        tip: "Authorization still valid to day 29; reauthorize to restart the honor period.",
      });
      if (closedAt === undefined && p.status === "held") {
        const age = now - a;
        const left = a + EXPIRY_MS - now;
        const honorLeft = a + HONOR_MS - now;
        const label = `#${p.number} ${p.name}`;
        const amt = p.committed > 0 ? money(p.committed) : "nothing yet (no winning bids)";
        if (left <= 0) {
          recs.push({ id: `r-${p.id}`, level: "urgent", paddleId: p.id, action: "none", title: `${label}: hold expired`, detail: `Funds were released ${span(-left)} ago. A new authorization is needed to collect ${amt}.` });
        } else if (left < 2 * DAY) {
          recs.push({ id: `r-${p.id}`, level: "urgent", paddleId: p.id, action: "close", title: `${label}: expires in ${span(left)}`, detail: `Capture ${amt} now. Reauthorizing is a last resort and would give only ${span(left)} of honor.` });
        } else if (honorLeft <= 0) {
          recs.push({ id: `r-${p.id}`, level: "soon", paddleId: p.id, action: "close", title: `${label}: past honor period`, detail: `Held ${span(age)}. Capture ${amt} soon, or reauthorize to restart the 3-day honor clock.` });
        } else if (honorLeft < 12 * HOUR) {
          recs.push({ id: `r-${p.id}`, level: "soon", paddleId: p.id, action: "close", title: `${label}: honor ends in ${span(honorLeft)}`, detail: `Capture ${amt} before the honor period ends for the best success rate.` });
        } else healthy++;
      }
    }
    if (cap) {
      events.push({
        id: `c-${p.id}`, resourceId: p.id, startDate: new Date(cap.ts), endDate: new Date(cap.ts), duration: 0,
        name: `Captured ${money(cap.amount)}`, kind: "capture", tip: `Captured ${money(cap.amount)}${cap.status ? ` (${cap.status})` : ""}`,
      });
    }
    if (voided) {
      events.push({
        id: `x-${p.id}`, resourceId: p.id, startDate: new Date(voided.ts), endDate: new Date(voided.ts), duration: 0,
        name: "Hold voided", kind: "void", tip: "Authorization voided; funds released to the bidder.",
      });
    }
    for (const e of state.events.filter((x) => x.paddleId === p.id && (x.type === "bid" || x.type === "agent-bid"))) {
      events.push({
        id: `b-${e.id}`, resourceId: p.id, startDate: new Date(e.ts), endDate: new Date(e.ts), duration: 0,
        name: "", kind: "bid", tip: e.text,
      });
    }
  }

  // Clock row: now, and the earliest hold's honor-end / expiry (PayPal's two deadlines).
  if (authAt !== null) {
    resources.unshift({ id: CLOCK_ID, name: "Clock", who: "clock" });
    const mk = (id: string, at: number, name: string, tip: string): TLEvent => ({ id, resourceId: CLOCK_ID, startDate: new Date(at), endDate: new Date(at), duration: 0, name, kind: "marker", tip });
    events.push(mk("m-now", now, "Now", "Current time"));
    events.push(mk("m-honor", authAt + HONOR_MS, "Honor period ends (first hold)", "3 days after the earliest authorization"));
    events.push(mk("m-exp", authAt + EXPIRY_MS, "Expiry (first hold)", "29 days after the earliest authorization: funds are released"));
  }

  if (state.status !== "closed") {
    for (const l of state.lots.filter((x) => x.status === "sold")) {
      recs.push({ id: `l-${l.id}`, level: "amber", action: "none", title: `${l.emoji} ${l.title}: hammered, not yet closed`, detail: `Sold for ${money(l.finalPrice ?? l.highBid)}; no money moves until the auction is closed and captured.` });
    }
  }
  const hammered = state.lots.some((l) => l.status === "sold");
  const closeReady = state.status === "live" && hammered && state.lots.every((l) => l.status === "sold" || l.status === "unsold");
  const order = { urgent: 0, soon: 1, amber: 2 };
  recs.sort((a, b) => order[a.level] - order[b.level]);
  return { resources, events, authAt, recs, healthy, closeReady };
}

/** Clearly-labelled sample: a gala whose holds are of mixed age so every risk state shows. */
export function sampleState(now: number): State {
  const t = (ms: number) => now - ms;
  const mk = (n: number, name: string, kind: "human" | "agent", hold: number, status: "held" | "captured" | "voided", committed = 0) =>
    ({ id: `s${n}`, number: n, name, kind, holdAmount: hold, committed, status }) as State["paddles"][number];
  const paddles = [
    mk(12, "Maya", "human", 400, "held", 250),
    mk(7, "Gus the Agent", "agent", 600, "held", 320),
    mk(31, "Dr. Ortiz", "human", 500, "held", 180),
    mk(44, "Bake Sale Bot", "agent", 300, "held", 90),
    mk(52, "Pat", "human", 800, "held", 420),
    mk(3, "Lena", "human", 250, "captured"),
    mk(9, "Noor", "human", 200, "voided"),
  ];
  const ages: Record<string, number> = { s12: 40 * 60_000, s7: 45 * 60_000, s31: 2.8 * DAY, s44: 9 * DAY, s52: 27.5 * DAY, s3: 3 * HOUR, s9: 3 * HOUR };
  const ledger: State["ledger"] = paddles.map((p, i) => ({ id: `lg${i}`, ts: t(ages[p.id]), kind: "authorized", paddleId: p.id, amount: p.holdAmount, status: "ok" }));
  ledger.push({ id: "lgc", ts: t(2 * HOUR), kind: "captured", paddleId: "s3", amount: 140, status: "COMPLETED" });
  ledger.push({ id: "lgv", ts: t(2 * HOUR), kind: "voided", paddleId: "s9", amount: 200, status: "VOIDED" });
  const lots: State["lots"] = [
    { id: "L1", title: "Signed Hockey Puck", description: "", emoji: "🏒", startPrice: 20, increment: 5, status: "sold", highBid: 140, finalPrice: 140, winnerPaddleId: "s3", phase: "sold" },
    { id: "L2", title: "Chef's Table for 4", description: "", emoji: "🍽️", startPrice: 50, increment: 10, status: "sold", highBid: 320, finalPrice: 320, winnerPaddleId: "s7", phase: "sold" },
    { id: "L3", title: "Weekend Cabin", description: "", emoji: "🏡", startPrice: 100, increment: 25, status: "open", highBid: 250, highPaddleId: "s12", phase: "going-once" },
  ];
  const m = 60_000;
  const events: State["events"] = [
    { id: "e1", ts: t(32 * m), type: "system", text: "open", lotId: "L1" },
    { id: "e2", ts: t(30 * m), type: "bid", text: "Paddle #3 bid $90", paddleId: "s3", lotId: "L1" },
    { id: "e3", ts: t(27 * m), type: "bid", text: "Paddle #3 bid $140", paddleId: "s3", lotId: "L1" },
    { id: "e4", ts: t(26 * m), type: "sold", text: "Sold", lotId: "L1" },
    { id: "e5", ts: t(25 * m), type: "system", text: "open", lotId: "L2" },
    { id: "e6", ts: t(22 * m), type: "agent-bid", text: "Gus the Agent bid $200", paddleId: "s7", lotId: "L2" },
    { id: "e7", ts: t(19 * m), type: "agent-bid", text: "Gus the Agent bid $320", paddleId: "s7", lotId: "L2" },
    { id: "e8", ts: t(17 * m), type: "sold", text: "Sold", lotId: "L2" },
    { id: "e9", ts: t(15 * m), type: "system", text: "open", lotId: "L3" },
    { id: "e10", ts: t(8 * m), type: "bid", text: "Paddle #12 bid $250", paddleId: "s12", lotId: "L3" },
  ];
  return {
    status: "live", demoMode: true, currentLotId: "L3", lots, paddles, events, caption: { text: "", ts: now }, ledger,
    totals: { held: 0, captured: 140, voided: 200, paidOut: 0 }, receipts: [],
  };
}
