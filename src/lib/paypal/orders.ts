// Orders v2: a paddle is one order with intent=AUTHORIZE, approved by the bidder, then authorized.
import { paypalRequest, usd, type Link, type Money } from "./client";

export type OrderStatus =
  | "CREATED"
  | "SAVED"
  | "APPROVED"
  | "VOIDED"
  | "COMPLETED"
  | "PAYER_ACTION_REQUIRED";

export interface AuthorizationSummary {
  id: string;
  status: string; // CREATED | CAPTURED | PARTIALLY_CAPTURED | VOIDED | DENIED | EXPIRED | PENDING
  amount: Money;
  expiration_time?: string;
  create_time?: string;
}

export interface Order {
  id: string;
  status: OrderStatus;
  intent?: "AUTHORIZE" | "CAPTURE";
  links?: Link[];
  payer?: {
    email_address?: string;
    payer_id?: string;
    name?: { given_name?: string; surname?: string };
  };
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    amount?: Money;
    payments?: { authorizations?: AuthorizationSummary[] };
  }>;
}

export interface CreateAuthorizeOrderInput {
  /** Paddle ceiling, e.g. "250.00". */
  amount: number | string;
  /** Our paddle id; echoed back in webhooks as custom_id. */
  paddleId: string;
  description?: string;
  /** Needed only for the redirect/approval-link flow (smoke test). The JS SDK button flow doesn't need them. */
  returnUrl?: string;
  cancelUrl?: string;
  brandName?: string;
  /**
   * SANDBOX ONLY, for scripted demo bidders: fund the paddle with a raw test card so the
   * order authorizes with no buyer approval step. Never use real card data.
   */
  testCard?: { number: string; expiry: string; name?: string };
  requestId?: string;
}

export interface CreatedOrder {
  id: string;
  status: OrderStatus;
  /** Buyer approval URL (rel "payer-action" or "approve"); undefined for card-funded orders. */
  approveUrl?: string;
  /** Present when a test card was used and PayPal authorized immediately. */
  authorization?: AuthorizationSummary;
  raw: Order;
}

export async function createAuthorizeOrder(input: CreateAuthorizeOrderInput): Promise<CreatedOrder> {
  const body: Record<string, unknown> = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: input.paddleId,
        custom_id: input.paddleId,
        description: (input.description ?? "Going Twice auction paddle").slice(0, 127),
        amount: usd(input.amount),
      },
    ],
  };

  if (input.testCard) {
    body.payment_source = {
      card: {
        number: input.testCard.number,
        expiry: input.testCard.expiry, // YYYY-MM
        name: input.testCard.name ?? "Demo Bidder",
      },
    };
  } else if (input.returnUrl || input.cancelUrl || input.brandName) {
    body.payment_source = {
      paypal: {
        experience_context: {
          brand_name: input.brandName ?? "Going Twice",
          shipping_preference: "NO_SHIPPING",
          user_action: "CONTINUE",
          ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
          ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
        },
      },
    };
  }

  const order = await paypalRequest<Order>("POST", "/v2/checkout/orders", {
    body,
    requestId: input.requestId,
  });

  return {
    id: order.id,
    status: order.status,
    approveUrl: order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
    authorization: firstAuthorization(order),
    raw: order,
  };
}

/** After buyer approval: place the hold. Returns the authorization (id, amount, expiration_time). */
export async function authorizeOrder(
  orderId: string,
  opts: { requestId?: string } = {},
): Promise<{ order: Order; authorization: AuthorizationSummary }> {
  const order = await paypalRequest<Order>(
    "POST",
    `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
    { body: {}, requestId: opts.requestId ?? `authorize:${orderId}` },
  );
  const authorization = firstAuthorization(order);
  if (!authorization) {
    throw new Error(`Order ${orderId} authorized but no authorization in response (status ${order.status})`);
  }
  return { order, authorization };
}

export async function getOrder(orderId: string): Promise<Order> {
  return paypalRequest<Order>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export function firstAuthorization(order: Order): AuthorizationSummary | undefined {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}
