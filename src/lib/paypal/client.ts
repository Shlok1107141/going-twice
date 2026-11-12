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
// Mapping follows the APIMatic plugin's typescript-error-handling skill: one family, a closed
// discriminator (`kind`), the debug id surfaced, and nothing hidden in message-only strings.

export interface PayPalErrorDetail {
  issue?: string;
  description?: string;
  field?: string;
  value?: string;
  location?: string;
}

/** Closed set, like the SDK's `err.kind`: switch on it exhaustively. */
export type PayPalErrorKind =
  | "auth" //          401/403 (bad/expired credentials, missing scope)
  | "validation" //    400, other 422
  | "not_found" //     404
  | "duplicate" //     422 DUPLICATE_TRANSACTION / DUPLICATE_INVOICE_ID / already captured
  | "rate_limit" //    429
  | "server" //        5xx and 408
  | "timeout" //       no response within the per-attempt deadline (status 0)
  | "network" //       DNS/connect/reset before a response (status 0)
  | "api"; //          any other error status

const DUPLICATE_RE = /DUPLICATE|ALREADY_CAPTURED|PREVIOUSLY_CAPTURED/i;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Any non-2xx (or no-response) outcome from PayPal. `paypalName` is PayPal's error name, `issue` the first details[].issue. */
export class PayPalError extends Error {
  /** HTTP status; 0 when no response arrived (kind "timeout" | "network"). */
  readonly status: number;
  readonly kind: PayPalErrorKind;
  readonly paypalName?: string;
  readonly issue?: string;
  readonly debugId?: string;
  readonly details: PayPalErrorDetail[];
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
  /** Retry-After from the response, in ms, when PayPal sent one. */
  readonly retryAfterMs?: number;
  /** Number of sends made for this call (1 = no retry happened). */
  attempts = 1;

  constructor(args: {
    status: number;
    method: string;
    path: string;
    body: unknown;
    debugIdHeader?: string | null;
    retryAfterMs?: number;
    kind?: "timeout" | "network";
    cause?: unknown;
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
      args.kind
        ? `PayPal ${args.method} ${args.path} -> ${args.kind === "timeout" ? "timed out" : "network failure"}`
        : `PayPal ${args.method} ${args.path} -> ${args.status}`,
      name,
      issue,
      b.message ?? b.error_description ?? details[0]?.description,
      debugId ? `(debug_id ${debugId})` : undefined,
    ]
      .filter(Boolean)
      .join(" | ");
    super(msg, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = "PayPalError"; // src/lib/auction/http.ts matches on this string
    this.status = args.status;
    this.paypalName = name;
    this.issue = issue;
    this.debugId = debugId;
    this.details = details;
    this.body = args.body;
    this.method = args.method;
    this.path = args.path;
    this.retryAfterMs = args.retryAfterMs;
    this.kind = args.kind ?? classify(args.status, name, issue, msg);
  }

  /** True if repeating the same request (same PayPal-Request-Id) could succeed. */
  get retryable(): boolean {
    return RETRY_STATUSES.has(this.status) || this.kind === "timeout" || this.kind === "network";
  }

  /** True for the 422 family that means "an earlier attempt already went through". */
  get isDuplicate(): boolean {
    return this.kind === "duplicate";
  }
}

function classify(status: number, name?: string, issue?: string, msg = ""): PayPalErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500 || status === 408) return "server";
  if (status === 422 && DUPLICATE_RE.test(`${issue ?? ""} ${name ?? ""} ${msg}`)) return "duplicate";
  if (status === 400 || status === 422) return "validation";
  return "api";
}

// ---------- Resilience configuration ----------
// Semantics follow the plugin's typescript-configuration-resilience skill (the SDK's retry loop):
//  - the timeout bounds ONE attempt (we also cover the body read), not the whole call;
//  - retried statuses are exactly 408/429/500/502/503/504, plus connection/timeout faults;
//  - wait = min(Retry-After ?? delay * factor^n, cap) * (1 + random * maxJitter) (jitter only adds);
//  - a write may be re-sent only if the provider can join duplicates: we always resend the SAME
//    PayPal-Request-Id (the SDK's default gate excludes POST for exactly this reason);
//  - a 401 invalidates the cached token and re-acquires it once, outside the retry budget.

export interface ResilienceConfig {
  /** Per-attempt deadline in ms (default 15000). */
  timeoutMs: number;
  /** Retries after the first attempt (default 3 => up to 4 sends). */
  maxRetries: number;
  baseDelayMs: number;
  backoffFactor: number;
  /** Additive fraction, 0..1 (default 0.25). */
  maxJitter: number;
  /** Ceiling for any single wait including Retry-After (default 20000; the SDK uses 60000). */
  maxDelayMs: number;
}

