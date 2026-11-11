// The Gala Report agent team, built on the Studio Agent Framework.
//
// Studio ships five built-in agents (lead, data, page, widget, planning). We keep that whole team,
// run every one of them on a Gemini adapter (directLlmRunner), and make the lead a "gala analyst":
// the built-in lead prompt plus the auction's domain rules and a nudge towards our two custom
// widgets. The lead delegates to the built-ins via delegateTo, as in the stock harness.

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter } from "ag-studio";
import { geminiAdapter } from "./gemini-adapter";

const GALA_BRIEF = `You are the Gala Report analyst for "Going Twice", an AI auctioneer for school charity auctions. The reader is the PTA chair.
Domain: every bidder paddle is a PayPal authorization HOLD. Winners are CAPTURED (never more than their hold), all other holds are RELEASED (voided), and the captured total is PAID OUT to the PTA treasurer.
Tables: lots (final price, fmv = estimated fair market value, aboveFmv = tax-deductible donation part, bids, secondsToSold), events (bid log), ledger (PayPal money movements; stage = Held / Captured / Released / Paid out), paddles (hold, committed, captured, PayPal status).
Rules: money is USD. Prefer the custom widgets: use widget type "money-flow" for anything about held vs captured vs released vs paid out, and "paddle-board" for per-paddle holds, commitments or captures. When asked a question, add or edit widgets on the page so the answer is visible, then state the answer in one or two plain sentences with the actual numbers (use the query tool to get them). "Sold above estimate" means lots where finalPrice > fmv (field lots.beatFmv = "Above estimate"). Be brief and warm.`;

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Sold above estimate", prompt: "Which lots sold above their estimated value?" },
  { label: "Captured vs released", prompt: "Show captured vs released by paddle" },
  { label: "Money story", prompt: "Add the money flow widget and tell me how much was held, captured, released and paid out." },
];

export function buildGalaAi(): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) =>
    createAiHarness(api, ({ builtIn }) => ({
      agents: [
        directLlmRunner({
          ...builtIn.lead,
          id: "lead",
          name: "Gala analyst",
          adapter,
          instructions: (ctx, params) => `${GALA_BRIEF}\n\n${builtIn.lead.instructions?.(ctx, params) ?? ""}`,
        }),
        directLlmRunner({ ...builtIn.data, adapter }),
        directLlmRunner({ ...builtIn.widget, adapter }),
        directLlmRunner({ ...builtIn.page, adapter }),
        directLlmRunner({ ...builtIn.planning, adapter }),
      ],
      primary: "lead",
      promptStarters: PROMPT_STARTERS,
    }));
}
