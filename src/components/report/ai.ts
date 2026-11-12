// The Gala Report agent team, built on the Studio Agent Framework.
//
// Studio ships five built-in agents (lead, data, page, widget, planning). We keep that whole team,
// run every one of them on a Gemini adapter (directLlmRunner), and make the lead a "gala analyst":
// the built-in lead prompt plus the auction's domain rules and a nudge towards our two custom
// widgets. The lead delegates to the built-ins via delegateTo, as in the stock harness.

import { createAiHarness, directLlmRunner, type AgAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from "ag-studio";
import { geminiAdapter } from "./gemini-adapter";

const GALA_BRIEF = `You are the Gala Report analyst for "Going Twice", an AI auctioneer for live auctions of any kind (galas, estate sales, art fairs, farm sales). The reader is the organizer.
Domain: every bidder paddle is a PayPal authorization HOLD. Winners are CAPTURED (never more than their hold), all other holds are RELEASED (voided), and the captured total is PAID OUT to the organizer/beneficiary.
Tables: lots (final price, fmv = estimated fair market value, aboveFmv = tax-deductible donation part, bids, secondsToSold), events (bid log), ledger (PayPal money movements; stage = Held / Captured / Released / Paid out), paddles (hold, committed, captured, PayPal status).
Rules: money is USD. Prefer the custom widgets: use widget type "money-flow" for anything about held vs captured vs released vs paid out, and "paddle-board" for per-paddle holds, commitments or captures. When asked a question, add or edit widgets on the page so the answer is visible, then state the answer in one or two plain sentences with the actual numbers (use the query tool to get them). "Sold above estimate" means lots where finalPrice > fmv (field lots.beatFmv = "Above estimate"). Be brief and warm.`;

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Sold above estimate", prompt: "Which lots sold above their estimated value?" },
  { label: "Captured vs released", prompt: "Show captured vs released by paddle" },
  { label: "Bids per lot", prompt: "Add a widget for bids per lot" },
  { label: "Money story", prompt: "Add the money flow widget and tell me how much was held, captured, released and paid out." },
];

/** The prompt chips above the dashboard send the same prompts the chat panel's starters do. */
export const CHIP_PROMPTS = [
  "Which lots sold above estimated value?",
  "Show captured vs released by paddle",
  "Add a widget for bids per lot",
  "What was our time to settle?",
];

// The live harness, so the page's prompt chips can talk to the same agent team as the chat panel.
let activeHarness: AgAiHarness | null = null;

/** Send a prompt to the Studio agent (new thread). Resolves with the failure text, or null on success. */
export async function askAgent(prompt: string): Promise<string | null> {
  if (!activeHarness) return "The report agent is not ready yet.";
  try {
    const session = await activeHarness.createThread({ agentId: "lead", title: prompt.slice(0, 40) });
    session.sendMessage(prompt);
    return await new Promise<string | null>((resolve) => {
      const done = () => {
        if (session.status === "error") {
          session.removeEventListener("changed", done);
          resolve("The Studio agent hit an error.");
        } else if (session.status === "idle" && session.messages.some((m) => m.role === "assistant")) {
          session.removeEventListener("changed", done);
          resolve(null);
        }
      };
      session.addEventListener("changed", done);
      setTimeout(() => resolve(null), 90_000);
    });
  } catch (e) {
    return e instanceof Error ? e.message : "The Studio agent failed.";
  }
}

export function buildGalaAi(): AgAiHarnessSetup {
  const adapter = geminiAdapter();
  return ({ api }) => {
    const h = createAiHarness(api, ({ builtIn }) => ({
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
    activeHarness = h;
    return h;
  };
}
