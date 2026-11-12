// Mirrors docs/API.md (binding UI <-> server contract).
export type Paddle = {
  id: string;
  number: number;
  name: string;
  kind: "human" | "agent";
  holdAmount: number;
  committed: number;
  status: "pending" | "held" | "captured" | "voided";
  agent?: { instruction: string; maxBid: number; lastReasoning?: string };
  authorizationId?: string;
  orderId?: string;
};

export type AuctionType = "charity" | "estate" | "collectibles" | "farm";
export type EventInfo = { name: string; organizer: string; beneficiary: string; tagline?: string; currency: "USD" };
export type AuctionSettings = { premiumPct: number; commissionPct: number };

export type Lot = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  startPrice: number;
  increment: number;
  status: "pending" | "open" | "sold" | "unsold";
  highBid: number;
  highPaddleId?: string;
  winnerPaddleId?: string;
  finalPrice?: number;
  phase: "bidding" | "going-once" | "going-twice" | "sold";
  fmv?: number;
  consignor?: string;
  unit?: "head" | "lot";
  quantity?: number;
  image?: string;
  sources?: { retailer: string; price: number; url: string }[];
  /** extra: one sentence Gus says about the lot when it opens (written by the model, else the description). */
  pitch?: string;
};

export type AuctionEvent = {
  id: string;
  ts: number;
  type: "bid" | "agent-bid" | "stall" | "going-once" | "going-twice" | "sold" | "system";
  text: string;
  paddleId?: string;
  lotId?: string;
};

export type LedgerRow = {
  id: string;
  ts: number;
  kind: "authorized" | "captured" | "voided" | "payout" | "receipt";
  paddleId?: string;
  amount: number;
  paypalId?: string;
  status: string;
  note?: string;
};

export type Totals = { held: number; captured: number; voided: number; paidOut: number };

export type Receipt = { paddleId: string; text: string; invoiceId?: string };

export type State = {
  status: "lobby" | "live" | "closed";
  auctionType?: AuctionType;
  settings?: AuctionSettings;
  event?: EventInfo;
  demoMode: boolean;
  testCards?: boolean;
  currentLotId?: string;
  lots: Lot[];
  paddles: Paddle[];
  events: AuctionEvent[];
  caption: { text: string; ts: number; /** which moment the line is for (bid, sold, pitch…); the stage cuts Gus off for bids */ kind?: string };
  ledger: LedgerRow[];
  totals: Totals;
  receipts: Receipt[];
};
