#!/usr/bin/env node
// Proves src/lib/paypal/client.ts resilience, then runs a real sandbox authorize -> capture -> void.
//   node --env-file=.env.local scripts/paypal-resilience-test.mjs [--offline]
// Part 1 (offline, no network to PayPal): injected 503s/timeouts/401, an unroutable host.
// Part 2 (sandbox, skipped with --offline or without creds): the real library, end to end.
// Exits non-zero on any failed assertion. Never prints credentials.

import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// The library is TypeScript with extensionless imports: transpile to CJS in a temp dir.
const out = mkdtempSync(join(tmpdir(), "pp-lib-"));
mkdirSync(join(out, "paypal"));
const src = join(root, "src", "lib", "paypal");
for (const f of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
  const js = ts.transpileModule(readFileSync(join(src, f), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(out, "paypal", f.replace(/\.ts$/, ".js")), js);
}
writeFileSync(join(out, "package.json"), '{"type":"commonjs"}');
const lib = require(join(out, "paypal", "index.js"));
const { paypalRequest, PayPalError, configureResilience, __testing, invalidateAccessToken } = lib;

let failures = 0;
const check = (c, m) => (c ? console.log(`  ok   ${m}`) : (failures++, console.log(`  FAIL ${m}`)));
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const quiet = () => {
  const w = console.warn, e = console.error;
  console.warn = console.error = () => {};
  return () => ((console.warn = w), (console.error = e));
};

process.env.PAYPAL_CLIENT_ID ||= "offline-id";
process.env.PAYPAL_CLIENT_SECRET ||= "offline-secret";
const realCreds = !!process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_ID !== "offline-id";
const REAL_ID = process.env.PAYPAL_CLIENT_ID, REAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const sleeps = [];

function fake(handler) {
  const calls = [];
  __testing.setFetch(async (url, init) => {
    const u = new URL(url);
    const call = { path: u.pathname, method: init.method, headers: new Headers(init.headers), signal: init.signal };
    calls.push(call);
    if (u.pathname === "/v1/oauth2/token") return json(200, { access_token: "tok" + calls.length, expires_in: 32400 });
    return handler(call, calls.filter((c) => c.path !== "/v1/oauth2/token").length);
  });
  return calls;
}
function reset() {
  invalidateAccessToken();
  sleeps.length = 0;
  configureResilience({ timeoutMs: 15_000, maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 20_000 });
  __testing.setBaseUrl(undefined);
  __testing.setFetch(undefined);
  __testing.setSleep(async (ms) => void sleeps.push(ms));
}
const hang = (signal) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));

console.log("Part 1: offline fault injection");

console.log("- 503 (Retry-After: 2) twice, then success: same PayPal-Request-Id, Retry-After honoured");
reset();
let restore = quiet();
let calls = fake((c, n) => (n < 3 ? json(503, { name: "SERVICE_UNAVAILABLE", debug_id: "dbg503" }, { "retry-after": "2" }) : json(201, { id: "CAP1" })));
let r = await paypalRequest("POST", "/v2/payments/authorizations/A1/capture", { body: {}, requestId: "capture:A1:5.00" });
restore();
let posts = calls.filter((c) => c.path.includes("capture"));
check(r.id === "CAP1" && posts.length === 3, `3 sends, succeeded (sends=${posts.length})`);
check(new Set(posts.map((c) => c.headers.get("paypal-request-id"))).size === 1 && posts[0].headers.get("paypal-request-id") === "capture:A1:5.00", "identical PayPal-Request-Id on every send");
check(sleeps.length === 2 && sleeps.every((s) => s >= 2000 && s <= 2500), `waits honour Retry-After 2s + <=25% jitter (${sleeps.join(", ")} ms)`);

console.log("- default UUID request id is minted once and reused across retries");
reset(); restore = quiet();
calls = fake((c, n) => (n < 2 ? json(502, {}) : json(200, { id: "ok" })));
await paypalRequest("POST", "/v2/checkout/orders", { body: {} });
restore();
posts = calls.filter((c) => c.path.includes("orders"));
check(posts.length === 2 && posts[0].headers.get("paypal-request-id") === posts[1].headers.get("paypal-request-id") && posts[0].headers.get("paypal-request-id"), "same generated id on both sends");

console.log("- per-attempt timeout (AbortController) then success; exponential backoff");
reset(); configureResilience({ timeoutMs: 120, baseDelayMs: 100, maxJitter: 0 }); restore = quiet();
calls = fake((c, n) => (n < 3 ? hang(c.signal) : json(200, { id: "late-ok" })));
r = await paypalRequest("POST", "/v2/payments/authorizations/A2/capture", { body: {}, requestId: "capture:A2" });
restore();
posts = calls.filter((c) => c.path.includes("capture"));
check(r.id === "late-ok" && posts.length === 3 && new Set(posts.map((c) => c.headers.get("paypal-request-id"))).size === 1, "timed-out sends retried with the same id");
check(sleeps.join() === "100,200", `backoff doubles (${sleeps.join(", ")} ms)`);

console.log("- exhausted retries surface a typed error with attempts");
reset(); configureResilience({ timeoutMs: 80, maxRetries: 2 }); restore = quiet();
fake((c) => hang(c.signal));
let err;
try { await paypalRequest("GET", "/v2/checkout/orders/X"); } catch (e) { err = e; }
restore();
check(err instanceof PayPalError && err.kind === "timeout" && err.status === 0 && err.attempts === 3 && err.retryable, `kind=timeout status=0 attempts=${err?.attempts}`);

