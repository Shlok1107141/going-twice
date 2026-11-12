// JSON-serialisable contracts shared by the web app and the Render Workflow tasks.
// Everything here crosses a process boundary (task args / results), so: plain data only, money in cents.

export type CaptureInput = {
  auctionId: string;
  demo: boolean;
  paddleId: string;
  paddleNumber: number;
  authorizationId: string;
  amountCents: number;
  holdCents: number;
  /** Event organizer/beneficiary name for payer-facing text. */
  organizer?: string;
};
export type CaptureResult = { paddleId: string; ok: boolean; paypalId?: string; status: string; amountCents: number; note?: string };

export type VoidInput = { auctionId: string; demo: boolean; paddleId: string; authorizationId: string; holdCents: number };
export type VoidResult = { paddleId: string; ok: boolean; paypalId: string; status: string; holdCents: number; note?: string };

export type PayoutInput = { auctionId: string; demo: boolean; amountCents: number; receiver?: string; organizer?: string };
export type PayoutResult = { ok: boolean; paypalId?: string; status: string; amountCents: number; receiver?: string; note?: string };

export type ReceiptInput = {
  auctionId: string;
  demo: boolean;
  paddleId: string;
  paddleNumber: number;
  payerEmail?: string;
  amountCents: number;
  captureId?: string;
  /** Receipt wording, written by the web app before the run (Claude phrases, code supplies numbers). */
  text: string;
  lines: { name: string; amountCents: number; fmvCents: number; listings: number }[];
  organizer?: string;
};
export type ReceiptResult = { paddleId: string; ok: boolean; invoiceId?: string; status: string; amountCents: number; note?: string };

export type SettlementPlan = {
  auctionId: string;
  demo: boolean;
  captures: CaptureInput[];
  voids: VoidInput[];
  /** Omitted when already paid out (a retried close) or nothing will be captured. */
  payout?: { receiver?: string; organizer?: string };
  /** `alreadyCaptured` (retried close): amountCents/captureId are preset and no capture result is needed. */
  receipts: (Omit<ReceiptInput, "amountCents" | "captureId"> & { alreadyCaptured?: boolean; amountCents?: number; captureId?: string })[];
};

export type SettlementResult = {
  captures: CaptureResult[];
  voids: VoidResult[];
  payout?: PayoutResult;
  receipts: ReceiptResult[];
};
