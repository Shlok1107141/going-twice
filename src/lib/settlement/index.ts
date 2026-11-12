// Settlement entry point: `settle()` picks an executor for the auction close.
//   inProcess        the original engine logic (injected by engine.close(); unchanged behaviour, the default)
//   renderWorkflows  builds a SettlementPlan, runs it as a Render Workflow (workflows/tasks.ts), then applies
//                    the returned results to the ledger exactly like the in-process path would.
// Enabled only when RENDER_WORKFLOWS=1 and the Render env is complete; otherwise (local/demo) nothing changes.
import { createHash } from "node:crypto";
import { Render } from "@renderinc/sdk";
import { say, money } from "@/lib/ai/auctioneer";
import { writeReceipt, type ReceiptItem } from "@/lib/ai/receipt";
import { addLedger, getInternal, getState, isDemoMode, pushEvent, recomputeTotals, type Paddle, type State } from "@/lib/auction/store";
import type { SettlementPlan, SettlementResult } from "./types";

export type { SettlementPlan, SettlementResult } from "./types";

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;
const RUN_WAIT_MS = 105_000; // route maxDuration is 120 s; a longer run is picked up again by the next close

export type SettleOptions = {
  /** The original in-process settlement (engine.doClose). */
  inProcess: () => Promise<State>;
  /** Hammer any lot still open (engine-owned; needed before the plan is computed). */
  hammerOpenLots: () => void;
};

/** RENDER_WORKFLOWS=1 plus RENDER_WORKFLOW_SLUG and RENDER_API_KEY (or RENDER_USE_LOCAL_DEV for the local task server). */
export function workflowsConfigured(): boolean {
  const e = process.env;
  const on = e.RENDER_WORKFLOWS === "1" || e.RENDER_WORKFLOWS === "true";
  const ok = !!e.RENDER_WORKFLOW_SLUG && (!!e.RENDER_API_KEY || e.RENDER_USE_LOCAL_DEV === "true");
  if (on && !ok) console.warn("[settlement] RENDER_WORKFLOWS is set but RENDER_WORKFLOW_SLUG / RENDER_API_KEY are missing; settling in-process");
  return on && ok;
}

export async function settle(opts: SettleOptions): Promise<State> {
  // The workflow plan models charity settlement (single treasurer payout, no premium). Estate splits and
  // buyer's premium stay on the tested in-process path until the workflow plan carries them.
  const s = getState();
  if (s.status === "closed" || !workflowsConfigured() || (s.auctionType ?? "charity") !== "charity") return opts.inProcess();
  return renderWorkflowsExecutor(opts);
}

// ---------------------------------------------------------------- plan

function wonBy(p: Paddle) {
  return getState().lots.filter((l) => l.status === "sold" && l.winnerPaddleId === p.id);
}

