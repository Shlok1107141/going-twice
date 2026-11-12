// Going Twice settlement as a Render Workflow.
//
//   settleAuction (root)
//     1. fan out: captureWinner x N  +  voidHold x M       (parallel, one instance each)
//     2. wait for all of them
//     3. sendPayout (one Payouts batch for what was actually captured)
//     4. fan out: issueReceipt x K (only winners whose capture succeeded)
//
// Money safety: each leaf task calls PayPal with a deterministic PayPal-Request-Id (see
// src/lib/settlement/steps.ts), so Render's automatic retries are idempotent. Transient errors throw
// (Render retries with backoff); permanent refusals return ok:false.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { doCapture, doPayout, doReceipt, doVoid } from "../src/lib/settlement/steps";
import type {
  CaptureInput, CaptureResult, PayoutInput, PayoutResult, ReceiptInput, ReceiptResult,
  SettlementPlan, SettlementResult, VoidInput, VoidResult,
} from "../src/lib/settlement/types";

const retry = { maxRetries: 3, waitDurationMs: 1000, backoffScaling: 2 };

export const captureWinner = task(
  { name: "captureWinner", retry, timeoutSeconds: 120 },
  async function captureWinner(_ctx: TaskContext, c: CaptureInput): Promise<CaptureResult> {
    return doCapture(c);
  },
);

export const voidHold = task(
  { name: "voidHold", retry, timeoutSeconds: 120 },
  async function voidHold(_ctx: TaskContext, v: VoidInput): Promise<VoidResult> {
    return doVoid(v);
  },
);

export const sendPayout = task(
  { name: "sendPayout", retry, timeoutSeconds: 120 },
  async function sendPayout(_ctx: TaskContext, p: PayoutInput): Promise<PayoutResult> {
    return doPayout(p);
  },
);

export const issueReceipt = task(
  { name: "issueReceipt", retry, timeoutSeconds: 120 },
  async function issueReceipt(_ctx: TaskContext, r: ReceiptInput): Promise<ReceiptResult> {
    return doReceipt(r);
  },
);

const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 300) : "task failed");

export const settleAuction = task(
  { name: "settleAuction", timeoutSeconds: 900 },
  async function settleAuction(ctx: TaskContext, plan: SettlementPlan): Promise<SettlementResult> {
    // A child task that exhausts its retries throws; record it as a failed row instead of losing the run.
    const [captures, voids] = await Promise.all([
      Promise.all(
        plan.captures.map((c) =>
          ctx.run(captureWinner, c).catch((e): CaptureResult => ({ paddleId: c.paddleId, ok: false, status: "FAILED", amountCents: c.amountCents, note: why(e) })),
        ),
      ),
      Promise.all(
        plan.voids.map((v) =>
          ctx.run(voidHold, v).catch((e): VoidResult => ({ paddleId: v.paddleId, ok: false, paypalId: v.authorizationId, status: "FAILED", holdCents: v.holdCents, note: why(e) })),
        ),
      ),
    ]);

    // The payout and receipts only make sense once every capture/void succeeded (same rule as in-process:
    // a partial failure stops here and the next close retries just what failed).
    const clean = captures.every((c) => c.ok) && voids.every((v) => v.ok);
    const result: SettlementResult = { captures, voids, receipts: [] };
    if (!clean) return result;

    const capturedCents = captures.reduce((s, c) => s + c.amountCents, 0);
    if (plan.payout && capturedCents > 0) {
      const input: PayoutInput = { auctionId: plan.auctionId, demo: plan.demo, amountCents: capturedCents, receiver: plan.payout.receiver, organizer: plan.payout.organizer };
      result.payout = await ctx.run(sendPayout, input).catch((e): PayoutResult => ({ ok: false, status: "FAILED", amountCents: capturedCents, note: why(e) }));
      // A failed payout no longer stops the close: receipts still go out and the app records
      // "payout pending — retry" (POST /api/payout/retry re-sends only the payout).
    }

    const byPaddle = new Map(captures.map((c) => [c.paddleId, c]));
    result.receipts = await Promise.all(
      plan.receipts.flatMap((r) => {
        const cap = byPaddle.get(r.paddleId);
        const amountCents = r.alreadyCaptured ? r.amountCents : cap?.ok ? cap.amountCents : undefined;
        if (amountCents === undefined) return [];
        const input: ReceiptInput = { ...r, amountCents, captureId: r.alreadyCaptured ? r.captureId : cap?.paypalId };
        return [ctx.run(issueReceipt, input).catch((e): ReceiptResult => ({ paddleId: r.paddleId, ok: false, status: "FAILED", amountCents, note: why(e) }))];
      }),
    );
    return result;
  },
);
