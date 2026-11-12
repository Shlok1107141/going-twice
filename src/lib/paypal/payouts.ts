// Payouts v1: send auction proceeds to the organizer (email, phone, or Venmo handle).
import { paypalRequest, toAmount, type Link } from "./client";

export type PayoutRecipientType = "EMAIL" | "PHONE" | "USER_HANDLE" | "PAYPAL_ID";
export type PayoutWallet = "PAYPAL" | "VENMO";

export interface PayoutItemInput {
  recipientType: PayoutRecipientType;
  /** user@example.com | +15555550123 | @venmohandle | PAYPALUSERID */
  receiver: string;
  amount: number | string;
  note?: string;
  /** Our id for this line; unique within the batch. */
  senderItemId?: string;
  /** VENMO is US/USD only; use with EMAIL, PHONE or USER_HANDLE. Default PayPal. */
  wallet?: PayoutWallet;
}

export interface CreatePayoutBatchInput {
  /** Idempotency key: PayPal rejects a reused sender_batch_id for 30 days. Use e.g. `close:${auctionId}`. */
  senderBatchId: string;
  /** PayPal-Request-Id; default `payout:<senderBatchId>`. A retry after a refused batch passes a fresh one. */
  requestId?: string;
  emailSubject?: string;
  emailMessage?: string;
  items: PayoutItemInput[];
}

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED" | "NEW";
  sender_batch_header: { sender_batch_id: string; email_subject?: string };
  amount?: { currency: string; value: string };
  fees?: { currency: string; value: string };
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  transaction_status?: string; // SUCCESS | UNCLAIMED | PENDING | FAILED | RETURNED | ONHOLD | BLOCKED | REFUNDED
  payout_item: {
    recipient_type: PayoutRecipientType;
    receiver: string;
    amount: { currency: string; value: string };
    note?: string;
    sender_item_id?: string;
    recipient_wallet?: string;
  };
  errors?: { name?: string; message?: string };
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items?: PayoutItem[];
  links?: Link[];
}

export async function createPayoutBatch(input: CreatePayoutBatchInput): Promise<PayoutBatch> {
  if (input.items.length === 0) throw new Error("Payout batch needs at least one item");
  const body = {
    sender_batch_header: {
      sender_batch_id: input.senderBatchId,
      email_subject: input.emailSubject ?? "Your Going Twice auction proceeds",
      ...(input.emailMessage ? { email_message: input.emailMessage } : {}),
    },
    items: input.items.map((it, i) => ({
      recipient_type: it.recipientType,
      receiver: it.receiver,
      amount: { value: toAmount(it.amount), currency: "USD" },
      note: it.note ?? "Going Twice auction proceeds",
      sender_item_id: it.senderItemId ?? `${input.senderBatchId}-${i + 1}`,
      // Docs spell the wallet value "Venmo"; omit for the PayPal default.
      ...(it.wallet === "VENMO" ? { recipient_wallet: "Venmo" } : {}),
    })),
  };
  return paypalRequest<PayoutBatch>("POST", "/v1/payments/payouts", {
    body,
    requestId: input.requestId ?? `payout:${input.senderBatchId}`,
    representation: false,
  });
}

/** Poll until batch_status is SUCCESS/DENIED/CANCELED (or rely on PAYMENT.PAYOUTSBATCH.* webhooks). */
export async function getPayoutBatch(payoutBatchId: string): Promise<PayoutBatch> {
  return paypalRequest<PayoutBatch>(
    "GET",
    `/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`,
  );
}

export async function getPayoutItem(payoutItemId: string): Promise<PayoutItem> {
  return paypalRequest<PayoutItem>(
    "GET",
    `/v1/payments/payouts-item/${encodeURIComponent(payoutItemId)}`,
  );
}
