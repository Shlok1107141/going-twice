// Absentee bidder decision. Claude may only answer "does this instruction want this lot, and
// should we bid now?" (plus a short reason). The AMOUNT is always computed by code (one
// increment over the high bid), capped by maxBid and the hold, and the engine re-validates it
// exactly like a human bid. Fallback: deterministic keyword heuristic.
import type { Lot, Paddle } from "@/lib/auction/types";
import { callClaude, claudeEnabled, extractJson } from "./claude";
import { money } from "./auctioneer";

export type AgentDecision = { bid: boolean; amount: number; reasoning: string };

/** Lowest legal bid on a lot (matches the UI's "next bid" formula). */
export function nextBidFor(lot: Lot): number {
  return lot.highPaddleId ? round2(lot.highBid + lot.increment) : lot.startPrice;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Effective cap: maxBid, tightened by any "$N" in the instruction text. */
export function agentCap(p: Paddle): number {
  const maxBid = p.agent?.maxBid ?? 0;
  const m = p.agent?.instruction.match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/);
  const fromText = m ? Number(m[1].replace(/,/g, "")) : NaN;
  return Number.isFinite(fromText) && fromText > 0 ? Math.min(maxBid, fromText) : maxBid;
}

const STOP = new Set(["with", "that", "this", "from", "for", "the", "and", "anything", "please", "up", "to", "bid", "max", "only", "your", "them", "they", "want", "would", "like", "some", "into"]);

function heuristicMatch(instruction: string, lot: Lot): boolean {
  const ins = instruction.toLowerCase();
  if (/\b(any|anything|everything|all lots)\b/.test(ins)) return true;
  const hay = `${lot.title} ${lot.description}`.toLowerCase();
  const words = ins.match(/[a-z]{4,}/g) ?? [];
  return words.some((w) => !STOP.has(w) && (hay.includes(w) || hay.includes(w.replace(/s$/, ""))));
}

export async function decideAgentBid(p: Paddle, lot: Lot): Promise<AgentDecision> {
  const instruction = p.agent?.instruction ?? "";
  const amount = nextBidFor(lot);
  const cap = agentCap(p);
  const headroom = round2(p.holdAmount - p.committed);

  // Hard limits first, in code. Claude is never asked to override these.
  if (p.agent?.lotId && p.agent.lotId !== lot.id) {
    return { bid: false, amount, reasoning: `Told to bid only on another lot, so I'm sitting on my hands for ${lot.title}.` };
  }
  if (amount > cap) {
    return { bid: false, amount, reasoning: `Next bid ${money(amount)} is over my limit of ${money(cap)}. Bowing out gracefully.` };
  }
  if (amount > headroom) {
    return { bid: false, amount, reasoning: `Next bid ${money(amount)} would exceed the paddle's remaining hold of ${money(headroom)}.` };
  }

  if (claudeEnabled()) {
    const reply = await callClaude({
      system:
        "You decide for an absentee bidder at a school charity auction. Given the bidder's instruction and one lot, " +
        'reply ONLY with JSON {"match":boolean,"bid":boolean,"reasoning":string}. match = the instruction wants this lot. ' +
        "bid = match and bidding the stated amount now fits the instruction. reasoning: one friendly sentence, under 25 words.",
      user:
        `Instruction: "${instruction}"\nLot: ${lot.title} — ${lot.description}\n` +
        `Next bid would be ${money(amount)} (code-checked to be within the bidder's ${money(cap)} limit).`,
      maxTokens: 120,
      timeoutMs: 4000,
    });
    const j = extractJson<{ match?: unknown; bid?: unknown; reasoning?: unknown }>(reply);
    if (j && typeof j.match === "boolean" && typeof j.bid === "boolean") {
      const reasoning = typeof j.reasoning === "string" && j.reasoning.trim() ? j.reasoning.trim().slice(0, 240) : "";
      const bid = j.match && j.bid;
      return {
        bid,
        amount,
        reasoning: reasoning || (bid ? `Bidding ${money(amount)} on ${lot.title}.` : `Passing on ${lot.title}.`),
      };
    }
  }

  const match = heuristicMatch(instruction, lot);
  return match
    ? { bid: true, amount, reasoning: `${lot.title} matches "${instruction}". Bidding ${money(amount)}, still under my ${money(cap)} limit.` }
    : { bid: false, amount, reasoning: `${lot.title} isn't what I was asked to bid on.` };
}
