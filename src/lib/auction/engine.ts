// Auction engine: bid validation, lot pacing, hammer, and settlement. Every money decision is
// plain code here; AI modules only produce words and yes/no bid proposals that we re-validate.
import * as pp from "@/lib/paypal";
import { say, money } from "@/lib/ai/auctioneer";
import { decideAgentBid } from "@/lib/ai/agent";
import { writeReceipt, SCHOOL_NAME, type ReceiptItem } from "@/lib/ai/receipt";
import {
  addLedger,
  getInternal,
  getState,
  isDemoMode,
  nextId,
  pushEvent,
  recomputeTotals,
  resetStore,
  save,
  setCaption,
  testCardsAllowed,
  type Lot,
  type Paddle,
  type State,
} from "./store";
import { currentRoom } from "./room";

export class EngineError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function tickSpeed(): number {
  const v = Number(process.env.TICK_SPEED);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Valid USD amount: finite, > 0, at most 2 decimals. Returns the normalised number or null. */
export function parseMoney(v: unknown, max = 100_000): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > max) return null;
  const c = Math.round(v * 100);
  if (Math.abs(c - v * 100) > 1e-6) return null;
  return dollars(c);
}

function demoId(kind: string): string {
  return `DEMO-${kind}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function findLot(lotId: string): Lot {
  const lot = getState().lots.find((l) => l.id === lotId);
  if (!lot) throw new EngineError(404, "Unknown lot");
  return lot;
}

function findPaddle(paddleId: string): Paddle {
  const p = getState().paddles.find((x) => x.id === paddleId);
  if (!p) throw new EngineError(404, "Unknown paddle");
  return p;
}

// ---------------------------------------------------------------- setup

export function reset(): State {
  return resetStore();
}

// Sandbox receipts: test-card paddles have no PayPal payer, so default to the next sandbox buyer
// email (env SANDBOX_BUYER_1..3 = "email:password"; only the email part is ever used).
const sb = globalThis as unknown as { __gtBuyerRR?: number };
function nextSandboxBuyerEmail(): string | undefined {
  const emails = [1, 2, 3]
    .map((n) => process.env[`SANDBOX_BUYER_${n}`]?.split(":")[0]?.trim())
    .filter((e): e is string => !!e && e.includes("@"));
  if (!emails.length) return undefined;
  sb.__gtBuyerRR = (sb.__gtBuyerRR ?? -1) + 1;
  return emails[sb.__gtBuyerRR % emails.length];
}

type NewPaddle = { name: string; holdAmount: number; agent?: Paddle["agent"]; testCard?: boolean; email?: string };

// PayPal's published sandbox test Visa (not a real card). Sandbox only.
function sandboxTestCard() {
  return { number: "4111111111111111", expiry: `${new Date().getFullYear() + 3}-12`, name: "Demo Bidder" };
}

/**
 * Demo: hold is simulated and immediately `held`. Live: creates an AUTHORIZE order (`pending`).
 * Live + sandbox + testCard: the order is funded with PayPal's sandbox test Visa and authorized
 * immediately, so the paddle gets a real sandbox authorization with no buyer login.
 */
export async function createPaddle(input: NewPaddle): Promise<{ paddle: Paddle; orderId?: string }> {
  const s = getState();
  if (s.status === "closed") throw new EngineError(409, "Auction is closed");
  if (input.testCard && !isDemoMode() && !testCardsAllowed()) {
    throw new EngineError(400, "testCard is only allowed when PAYPAL_ENV=sandbox");
  }
  if (!input.email && input.testCard && !isDemoMode() && testCardsAllowed()) input.email = nextSandboxBuyerEmail();
  const p: Paddle = {
    id: nextId("p"),
    number: 100 + s.paddles.length + 1,
    name: input.name,
    kind: input.agent ? "agent" : "human",
    holdAmount: input.holdAmount,
    committed: 0,
    status: "pending",
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.email ? { payerEmail: input.email } : {}),
  };

  if (isDemoMode()) {
    p.authorizationId = demoId("AUTH");
    p.orderId = demoId("ORDER");
    p.status = "held";
    s.paddles.push(p);
    addLedger({ kind: "authorized", paddleId: p.id, amount: p.holdAmount, paypalId: p.authorizationId, status: "CREATED", note: "simulated hold" });
  } else if (input.testCard) {
    const order = await pp.createAuthorizeOrder({
      amount: p.holdAmount,
      paddleId: p.id,
      description: `Going Twice paddle #${p.number} (hold, not a charge)`,
      testCard: sandboxTestCard(),
      requestId: `order:${getInternal().auctionId}:${p.id}`,
    });
    p.orderId = order.id;
    const auth = order.authorization ?? (await pp.authorizeOrder(order.id)).authorization;
    if (!["CREATED", "PENDING"].includes(auth.status)) {
      throw new EngineError(402, `Test-card authorization ${auth.status.toLowerCase()}`);
    }
    p.authorizationId = auth.id;
    p.holdAmount = Math.min(p.holdAmount, dollars(pp.toCents(auth.amount.value)));
    p.status = "held";
    s.paddles.push(p);
    addLedger({ kind: "authorized", paddleId: p.id, amount: p.holdAmount, paypalId: auth.id, status: auth.status, note: "sandbox test card" });
  } else {
    const order = await pp.createAuthorizeOrder({
      amount: p.holdAmount,
      paddleId: p.id,
      description: `Going Twice paddle #${p.number} (hold, not a charge)`,
      requestId: `order:${getInternal().auctionId}:${p.id}`,
    });
    p.orderId = order.id;
    s.paddles.push(p);
    save();
  }
  pushEvent({ type: "system", text: `Paddle #${p.number} (${p.name}${p.kind === "agent" ? ", absentee agent" : ""}) joined${p.status === "held" ? ` with a ${money(p.holdAmount)} hold` : ""}.`, paddleId: p.id });
  if (p.status === "held" && p.kind === "agent" && s.currentLotId) triggerAgents(s.currentLotId);
  return { paddle: p, orderId: p.status === "pending" ? p.orderId : undefined };
}

