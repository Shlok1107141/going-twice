// In-memory auction stores, one per room (see room.ts), on globalThis (survives Next dev HMR),
// with optional write-behind JSON persistence in .data/state-<ROOM>.json so a Render restart
// doesn't wipe a demo. Disable persistence with PERSIST=0. Single instance only.
// Up to MAX_ROOMS rooms are kept in memory; the least recently used is evicted (still on disk).
import fs from "node:fs";
import path from "node:path";
import { currentRoom } from "./room";
import { DEFAULT_AUCTION_TYPE, defaultSettings, typeConfig } from "./auctionTypes";
import type { AuctionEvent, AuctionSettings, AuctionType, Internal, LedgerRow, Lot, State } from "./types";

export * from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const dataFile = (room: string) => path.join(DATA_DIR, `state-${room}.json`);
const MAX_EVENTS = 50;
const MAX_ROOMS = 200;

type Store = { state: State; internal: Internal };
const g = globalThis as unknown as {
  __gtRooms?: Map<string, Store>; // insertion order = recency (re-inserted on access)
  __gtSaveTimers?: Map<string, ReturnType<typeof setTimeout>>;
  __gtIdIndex?: Map<string, string>; // PayPal id -> room (webhooks carry no room)
};
const rooms = () => (g.__gtRooms ??= new Map());
const timers = () => (g.__gtSaveTimers ??= new Map());
const idIndex = () => (g.__gtIdIndex ??= new Map());

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

/** Sandbox buyer emails (env SANDBOX_BUYER_1..3 = "email:password"); only the email part is ever read. */
export function sandboxBuyerEmails(): string[] {
  return [1, 2, 3]
    .map((n) => process.env[`SANDBOX_BUYER_${n}`]?.split(":")[0]?.trim())
    .filter((e): e is string => !!e && e.includes("@"));
}

function seedLots(type: AuctionType): Lot[] {
  const base = { status: "pending" as const, highBid: 0, phase: "bidding" as const };
  return typeConfig(type).lots.map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    emoji: l.emoji,
    startPrice: l.startPrice,
    increment: l.increment,
    ...(l.fmv !== undefined ? { fmv: l.fmv } : {}),
    ...(l.consignor ? { consignor: l.consignor } : {}),
    ...(l.unit ? { unit: l.unit } : {}),
    ...(l.quantity ? { quantity: l.quantity } : {}),
    ...base,
  }));
}

export type NewAuctionOptions = {
  type?: AuctionType;
  settings?: Partial<AuctionSettings>;
  organizerEmail?: string;
  /** One email per consignor, in order of first appearance across the lots. */
  consignorEmails?: string[];
};

function freshStore(o: NewAuctionOptions = {}): Store {
  const type = o.type ?? DEFAULT_AUCTION_TYPE;
  const lots = seedLots(type);
  const settings: AuctionSettings = { ...defaultSettings(type), ...o.settings };
  const consignors: Record<string, string> = {};
  if (typeConfig(type).payoutPlan === "consignment") {
    const list = o.consignorEmails?.length ? o.consignorEmails : sandboxBuyerEmails();
    const groups: string[] = [];
    for (const l of lots) if (l.consignor && !groups.includes(l.consignor)) groups.push(l.consignor);
    for (const l of lots) {
      const email = l.consignor && list.length ? list[groups.indexOf(l.consignor) % list.length] : undefined;
      if (email) consignors[l.id] = email;
    }
  }
  const organizer = o.organizerEmail || process.env.TREASURER_PAYPAL_EMAIL || process.env.TREASURER_RECEIVER || undefined;
  return {
    state: {
      status: "lobby",
      auctionType: type,
      settings,
      demoMode: isDemoMode(),
      testCards: testCardsAllowed(),
      lots,
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
      payout: { ...(organizer ? { organizer } : {}), consignors },
      webhookIds: [],
    },
  };
}

function indexLedger(room: string, st: Store): void {
  for (const r of st.state.ledger) if (r.paypalId) idIndex().set(r.paypalId, room);
}

function readFile(file: string): Store | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Store;
    return parsed?.state?.lots && parsed?.internal?.auctionId ? parsed : null;
  } catch {
    return null; // no file / unreadable
  }
}

function load(room: string): Store {
  if (persistEnabled()) {
    const parsed = readFile(dataFile(room));
    if (parsed) {
      parsed.state.demoMode = isDemoMode();
      parsed.state.testCards = testCardsAllowed();
      // Rooms persisted before auction types existed are charity galas.
      parsed.state.auctionType ??= DEFAULT_AUCTION_TYPE;
      parsed.state.settings ??= defaultSettings(parsed.state.auctionType);
      return parsed;
    }
  }
  return freshStore();
}

/** A room with nothing in it (no paddles, no ledger) can be dropped from memory at no cost. */
const isEmptyRoom = (st: Store) => st.state.paddles.length === 0 && st.state.ledger.length === 0;

