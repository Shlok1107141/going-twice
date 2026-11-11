// Donation receipt text per winner. Numbers (paid, FMV estimate, difference) are computed in
// code and given to Claude; Claude only phrases them. Fallback is a fixed template.
import { callClaude } from "./claude";
import { money } from "./auctioneer";

export const SCHOOL_NAME = "Maple Street Elementary PTA (placeholder nonprofit)";

export type ReceiptItem = { title: string; paid: number; fmv: number; listings?: number };

const DISCLAIMER =
  "The fair market value shown is a good-faith estimate by the organizer, not an appraisal or tax advice. " +
  "Please consult a tax adviser about any deduction.";

function lineFor(i: ReceiptItem): string {
  const excess = Math.max(0, Math.round((i.paid - i.fmv) * 100) / 100);
  const via = i.listings ? ` (estimated from ${i.listings} retail listings via Channel3)` : "";
  return `${i.title}: paid ${money(i.paid)}; goods and services received, estimated FMV ${money(i.fmv)}${via}; amount above estimated FMV ${money(excess)}.`;
}

export function templateReceipt(name: string, items: ReceiptItem[]): string {
  const total = items.reduce((s, i) => s + i.paid, 0);
  return [
    `Thank you, ${name}! Donation receipt from ${SCHOOL_NAME}.`,
    ...items.map(lineFor),
    `Total paid: ${money(Math.round(total * 100) / 100)}.`,
    DISCLAIMER,
  ].join("\n");
}

export async function writeReceipt(name: string, items: ReceiptItem[]): Promise<string> {
  const facts = items.map(lineFor).join("\n");
  const reply = await callClaude({
    system:
      "You write short, warm donation receipts for a school charity auction. Use EXACTLY the numbers given; never invent or change amounts. " +
      "Plain text, at most 90 words, no markdown.",
    user: `Donor: ${name}\nOrganization: ${SCHOOL_NAME}\nFacts:\n${facts}\nWrite a thank-you receipt that lists each item, amount paid, and estimated fair market value of goods and services received.`,
    maxTokens: 220,
    timeoutMs: 4000,
  });
  // The disclaimer and the exact figures are always appended by code, whatever Claude wrote.
  return reply ? `${reply.trim()}\n\n${facts}\n${DISCLAIMER}` : templateReceipt(name, items);
}
