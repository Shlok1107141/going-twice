// "Gus", the auctioneer. One line per event, built in code from short sentences (see gusLines.ts) so the
// room hears it instantly and a new bid can cut him off mid-sentence. The model has exactly one job here:
// one sentence per lot that sells it, written ahead of time (falling back to the lot's own description).
// Gus never decides pacing or money: the engine owns phases, this module only chooses words.
import { getState, save, setCaption } from "@/lib/auction/store";
import { typeConfig } from "@/lib/auction/auctionTypes";
import { currentRoom } from "@/lib/auction/room";
import { callClaude, claudeEnabled, extractJson } from "./claude";
import { FIXED, FORMS, money } from "./gusLines";

export { money };

export type GusEvent =
  | "open"
  | "bid"
  | "agent-bid"
  | "stall"
  | "going-once"
  | "going-twice"
  | "sold"
  | "unsold"
  | "close";

export type GusContext = {
  lot?: string;
  name?: string;
  amount?: number;
  next?: number;
  /** True for the first bid on a lot. */
  first?: boolean;
  /** Position of the lot in the catalogue (1-based). */
  lotNo?: number;
  /** The lot's description; the fallback for the one model-written sentence. */
  description?: string;
  /** The one sentence the model wrote for this lot (see preparePitches). */
  pitch?: string;
  /** estate: who the lot is from, e.g. "the Hendricks estate". */
  consignor?: string;
  /** farm: head count, so Gus can quote a per-head price. */
  unit?: "head" | "lot";
  quantity?: number;
};

const g = globalThis as unknown as {
  __gusBag?: Map<string, number[]>;
  __gusLast?: Map<string, number>;
  __gusPitchBusy?: Set<string>;
  __gusPitchTried?: Set<string>;
};

/** Picks from a list without repeating until every option has been used (per room, per kind). */
function pick<T>(kind: string, list: readonly T[]): T {
  if (list.length === 1) return list[0];
  const bags = (g.__gusBag ??= new Map());
  const lasts = (g.__gusLast ??= new Map());
  const key = `${currentRoom()}:${kind}`;
  let bag = bags.get(key);
  if (!bag || bag.length === 0) {
    bag = list.map((_, i) => i).sort(() => Math.random() - 0.5);
    if (bag[bag.length - 1] === lasts.get(key)) bag.reverse(); // never the same line twice in a row
    bags.set(key, bag);
    if (bags.size > 2000) {
      bags.clear();
      lasts.clear();
      bags.set(key, bag);
    }
  }
  const i = bag.pop() as number;
  lasts.set(key, i);
  return list[i];
}

const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

export function templateLine(kind: GusEvent, c: GusContext): string {
  const premium = (getState().settings?.premiumPct ?? 0) > 0 && FIXED.premium[0];
  const name = c.name ?? "our bidder";
  const amount = FORMS.amount(money(c.amount) || "The bid");
  const ask = c.next !== undefined && FORMS.ask(money(c.next));
  const perHead = c.unit === "head" && (c.quantity ?? 0) > 1 && c.amount ? FORMS.perHead(money(Math.round(c.amount / (c.quantity ?? 1)))) : "";
  switch (kind) {
    case "open":
      return join(c.lotNo ? FORMS.lotNo(c.lotNo) : "", FORMS.title(c.lot ?? "The next lot"), c.consignor && FORMS.from(c.consignor), FORMS.opening(money(c.amount)), premium);
    case "bid": {
      const shape = c.first ? pick("first", [0, 1]) : pick("bid", [0, 1, 2, 3]);
      if (shape === 0) return join(amount, FORMS.name(name), ask, perHead);
      if (shape === 1) return join(FORMS.name(name), amount, ask, perHead);
      if (shape === 2) return join(pick("lead", FIXED.bidLead), amount, FORMS.name(name), perHead);
      return join(amount, FORMS.thanks(name), ask, perHead);
    }
    case "agent-bid":
      return join(amount, FORMS.agent(name), ask);
    case "stall":
      return pick("stall", FIXED.stall);
    case "going-once":
      return FIXED.goingOnce[0];
    case "going-twice":
      return pick("twice", FIXED.goingTwice);
    case "sold":
      return join(c.name ? FORMS.soldTo(c.name) : FIXED.sold[0], amount, premium);
    case "unsold":
      return pick("unsold", FIXED.unsold);
    case "close":
      return FIXED.close.join(" ");
  }
}

/** Per-type persona, plus the event's organizer and beneficiary names. */
function systemPrompt(): string {
  const st = getState();
  const cfg = typeConfig(st.auctionType);
  const ev = st.event;
  return (
    `You are Gus, ${cfg.gus.persona}. The event is "${ev.name}", run by ${ev.organizer}; proceeds go to ${ev.beneficiary}. ` +
    "For each lot you are given, write exactly ONE short sentence (at most 16 words) that makes the room want it. " +
    "Warm and plain, like a person talking. No prices, no numbers, no jokes about money, no emoji, no stage directions. " +
    'Reply ONLY with JSON {"pitches":["...","..."]}, one sentence per lot, in the same order.'
  );
}

function firstSentence(text: string | undefined): string {
  const s = (text ?? "").split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
  return s.length > 160 ? "" : s;
}

/**
 * The model's one job for Gus: a single sentence per lot, written ahead of time (one call for the whole
 * catalogue) so the stage can voice it before the lot opens. Each lot gets its own description as the
 * pitch at once, and the model's sentence replaces it when it arrives. Safe to call often.
 */
export async function preparePitches(): Promise<void> {
  const room = currentRoom();
  const busy = (g.__gusPitchBusy ??= new Set());
  const tried = (g.__gusPitchTried ??= new Set());
  if (busy.has(room)) return;
  const todo = getState()
    .lots.filter((l) => l.status === "pending" && !tried.has(`${room}:${l.id}`))
    .slice(0, 8);
  if (todo.length === 0) return;
  busy.add(room);
  try {
    if (tried.size > 5000) tried.clear();
    for (const l of todo) {
      tried.add(`${room}:${l.id}`);
      if (!l.pitch) l.pitch = firstSentence(l.description) || undefined;
    }
    save();
    if (!claudeEnabled()) return;
    const reply = await callClaude({
      system: systemPrompt(),
      user: todo.map((l, i) => `${i + 1}. ${l.title}: ${l.description}`).join("\n"),
      maxTokens: 400,
      timeoutMs: 9000,
    });
    const list = extractJson<{ pitches?: unknown }>(reply)?.pitches;
    if (!Array.isArray(list)) return;
    todo.forEach((l, i) => {
      const raw: unknown = list[i];
      const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").replace(/^["']|["']$/g, "").trim() : "";
      if (s && s.length <= 160 && !/[$\d]/.test(s) && l.status === "pending") l.pitch = s;
    });
    save();
  } finally {
    busy.delete(room);
  }
}

/** How long the opening line gets to itself before the one-sentence pitch follows it. */
const PITCH_AFTER_MS = 4200;

/** Say something now. Returns the line (already on the caption). */
export function say(kind: GusEvent, c: GusContext): string {
  const line = templateLine(kind, c);
  const ts = setCaption(line, kind);
  const pitch = kind === "open" ? c.pitch || firstSentence(c.description) : "";
  if (pitch) {
    const speed = Number(process.env.TICK_SPEED) > 0 ? Number(process.env.TICK_SPEED) : 1;
    // Only if nothing newer was said: a bid always wins over the pitch.
    setTimeout(() => {
      if (getState().caption.ts === ts) setCaption(pitch, "pitch");
    }, PITCH_AFTER_MS / speed);
  }
  return line;
}