function evict(m: Map<string, Store>, keep: string): void {
  while (m.size > MAX_ROOMS) {
    // Least recently used first; without persistence, never drop a room that holds paddles/money
    // while an empty one can go instead (an evicted room would be lost, holds and all).
    let victim: string | undefined;
    for (const [code, st] of m) {
      if (code === keep) continue;
      if (persistEnabled() || isEmptyRoom(st)) {
        victim = code;
        break;
      }
    }
    if (!victim) {
      if (m.size <= MAX_ROOMS * 2) return; // every room is live and unpersisted: allow a soft overflow
      victim = m.keys().next().value as string;
      console.warn(`[store] evicting live room ${victim} (over ${MAX_ROOMS * 2} rooms, PERSIST=0)`);
    }
    flush(victim);
    m.delete(victim);
  }
}

function store(): Store {
  const room = currentRoom();
  const m = rooms();
  let st = m.get(room);
  if (st) {
    m.delete(room); // move to most-recent position
  } else {
    st = load(room);
    indexLedger(room, st);
  }
  m.set(room, st);
  evict(m, room);
  return st;
}

// Read-only view of a never-used room: one shared pristine lobby per type, so polling random room codes
// (or a cold Render instance answering /api/state) never allocates, writes or evicts anything.
const pristine = globalThis as unknown as { __gtPristine?: State };

/** State for GET requests: the room if it exists (memory or disk), else a shared pristine lobby. */
export function peekState(): State {
  const room = currentRoom();
  if (rooms().has(room) || (persistEnabled() && fs.existsSync(dataFile(room)))) return store().state;
  return (pristine.__gtPristine ??= freshStore().state);
}

/** Rooms currently held in memory (diagnostics / break tests). */
export function roomCount(): number {
  return rooms().size;
}

/** Room that holds a PayPal id (authorization / capture / payout batch / invoice), if any. */
export function roomForPaypalId(...ids: Array<string | undefined>): string | undefined {
  for (const id of ids) {
    const hit = id ? idIndex().get(id) : undefined;
    if (hit) return hit;
  }
  if (persistEnabled()) {
    // Not in memory (evicted or after a restart): scan persisted rooms.
    try {
      for (const f of fs.readdirSync(DATA_DIR)) {
        const m = /^state-([A-Z0-9]{1,12})\.json$/.exec(f);
        if (!m || rooms().has(m[1])) continue;
        const st = readFile(path.join(DATA_DIR, f));
        if (!st) continue;
        indexLedger(m[1], st);
        for (const id of ids) if (id && idIndex().get(id) === m[1]) return m[1];
      }
    } catch {
      // no data dir
    }
  }
  return undefined;
}

export function getState(): State {
  return store().state;
}

export function getInternal(): Internal {
  return store().internal;
}

/** Fresh auction, optionally of another type (new auctionId, so PayPal idempotency keys never collide across rehearsals). */
export function resetStore(o?: NewAuctionOptions): State {
  const fresh = freshStore(o);
  const room = currentRoom();
  rooms().delete(room);
  rooms().set(room, fresh);
  save();
  return fresh.state;
}

export function nextId(prefix: string): string {
  const i = store().internal;
  i.seq += 1;
  return `${prefix}-${i.seq}`;
}

function flush(room: string): void {
  const t = timers().get(room);
  if (t) clearTimeout(t);
  timers().delete(room);
  const st = rooms().get(room);
  if (!st || !persistEnabled()) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = dataFile(room) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, dataFile(room));
  } catch (e) {
    console.error("[store] persist failed:", (e as Error).message);
  }
}

/** Write-behind persistence (coalesced per room). Call after every mutation. */
export function save(): void {
  const room = currentRoom();
  if (!persistEnabled() || timers().has(room)) return;
  timers().set(room, setTimeout(() => flush(room), 150));
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
  if (r.paypalId) idIndex().set(r.paypalId, currentRoom());
  recomputeTotals();
  return r;
}

const cents = (n: number) => Math.round(n * 100);
const dollars = (c: number) => c / 100;

/** Ledger statuses that mean no money moved (failed, waiting for a retry, or replaced by a retry). */
export const NO_MONEY_STATUSES = ["FAILED", "PENDING_RETRY", "RETRIED", "DENIED"];
const MONEY_MOVED = (status: string) => !NO_MONEY_STATUSES.includes(status);

/** Totals are derived from paddles + ledger so they can never drift. */
export function recomputeTotals(): void {
  const s = getState();
  let held = 0, captured = 0, voided = 0, paidOut = 0;
  for (const p of s.paddles) if (p.status === "held") held += cents(p.holdAmount);
  for (const r of s.ledger) {
    if (!MONEY_MOVED(r.status)) continue;
    if (r.kind === "captured") captured += cents(r.amount);
    else if (r.kind === "voided") voided += cents(r.amount);
    else if (r.kind === "payout") paidOut += cents(r.amount);
  }
  s.totals = { held: dollars(held), captured: dollars(captured), voided: dollars(voided), paidOut: dollars(paidOut) };
  save();
}
