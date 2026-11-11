// Invoicing v2: a donation receipt per winner, sent as a PayPal invoice and marked paid
// against the capture (record-payment), so the winner gets a PayPal-native receipt.
import { paypalRequest, toAmount, CURRENCY, type Link, type Money } from "./client";

export interface ReceiptLine {
  name: string; // lot title (<= 200 chars)
  /** AI-written line, e.g. "Fair market value $120; tax-deductible portion $280." (<= 1000 chars) */
  description?: string;
  /** Winning bid. */
  amount: number | string;
}

export interface CreateReceiptInvoiceInput {
  /** Must be unique per merchant (DUPLICATE_INVOICE_NUMBER). e.g. `GT-${auctionId}-${paddleNo}`. */
  invoiceNumber: string;
  recipientEmail: string;
  recipientName?: { given_name?: string; surname?: string };
  lines: ReceiptLine[];
  /** Shown to the payer; good place for the AI-written FMV / thank-you text. */
  note?: string;
  /** Private memo for the organiser (e.g. capture id). */
  memo?: string;
  invoicerBusinessName?: string;
  /** Send the email to the winner (default true). */
  send?: boolean;
}

export interface Invoice {
  id: string;
  status: string; // DRAFT | SENT | SCHEDULED | PAID | MARKED_AS_PAID | PARTIALLY_PAID | CANCELLED ...
  detail?: { invoice_number?: string; metadata?: { recipient_view_url?: string; invoicer_view_url?: string } };
  amount?: Money;
  links?: Link[];
}

/** Create draft -> send. Returns the invoice id (record the payment next with recordPayment). */
export async function createAndSendReceiptInvoice(
  input: CreateReceiptInvoiceInput,
): Promise<{ invoiceId: string; invoice?: Invoice }> {
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    detail: {
      invoice_number: input.invoiceNumber.slice(0, 25),
      invoice_date: today,
      currency_code: CURRENCY,
      ...(input.note ? { note: input.note.slice(0, 4000) } : {}),
      ...(input.memo ? { memo: input.memo.slice(0, 500) } : {}),
      payment_term: { term_type: "DUE_ON_RECEIPT" },
    },
    ...(input.invoicerBusinessName
      ? { invoicer: { business_name: input.invoicerBusinessName.slice(0, 300) } }
      : {}),
    primary_recipients: [
      {
        billing_info: {
          email_address: input.recipientEmail,
          ...(input.recipientName ? { name: input.recipientName } : {}),
        },
      },
    ],
    items: input.lines.map((l) => ({
      name: l.name.slice(0, 200),
      ...(l.description ? { description: l.description.slice(0, 1000) } : {}),
      quantity: "1",
      unit_amount: { currency_code: CURRENCY, value: toAmount(l.amount) },
      unit_of_measure: "QUANTITY",
    })),
  };

  // Create returns either the full invoice (Prefer: return=representation) or a {rel:"self",href} link.
  const created = await paypalRequest<Invoice & { href?: string }>("POST", "/v2/invoicing/invoices", {
    body,
    requestId: `invoice:${input.invoiceNumber}`,
  });
  const invoiceId = created.id ?? created.href?.split("/").pop();
  if (!invoiceId) throw new Error("Invoice create returned no id");

  if (input.send !== false) {
    await paypalRequest("POST", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
      body: { send_to_invoicer: false, send_to_recipient: true },
      requestId: `invoice-send:${invoiceId}`,
      representation: false,
    });
  }
  return { invoiceId, invoice: created.id ? created : undefined };
}

export type InvoicePaymentMethod =
  | "PAYPAL"
  | "BANK_TRANSFER"
  | "CASH"
  | "CHECK"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "WIRE_TRANSFER"
  | "OTHER";

/** Mark the invoice paid with the amount already captured from the paddle. */
export async function recordPayment(
  invoiceId: string,
  input: { amount: number | string; method?: InvoicePaymentMethod; note?: string; paymentDate?: string },
): Promise<{ payment_id: string }> {
  return paypalRequest<{ payment_id: string }>(
    "POST",
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`,
    {
      body: {
        method: input.method ?? "PAYPAL",
        payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
        amount: { currency_code: CURRENCY, value: toAmount(input.amount) },
        ...(input.note ? { note: input.note.slice(0, 2000) } : {}),
      },
      requestId: `invoice-pay:${invoiceId}`,
    },
  );
}

export async function getInvoice(invoiceId: string): Promise<Invoice> {
  return paypalRequest<Invoice>("GET", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}