/** Live: after buyer approval, place the hold. Demo: no-op (already held). Idempotent. */
export async function authorizePaddle(paddleId: string, orderId: string): Promise<Paddle> {
  const p = findPaddle(paddleId);
  if (p.status !== "pending") return p;
  if (isDemoMode()) return p;
  if (!p.orderId || p.orderId !== orderId) throw new EngineError(400, "orderId does not match this paddle");

  const { order, authorization } = await pp.authorizeOrder(orderId);
  if (!["CREATED", "PENDING"].includes(authorization.status)) {
    throw new EngineError(402, `Authorization ${authorization.status.toLowerCase()}`);
  }
  p.authorizationId = authorization.id;
  // The hold is whatever PayPal actually authorized (never more than requested).
  p.holdAmount = Math.min(p.holdAmount, dollars(pp.toCents(authorization.amount.value)));
  p.payerEmail = order.payer?.email_address ?? p.payerEmail;
  p.status = "held";
  addLedger({ kind: "authorized", paddleId: p.id, amount: p.holdAmount, paypalId: authorization.id, status: authorization.status });
  pushEvent({ type: "system", text: `Paddle #${p.number} (${p.name}) is live with a ${money(p.holdAmount)} hold.`, paddleId: p.id });
  return p;
}

// ---------------------------------------------------------------- lots & bids

export function startLot(lotId: string): State {
  const s = getState();
  if (s.status === "closed") throw new EngineError(409, "Auction is closed");
  const lot = findLot(lotId);
  if (lot.status === "open") return s;
  if (lot.status !== "pending") throw new EngineError(409, "That lot has already been sold");

  for (const other of s.lots) if (other.status === "open") hammerLot(other);

  lot.status = "open";
  lot.phase = "bidding";
  lot.highBid = 0;
  s.status = "live";
  s.currentLotId = lot.id;
  const i = getInternal();
  i.lastActivityAt = Date.now();
  i.stalled = false;
  pushEvent({ type: "system", text: `${lot.emoji} ${lot.title} is open at ${money(lot.startPrice)}.`, lotId: lot.id });
  say("open", { lot: lot.title, amount: lot.startPrice });
  triggerAgents(lot.id);
  return s;
}

