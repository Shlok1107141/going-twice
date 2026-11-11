// Shared types for the auction engine. Shape is the binding contract in docs/API.md;
// fields marked "extra" are additive (the UI may ignore them).

export type PaddleStatus = "pending" | "held" | "captured" | "voided";

export type Paddle = {
  id: string;
  number: number;
  name: string;
  kind: "human" | "agent";
  holdAmount: number;
  /** Sum of current winning bids (open-lot high bids + won lots) not yet captured. */
  committed: number;
  status: PaddleStatus;
  agent?: { instruction: string; maxBid: number; lastReasoning?: string; lotId?: string /* extra */ };
  authorizationId?: string;
  orderId?: string;
  /** extra: payer email from PayPal (live mode), used for the receipt invoice. */
  payerEmail?: string;
  /** extra: amount captured at close. */
  capturedAmount?: number;
};

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
  /** extra: estimated fair market value used for receipts (an estimate, not tax advice). */
  fmv?: number;
};

export type AuctionEventType =
  | "bid"
  | "agent-bid"
  | "stall"
  | "going-once"
  | "going-twice"
  | "sold"
  | "system";

export type AuctionEvent = {
  id: string;
  ts: number;
  type: AuctionEventType;
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

export type Receipt = { paddleId: string; text: string; invoiceId?: string };

export type State = {
  status: "lobby" | "live" | "closed";
  demoMode: boolean;
  /** extra: live PayPal against the sandbox, so `testCard:true` paddles are allowed. */
  testCards?: boolean;
  currentLotId?: string;
  lots: Lot[];
  paddles: Paddle[];
  events: AuctionEvent[];
  caption: { text: string; ts: number };
  ledger: LedgerRow[];
  totals: { held: number; captured: number; voided: number; paidOut: number };
  receipts: Receipt[];
};

/** Server-only bookkeeping that is not part of the public State. */
export type Internal = {
  auctionId: string;
  seq: number;
  /** ms timestamp of the last bid (or lot open) on the current lot; drives /tick pacing. */
  lastActivityAt: number;
  /** stall line already said during the current quiet period. */
  stalled: boolean;
  payoutDone: boolean;
  webhookIds: string[];
};
