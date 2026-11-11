// In-memory auction store on globalThis (survives Next dev HMR), with optional write-behind
// JSON persistence in .data/state.json so a Render restart doesn't wipe a demo.
// Disable persistence with PERSIST=0. Single instance only.
import fs from "node:fs";
import path from "node:path";
import type { AuctionEvent, Internal, LedgerRow, Lot, State } from "./types";

export * from "./types";

const DATA_FILE = path.join(process.cwd(), ".data", "state.json");
const MAX_EVENTS = 50;

type Store = { state: State; internal: Internal };
const g = globalThis as unknown as { __gtStore?: Store; __gtSaveTimer?: ReturnType<typeof setTimeout> };

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || !process.env.PAYPAL_CLIENT_ID;
}

/** Live PayPal against the sandbox: `testCard:true` paddles are allowed. */
export function testCardsAllowed(): boolean {
  return !isDemoMode() && (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase() === "sandbox";
}

function persistEnabled(): boolean {
  return process.env.PERSIST !== "0";
}

function seedLots(): Lot[] {
  const base = { status: "pending" as const, highBid: 0, phase: "bidding" as const };
  return [
    { id: "lot-principal", title: "Principal for a Day", emoji: "🎓",
      description: "Your child runs morning announcements, picks the lunch dessert, and gets the big chair.",
      startPrice: 50, increment: 10, fmv: 0, ...base },
    { id: "lot-pizza", title: "Family Pizza Night Basket", emoji: "🍕",
      description: "Two large pizzas, a board game, and movie-night snacks from a local pizzeria.",
      startPrice: 40, increment: 5, fmv: 75, ...base },
    { id: "lot-cabin", title: "Weekend Cabin Getaway", emoji: "🏕️",
      description: "Two nights at a family's lakeside cabin. Sleeps six. Canoe included.",
      startPrice: 200, increment: 25, fmv: 450, ...base },
    { id: "lot-quilt", title: "Signed Class Quilt", emoji: "🧵",
      description: "Hand-stitched by Room 4B, every square signed by a student.",
      startPrice: 75, increment: 10, fmv: 60, ...base },
  ];
}

function freshStore(): Store {
  return {
    state: {
      status: "lobby",
      demoMode: isDemoMode(),
      testCards: testCardsAllowed(),
      lots: seedLots(),
      paddles: [],
      events: [],
      caption: { text: "Welcome to the Maple Street gala! Grab a paddle and get those thumbs warmed up.", ts: Date.now() },
      ledger: [],
      totals: { held: 0, captured: 0, voided: 0, paidOut: 0 },
      receipts: [],
    },
    internal: {
      auctionId: Math.random().toString(36).slice(2, 8).toUpperCase(),
      seq: 0,
      lastActivityAt: Date.now(),
      stalled: false,
      payoutDone: false,
      webhookIds: [],
    },
  };
}

function load(): Store {
  if (persistEnabled()) {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw) as Store;
      if (parsed?.state?.lots && parsed?.internal?.auctionId) {
        parsed.state.demoMode = isDemoMode();
        parsed.state.testCards = testCardsAllowed();
        return parsed;
      }
    } catch {
      // no file / unreadable: start fresh
    }
  }
  return freshStore();
}

function store(): Store {
  if (!g.__gtStore) g.__gtStore = load();
  return g.__gtStore;
}

export function getState(): State {
  return store().state;
}

export function getInternal(): Internal {
  return store().internal;
}

/** Fresh auction (new auctionId, so PayPal idempotency keys never collide across rehearsals). */
export function resetStore(): State {
  g.__gtStore = freshStore();
  save();
  return g.__gtStore.state;
}

export function nextId(prefix: string): string {
  const i = store().internal;
  i.seq += 1;
  return `${prefix}-${i.seq}`;
}

/** Write-behind persistence (coalesced). Call after every mutation. */
export function save(): void {
  if (!persistEnabled() || g.__gtSaveTimer) return;
  g.__gtSaveTimer = setTimeout(() => {
    g.__gtSaveTimer = undefined;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(store()));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) {
      console.error("[store] persist failed:", (e as Error).message);
    }
  }, 150);
}

export function pushEvent(e: Omit<AuctionEvent, "id" | "ts">): AuctionEvent {
  const s = getState();
  const ev: AuctionEvent = { id: nextId("ev"), ts: Date.now(), ...e };
  s.events.push(ev);
  if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
  save();
  return ev;
}

/** Caption ts is strictly increasing so the stage always notices a new line. */
export function setCaption(text: string): number {
  const s = getState();
  const ts = Math.max(Date.now(), s.caption.ts + 1);
  s.caption = { text, ts };
  save();
  return ts;
}

export function addLedger(row: Omit<LedgerRow, "id" | "ts">): LedgerRow {
  const s = getState();
  const r: LedgerRow = { id: nextId("led"), ts: Date.now(), ...row };
  s.ledger.push(r);
  recomputeTotals();
  return r;
}

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;

/** Totals are derived from paddles + ledger so they can never drift. */
export function recomputeTotals(): void {
  const s = getState();
  let held = 0, captured = 0, voided = 0, paidOut = 0;
  for (const p of s.paddles) if (p.status === "held") held += cents(p.holdAmount);
  for (const r of s.ledger) {
    if (r.status === "FAILED") continue;
    if (r.kind === "captured") captured += cents(r.amount);
    else if (r.kind === "voided") voided += cents(r.amount);
    else if (r.kind === "payout") paidOut += cents(r.amount);
  }
  s.totals = { held: dollars(held), captured: dollars(captured), voided: dollars(voided), paidOut: dollars(paidOut) };
  save();
}