export type LotDraft = {
  title: string;
  description: string;
  startPrice: number;
  increment: number;
  fmv: number;
  image?: string;
  sources?: { retailer: string; price: number; url: string }[];
};

/** Snap-a-lot: append a pending lot (numbers already computed by fmv.ts) and have Gus announce it. */
export function addLot(draft: LotDraft): Lot {
  const s = getState();
  if (s.status === "closed") throw new EngineError(409, "Auction is closed");
  const lot: Lot = {
    id: nextId("lot"),
    title: draft.title,
    description: draft.description,
    emoji: "🎁",
    startPrice: draft.startPrice,
    increment: draft.increment,
    status: "pending",
    highBid: 0,
    phase: "bidding",
    fmv: draft.fmv,
    image: draft.image,
    sources: draft.sources,
  };
  s.lots.push(lot);
  pushEvent({ type: "system", text: `New lot added: ${lot.title}, opening at ${money(lot.startPrice)}.`, lotId: lot.id });
  setCaption(`Fresh off the donation table: ${lot.title}! Estimated at ${money(lot.fmv)}, opening at ${money(lot.startPrice)}.`);
  save();
  return lot;
}

export type BidResult = { ok: true } | { ok: false; error: string };

/** The one and only bid path (humans and agents). Synchronous, so it is atomic in Node. */
export function placeBid(paddleId: string, lotId: string, amountIn: number, source: "human" | "agent" = "human"): BidResult {
  const s = getState();
  const lot = s.lots.find((l) => l.id === lotId);
  const p = s.paddles.find((x) => x.id === paddleId);
  if (!lot) return { ok: false, error: "Unknown lot" };
  if (!p) return { ok: false, error: "Unknown paddle" };
  if (s.status !== "live" || lot.status !== "open" || lot.phase === "sold") return { ok: false, error: "This lot isn't taking bids" };
  if (p.status !== "held") return { ok: false, error: "Your paddle doesn't have an active hold yet" };
  if (source === "human" && p.kind === "agent") return { ok: false, error: "Agent paddles bid automatically" };
  const amount = parseMoney(amountIn);
  if (amount === null) return { ok: false, error: "Invalid amount" };
  if (lot.highPaddleId === p.id) return { ok: false, error: "You're already the high bidder" };

  const min = lot.highPaddleId ? lot.highBid + lot.increment : lot.startPrice;
  if (cents(amount) < cents(min)) return { ok: false, error: `Bid must be at least ${money(min)}` };

  const own = lot.highPaddleId === p.id ? lot.highBid : 0;
  if (cents(p.committed) - cents(own) + cents(amount) > cents(p.holdAmount)) {
    const room = dollars(cents(p.holdAmount) - cents(p.committed) + cents(own));
    return { ok: false, error: `That would go over your ${money(p.holdAmount)} hold (room left: ${money(room)})` };
  }

  // Commit: release the previous high bidder's exposure, take ours.
  if (lot.highPaddleId) {
    const prev = s.paddles.find((x) => x.id === lot.highPaddleId);
    if (prev) prev.committed = dollars(Math.max(0, cents(prev.committed) - cents(lot.highBid)));
  }
  p.committed = dollars(cents(p.committed) + cents(amount));
  lot.highBid = amount;
  lot.highPaddleId = p.id;
  lot.phase = "bidding";
  const i = getInternal();
  i.lastActivityAt = Date.now();
  i.stalled = false;

  const isAgent = p.kind === "agent";
  const next = amount + lot.increment;
  pushEvent({
    type: isAgent ? "agent-bid" : "bid",
    text: isAgent
      ? `Paddle #${p.number} (${p.name}'s agent) bids ${money(amount)}. ${p.agent?.lastReasoning ?? ""}`.trim()
      : `Paddle #${p.number} (${p.name}) bids ${money(amount)}.`,
    paddleId: p.id,
    lotId: lot.id,
  });
  say(isAgent ? "agent-bid" : "bid", { lot: lot.title, name: p.name, amount, next });
  save();
  if (!isAgent) triggerAgents(lot.id);
  return { ok: true };
}

