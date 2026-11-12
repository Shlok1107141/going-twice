# APIMatic Context Plugin for PayPal: how it was used

The plugin (`C:\Users\HP\.context-plugins\vscode\paypal\`, also exposed as `paypal:typescript-*` skills) teaches an agent to use an APIMatic-generated PayPal TypeScript SDK. Its skills are API-agnostic best practice plus SDK-specific facts. We used them as the authority for resilience, error and auth design in `src/lib/paypal/client.ts`.

## Skills consulted and what each changed

| Skill | What it told us | Change (src/lib/paypal/client.ts) |
|---|---|---|
| typescript-configuration-resilience | Timeout bounds ONE attempt, not the call (do the arithmetic); retried statuses are exactly 408/429/500/502/503/504 plus connection/timeout faults; wait = min(Retry-After ?? delay*2^n, cap) * (1 + random*jitter), jitter only adds; Retry-After honoured (seconds and HTTP-date); a POST is outside the default retry gate because a transport failure leaves the outcome unknown, so a write may be re-sent only if the provider can join duplicates | `ResilienceConfig`, `backoffMs`, `parseRetryAfter`, `attemptOnce` (AbortController, 15 s, covers body read), retry loop in `paypalRequest`. POST is re-sent only because the SAME `PayPal-Request-Id` is minted once outside the loop. PATCH/PUT/DELETE are re-sent only on 429/503, never on timeouts |
| typescript-error-handling | One error family with a closed `kind`; no-response failures (timeout/connection) are distinct kinds; surface the diagnostic id yourself; handle each failure kind the same way everywhere | `PayPalErrorKind` (auth, validation, not_found, duplicate, rate_limit, server, timeout, network, api), `PayPalError.kind/isDuplicate/attempts/retryAfterMs/debugId`, `classify()`. `name` stays `"PayPalError"` and all prior fields are kept, so `auction/http.ts` and `authorizations.ts` are unchanged |
| typescript-authentication | OAuth client-credentials: SDK caches the token, and on 401 invalidates and re-acquires | 401 invalidates the token and replays once, outside the retry budget; the token request itself now has timeout + retry (minting is idempotent) |
| typescript-testing | Fake the single transport seam, assert the request actually built, cover error paths, test retry deliberately | `__testing.setFetch/setBaseUrl/setSleep` seams; `scripts/paypal-resilience-test.mjs` |
| typescript-getting-started / integrate-paypal | SDK identity, install, and the rule that SDK facts come from lookups | Used for the SDK-adoption decision below |

## Before / after

Before: no timeout; one retry on 401 and one on 429/5xx with a fixed 750 ms wait; network errors (the observed connect timeouts) escaped as raw `TypeError`; a hung connection could stall a request indefinitely.
After: 15 s per-attempt deadline, up to 3 retries with exponential backoff + jitter (cap 20 s, Retry-After respected) for network faults, timeouts, 408/429/5xx on GET/POST; identical `PayPal-Request-Id` on every send; 401 refresh once; typed errors with `debug_id`. Tunables: `PAYPAL_TIMEOUT_MS`, `PAYPAL_MAX_RETRIES`. The DUPLICATE recovery in `authorizations.ts` is kept: a timeout can still leave the outcome unknown, which the plugin calls a reconciliation problem that no retry setting solves.

Worst-case latency: (3+1) x 15 s + waits, about 70 s for one call; lower `PAYPAL_MAX_RETRIES` for request paths with short deadlines.

## Should we adopt the official PayPal TypeScript Server SDK? Not now (honest answer)

- The plugin's SDK is the package `paypal` at version 2.29.0, "not on npm; built from source" from `github.com/context-plugins/paypal-typescript-sdk`. A git dependency that must be built at install time is a build risk for Render deploys (`render.yaml`) and for judges running `npm ci`. (The unrelated npm package named `paypal` is a different, abandoned library.) The npm package `@paypal/paypal-server-sdk` is a separate artifact that the plugin does not document, so we could not use the plugin's guidance for it.
- Per the plugin's own skills, that SDK sends its own `Idempotency-Key` on non-GET calls and exposes no per-request headers. Our money path depends on a deterministic `PayPal-Request-Id` (e.g. `capture:{auth}:{amount}`) that survives app-level retries. The SDK cannot send that header, so adopting it for capture/authorize would weaken, not preserve, our double-charge protection.
- Its default retry gate excludes POST, and its retry options cannot make a write safe without a provider-side key (see above).
- Its coverage is Orders/Payments/Subscriptions/Transaction Search/Vault (40 operations); our Payouts, Invoicing and Webhook signature verification are outside it.
We therefore kept REST and ported the SDK's documented retry semantics instead. No call was moved to the SDK.

## Tests

`node --env-file=.env.local scripts/paypal-resilience-test.mjs` (add `--offline` to skip sandbox). Part 1 injects faults via the transport seam and an unroutable host (192.0.2.1): 503 + Retry-After x2 then success with an identical Request-Id; timeout then success with backoff 100/200 ms; typed exhausted-retry error; 401 refresh once; 422 DUPLICATE_TRANSACTION classified and not retried; PATCH timeout not re-sent. Part 2 runs real sandbox authorize -> capture ($5 of $12, final) -> repeat capture returns the same capture -> authorize -> void, plus a real 404 mapped to `not_found` with `debug_id`. All passed. `next start` + `scripts/live-flow.mjs` also passed (no regression).

## Devpost "experience" paragraph (about 120 words)

The APIMatic PayPal plugin was most useful as engineering guidance, not codegen. Its resilience skill spelled out semantics we would have guessed at: the timeout bounds one attempt, POSTs are not retried by default because a dropped connection leaves the outcome unknown, Retry-After is honoured, jitter only adds. That pushed us to resend the same PayPal-Request-Id and keep a reconciliation path, which fixed our real sandbox connect-timeout/DUPLICATE_TRANSACTION problem. The error-handling skill gave us a closed error taxonomy with debug_id. Limits: the SDK is not on npm and cannot set PayPal-Request-Id per call, and misses Payouts and Invoicing, so we kept REST and ported its documented behaviour rather than adopting it. Better than building blind, but not a drop-in dependency.
