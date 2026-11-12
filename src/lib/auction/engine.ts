// Auction engine: bid validation, lot pacing, hammer, and settlement. Every money decision is
// plain code here; AI modules only produce words and yes/no bid proposals that we re-validate.
import * as pp from "@/lib/paypal";
import { say, money } from "@/lib/ai/auctioneer";
import { decideAgentBid } from "@/lib/ai/agent";
import { writeReceipt, SCHOOL_NAME, type ReceiptItem, type SalesContext } from "@/lib/ai/receipt";
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
  type AuctionSettings,
  type AuctionType,
  type Lot,
  type Paddle,
  type State,
} from "./store";
import { grossCents, isAuctionType, typeConfig } from "./auctionTypes";
import { currentRoom } from "./room";
import { settle } from "@/lib/settlement";
import { SimulatedPayPalError, takeFailure } from "./testHooks";

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

/** Hostile-input caps per room (state is polled every second, so it must stay small). */
export const MAX_PADDLES = 200;
export const MAX_LOTS_PER_ROOM = 40;

const cg = globalThis as unknown as { __gtClosing?: Map<string, Promise<State>>; __gtPayoutRetry?: Map<string, Promise<PayoutRetryResult>> };

/** A close is running right now in this room. */
function closingNow(): boolean {
  return cg.__gtClosing?.has(currentRoom()) ?? false;
}

/** Why the auction can't take new paddles/lots/bids, or null when it can. Once close starts, the room is frozen. */
function frozenReason(): string | null {
  if (getState().status === "closed") return "Auction is closed";
  if (getInternal().closeStarted || closingNow()) return "Auction is closing: no new paddles, lots or bids";
  return null;
}

function assertOpen(): void {
  const why = frozenReason();
  if (why) throw new EngineError(409, why);
}

/** Best-effort release of every live hold of the auction being thrown away (reset / type switch). */
function releaseHolds(s: State): void {
  if (isDemoMode()) return;
  for (const p of s.paddles) {
    if (p.status !== "held" || !p.authorizationId) continue;
    const auth = p.authorizationId;
    p.status = "voided";
    pp.voidAuthorization(auth).catch((e) => console.error("[reset] void", auth, "failed:", errMsg(e)));
  }
}

/**
 * The auction was reset or closed while we awaited PayPal: never keep a hold nobody will settle.
 * Voids the fresh authorization (best effort) and throws 409.
 */
function abandonIfStale(auctionId: string, authorizationId?: string): void {
  if (getInternal().auctionId === auctionId && !frozenReason()) return;
  if (authorizationId && !isDemoMode()) {
    pp.voidAuthorization(authorizationId).catch((e) => console.error("[paddle] void of abandoned hold failed:", errMsg(e)));
  }
  throw new EngineError(409, `The auction was reset or closed while your hold was being placed${authorizationId ? "; that hold was released" : ""}`);
}

// ---------------------------------------------------------------- setup

/** Fresh auction in the same room; keeps the room's auction type, settings and organizer email. */
export function reset(): State {
  if (closingNow()) throw new EngineError(409, "A close is in progress; reset after it finishes");
  const s = getState();
  releaseHolds(s);
  return resetStore({ type: s.auctionType, settings: s.settings, organizerEmail: getInternal().payout?.organizer });
}

export type TypeInput = {
  type: unknown;
  premiumPct?: unknown;
  commissionPct?: unknown;
  organizerEmail?: unknown;
  consignorEmails?: unknown;
};

const EMAIL_RE = /^[^\s@,;<>]{1,64}@[^\s@,;<>]{1,190}\.[^\s@,;<>]{2,}$/;

function pct(v: unknown, label: string, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) {
    throw new EngineError(400, `${label} must be a number from 0 to ${max} with at most 2 decimals`);
  }
  return v;
}

function email(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !EMAIL_RE.test(v.trim())) throw new EngineError(400, `${label} must be a valid email address`);
  return v.trim();
}

