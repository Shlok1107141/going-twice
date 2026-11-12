// Fault-injection hooks for break tests (scripts/break-tests.mjs). OFF unless the server runs with
// GT_TEST_HOOKS=1, and never with PAYPAL_ENV=live. Hooks are per room (money) or global (Gemini) and
// count down, so "fail the next payout once" is exact. Simulated failures never reach PayPal.

export type Hooks = {
  /** Next N payout batches fail with this PayPal issue (e.g. INSUFFICIENT_FUNDS) before any PayPal call. */
  failPayout?: { issue: string; times: number };
  /** Next N captures fail (simulated transient PayPal error) before any PayPal call. */
  failCapture?: { times: number };
};

const g = globalThis as unknown as { __gtHooks?: Map<string, Hooks>; __gtGeminiHook?: { status: number; times: number } };
const rooms = () => (g.__gtHooks ??= new Map());

export function testHooksEnabled(): boolean {
  return process.env.GT_TEST_HOOKS === "1" && (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase() !== "live";
}

export function setHooks(room: string, h: Hooks): Hooks {
  rooms().set(room, h);
  return h;
}

export function getHooks(room: string): Hooks {
  return rooms().get(room) ?? {};
}

/** Simulated PayPal failure error, shaped like PayPalError for the ledger/notes. */
export class SimulatedPayPalError extends Error {
  readonly name = "PayPalError";
  constructor(public issue: string) {
    super(`PayPal UNPROCESSABLE_ENTITY: ${issue} (simulated by test hook)`);
  }
}

/** Consume one "fail" token for a money step in a room; returns the issue to fail with, if any. */
export function takeFailure(room: string, step: "payout" | "capture"): string | undefined {
  if (!testHooksEnabled()) return undefined;
  const h = rooms().get(room);
  if (step === "payout" && h?.failPayout && h.failPayout.times > 0) {
    h.failPayout.times--;
    return h.failPayout.issue;
  }
  if (step === "capture" && h?.failCapture && h.failCapture.times > 0) {
    h.failCapture.times--;
    return "INTERNAL_SERVICE_ERROR";
  }
  return undefined;
}

/** Global: next N Gemini calls get this HTTP status (e.g. 429) without leaving the server. */
export function setGeminiHook(status: number, times: number): void {
  g.__gtGeminiHook = { status, times };
}

export function takeGeminiFailure(): number | undefined {
  const h = g.__gtGeminiHook;
  if (!testHooksEnabled() || !h || h.times <= 0) return undefined;
  h.times--;
  return h.status;
}
