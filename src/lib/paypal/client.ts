// PayPal REST client: OAuth token cache, env-based base URL, idempotency, typed errors.
// Server-only. No external deps; uses global fetch (Node 18+ / Next.js runtime "nodejs").

if (typeof window !== "undefined") {
  throw new Error("src/lib/paypal is server-only; never import it from client components.");
}

export type PayPalEnv = "sandbox" | "live";

const BASE_URLS: Record<PayPalEnv, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
};

export function paypalEnv(): PayPalEnv {
  const raw = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
  if (raw !== "sandbox" && raw !== "live") {
    throw new Error(`PAYPAL_ENV must be "sandbox" or "live" (got "${raw}")`);
  }
  return raw;
}

export function paypalBaseUrl(): string {
  return BASE_URLS[paypalEnv()];
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
}

// ---------- Errors ----------

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
  value?: string;
  location?: string;
}

/** Any non-2xx from PayPal. `name` is PayPal's error name (e.g. UNPROCESSABLE_ENTITY), `issue` the first details[].issue. */
export class PayPalError extends Error {
  readonly status: number;
  readonly paypalName?: string;
  readonly issue?: string;
  readonly debugId?: string;
  readonly details: PayPalErrorDetail[];
  readonly body: unknown;
  readonly method: string;
  readonly path: string;

  constructor(args: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    debugIdHeader?: string | null;
  }) {
    const b = (args.body ?? {}) as {
      name?: string;
      message?: string;
      debug_id?: string;
      details?: PayPalErrorDetail[];
      error?: string;
      error_description?: string;
    };
    const details = Array.isArray(b.details) ? b.details : [];
    const issue = details[0]?.issue;
    const name = b.name ?? b.error;
    const debugId = b.debug_id ?? args.debugIdHeader ?? undefined;
    const msg = [
      `PayPal ${args.method} ${args.path} -> ${args.status}`,
      name,
      issue,
      b.message ?? b.error_description ?? details[0]?.description,
      debugId ? `(debug_id ${debugId})` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
    super(msg);
    this.name = "PayPalError";
    this.status = args.status;
    this.paypalName = name;
    this.issue = issue;
    this.debugId = debugId;
    this.details = details;
    this.body = args.body;
    this.method = args.method;
    this.path = args.path;
  }

  /** True if retrying the same request (same PayPal-Request-Id) could succeed. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

// ---------- OAuth token cache ----------

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
  env: PayPalEnv;
}

// Kept on globalThis so Next.js dev hot-reloads don't re-mint a token per request.
const g = globalThis as unknown as {
  __ppToken?: TokenCache;
  __ppTokenInflight?: Promise<string>;
};

const EXPIRY_SKEW_MS = 5 * 60 * 1000;

export function invalidateAccessToken(): void {
  g.__ppToken = undefined;
}

export async function getAccessToken(): Promise<string> {
  const env = paypalEnv();
  const cached = g.__ppToken;
  if (cached && cached.env === env && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return cached.token;
  }
  if (g.__ppTokenInflight) return g.__ppTokenInflight;

  g.__ppTokenInflight = (async () => {
    const { clientId, clientSecret } = credentials();
    const path = "/v1/oauth2/token";
    const res = await fetch(paypalBaseUrl() + path, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const body = await readBody(res);
    if (!res.ok) {
      throw new PayPalError({
        status: res.status,
        method: "POST",
        path,
        body,
        debugIdHeader: res.headers.get("paypal-debug-id"),
      });
    }
    const { access_token, expires_in } = body as { access_token: string; expires_in: number };
    g.__ppToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000, env };
    return access_token;
  })();

  try {
    return await g.__ppTokenInflight;
  } finally {
    g.__ppTokenInflight = undefined;
  }
}

// ---------- Request helper ----------

export interface PayPalRequestOptions {
  /** JSON-serialisable body. */
  body?: unknown;
  /** Pre-serialised body (used by webhook verification to keep the raw event bytes). */
  rawBody?: string;
  /**
   * Idempotency key sent as PayPal-Request-Id on every POST. Pass a deterministic key
   * (e.g. `capture:${authorizationId}`) so a retried app action can't double-charge.
   * Defaults to a fresh UUID.
   */
  requestId?: string;
  headers?: Record<string, string>;
  /** Ask PayPal to return the full resource (Prefer: return=representation). Default true. */
  representation?: boolean;
}

export async function paypalRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: PayPalRequestOptions = {},
): Promise<T> {
  const requestId = method === "POST" ? (opts.requestId ?? crypto.randomUUID()) : undefined;
  const payload =
    opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));

  // One retry on 401 (stale token), one on 429/5xx (same request id => safe).
  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      ...(opts.representation === false ? {} : { Prefer: "return=representation" }),
      ...opts.headers,
    };
    const res = await fetch(paypalBaseUrl() + path, {
      method,
      headers,
      body: payload,
      cache: "no-store",
    });
    const body = await readBody(res);
    if (res.ok) return body as T;

    const err = new PayPalError({
      status: res.status,
      method,
      path,
      body,
      debugIdHeader: res.headers.get("paypal-debug-id"),
    });
    if (attempt === 0 && res.status === 401) {
      invalidateAccessToken();
      continue;
    }
    if (attempt === 0 && err.retryable) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 750;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    console.error("[paypal]", err.message);
    throw err;
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined; // e.g. 204 from void
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------- Money (strings, 2 decimals, USD) ----------

export type Currency = "USD";
export const CURRENCY: Currency = "USD";

export interface Money {
  currency_code: Currency;
  value: string;
}

/** Normalise a number or decimal string to a 2-decimal string, via integer cents (no float drift). */
export function toAmount(v: number | string): string {
  return centsToAmount(toCents(v));
}

export function toCents(v: number | string): number {
  const s = typeof v === "number" ? v.toFixed(2) : v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid money amount: "${v}"`);
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centsToAmount(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function usd(v: number | string): Money {
  return { currency_code: CURRENCY, value: toAmount(v) };
}

export interface Link {
  href: string;
  rel: string;
  method?: string;
}