async function buildPlan(): Promise<SettlementPlan> {
  const s = getState();
  const i = getInternal();
  const plan: SettlementPlan = { auctionId: i.auctionId, demo: isDemoMode(), captures: [], voids: [], receipts: [] };
  const organizer = (s as { event?: { beneficiary?: string; organizer?: string } }).event?.beneficiary || (s as { event?: { organizer?: string } }).event?.organizer;

  for (const p of s.paddles) {
    if (p.status !== "held" || !p.authorizationId) continue;
    const wonCents = wonBy(p).reduce((c, l) => c + cents(l.finalPrice ?? 0), 0);
    if (wonCents > 0) {
      plan.captures.push({ auctionId: i.auctionId, demo: plan.demo, paddleId: p.id, paddleNumber: p.number, authorizationId: p.authorizationId, amountCents: wonCents, holdCents: cents(p.holdAmount), organizer });
    } else {
      plan.voids.push({ auctionId: i.auctionId, demo: plan.demo, paddleId: p.id, authorizationId: p.authorizationId, holdCents: cents(p.holdAmount) });
    }
  }

  // The payout amount is final once the captures return, so only the receiver goes in the plan.
  if (!i.payoutDone) plan.payout = { receiver: process.env.TREASURER_PAYPAL_EMAIL || process.env.TREASURER_RECEIVER, organizer };

  // Receipts: this close's winners plus earlier winners whose receipt is still missing (retried close).
  const willCapture = new Set(plan.captures.map((c) => c.paddleId));
  const winners = s.paddles.filter((p) => (willCapture.has(p.id) || p.status === "captured") && !s.receipts.some((r) => r.paddleId === p.id));
  const texts = await Promise.all(
    winners.map((p) => {
      const items: ReceiptItem[] = wonBy(p).map((l) => ({ title: l.title, paid: l.finalPrice ?? 0, fmv: l.fmv ?? 0, listings: l.sources?.length }));
      return writeReceipt(p.name, items);
    }),
  );
  winners.forEach((p, k) => {
    const captured = p.status === "captured";
    const ledgerCapture = s.ledger.find((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED");
    plan.receipts.push({
      auctionId: i.auctionId,
      demo: plan.demo,
      paddleId: p.id,
      paddleNumber: p.number,
      payerEmail: p.payerEmail,
      text: texts[k],
      lines: wonBy(p).map((l) => ({ name: l.title, amountCents: cents(l.finalPrice ?? 0), fmvCents: cents(l.fmv ?? 0), listings: l.sources?.length ?? 0 })),
      organizer,
      ...(captured ? { alreadyCaptured: true, amountCents: cents(p.capturedAmount ?? 0), captureId: ledgerCapture?.paypalId } : {}),
    });
  });
  return plan;
}

// ---------------------------------------------------------------- run

function resultOf(details: { results?: unknown }): SettlementResult | null {
  const r = Array.isArray(details.results) ? details.results[0] : details.results;
  return r && typeof r === "object" && "captures" in r ? (r as SettlementResult) : null;
}

async function renderWorkflowsExecutor(opts: SettleOptions): Promise<State> {
  const s = getState();
  getInternal().closeStarted = true; // freeze the room, same as the in-process close
  opts.hammerOpenLots();
  pushEvent({ type: "system", text: "Closing the auction: settling every paddle on Render Workflows." });
  const plan = await buildPlan();

  // Same plan + same ledger => same key => a re-sent close re-attaches to the in-flight run instead of
  // starting a second one. Applying a run adds ledger rows, so a retry after failures gets a fresh run.
  const key = "settle-" + createHash("sha256").update(JSON.stringify(plan)).update(String(s.ledger.length)).digest("hex").slice(0, 40);
  const render = new Render();
  const started = await render.workflows.startTask(`${process.env.RENDER_WORKFLOW_SLUG}/settleAuction`, [plan], { idempotencyKey: key, signal: AbortSignal.timeout(RUN_WAIT_MS) });
  const runId = started.taskRunId;
  pushEvent({ type: "system", text: `Render Workflows run ${runId} started: captures and voids fan out in parallel.` });

  let details;
  try {
    details = await started.get(); // SDK polls the run until it finishes
  } catch (e) {
    pushEvent({ type: "system", text: `Render Workflows run ${runId} did not report back (${e instanceof Error ? e.message.slice(0, 120) : "error"}). Close again to re-attach.` });
    return s;
  }
  const result = details.status === "succeeded" || details.status === "completed" ? resultOf(details) : null;
  if (!result) {
    pushEvent({ type: "system", text: `Render Workflows run ${runId} ${details.status}${details.error ? `: ${details.error.slice(0, 160)}` : ""}. Close again to retry.` });
    return s;
  }
  return applyResult(plan, result, runId);
}

// ---------------------------------------------------------------- apply (mirrors engine.doClose)

function applyResult(plan: SettlementPlan, r: SettlementResult, runId: string): State {
  const s = getState();
  const i = getInternal();
  const via = `settled by Render Workflows run ${runId}`;
  let failed = false;

  for (const c of r.captures) {
    const p = s.paddles.find((x) => x.id === c.paddleId);
    if (!p) continue;
    const amount = dollars(c.amountCents);
    if (!c.ok) {
      addLedger({ kind: "captured", paddleId: p.id, amount, paypalId: c.paypalId, status: "FAILED", note: `${c.note ?? "capture failed"}; ${via}` });
      failed = true;
      continue;
    }
    p.status = "captured";
    p.capturedAmount = amount;
    p.committed = 0;
    const hold = plan.captures.find((x) => x.paddleId === p.id)?.holdCents ?? cents(p.holdAmount);
    addLedger({ kind: "captured", paddleId: p.id, amount, paypalId: c.paypalId, status: c.status, note: `final capture; ${money(dollars(hold - c.amountCents))} of hold released; ${via}` });
    pushEvent({ type: "system", text: `Captured ${money(amount)} from paddle #${p.number} (${p.name}).`, paddleId: p.id });
  }
  for (const v of r.voids) {
    const p = s.paddles.find((x) => x.id === v.paddleId);
    if (!p) continue;
    const amount = dollars(v.holdCents);
    if (!v.ok) {
      addLedger({ kind: "voided", paddleId: p.id, amount, paypalId: v.paypalId, status: "FAILED", note: `${v.note ?? "void failed"}; ${via}` });
      failed = true;
      continue;
    }
    p.status = "voided";
    p.committed = 0;
    addLedger({ kind: "voided", paddleId: p.id, amount, paypalId: v.paypalId, status: "VOIDED", note: `${v.note ? v.note + "; " : ""}${via}` });
    pushEvent({ type: "system", text: `Released paddle #${p.number}'s ${money(amount)} hold.`, paddleId: p.id });
  }
  recomputeTotals();
  if (failed) {
    pushEvent({ type: "system", text: "Some payments need attention. Close again to retry only what failed." });
    return s;
  }

  if (r.payout) {
    const amount = dollars(r.payout.amountCents);
    const attempts = (s.payoutStatus?.attempts ?? 0) + 1;
    if (!r.payout.ok) {
      // Same contract as the in-process close: captures/voids are final, so close anyway and leave a
      // "payout pending — retry" row; POST /api/payout/retry re-sends only the payout (in-process).
      const reason = r.payout.note ?? "payout failed";
      addLedger({ kind: "payout", amount, status: "PENDING_RETRY", note: `payout pending — retry (POST /api/payout/retry): ${reason}; ${via}` });
      s.payoutStatus = { state: "retry", amount, error: reason.slice(0, 200), attempts };
      pushEvent({ type: "system", text: `Payout of ${money(amount)} to the beneficiary is pending (${reason.slice(0, 80)}). Every capture and release is done; retry the payout from admin.` });
    } else {
      addLedger({ kind: "payout", amount, paypalId: r.payout.paypalId, status: r.payout.status, note: `to treasurer${r.payout.receiver ? ` ${r.payout.receiver}` : ""}; ${via}` });
      i.payoutDone = true;
      s.payoutStatus = { state: "sent", amount, attempts, batchId: r.payout.paypalId };
      pushEvent({ type: "system", text: `Sent ${money(amount)} to the beneficiary.` });
    }
  } else {
    i.payoutDone = true;
  }

  for (const rc of r.receipts) {
    const p = s.paddles.find((x) => x.id === rc.paddleId);
    const planned = plan.receipts.find((x) => x.paddleId === rc.paddleId);
    if (!p || !planned) continue;
    s.receipts.push({ paddleId: p.id, text: planned.text, ...(rc.invoiceId ? { invoiceId: rc.invoiceId } : {}) });
    addLedger({ kind: "receipt", paddleId: p.id, amount: dollars(rc.amountCents), paypalId: rc.invoiceId, status: rc.status, note: `${rc.note ? rc.note + "; " : ""}${via}` });
  }

  s.status = "closed";
  recomputeTotals();
  pushEvent({ type: "system", text: `Auction closed. Collected ${money(s.totals.captured)}, released ${money(s.totals.voided)} in holds, paid out ${money(s.totals.paidOut)}.` });
  say("close", {});
  return s;
}