/** Called by the stage every ~2 s. Advances at most one phase step per call. */
export function tick(): void {
  const s = getState();
  if (s.status !== "live" || !s.currentLotId) return;
  const lot = s.lots.find((l) => l.id === s.currentLotId);
  if (!lot || lot.status !== "open") return;
  const i = getInternal();
  const elapsed = ((Date.now() - i.lastActivityAt) / 1000) * tickSpeed();
  const ctx = { lot: lot.title, amount: lot.highPaddleId ? lot.highBid : lot.startPrice };

  if (lot.phase === "bidding") {
    if (elapsed >= 14) {
      lot.phase = "going-once";
      pushEvent({ type: "going-once", text: `${lot.title}: going once at ${money(ctx.amount)}.`, lotId: lot.id });
      say("going-once", ctx);
    } else if (elapsed >= 8 && !i.stalled) {
      i.stalled = true;
      pushEvent({ type: "stall", text: `${lot.title} is waiting on a bid at ${money(ctx.amount)}.`, lotId: lot.id });
      say("stall", ctx);
    }
  } else if (lot.phase === "going-once" && elapsed >= 18) {
    lot.phase = "going-twice";
    pushEvent({ type: "going-twice", text: `${lot.title}: going twice at ${money(ctx.amount)}.`, lotId: lot.id });
    say("going-twice", ctx);
  } else if (lot.phase === "going-twice" && elapsed >= 22) {
    hammerLot(lot);
  }
  save();
}

export function hammer(lotId: string): State {
  const lot = findLot(lotId);
  if (lot.status === "open") hammerLot(lot);
  else if (lot.status === "pending") throw new EngineError(409, "That lot hasn't started");
  return getState();
}

/** SOLD records the winner and price. No money moves here: exposure stays committed until close. */
function hammerLot(lot: Lot): void {
  const s = getState();
  lot.phase = "sold";
  if (lot.highPaddleId) {
    const w = s.paddles.find((x) => x.id === lot.highPaddleId);
    lot.status = "sold";
    lot.winnerPaddleId = lot.highPaddleId;
    lot.finalPrice = lot.highBid;
    pushEvent({ type: "sold", text: `SOLD: ${lot.title} to paddle #${w?.number} (${w?.name}) for ${money(lot.highBid)}.`, paddleId: w?.id, lotId: lot.id });
    say("sold", { lot: lot.title, name: w?.name, amount: lot.highBid });
  } else {
    lot.status = "unsold";
    pushEvent({ type: "sold", text: `${lot.title} passed with no bids.`, lotId: lot.id });
    say("unsold", { lot: lot.title });
  }
  save();
}

// ---------------------------------------------------------------- absentee agents

const ag = globalThis as unknown as { __gtAgentBusy?: Set<string>; __gtAgentAgain?: Set<string> };

function triggerAgents(lotId: string): void {
  const busy = (ag.__gtAgentBusy ??= new Set());
  const again = (ag.__gtAgentAgain ??= new Set());
  for (const p of getState().paddles) {
    if (p.kind !== "agent" || p.status !== "held") continue;
    const key = `${currentRoom()}:${p.id}`;
    if (busy.has(key)) {
      again.add(key);
      continue;
    }
    busy.add(key);
    const delay = Math.max(100, 1200 / tickSpeed());
    setTimeout(() => void runAgent(p.id, lotId), delay);
  }
}

