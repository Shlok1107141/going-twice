// Shared types for the auction engine. Shape is the binding contract in docs/API.md;
// fields marked "extra" are additive (the UI may ignore them).

export type AuctionType = "charity" | "estate" | "collectibles" | "farm";

/** Public, editable per-room numbers (emails live in Internal.payout, never in State). */
export type AuctionSettings = {
  /** Buyer's premium % added on top of hammer (always 0 for charity). */
  premiumPct: number;
  /** House commission % kept from the hammer price on consigned lots (estate only). */
  commissionPct: number;
};

/** Editable event details (who is running this auction and who receives the proceeds). */
export type EventInfo = {
  name: string;
  organizer: string;
  /** Who receives the proceeds. */
  beneficiary: string;
  tagline?: string;
  currency: "USD";
};

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
  /** extra: small photo (data URL or https URL) of the donated item, shown on the stage. */
  image?: string;
  /** extra: consignor / seller label shown to the room, e.g. "the Hendricks estate" (estate). */
  consignor?: string;
  /** extra: farm lots: sold as one lot, with a head count so Gus can quote a per-head price. */
  unit?: "head" | "lot";
  quantity?: number;
  /** extra: retail listings (via Channel3) the FMV was estimated from. */
  sources?: { retailer: string; price: number; url: string }[];
  /** extra: one sentence Gus says about the lot when it opens (written by the model, else the description). */
  pitch?: string;
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
  /** extra: kind of auction (default "charity"). */
  auctionType: AuctionType;
  settings: AuctionSettings;
  /** extra: editable event details (defaults per auction type). */
  event: EventInfo;
  demoMode: boolean;
  /** extra: live PayPal against the sandbox, so `testCard:true` paddles are allowed. */
  testCards?: boolean;
  currentLotId?: string;
  lots: Lot[];
  paddles: Paddle[];
  events: AuctionEvent[];
  caption: { text: string; ts: number; /** which moment the line is for (bid, sold, pitch…); the stage cuts Gus off for bids */ kind?: string };
  ledger: LedgerRow[];
  totals: { held: number; captured: number; voided: number; paidOut: number };
  receipts: Receipt[];
  /**
   * extra: settlement payout state once close has run. "retry" = captures and voids are done but the
   * Payouts batch failed (e.g. INSUFFICIENT_FUNDS); POST /api/payout/retry sends only the payout.
   */
  payoutStatus?: PayoutStatus;
};

export type PayoutStatus = {
  state: "sent" | "retry" | "none";
  /** Amount the payout is for (the captured total). */
  amount: number;
  /** Last failure (PayPal issue / message) while state is "retry". */
  error?: string;
  attempts: number;
  /** PayPal payout_batch_id once sent. */
  batchId?: string;
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
  /** Set when a close starts: from then on no new paddles, lots or bids (money is moving). */
  closeStarted?: boolean;
  /** Last paddle number handed out (minus 100); reserved synchronously so parallel registrations never collide. */
  paddleNo?: number;
  /** Payout addresses (kept out of public State): organizer/house, and per-lot consignors. */
  payout?: { organizer?: string; consignors?: Record<string, string> };
  webhookIds: string[];
};
