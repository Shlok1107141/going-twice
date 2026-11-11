// Payments v2 authorizations: capture (at the gavel), void (non-winners), reauthorize (stretch).
import { PayPalError, paypalRequest, toCents, usd, type Link, type Money } from "./client";

export interface Authorization {
  id: string;
  status: string; // CREATED | CAPTURED | PARTIALLY_CAPTURED | VOIDED | DENIED | EXPIRED | PENDING
  amount: Money;
  custom_id?: string;
  expiration_time?: string;
  create_time?: string;
  links?: Link[];
}

export interface Capture {
  id: string;
  status: "COMPLETED" | "PENDING" | "DECLINED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "FAILED";
  amount: Money;
  final_capture?: boolean;
  invoice_id?: string;
  custom_id?: string;
  status_details?: { reason?: string };
  create_time?: string;
  links?: Link[];
}

export async function getAuthorization(authorizationId: string): Promise<Authorization> {
  return paypalRequest<Authorization>(
    "GET",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`,
  );
}

export interface CaptureInput {
  amount: number | string;
  /** true = this is the only/last capture; PayPal releases the unused remainder of the hold. */
  finalCapture?: boolean;
  /** Unique per capture (PayPal rejects duplicates: DUPLICATE_INVOICE_ID). */
  invoiceId?: string;
  noteToPayer?: string;
  /** Up to 22 chars, shown on card statements. */
  softDescriptor?: string;
  requestId?: string;
}

/**
 * Capture `amount` (<= authorized; PayPal allows up to 115% / +$75 over, but we never rely on it).
 * Default idempotency key is per authorization + amount, so a retried hammer can't double-charge.
 */
export async function captureAuthorization(
  authorizationId: string,
  input: CaptureInput,
): Promise<Capture> {
  if (toCents(input.amount) <= 0) throw new Error("Capture amount must be > 0 (void instead)");
  const amount = usd(input.amount);
  try {
    return await paypalRequest<Capture>(
      "POST",
      `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
      {
        body: {
          amount,
          final_capture: input.finalCapture ?? true,
          ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
          ...(input.noteToPayer ? { note_to_payer: input.noteToPayer.slice(0, 255) } : {}),
          ...(input.softDescriptor ? { soft_descriptor: input.softDescriptor.slice(0, 22) } : {}),
        },
        requestId: input.requestId ?? `capture:${authorizationId}:${amount.value}`,
      },
    );
  } catch (e) {
    // A retry after a network timeout can hit 422 DUPLICATE_TRANSACTION / DUPLICATE_INVOICE_ID /
    // AUTHORIZATION_ALREADY_CAPTURED even though the first attempt succeeded at PayPal. Recover the
    // existing capture instead of leaving the winner's money in limbo; rethrow if there is none.
    const err = e as PayPalError;
    const dup = err instanceof PayPalError && err.status === 422 &&
      /DUPLICATE|ALREADY_CAPTURED|PREVIOUSLY_CAPTURED/i.test(`${err.issue ?? ""} ${err.paypalName ?? ""} ${err.message}`);
    if (!dup) throw e;
    const existing = await findExistingCapture(authorizationId, amount.value);
    if (existing) return existing;
    throw e;
  }
}

/** Look up a capture already made against this authorization (via its order), matching the amount. */
async function findExistingCapture(authorizationId: string, value: string): Promise<Capture | null> {
  const auth = await getAuthorization(authorizationId);
  const orderId = (auth as unknown as { supplementary_data?: { related_ids?: { order_id?: string } } })
    .supplementary_data?.related_ids?.order_id;
  if (!orderId) return null;
  const order = await paypalRequest<{
    purchase_units?: Array<{ payments?: { captures?: Capture[] } }>;
  }>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, {});
  const captures = (order.purchase_units ?? []).flatMap((u) => u.payments?.captures ?? []);
  return (
    captures.find((c) => (c as unknown as { amount?: { value?: string } }).amount?.value === value) ??
    captures[0] ??
    null
  );
}

/** Release the whole hold. PayPal returns 204 (or the voided auth with Prefer: return=representation). */
export async function voidAuthorization(
  authorizationId: string,
  opts: { requestId?: string } = {},
): Promise<Authorization | undefined> {
  return paypalRequest<Authorization | undefined>(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`,
    { requestId: opts.requestId ?? `void:${authorizationId}` },
  );
}

/**
 * New authorization id with a fresh 3-day honor period. Only allowed AFTER the honor period
 * (days 4-29), so it cannot be demoed same-day (REAUTHORIZE_NOT_ALLOWED / similar).
 */
export async function reauthorize(
  authorizationId: string,
  opts: { amount?: number | string; requestId?: string } = {},
): Promise<Authorization> {
  return paypalRequest<Authorization>(
    "POST",
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,
    {
      body: opts.amount === undefined ? {} : { amount: usd(opts.amount) },
      requestId: opts.requestId ?? `reauth:${authorizationId}`,
    },
  );
}
