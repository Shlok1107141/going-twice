// Webhooks: verify via PayPal's verify-webhook-signature API, then hand typed events to the app.
import { paypalRequest } from "./client";

export const WEBHOOK_EVENTS = {
  ORDER_APPROVED: "CHECKOUT.ORDER.APPROVED",
  AUTHORIZATION_CREATED: "PAYMENT.AUTHORIZATION.CREATED",
  AUTHORIZATION_VOIDED: "PAYMENT.AUTHORIZATION.VOIDED",
  CAPTURE_COMPLETED: "PAYMENT.CAPTURE.COMPLETED",
  CAPTURE_PENDING: "PAYMENT.CAPTURE.PENDING",
  CAPTURE_DECLINED: "PAYMENT.CAPTURE.DECLINED",
  PAYOUTS_BATCH_SUCCESS: "PAYMENT.PAYOUTSBATCH.SUCCESS",
  PAYOUTS_BATCH_DENIED: "PAYMENT.PAYOUTSBATCH.DENIED",
  PAYOUTS_ITEM_SUCCEEDED: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  PAYOUTS_ITEM_UNCLAIMED: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  PAYOUTS_ITEM_FAILED: "PAYMENT.PAYOUTS-ITEM.FAILED",
  INVOICE_PAID: "INVOICING.INVOICE.PAID",
} as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[keyof typeof WEBHOOK_EVENTS] | (string & {});

export interface PayPalWebhookEvent<R = Record<string, unknown>> {
  id: string;
  event_type: WebhookEventType;
  resource_type?: string;
  summary?: string;
  create_time?: string;
  resource: R;
}

/**
 * Verify a webhook delivery. Pass the RAW request body (await req.text()), not re-serialised JSON:
 * PayPal checks the signature against the exact bytes, so we splice the raw text into the request.
 * Note: events from the dashboard Webhooks Simulator can never pass (webhook_id "WEBHOOK_ID").
 */
export async function verifyWebhookSignature(args: {
  headers: Headers;
  rawBody: string;
  webhookId?: string;
}): Promise<boolean> {
  const webhookId = args.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");

  const h = (name: string) => args.headers.get(name) ?? "";
  const fields = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (!fields.transmission_id || !fields.transmission_sig) return false;

  const rawBody =
    JSON.stringify(fields).slice(0, -1) + `,"webhook_event":${args.rawBody.trim()}}`;

  const res = await paypalRequest<{ verification_status: "SUCCESS" | "FAILURE" }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    { rawBody, requestId: `verify:${fields.transmission_id}`, representation: false },
  );
  return res.verification_status === "SUCCESS";
}

/** Verify and parse in one step. Returns null if the signature is invalid. */
export async function readVerifiedEvent(req: Request, webhookId?: string): Promise<PayPalWebhookEvent | null> {
  const rawBody = await req.text();
  const ok = await verifyWebhookSignature({ headers: req.headers, rawBody, webhookId });
  return ok ? (JSON.parse(rawBody) as PayPalWebhookEvent) : null;
}