function envNum(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

const config: ResilienceConfig = {
  timeoutMs: envNum("PAYPAL_TIMEOUT_MS", 15_000, 1),
  maxRetries: envNum("PAYPAL_MAX_RETRIES", 3, 0),
  baseDelayMs: 1000,
  backoffFactor: 2,
  maxJitter: 0.25,
  maxDelayMs: 20_000,
};

/** Test/ops hook: override resilience knobs (e.g. tiny delays in the resilience script). */
export function configureResilience(partial: Partial<ResilienceConfig>): ResilienceConfig {
  Object.assign(config, partial);
  return { ...config };
}

// Test seams: swap the transport / base URL / sleeper without touching callers.
const realFetch: typeof fetch = (input, init) => fetch(input, init);
let fetchImpl: typeof fetch = realFetch;
let baseUrlOverride: string | undefined;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let sleepImpl: (ms: number) => Promise<void> = realSleep;

export const __testing = {
  setFetch(fn?: typeof fetch) {
    fetchImpl = fn ?? realFetch;
  },
  setBaseUrl(url?: string) {
    baseUrlOverride = url;
  },
  setSleep(fn?: (ms: number) => Promise<void>) {
    sleepImpl = fn ?? realSleep;
  },
};

function baseUrl(): string {
  return baseUrlOverride ?? paypalBaseUrl();
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const date = Date.parse(h); // HTTP-date form
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function backoffMs(retryIndex: number, retryAfterMs?: number): number {
  const base = Math.min(
    retryAfterMs ?? config.baseDelayMs * config.backoffFactor ** retryIndex,
    config.maxDelayMs,
  );
  return Math.ceil(base * (1 + Math.random() * config.maxJitter));
}

/** One bounded attempt: fetch + body read under a single AbortController deadline. */
async function attemptOnce(
  url: string,
  init: RequestInit,
  method: string,
  path: string,
): Promise<{ res: Response; body: unknown }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: ac.signal, cache: "no-store" });
    const body = await readBody(res);
    return { res, body };
  } catch (e) {
    throw new PayPalError({
      status: 0,
      method,
      path,
      body: undefined,
      kind: ac.signal.aborted ? "timeout" : "network",
      cause: e,
    });
  } finally {
    clearTimeout(timer);
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
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${clientId}:${clientSecret}`),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
    };
    // Minting a token is idempotent, so faults/429/5xx are safe to retry like any other call.
    for (let attempt = 0; ; attempt++) {
      let failure: PayPalError;
      try {
        const { res, body } = await attemptOnce(baseUrl() + path, init, "POST", path);
        if (res.ok) {
          const { access_token, expires_in } = body as { access_token: string; expires_in: number };
          g.__ppToken = { token: access_token, expiresAt: Date.now() + expires_in * 1000, env };
          return access_token;
        }
        failure = new PayPalError({
          status: res.status,
          method: "POST",
          path,
          body,
          debugIdHeader: res.headers.get("paypal-debug-id"),
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
        });
      } catch (e) {
        failure = e as PayPalError;
      }
      failure.attempts = attempt + 1;
      if (!failure.retryable || attempt >= config.maxRetries) throw failure;
      await sleepImpl(backoffMs(attempt, failure.retryAfterMs));
    }
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
   * Defaults to a fresh UUID, minted ONCE per call and reused by every internal retry.
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
  // Minted once, outside the loop: every retry carries the identical PayPal-Request-Id, so PayPal
  // joins duplicates instead of executing the write twice.
  const requestId = method === "POST" ? (opts.requestId ?? crypto.randomUUID()) : undefined;
  const payload =
    opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  // Faults (timeout / dropped connection) leave the outcome unknown, so only calls PayPal can
  // de-duplicate (POST with Request-Id) or that are naturally idempotent (GET) are re-sent on
  // them. PATCH/PUT/DELETE are re-sent only on 429/503, where PayPal explicitly did not process it.
  const faultRetrySafe = method === "GET" || method === "POST";

  let retries = 0;
  let refreshedToken = false;
  for (;;) {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
      ...(opts.representation === false ? {} : { Prefer: "return=representation" }),
      ...opts.headers,
    };

    let err: PayPalError;
    try {
      const { res, body } = await attemptOnce(
        baseUrl() + path,
        { method, headers, body: payload },
        method,
        path,
      );
      if (res.ok) return body as T;
      err = new PayPalError({
        status: res.status,
        method,
        path,
        body,
        debugIdHeader: res.headers.get("paypal-debug-id"),
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    } catch (e) {
      err = e as PayPalError;
    }
    err.attempts = retries + 1;

    // Stale/expired token: invalidate and re-acquire once; does not consume the retry budget.
    if (err.status === 401 && !refreshedToken) {
      refreshedToken = true;
      invalidateAccessToken();
      continue;
    }

    const safe = faultRetrySafe || err.status === 429 || err.status === 503;
    if (safe && err.retryable && retries < config.maxRetries) {
      const wait = backoffMs(retries, err.retryAfterMs);
      console.warn(
        `[paypal] ${method} ${path} ${err.status || err.kind} -> retry ${retries + 1}/${config.maxRetries} in ${wait}ms` +
          (requestId ? ` (PayPal-Request-Id ${requestId})` : "") +
          (err.debugId ? ` (debug_id ${err.debugId})` : ""),
      );
      retries++;
      await sleepImpl(wait);
      continue;
    }
    console.error("[paypal]", err.message, `(attempts ${err.attempts})`);
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