/** Switch the room to another auction type and reset it with that type's sample lots. */
export function setAuctionType(input: TypeInput): State {
  if (!isAuctionType(input.type)) throw new EngineError(400, "type must be one of charity, estate, collectibles, farm");
  const type: AuctionType = input.type;
  const cfg = typeConfig(type);
  const settings: Partial<AuctionSettings> = {};
  const premium = pct(input.premiumPct, "premiumPct", 50);
  const commission = pct(input.commissionPct, "commissionPct", 60);
  if (premium !== undefined && cfg.editable.premium) settings.premiumPct = premium;
  if (commission !== undefined && cfg.editable.commission) settings.commissionPct = commission;
  const organizerEmail = email(input.organizerEmail, "organizerEmail");
  let consignorEmails: string[] | undefined;
  if (input.consignorEmails !== undefined && cfg.editable.consignors) {
    if (!Array.isArray(input.consignorEmails) || input.consignorEmails.length > 10) throw new EngineError(400, "consignorEmails must be a list of up to 10 emails");
    consignorEmails = input.consignorEmails.map((e) => email(e, "consignorEmails")).filter((e): e is string => !!e);
  }
  if (closingNow()) throw new EngineError(409, "A close is in progress; switch type after it finishes");
  releaseHolds(getState());
  const s = resetStore({ type, settings, organizerEmail, consignorEmails });
  if (type !== "charity") {
    setCaption(`Welcome to the ${cfg.stageLabel}! Grab a paddle and get those thumbs warmed up.`);
  }
  return s;
}

/** Lot facts Gus may weave into a line (consignor provenance, per-head quotes). */
function lotCtx(lot: Lot) {
  return { consignor: lot.consignor, unit: lot.unit, quantity: lot.quantity };
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
  const i0 = getInternal();
  if (input.testCard && !isDemoMode() && !testCardsAllowed()) {
    throw new EngineError(400, "testCard is only allowed when PAYPAL_ENV=sandbox");
  }
  assertOpen();
  if (s.paddles.length >= MAX_PADDLES) throw new EngineError(409, `This room is full (${MAX_PADDLES} paddles)`);
  if (!input.email && input.testCard && !isDemoMode() && testCardsAllowed()) input.email = nextSandboxBuyerEmail();
  // Reserve the paddle number synchronously: concurrent registrations (autopilot creates its bidders in
  // parallel) must never share a number, since the capture invoice_id and receipt number derive from it.
  i0.paddleNo = Math.max(i0.paddleNo ?? 0, s.paddles.length) + 1;
  const auctionId = i0.auctionId;
  const p: Paddle = {
    id: nextId("p"),
    number: 100 + i0.paddleNo,
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
    abandonIfStale(auctionId, auth.id);
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
    abandonIfStale(auctionId);
    p.orderId = order.id;
    s.paddles.push(p);
    save();
  }
  pushEvent({ type: "system", text: `Paddle #${p.number} (${p.name}${p.kind === "agent" ? ", absentee agent" : ""}) joined${p.status === "held" ? ` with a ${money(p.holdAmount)} hold` : ""}.`, paddleId: p.id });
  if (p.status === "held" && p.kind === "agent" && s.currentLotId) triggerAgents(s.currentLotId);
  return { paddle: p, orderId: p.status === "pending" ? p.orderId : undefined };
}

const az = globalThis as unknown as { __gtAuthorizing?: Map<string, Promise<Paddle>> };

/** Live: after buyer approval, place the hold. Demo: no-op (already held). Idempotent; a double-click shares one call. */
export function authorizePaddle(paddleId: string, orderId: string): Promise<Paddle> {
  const inflight = (az.__gtAuthorizing ??= new Map());
  const key = `${currentRoom()}:${paddleId}`;
  let run = inflight.get(key);
  if (!run) {
    run = doAuthorizePaddle(paddleId, orderId).finally(() => inflight.delete(key));
    inflight.set(key, run);
  }
  return run;
}

