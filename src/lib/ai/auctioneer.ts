// "Gus", the auctioneer. Templated lines go to the caption instantly; on bid / stall / sold
// Claude adds a short follow-up quip (max one call in flight, 4 s timeout). Claude never
// decides pacing or money here: the engine owns phases, this module only writes words.
import { getState, setCaption } from "@/lib/auction/store";
import { typeConfig } from "@/lib/auction/auctionTypes";
import { callClaude, claudeEnabled } from "./claude";

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
  extra?: string;
  /** estate: who the lot is from, e.g. "the Hendricks estate". */
  consignor?: string;
  /** farm: head count, so Gus can quote a per-head price. */
  unit?: "head" | "lot";
  quantity?: number;
};

const LINES: Record<GusEvent, string[]> = {
  open: [
    "Next up: {lot}! We'll start at {amount}. Thumbs ready, people.",
    "Here comes {lot}. Opening at {amount}, and I have a good feeling about this room.",
    "Feast your eyes on {lot}. Who'll start me at {amount}?",
  ],
  stall: [
    "I see a lot of phones and not a lot of thumbs. {organizer} can feel that, you know.",
    "It's very quiet in here. Somebody say something. Anything. Preferably a number.",
    "{lot} is sitting at {amount}. That's less than your last lunch out, and you didn't even get a story.",
    "I can wait. I've waited out longer silences than this. I can absolutely wait.",
    "Somebody out there is doing math. Stop doing math. It's for {beneficiary}.",
  ],
  bid: [
    "{amount} from {name}! Look at that. Decisive. Somebody had coffee.",
    "{name} is in at {amount}! Do I hear {next}? I have excellent hearing.",
    "Ooh, {name} takes it back at {amount}. This just got personal, in a friendly kind of way.",
    "{amount}! Thank you, {name}. That's a real help to {beneficiary} and you're not even done.",
    "We have {amount} from {name}, and I just watched three people reach for their phones.",
  ],
  "agent-bid": [
    "{amount} from the agent bidding for {name}, who is at home in pajamas and still beating you.",
    "The robot says {amount}! It's polite, it's on budget, and it does not get tired.",
    "{name}'s agent is back in at {amount}. It told me its limit. I'm not telling you.",
    "A bid from the couch! {amount} for {name}, by way of a very focused assistant.",
  ],
  "going-once": [
    "{amount}, going once. This is the part where you look at your neighbor.",
    "Going once... going twice... thumbs, people, thumbs...",
  ],
  "going-twice": ["Going twice at {amount}. Last call, and I mean it this time. Mostly."],
  sold: [
    "Sold! {lot} goes to {name} for {amount}. No line, no clipboard, you're already paid up.",
    "Sold to {name}! Everybody else, your holds are released. Go get a snack.",
    "And that's sold for {amount}! {name}, {organizer} thanks you, and so does whoever was going to chase your check.",
  ],
  unsold: [
    "No takers for {lot}? It goes back on the shelf. Its feelings are only slightly hurt.",
  ],
  close: [
    "That's a wrap on {event}! Winners are charged exactly what they won, everyone else's hold is released, and the proceeds are on their way to {beneficiary}. Thank you!",
  ],
};

const ENRICH: ReadonlySet<GusEvent> = new Set<GusEvent>(["bid", "agent-bid", "stall", "sold"]);

const g = globalThis as unknown as { __gusRot?: Record<string, number>; __gusInflight?: boolean };

export function money(n: number | undefined): string {
  if (n === undefined) return "";
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

function fill(t: string, c: GusContext): string {
  const ev = getState().event;
  return t
    .replaceAll("{organizer}", ev.organizer)
    .replaceAll("{beneficiary}", ev.beneficiary)
    .replaceAll("{event}", ev.name)
    .replaceAll("{lot}", c.lot ?? "this lot")
    .replaceAll("{name}", c.name ?? "our bidder")
    .replaceAll("{amount}", money(c.amount) || "this price")
    .replaceAll("{next}", money(c.next) || "more")
    .replaceAll("{consignor}", c.consignor ?? "the consignor")
    .replaceAll("{each}", c.unit === "head" && (c.quantity ?? 0) > 1 && c.amount ? `, that's ${money(Math.round((c.amount / (c.quantity ?? 1)) * 100) / 100)} a head` : "");
}

export function templateLine(kind: GusEvent, c: GusContext): string {
  const override = (typeConfig(getState().auctionType).gus.lines as Partial<Record<GusEvent, string[]>>)[kind];
  const list = override?.length ? override : LINES[kind];
  const rot = (g.__gusRot ??= {});
  const i = rot[kind] ?? Math.floor(Math.random() * list.length);
  rot[kind] = (i + 1) % list.length;
  return fill(list[i % list.length], c);
}

const REPLY_RULES =
  "Reply with exactly ONE short spoken line (at most 18 words) to be read aloud. Plain text only: no markdown, no lists, no quotes, no emoji, no stage directions.";

/** Per-type persona and vocabulary, plus the event's organizer and beneficiary names. */
function systemPrompt(): string {
  const st = getState();
  const cfg = typeConfig(st.auctionType);
  const ev = st.event;
  const where = `The event is "${ev.name}", run by ${ev.organizer}; proceeds go to ${ev.beneficiary}.`;
  if (cfg.type === "charity") {
    return (
      `You are Gus, the warm, funny, slightly over-caffeinated volunteer auctioneer at a charity auction. ${where} ` +
      "Keep it kind and family-friendly: tease the room, never a person; no mention of money moving, cards or fees. " +
      REPLY_RULES
    );
  }
  return (
    `You are Gus, ${cfg.gus.persona}. ${where} ` +
    `Keep it friendly and tasteful: tease the room, never a person; no mention of cards or payment mechanics. Vocabulary you may use: ${cfg.gus.vocabulary}. ` +
    REPLY_RULES
  );
}

/**
 * Say something now. Returns the template line (already on the caption). For lively events,
 * asynchronously asks Claude for a follow-up quip and posts it only if nothing newer was said.
 */
export function say(kind: GusEvent, c: GusContext): string {
  const line = templateLine(kind, c);
  const ts = setCaption(line);
  if (ENRICH.has(kind) && claudeEnabled() && !g.__gusInflight) {
    g.__gusInflight = true;
    const user =
      `Event: ${kind}. Lot: ${c.lot ?? "-"}. Bidder: ${c.name ?? "-"}. Amount: ${money(c.amount) || "-"}. ` +
      `Next bid: ${money(c.next) || "-"}. ${c.consignor ? `From: ${c.consignor}. ` : ""}${c.extra ?? ""}\nYou just said: "${line}"\nAdd one short follow-up line.`;
    void callClaude({ system: systemPrompt(), user, maxTokens: 80, timeoutMs: 4000, fast: true })
      .then((reply) => {
        const first = reply?.split("\n").map((l) => l.trim()).find(Boolean);
        const clean = first?.replace(/^["']|["']$/g, "").trim();
        if (clean && clean.length <= 200 && getState().caption.ts === ts) setCaption(clean);
      })
      .finally(() => {
        g.__gusInflight = false;
      });
  }
  return line;
}
