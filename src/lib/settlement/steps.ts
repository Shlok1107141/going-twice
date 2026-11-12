// The four money steps, as plain async functions with no auction-state access. The Render Workflow
// tasks (workflows/tasks.ts) wrap these. Idempotency comes from the existing PayPal-Request-Id keys
// in src/lib/paypal/* (capture:<auth>:<amount>, void:<auth>, payout:<batchId>, invoice:<number>), so a
// Render retry (or a re-triggered run) can never move money twice.
//
// Error contract: a transient failure (network, 429, 5xx) THROWS so Render's task retry policy re-runs
// the task. A permanent PayPal refusal (declined, invalid) RETURNS ok:false so we don't burn retries.
import * as pp from "@/lib/paypal";
import type { CaptureInput, CaptureResult, PayoutInput, PayoutResult, ReceiptInput, ReceiptResult, VoidInput, VoidResult } from "./types";

const ORG = (o?: string) => (o && o.trim()) || "the organizer";
const demoId = (kind: string) => `DEMO-${kind}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
const msg = (e: unknown) => (e instanceof Error ? e.message.slice(0, 300) : "unknown error");

/** Rethrow when Render should retry; otherwise hand back a message for an ok:false result. */
function permanent(e: unknown): string {
  if (!(e instanceof pp.PayPalError) || e.retryable) throw e;
  return msg(e);
}

export async function doCapture(c: CaptureInput): Promise<CaptureResult> {
  const base = { paddleId: c.paddleId, amountCents: c.amountCents };
  if (c.amountCents > c.holdCents) return { ...base, ok: false, status: "FAILED", note: "won total exceeds hold; not captured" };
  if (c.demo) return { ...base, ok: true, paypalId: demoId("CAPTURE"), status: "COMPLETED" };
  try {
    const cap = await pp.captureAuthorization(c.authorizationId, {
      amount: pp.centsToAmount(c.amountCents),
      finalCapture: true,
      invoiceId: `GT-${c.auctionId}-${c.paddleNumber}`,
      noteToPayer: `Thank you for supporting ${ORG(c.organizer)}!`,
      softDescriptor: "GOINGTWICE AUCTION",
    });
    if (cap.status === "DECLINED" || cap.status === "FAILED") {
      return { ...base, ok: false, paypalId: cap.id, status: "FAILED", note: `capture ${cap.status.toLowerCase()}` };
    }
    return { ...base, ok: true, paypalId: cap.id, status: cap.status };
  } catch (e) {
    return { ...base, ok: false, status: "FAILED", note: permanent(e) };
  }
}

export async function doVoid(v: VoidInput): Promise<VoidResult> {
  const base = { paddleId: v.paddleId, paypalId: v.authorizationId, holdCents: v.holdCents };
  if (v.demo) return { ...base, ok: true, status: "VOIDED", note: "simulated void" };
  try {
    await pp.voidAuthorization(v.authorizationId);
    return { ...base, ok: true, status: "VOIDED" };
  } catch (e) {
    return { ...base, ok: false, status: "FAILED", note: permanent(e) };
  }
}

export async function doPayout(p: PayoutInput): Promise<PayoutResult> {
  const base = { amountCents: p.amountCents, receiver: p.receiver };
  if (p.demo) return { ...base, ok: true, paypalId: demoId("PAYOUT"), status: "SUCCESS" };
  if (!p.receiver) return { ...base, ok: false, status: "FAILED", note: "TREASURER_PAYPAL_EMAIL is not set on the workflow service" };
  try {
    const batch = await pp.createPayoutBatch({
      senderBatchId: `close-${p.auctionId}`,
      emailSubject: "Going Twice auction proceeds",
      items: [{ recipientType: "EMAIL", receiver: p.receiver, amount: pp.centsToAmount(p.amountCents), note: `Auction proceeds for ${ORG(p.organizer)}` }],
    });
    return { ...base, ok: true, paypalId: batch.batch_header.payout_batch_id, status: batch.batch_header.batch_status };
  } catch (e) {
    return { ...base, ok: false, status: "FAILED", note: permanent(e) };
  }
}

export async function doReceipt(r: ReceiptInput): Promise<ReceiptResult> {
  const base = { paddleId: r.paddleId, amountCents: r.amountCents };
  if (r.demo) return { ...base, ok: true, invoiceId: demoId("INV"), status: "PAID", note: "simulated invoice" };
  if (!r.payerEmail) return { ...base, ok: true, status: "SKIPPED", note: "no payer email; receipt shown in app only" };
  try {
    const inv = await pp.createAndSendReceiptInvoice({
      invoiceNumber: `GTR-${r.auctionId}-${r.paddleNumber}`,
      recipientEmail: r.payerEmail,
      lines: r.lines.map((l) => ({
        name: l.name,
        amount: l.amountCents / 100,
        description: `Estimated fair market value $${(l.fmvCents / 100).toFixed(2)}${l.listings ? ` from ${l.listings} retail listings via Channel3` : ""} (estimate only).`,
      })),
      note: r.text,
      memo: r.captureId,
      invoicerBusinessName: ORG(r.organizer),
    });
    try {
      await pp.recordPayment(inv.invoiceId, { amount: pp.centsToAmount(r.amountCents), note: "Paid via Going Twice paddle capture" });
    } catch (e) {
      return { ...base, ok: false, invoiceId: inv.invoiceId, status: "SENT", note: permanent(e) };
    }
    return { ...base, ok: true, invoiceId: inv.invoiceId, status: "PAID" };
  } catch (e) {
    return { ...base, ok: false, status: "FAILED", note: permanent(e) };
  }
}
