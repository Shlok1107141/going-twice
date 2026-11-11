// Payments v2 authorizations: capture (at the gavel), void (non-winners), reauthorize (stretch).
import { paypalRequest, toCents, usd, type Link, type Money } from "./client";

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
  return paypalRequest<Capture>(
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
