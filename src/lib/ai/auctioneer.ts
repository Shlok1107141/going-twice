// "Gus", the auctioneer. Templated lines go to the caption instantly; on bid / stall / sold
// Claude adds a short follow-up quip (max one call in flight, 4 s timeout). Claude never
// decides pacing or money here: the engine owns phases, this module only writes words.
import { getState, setCaption } from "@/lib/auction/store";
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

export type GusContext = { lot?: string; name?: string; amount?: number; next?: number; extra?: string };

const LINES: Record<GusEvent, string[]> = {
  open: [
    "Next up: {lot}! We'll start at {amount}. Thumbs ready, people.",
    "Here comes {lot}. Opening at {amount}, and I have a good feeling about this room.",
    "Feast your eyes on {lot}. Who'll start me at {amount}?",
  ],
  stall: [
    "I see a lot of phones and not a lot of thumbs. The library fund can feel that, you know.",
    "It's very quiet in here. This is a gym. It has never once been this quiet.",
    "{lot} is sitting at {amount}. That's less than you spent on the last book fair, and you got erasers.",
    "I can wait. I've sat through a three-hour recorder concert. I can absolutely wait.",
    "Somebody out there is doing math. Stop doing math. It's for the kids.",
  ],
  bid: [
    "{amount} from {name}! Look at that. Decisive. Somebody had coffee.",
    "{name} is in at {amount}! Do I hear {next}? I have excellent hearing.",
    "Ooh, {name} takes it back at {amount}. This just got personal, in a friendly, bake-sale kind of way.",
    "{amount}! Thank you, {name}. That's about four new library books and you're not even done.",
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
    "Sold to {name}! Everybody else, your holds are released. Go get a brownie.",
    "And that's sold for {amount}! {name}, the PTA thanks you, and so does whoever was going to chase your check.",
  ],
  unsold: [
    "No takers for {lot}? It goes back on the shelf. Its feelings are only slightly hurt.",
  ],
  close: [
    "That's a wrap! Winners are charged exactly what they won, everyone else's hold is released, and the money is on its way to the PTA. Thank you!",
  ],
};

const ENRICH: ReadonlySet<GusEvent> = new Set<GusEvent>(["bid", "agent-bid", "stall", "sold"]);

const g = globalThis as unknown as { __gusRot?: Record<string, number>; __gusInflight?: boolean };

export function money(n: number | undefined): string {
  if (n === undefined) return "";
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}

function fill(t: string, c: GusContext): string {
  return t
    .replaceAll("{lot}", c.lot ?? "this lot")
    .replaceAll("{name}", c.name ?? "our bidder")
    .replaceAll("{amount}", money(c.amount) || "this price")
    .replaceAll("{next}", money(c.next) || "more");
}

export function templateLine(kind: GusEvent, c: GusContext): string {
  const list = LINES[kind];
  const rot = (g.__gusRot ??= {});
  const i = rot[kind] ?? Math.floor(Math.random() * list.length);
  rot[kind] = (i + 1) % list.length;
  return fill(list[i % list.length], c);
}

const SYSTEM =
  "You are Gus, the warm, funny, slightly over-caffeinated volunteer auctioneer at an elementary school charity gala. " +
  "Keep it school-appropriate and kind: tease the room, never a person; no mention of money moving, cards or fees. " +
  "Reply with ONE spoken follow-up line of at most 18 words. No quotes, no emoji, no stage directions.";

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
      `Next bid: ${money(c.next) || "-"}. ${c.extra ?? ""}\nYou just said: "${line}"\nAdd one short follow-up line.`;
    void callClaude({ system: SYSTEM, user, maxTokens: 80, timeoutMs: 4000 })
      .then((reply) => {
        const clean = reply?.replace(/^["']|["']$/g, "").split("\n")[0].trim();
        if (clean && clean.length <= 200 && getState().caption.ts === ts) setCaption(clean);
      })
      .finally(() => {
        g.__gusInflight = false;
      });
  }
  return line;
}
