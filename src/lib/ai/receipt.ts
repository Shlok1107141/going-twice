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

export async function writeReceipt(name: string, items: ReceiptItem[], sales?: SalesContext): Promise<string> {
  if (sales) return writeSalesReceipt(name, sales);
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

// ---------------------------------------------------------------- sales receipts (non-charity)

/** Code-computed numbers for a sales receipt: hammer, premium, total, and (estate) the consignor credit. */
export type SalesContext = {
  orgName: string;
  premiumPct: number;
  hammer: number;
  premium: number;
  total: number;
  consignment: boolean;
  commissionPct: number;
  lots: { title: string; hammer: number; consignor?: string; credit: number; unit?: "head" | "lot"; quantity?: number }[];
};

const SALES_NOTE = "This is a sales receipt for goods purchased at auction, not a donation receipt.";

function salesLines(c: SalesContext): string[] {
  const lines = c.lots.map((l) => {
    const head = l.unit === "head" && (l.quantity ?? 0) > 1 ? ` (${l.quantity} head, ${money(Math.round((l.hammer / (l.quantity ?? 1)) * 100) / 100)} per head)` : "";
    const credit = c.consignment && l.consignor ? `; consignor credit ${money(l.credit)} to ${l.consignor} (${100 - c.commissionPct}% of hammer)` : "";
    return `${l.title}: hammer ${money(l.hammer)}${head}${credit}.`;
  });
  lines.push(`Hammer total: ${money(c.hammer)}.`);
  if (c.premium > 0) lines.push(`Buyer's premium (${c.premiumPct}%): ${money(c.premium)}.`);
  lines.push(`Total charged: ${money(c.total)}.`);
  return lines;
}

export function templateSalesReceipt(name: string, c: SalesContext): string {
  return [`Thank you, ${name}! Sales receipt from ${c.orgName}.`, ...salesLines(c), SALES_NOTE].join("\n");
}

export async function writeSalesReceipt(name: string, c: SalesContext): Promise<string> {
  const facts = salesLines(c).join("\n");
  const reply = await callClaude({
    system:
      "You write short, warm sales receipts for an auction house. Use EXACTLY the numbers given; never invent or change amounts. " +
      "This is a purchase, not a donation: do not mention tax deductions. Plain text, at most 70 words, no markdown.",
    user: `Buyer: ${name}\nSeller: ${c.orgName}\nFacts:\n${facts}\nWrite a thank-you receipt that lists each lot, the hammer price${c.premium > 0 ? ", the buyer's premium" : ""} and the total charged.`,
    maxTokens: 200,
    timeoutMs: 4000,
  });
  return reply ? `${reply.trim()}\n\n${facts}\n${SALES_NOTE}` : templateSalesReceipt(name, c);
}