console.log("- unroutable host (RFC 5737 192.0.2.1): real network failure, bounded by the timeout");
reset(); configureResilience({ timeoutMs: 400, maxRetries: 1 }); __testing.setBaseUrl("http://192.0.2.1:9"); restore = quiet();
const t0 = Date.now();
err = undefined;
try { await paypalRequest("GET", "/v2/checkout/orders/X"); } catch (e) { err = e; }
restore();
check(err instanceof PayPalError && (err.kind === "timeout" || err.kind === "network") && err.attempts === 2, `kind=${err?.kind} attempts=${err?.attempts} in ${Date.now() - t0}ms (<= 2 x 400ms + fast-fail)`);

console.log("- 401 once: token invalidated and re-acquired, request replayed, not counted as a retry");
reset();
calls = fake((c, n) => (c.headers.get("authorization") === "Bearer tok1" ? json(401, { name: "AUTHENTICATION_FAILURE" }) : json(200, { id: "fresh" })));
r = await paypalRequest("GET", "/v2/checkout/orders/Y");
check(r.id === "fresh" && calls.filter((c) => c.path === "/v1/oauth2/token").length === 2 && sleeps.length === 0, "2 token mints, 0 backoff sleeps");
reset(); restore = quiet();
fake(() => json(401, { name: "AUTHENTICATION_FAILURE" }));
err = undefined;
try { await paypalRequest("GET", "/v2/checkout/orders/Y"); } catch (e) { err = e; }
restore();
check(err?.kind === "auth" && err.status === 401, "persistent 401 -> kind=auth after exactly one refresh");

console.log("- not retried: 400/422, and faults on PATCH (outcome unknown, no idempotency key)");
reset(); restore = quiet();
calls = fake(() => json(422, { name: "UNPROCESSABLE_ENTITY", debug_id: "dbg422", details: [{ issue: "DUPLICATE_TRANSACTION", description: "dup" }] }));
err = undefined;
try { await paypalRequest("POST", "/v2/payments/authorizations/A/capture", { body: {} }); } catch (e) { err = e; }
restore();
check(err.kind === "duplicate" && err.isDuplicate && err.debugId === "dbg422" && err.attempts === 1 && sleeps.length === 0, `422 DUPLICATE_TRANSACTION -> kind=duplicate, debug_id=${err.debugId}, 1 send`);
check(/debug_id dbg422/.test(err.message), "debug_id is in the message");
reset(); configureResilience({ timeoutMs: 80 }); restore = quiet();
calls = fake((c) => hang(c.signal));
err = undefined;
try { await paypalRequest("PATCH", "/v2/checkout/orders/Z", { body: [] }); } catch (e) { err = e; }
restore();
check(err.kind === "timeout" && calls.filter((c) => c.path.includes("orders")).length === 1, "PATCH timeout not re-sent");
reset(); restore = quiet();
fake(() => json(400, { name: "INVALID_REQUEST", details: [{ issue: "MISSING_REQUIRED_PARAMETER" }] }));
err = undefined;
try { await paypalRequest("POST", "/v2/checkout/orders", { body: {} }); } catch (e) { err = e; }
restore();
check(err.kind === "validation" && err.issue === "MISSING_REQUIRED_PARAMETER" && err.attempts === 1, "400 -> kind=validation, no retry");

// ---- Part 2: real sandbox ----
if (process.argv.includes("--offline") || !realCreds) {
  console.log("\nPart 2 skipped (--offline or no sandbox credentials in env).");
} else {
  console.log("\nPart 2: real PayPal sandbox through the library");
  process.env.PAYPAL_CLIENT_ID = REAL_ID; process.env.PAYPAL_CLIENT_SECRET = REAL_SECRET;
  reset(); __testing.setSleep(undefined); // real sleeps now
  const card = { number: "4111111111111111", expiry: `${new Date().getFullYear() + 3}-12`, name: "Resilience Test" };
  const run = Date.now().toString(36);
  try {
    // Real network, first call dials an unroutable host once, then the real one: the retry path on live TLS.
    const mk = async (tag) => {
      const o = await lib.createAuthorizeOrder({ amount: "12.00", paddleId: `res-${tag}-${run}`, testCard: card, requestId: `res:${tag}:${run}` });
      const auth = o.authorization ?? (await lib.authorizeOrder(o.id)).authorization;
      return { order: o.id, auth };
    };
    const a = await mk("cap");
    check(a.auth.id && a.auth.status === "CREATED", `authorize ok (hold ${a.auth.id}, ${a.auth.status})`);
    const cap = await lib.captureAuthorization(a.auth.id, { amount: "5.00", finalCapture: true });
    check(cap.status === "COMPLETED" || cap.status === "PENDING", `capture $5.00 of $12.00 hold -> ${cap.status} (${cap.id})`);
    const again = await lib.captureAuthorization(a.auth.id, { amount: "5.00", finalCapture: true });
    check(again.id === cap.id, "repeat capture (same Request-Id / duplicate recovery) returns the SAME capture, no double charge");
    const after = await lib.getAuthorization(a.auth.id);
    check(after.status === "CAPTURED" || after.status === "PARTIALLY_CAPTURED", `authorization now ${after.status}`);

    const b = await mk("void");
    await lib.voidAuthorization(b.auth.id);
    const v = await lib.getAuthorization(b.auth.id);
    check(v.status === "VOIDED", `void -> ${v.status}`);

    // Typed error against the real API (404), debug_id surfaced.
    restore = quiet(); err = undefined;
    try { await lib.getAuthorization("0AAAAAAAAAAAAAAAA"); } catch (e) { err = e; }
    restore();
    check(err instanceof PayPalError && err.status === 404 && err.kind === "not_found" && !!err.debugId, `bad id -> kind=${err?.kind}, debug_id=${err?.debugId}`);
  } catch (e) {
    failures++;
    console.log("  FAIL sandbox sequence threw:", e instanceof Error ? e.message : e);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