async function runAgent(paddleId: string, lotId: string): Promise<void> {
  const busy = ag.__gtAgentBusy!;
  const again = ag.__gtAgentAgain!;
  const key = `${currentRoom()}:${paddleId}`;
  try {
    for (let round = 0; round < 3; round++) {
      again.delete(key);
      const s = getState();
      const p = s.paddles.find((x) => x.id === paddleId);
      const lot = s.lots.find((l) => l.id === lotId);
      if (!p || !p.agent || p.status !== "held" || !lot || lot.status !== "open" || s.status !== "live") return;
      if (lot.highPaddleId === p.id) return;

      const d = await decideAgentBid(p, lot);
      p.agent.lastReasoning = d.reasoning;
      save();
      if (d.bid) {
        // Proposal only: the engine re-validates exactly like a human bid.
        const r = placeBid(p.id, lot.id, d.amount, "agent");
        if (r.ok) return;
        if (!again.has(key)) {
          p.agent.lastReasoning = `${d.reasoning} (Engine declined: ${r.error}.)`;
          return;
        }
      } else if (!again.has(key)) {
        return;
      }
    }
  } catch (e) {
    console.error("[agent]", (e as Error).message);
  } finally {
    busy.delete(key);
  }
}

// ---------------------------------------------------------------- settlement

const cg = globalThis as unknown as { __gtClosing?: Map<string, Promise<State>> };

/** Idempotent. Concurrent calls share one run; a closed auction returns state with no money movement. */
export function close(): Promise<State> {
  const closing = (cg.__gtClosing ??= new Map());
  const room = currentRoom();
  let run = closing.get(room);
  if (!run) {
    run = doClose().finally(() => {
      closing.delete(room);
    });
    closing.set(room, run);
  }
  return run;
}

function wonBy(p: Paddle): Lot[] {
  return getState().lots.filter((l) => l.status === "sold" && l.winnerPaddleId === p.id);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : "unknown error";
}