async function doAuthorizePaddle(paddleId: string, orderId: string): Promise<Paddle> {
  const p = findPaddle(paddleId);
  if (p.status !== "pending") return p;
  if (isDemoMode()) return p;
  if (!p.orderId || p.orderId !== orderId) throw new EngineError(400, "orderId does not match this paddle");
  // A hold placed after close starts would never be captured or voided.
  assertOpen();
  const auctionId = getInternal().auctionId;

  const { order, authorization } = await pp.authorizeOrder(orderId);
  if (!["CREATED", "PENDING"].includes(authorization.status)) {
    throw new EngineError(402, `Authorization ${authorization.status.toLowerCase()}`);
  }
  abandonIfStale(auctionId, authorization.id);
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
  assertOpen();
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
  say("open", { lot: lot.title, amount: lot.startPrice, ...lotCtx(lot) });
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
  assertOpen();
  if (s.lots.length >= MAX_LOTS_PER_ROOM) throw new EngineError(409, `This room already has ${MAX_LOTS_PER_ROOM} lots`);
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
  setCaption(
    s.auctionType === "charity"
      ? `Fresh off the donation table: ${lot.title}! Estimated at ${money(lot.fmv)}, opening at ${money(lot.startPrice)}.`
      : `New lot just in: ${lot.title}, opening at ${money(lot.startPrice)}.`,
  );
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
  const frozen = frozenReason();
  if (frozen) return { ok: false, error: frozen };
  if (p.status !== "held") return { ok: false, error: "Your paddle doesn't have an active hold yet" };
  if (source === "human" && p.kind === "agent") return { ok: false, error: "Agent paddles bid automatically" };
  const amount = parseMoney(amountIn);
  if (amount === null) return { ok: false, error: "Invalid amount" };
  if (lot.highPaddleId === p.id) return { ok: false, error: "You're already the high bidder" };

  const min = lot.highPaddleId ? lot.highBid + lot.increment : lot.startPrice;
  if (cents(amount) < cents(min)) return { ok: false, error: `Bid must be at least ${money(min)}` };

  const own = lot.highPaddleId === p.id ? lot.highBid : 0;
  // Hold must cover hammer plus buyer's premium (premiumPct is 0 for charity, so gross == hammer).
  const premiumPct = s.settings?.premiumPct ?? 0;
  const afterCents = cents(p.committed) - cents(own) + cents(amount);
  if (grossCents(afterCents, premiumPct) > cents(p.holdAmount)) {
    if (premiumPct > 0) {
      const base = cents(p.committed) - cents(own);
      let roomC = Math.max(0, Math.floor(((cents(p.holdAmount) - grossCents(base, premiumPct)) * 100) / (100 + premiumPct)));
      while (roomC > 0 && grossCents(base + roomC, premiumPct) > cents(p.holdAmount)) roomC--;
      return { ok: false, error: `That would go over your ${money(p.holdAmount)} hold once the ${premiumPct}% buyer's premium is added (room left: ${money(dollars(roomC))} hammer)` };
    }
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
  say(isAgent ? "agent-bid" : "bid", { lot: lot.title, name: p.name, amount, next, ...lotCtx(lot) });
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
      say("going-once", { ...ctx, ...lotCtx(lot) });
    } else if (elapsed >= 8 && !i.stalled) {
      i.stalled = true;
      pushEvent({ type: "stall", text: `${lot.title} is waiting on a bid at ${money(ctx.amount)}.`, lotId: lot.id });
      say("stall", { ...ctx, ...lotCtx(lot) });
    }
  } else if (lot.phase === "going-once" && elapsed >= 18) {
    lot.phase = "going-twice";
    pushEvent({ type: "going-twice", text: `${lot.title}: going twice at ${money(ctx.amount)}.`, lotId: lot.id });
    say("going-twice", { ...ctx, ...lotCtx(lot) });
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
    say("sold", { lot: lot.title, name: w?.name, amount: lot.highBid, ...lotCtx(lot) });
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

/** Idempotent. Concurrent calls share one run; a closed auction returns state with no money movement. */
export function close(): Promise<State> {
  const closing = (cg.__gtClosing ??= new Map());
  const room = currentRoom();
  let run = closing.get(room);
  if (!run) {
    run = settle({ inProcess: doClose, hammerOpenLots: () => { for (const lot of getState().lots) if (lot.status === "open") hammerLot(lot); } }).finally(() => {
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

type PayoutLine = { receiver?: string; cents: number; payNote: string; ledgerNote: string; house?: boolean };

const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "")}%`;

/** Who gets paid what. Always sums to the captured total. Charity/collectibles/farm: one line to the organizer. */
function payoutPlan(s: State, receiver: string | undefined, capturedCents: number): PayoutLine[] {
  const cfg = typeConfig(s.auctionType);
  if (cfg.payoutPlan !== "consignment") {
    return [
      {
        receiver,
        cents: capturedCents,
        payNote: cfg.receiptKind === "sale" ? `Sale proceeds for ${cfg.orgName}` : `Auction proceeds for ${SCHOOL_NAME}`,
        ledgerNote: `${cfg.receiptKind === "sale" ? "to organizer" : "to treasurer"}${receiver ? ` ${receiver}` : ""}`,
        house: true,
      },
    ];
  }
  // Consignment: per sold lot, consignor gets hammer minus commission; the house keeps the rest
  // (commission plus any buyer's premium, and lots with no consignor email).
  const commissionPct = s.settings?.commissionPct ?? 0;
  const consignors = getInternal().payout?.consignors ?? {};
  const byEmail = new Map<string, { cents: number; lots: string[] }>();
  for (const l of s.lots) {
    const email = consignors[l.id];
    const winner = s.paddles.find((p) => p.id === l.winnerPaddleId);
    if (l.status !== "sold" || !email || winner?.status !== "captured") continue;
    const hammerC = cents(l.finalPrice ?? 0);
    const credit = hammerC - Math.round((hammerC * commissionPct) / 100);
    const e = byEmail.get(email) ?? { cents: 0, lots: [] };
    e.cents += credit;
    e.lots.push(`${l.title} ${money(l.finalPrice)}`);
    byEmail.set(email, e);
  }
  const split = `consignor ${pctText(100 - commissionPct)} / house ${pctText(commissionPct)}`;
  const withPremium = (s.settings?.premiumPct ?? 0) > 0;
  const lines: PayoutLine[] = [];
  let consignorTotal = 0;
  for (const [email, e] of byEmail) {
    if (e.cents <= 0) continue;
    consignorTotal += e.cents;
    lines.push({
      receiver: email,
      cents: e.cents,
      payNote: `Consignment proceeds (hammer minus ${pctText(commissionPct)} house commission): ${e.lots.join("; ")}`.slice(0, 300),
      ledgerNote: `${split}: ${e.lots.join("; ")} to consignor ${email}`,
    });
  }
  const houseC = capturedCents - consignorTotal;
  if (houseC > 0) {
    lines.push({
      receiver,
      cents: houseC,
      payNote: `House share: ${pctText(commissionPct)} commission${withPremium ? " plus buyer's premium" : ""}`,
      ledgerNote: `${split}: house commission${withPremium ? " + buyer's premium" : ""} to house${receiver ? ` ${receiver}` : ""}`,
      house: true,
    });
  }
  return lines;
}

function payoutEvent(s: State, plan: PayoutLine[], capturedCents: number): string {
  const cfg = typeConfig(s.auctionType);
  if (cfg.payoutPlan === "consignment") {
    const houseC = plan.filter((x) => x.house).reduce((c, x) => c + x.cents, 0);
    return `Paid out ${money(dollars(capturedCents))}: ${money(dollars(capturedCents - houseC))} to consignors, ${money(dollars(houseC))} to the house.`;
  }
  return cfg.receiptKind === "sale" ? `Sent ${money(dollars(capturedCents))} to the organizer.` : `Sent ${money(dollars(capturedCents))} to the PTA treasurer.`;
}

async function doClose(): Promise<State> {
  const s = getState();
  if (s.status === "closed") return s;
  const i = getInternal();
  const demo = isDemoMode();
  const step = demo ? Math.max(20, 350 / tickSpeed()) : 0; // lets the money board animate in demo
  i.closeStarted = true; // freeze: no new paddles, lots or bids from here on (also across a retried close)
  const room = currentRoom();

  for (const lot of s.lots) if (lot.status === "open") hammerLot(lot);
  pushEvent({ type: "system", text: "Closing the auction: settling every paddle." });
  let failed = false;
  const cfg = typeConfig(s.auctionType);
  const premiumPct = s.settings?.premiumPct ?? 0;
  const sale = cfg.receiptKind === "sale";

  // 1) One final capture per winner (sum of lots won), void everyone else. Sequential.
  for (const p of s.paddles) {
    if (p.status !== "held" || !p.authorizationId) continue;
    const hammerCents = wonBy(p).reduce((c, l) => c + cents(l.finalPrice ?? 0), 0);
    const wonCents = grossCents(hammerCents, premiumPct); // hammer + buyer's premium (== hammer for charity)
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
        const simulated = takeFailure(room, "capture");
        if (simulated) throw new SimulatedPayPalError(simulated);
        if (!demo) {
          const cap = await pp.captureAuthorization(p.authorizationId, {
            amount: pp.centsToAmount(wonCents),
            finalCapture: true,
            invoiceId: `GT-${i.auctionId}-${p.number}`,
            noteToPayer: sale ? `Thank you for your purchase from ${cfg.orgName}!` : `Thank you for supporting ${SCHOOL_NAME}!`,
            softDescriptor: cfg.softDescriptor,
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
        addLedger({ kind: "captured", paddleId: p.id, amount, paypalId: id, status, note: `final capture${premiumPct > 0 ? `; hammer ${money(dollars(hammerCents))} + ${premiumPct}% buyer's premium ${money(dollars(wonCents - hammerCents))}` : ""}; ${money(dollars(cents(p.holdAmount) - wonCents))} of hold released` });
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

  // 2) One Payouts batch for the captured total (organizer, or consignors + house for consignment).
  //    A failed payout does NOT block the close: every capture/void is final by now, so the auction
  //    closes with a "payout pending — retry" ledger row and POST /api/payout/retry sends only the payout.
  if (step) await sleep(step);
  await sendPayout();

  // 3) Receipts (best effort; never blocks closing). Claude phrases, code supplies the numbers.
  const winners = s.paddles.filter((p) => p.status === "captured" && !s.receipts.some((r) => r.paddleId === p.id));
  const texts = await Promise.all(
    winners.map((p) => {
      const items: ReceiptItem[] = wonBy(p).map((l) => ({ title: l.title, paid: l.finalPrice ?? 0, fmv: l.fmv ?? 0, listings: l.sources?.length }));
      return writeReceipt(p.name, items, sale ? salesContext(p, s, wonBy(p)) : undefined);
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
          const lines = sale
            ? salesInvoiceLines(salesContext(p, s, lots), lots)
            : lots.map((l) => ({ name: l.title, amount: l.finalPrice ?? 0, description: `Estimated fair market value ${money(l.fmv ?? 0)}${l.sources?.length ? ` from ${l.sources.length} retail listings via Channel3` : ""} (estimate only).` }));
          const inv = await pp.createAndSendReceiptInvoice({
            invoiceNumber: `GTR-${i.auctionId}-${p.number}`,
            recipientEmail: p.payerEmail,
            lines,
            note: text,
            memo: s.ledger.find((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED")?.paypalId,
            invoicerBusinessName: cfg.invoicerName,
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
  recomputeTotals();
  pushEvent({ type: "system", text: `Auction closed. Collected ${money(s.totals.captured)}, released ${money(s.totals.voided)} in holds, ${s.payoutStatus?.state === "retry" ? `payout of ${money(s.payoutStatus.amount)} pending retry` : `paid out ${money(s.totals.paidOut)}`}.` });
  say("close", {});
  return s;
}

const PAYOUT_PENDING_NOTE = "payout pending — retry";

/** PayPal said this sender_batch_id was already used: an earlier attempt created the batch. */
function isDuplicateBatch(e: unknown): boolean {
  const x = e as { issue?: string; paypalName?: string; message?: string; details?: { issue?: string; field?: string }[] };
  const text = [x.issue, x.message, ...(x.details ?? []).map((d) => `${d.field} ${d.issue}`)].join(" ").toUpperCase();
  return text.includes("SENDER_BATCH_ID") && (text.includes("ALREADY") || text.includes("DUPLICATE"));
}

/**
 * Send the one Payouts batch for the captured total, once. Idempotent: `payoutDone` short-circuits, the
 * sender_batch_id is always `close-<auctionId>` (PayPal refuses a reused one for 30 days, so money can
 * never go out twice), and each attempt gets its own PayPal-Request-Id so a retry is not answered with the
 * cached failure. On failure: one PENDING_RETRY ledger row (updated in place) + state.payoutStatus "retry".
 * Returns true when the payout is done (or there was nothing to pay).
 */
async function sendPayout(): Promise<boolean> {
  const s = getState();
  const i = getInternal();
  const demo = isDemoMode();
  const cfg = typeConfig(s.auctionType);
  recomputeTotals();
  if (i.payoutDone) return true;
  const capturedCents = cents(s.totals.captured);
  if (capturedCents <= 0) {
    i.payoutDone = true;
    s.payoutStatus = { state: "none", amount: 0, attempts: 0 };
    return true;
  }
  const attempts = (s.payoutStatus?.attempts ?? 0) + 1;
  const senderBatchId = `close-${i.auctionId}`;
  const receiver = i.payout?.organizer || process.env.TREASURER_PAYPAL_EMAIL || process.env.TREASURER_RECEIVER;
  const plan = payoutPlan(s, receiver, capturedCents);
  try {
    const simulated = takeFailure(currentRoom(), "payout");
    if (simulated) throw new SimulatedPayPalError(simulated);
    let id = demoId("PAYOUT");
    let status = "SUCCESS";
    let extra = "";
    if (!demo) {
      if (plan.some((x) => !x.receiver)) throw new Error("TREASURER_PAYPAL_EMAIL is not set");
      try {
        const batch = await pp.createPayoutBatch({
          senderBatchId,
          requestId: attempts > 1 ? `payout:${senderBatchId}:attempt-${attempts}` : undefined,
          emailSubject: cfg.receiptKind === "sale" ? `${cfg.invoicerName} sale proceeds` : "Going Twice auction proceeds",
          items: plan.map((x) => ({ recipientType: "EMAIL" as const, receiver: x.receiver as string, amount: pp.centsToAmount(x.cents), note: x.payNote })),
        });
        id = batch.batch_header.payout_batch_id;
        status = batch.batch_header.batch_status;
      } catch (e) {
        if (attempts === 1 || !isDuplicateBatch(e)) throw e;
        // An earlier attempt reached PayPal after all; never send a second batch.
        id = senderBatchId;
        extra = `; batch ${senderBatchId} already created by an earlier attempt, not sent twice`;
      }
    }
    i.payoutDone = true;
    for (const r of s.ledger) if (r.kind === "payout" && r.status === "PENDING_RETRY") r.status = "RETRIED";
    for (const x of plan) addLedger({ kind: "payout", amount: dollars(x.cents), paypalId: id, status, note: `${x.ledgerNote}${attempts > 1 ? `; sent on attempt ${attempts}` : ""}${extra}` });
    s.payoutStatus = { state: "sent", amount: dollars(capturedCents), attempts, batchId: id };
    pushEvent({ type: "system", text: payoutEvent(s, plan, capturedCents) });
    recomputeTotals();
    return true;
  } catch (e) {
    const x = e as { issue?: string; paypalName?: string };
    const reason = x.issue ?? x.paypalName ?? errMsg(e);
    const note = `${PAYOUT_PENDING_NOTE} (POST /api/payout/retry): ${errMsg(e)}`;
    const pending = s.ledger.find((r) => r.kind === "payout" && r.status === "PENDING_RETRY");
    if (pending) {
      pending.note = `${note}; attempt ${attempts}`;
      pending.ts = Date.now();
    } else {
      addLedger({ kind: "payout", amount: dollars(capturedCents), status: "PENDING_RETRY", note });
    }
    s.payoutStatus = { state: "retry", amount: dollars(capturedCents), error: reason.slice(0, 200), attempts };
    const who = cfg.payoutPlan === "consignment" ? "the consignors" : cfg.receiptKind === "sale" ? "the organizer" : "the treasurer";
    pushEvent({ type: "system", text: `Payout of ${money(dollars(capturedCents))} to ${who} is pending (${reason.slice(0, 80)}). Every capture and release is done; retry the payout from admin.` });
    recomputeTotals();
    return false;
  }
}

export type PayoutRetryResult = { ok: boolean; retried: boolean; state: State };

/**
 * POST /api/payout/retry: re-send ONLY the payout of a closed auction. Idempotent: concurrent calls share
 * one attempt, and once paid every call returns {ok:true, retried:false} with no money movement.
 */
export function retryPayout(): Promise<PayoutRetryResult> {
  const inflight = (cg.__gtPayoutRetry ??= new Map());
  const room = currentRoom();
  let run = inflight.get(room);
  if (!run) {
    run = (async (): Promise<PayoutRetryResult> => {
      if (closingNow()) throw new EngineError(409, "A close is in progress; retry the payout after it finishes");
      const s = getState();
      if (s.status !== "closed") throw new EngineError(409, "Close the auction first: the payout runs after every capture and void");
      if (getInternal().payoutDone) return { ok: true, retried: false, state: s };
      const ok = await sendPayout();
      if (ok) pushEvent({ type: "system", text: `Payout retry succeeded: paid out ${money(s.totals.paidOut)}.` });
      return { ok, retried: true, state: getState() };
    })().finally(() => inflight.delete(room));
    inflight.set(room, run);
  }
  return run;
}

/** Sales-receipt numbers for one winner: all code-computed, so receipt, invoice and capture always agree. */
function salesContext(p: Paddle, s: State, lots: Lot[]): SalesContext {
  const cfg = typeConfig(s.auctionType);
  const commissionPct = s.settings?.commissionPct ?? 0;
  const premiumPct = s.settings?.premiumPct ?? 0;
  const hammer = lots.reduce((c, l) => c + cents(l.finalPrice ?? 0), 0);
  const total = cents(p.capturedAmount ?? 0) || grossCents(hammer, premiumPct);
  return {
    orgName: cfg.orgName,
    premiumPct,
    hammer: dollars(hammer),
    premium: dollars(total - hammer),
    total: dollars(total),
    consignment: cfg.payoutPlan === "consignment",
    commissionPct,
    lots: lots.map((l) => {
      const h = cents(l.finalPrice ?? 0);
      return { title: l.title, hammer: l.finalPrice ?? 0, consignor: l.consignor, credit: dollars(h - Math.round((h * commissionPct) / 100)), unit: l.unit, quantity: l.quantity };
    }),
  };
}

function salesInvoiceLines(ctx: SalesContext, lots: Lot[]) {
  const lines = lots.map((l, k) => {
    const bits = [`Hammer price ${money(l.finalPrice)}`];
    if (l.unit === "head" && (l.quantity ?? 0) > 1 && l.finalPrice) bits.push(`${l.quantity} head, ${money(Math.round((l.finalPrice / (l.quantity ?? 1)) * 100) / 100)} per head`);
    if (ctx.consignment && l.consignor) bits.push(`consignor credit ${money(ctx.lots[k].credit)} to ${l.consignor} (${100 - ctx.commissionPct}% of hammer)`);
    return { name: l.title, amount: l.finalPrice ?? 0, description: `${bits.join("; ")}.` };
  });
  if (ctx.premium > 0) lines.push({ name: `Buyer's premium (${ctx.premiumPct}%)`, amount: ctx.premium, description: `${ctx.premiumPct}% of the ${money(ctx.hammer)} hammer total.` });
  return lines;
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