async function doClose(): Promise<State> {
  const s = getState();
  if (s.status === "closed") return s;
  const i = getInternal();
  const demo = isDemoMode();
  const step = demo ? Math.max(20, 350 / tickSpeed()) : 0; // lets the money board animate in demo

  for (const lot of s.lots) if (lot.status === "open") hammerLot(lot);
  pushEvent({ type: "system", text: "Closing the auction: settling every paddle." });
  let failed = false;

  // 1) One final capture per winner (sum of lots won), void everyone else. Sequential.
  for (const p of s.paddles) {
    if (p.status !== "held" || !p.authorizationId) continue;
    const wonCents = wonBy(p).reduce((c, l) => c + cents(l.finalPrice ?? 0), 0);
    if (wonCents > cents(p.holdAmount)) {
      // Cannot happen if bids went through placeBid; never over-capture.
      addLedger({ kind: "captured", paddleId: p.id, amount: dollars(wonCents), status: "FAILED", note: "won total exceeds hold; not captured" });
      failed = true;
      continue;
    }
    if (step) await sleep(step);
    if (wonCents > 0) {
      const amount = dollars(wonCents);
      try {
        let id = demoId("CAPTURE");
        let status = "COMPLETED";
        if (!demo) {
          const cap = await pp.captureAuthorization(p.authorizationId, {
            amount: pp.centsToAmount(wonCents),
            finalCapture: true,
            invoiceId: `GT-${i.auctionId}-${p.number}`,
            noteToPayer: `Thank you for supporting ${SCHOOL_NAME}!`,
            softDescriptor: "GOINGTWICE PTA",
          });
          id = cap.id;
          status = cap.status;
          if (status === "DECLINED" || status === "FAILED") {
            addLedger({ kind: "captured", paddleId: p.id, amount, paypalId: id, status: "FAILED", note: `capture ${status.toLowerCase()}` });
            failed = true;
            continue;
          }
        }
        p.status = "captured";
        p.capturedAmount = amount;
        p.committed = 0;
        addLedger({ kind: "captured", paddleId: p.id, amount, paypalId: id, status, note: `final capture; ${money(dollars(cents(p.holdAmount) - wonCents))} of hold released` });
        pushEvent({ type: "system", text: `Captured ${money(amount)} from paddle #${p.number} (${p.name}).`, paddleId: p.id });
      } catch (e) {
        addLedger({ kind: "captured", paddleId: p.id, amount, status: "FAILED", note: errMsg(e) });
        failed = true;
      }
    } else {
      try {
        if (!demo) await pp.voidAuthorization(p.authorizationId);
        p.status = "voided";
        p.committed = 0;
        addLedger({ kind: "voided", paddleId: p.id, amount: p.holdAmount, paypalId: p.authorizationId, status: "VOIDED", note: demo ? "simulated void" : undefined });
        pushEvent({ type: "system", text: `Released paddle #${p.number}'s ${money(p.holdAmount)} hold.`, paddleId: p.id });
      } catch (e) {
        addLedger({ kind: "voided", paddleId: p.id, amount: p.holdAmount, paypalId: p.authorizationId, status: "FAILED", note: errMsg(e) });
        failed = true;
      }
    }
  }

  if (failed) {
    pushEvent({ type: "system", text: "Some payments need attention. Close again to retry only what failed." });
    recomputeTotals();
    return s;
  }

  // 2) One Payouts batch for the captured total.
  recomputeTotals();
  const capturedCents = cents(s.totals.captured);
  if (!i.payoutDone && capturedCents > 0) {
    if (step) await sleep(step);
    const receiver = process.env.TREASURER_PAYPAL_EMAIL || process.env.TREASURER_RECEIVER;
    try {
      let id = demoId("PAYOUT");
      let status = "SUCCESS";
      if (!demo) {
        if (!receiver) throw new Error("TREASURER_PAYPAL_EMAIL is not set");
        const batch = await pp.createPayoutBatch({
          senderBatchId: `close-${i.auctionId}`,
          emailSubject: "Going Twice auction proceeds",
          items: [{ recipientType: "EMAIL", receiver, amount: pp.centsToAmount(capturedCents), note: `Auction proceeds for ${SCHOOL_NAME}` }],
        });
        id = batch.batch_header.payout_batch_id;
        status = batch.batch_header.batch_status;
      }
      i.payoutDone = true;
      addLedger({ kind: "payout", amount: dollars(capturedCents), paypalId: id, status, note: `to treasurer${receiver ? ` ${receiver}` : ""}` });
      pushEvent({ type: "system", text: `Sent ${money(dollars(capturedCents))} to the PTA treasurer.` });
    } catch (e) {
      addLedger({ kind: "payout", amount: dollars(capturedCents), status: "FAILED", note: errMsg(e) });
      pushEvent({ type: "system", text: "Payout to the treasurer failed. Close again to retry." });
      return s;
    }
  } else {
    i.payoutDone = true;
  }

  // 3) Receipts (best effort; never blocks closing). Claude phrases, code supplies the numbers.
  const winners = s.paddles.filter((p) => p.status === "captured" && !s.receipts.some((r) => r.paddleId === p.id));
  const texts = await Promise.all(
    winners.map((p) => {
      const items: ReceiptItem[] = wonBy(p).map((l) => ({ title: l.title, paid: l.finalPrice ?? 0, fmv: l.fmv ?? 0, listings: l.sources?.length }));
      return writeReceipt(p.name, items);
    }),
  );
  for (const [k, p] of winners.entries()) {
    const text = texts[k];
    const amount = p.capturedAmount ?? 0;
    let invoiceId: string | undefined = demo ? demoId("INV") : undefined;
    let status = "PAID";
    let note: string | undefined = demo ? "simulated invoice" : undefined;
    if (!demo) {
      if (!p.payerEmail) {
        status = "SKIPPED";
        note = "no payer email; receipt shown in app only";
      } else {
        try {
          const lots = wonBy(p);
          const inv = await pp.createAndSendReceiptInvoice({
            invoiceNumber: `GTR-${i.auctionId}-${p.number}`,
            recipientEmail: p.payerEmail,
            lines: lots.map((l) => ({ name: l.title, amount: l.finalPrice ?? 0, description: `Estimated fair market value ${money(l.fmv ?? 0)}${l.sources?.length ? ` from ${l.sources.length} retail listings via Channel3` : ""} (estimate only).` })),
            note: text,
            memo: s.ledger.find((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED")?.paypalId,
            invoicerBusinessName: "Maple Street Elementary PTA",
          });
          invoiceId = inv.invoiceId;
          await pp.recordPayment(inv.invoiceId, { amount: pp.centsToAmount(cents(amount)), note: "Paid via Going Twice paddle capture" });
        } catch (e) {
          status = invoiceId ? "SENT" : "FAILED";
          note = errMsg(e);
        }
      }
    }
    s.receipts.push({ paddleId: p.id, text, ...(invoiceId ? { invoiceId } : {}) });
    addLedger({ kind: "receipt", paddleId: p.id, amount, paypalId: invoiceId, status, note });
  }

  s.status = "closed";
  pushEvent({ type: "system", text: `Auction closed. Collected ${money(s.totals.captured)}, released ${money(s.totals.voided)} in holds, paid out ${money(s.totals.paidOut)}.` });
  say("close", {});
  recomputeTotals();
  return s;
}

// ---------------------------------------------------------------- webhooks

type WebhookEvent = { id?: string; event_type?: string; resource?: Record<string, unknown> };

/** Webhooks only confirm what synchronous calls already recorded (and resolve PENDING captures). */
export function applyWebhook(ev: WebhookEvent): void {
  const s = getState();
  const i = getInternal();
  if (!ev.id || !ev.event_type) return;
  if (i.webhookIds.includes(ev.id)) return;
  i.webhookIds.push(ev.id);
  if (i.webhookIds.length > 200) i.webhookIds.splice(0, i.webhookIds.length - 200);

  const r = ev.resource ?? {};
  const rid = typeof r.id === "string" ? r.id : undefined;
  const find = (kind: string, id?: string) => (id ? s.ledger.find((x) => x.kind === kind && x.paypalId === id) : undefined);
  const mark = (row: ReturnType<typeof find>, status: string | null, note: string) => {
    if (!row) return;
    if (status) row.status = status;
    row.note = row.note ? `${row.note}; ${note}` : note;
  };
  const W = pp.WEBHOOK_EVENTS;
  switch (ev.event_type) {
    case W.CAPTURE_COMPLETED:
      mark(find("captured", rid), "COMPLETED", "confirmed by webhook");
      break;
    case W.CAPTURE_PENDING:
      mark(find("captured", rid), "PENDING", "pending per webhook");
      break;
    case W.CAPTURE_DECLINED:
      mark(find("captured", rid), "FAILED", "declined per webhook");
      break;
    case W.AUTHORIZATION_CREATED:
      mark(find("authorized", rid), null, "confirmed by webhook");
      break;
    case W.AUTHORIZATION_VOIDED:
      mark(find("voided", rid), "VOIDED", "confirmed by webhook");
      break;
    case W.PAYOUTS_BATCH_SUCCESS:
    case W.PAYOUTS_BATCH_DENIED: {
      const bh = r.batch_header as { payout_batch_id?: string } | undefined;
      mark(find("payout", bh?.payout_batch_id), ev.event_type === W.PAYOUTS_BATCH_SUCCESS ? "SUCCESS" : "FAILED", "per webhook");
      break;
    }
    case W.PAYOUTS_ITEM_SUCCEEDED:
    case W.PAYOUTS_ITEM_UNCLAIMED:
    case W.PAYOUTS_ITEM_FAILED: {
      const bid = typeof r.payout_batch_id === "string" ? r.payout_batch_id : undefined;
      mark(find("payout", bid), null, `item ${String(r.transaction_status ?? ev.event_type).toLowerCase()}`);
      break;
    }
    case W.INVOICE_PAID: {
      const inv = r.invoice as { id?: string } | undefined;
      mark(find("receipt", inv?.id ?? rid), "PAID", "confirmed by webhook");
      break;
    }
    default:
      return;
  }
  recomputeTotals();
}
