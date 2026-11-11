#!/usr/bin/env node
// Going Twice: PayPal sandbox smoke test for the paddle money path. Node 20+, no deps.
// Proves: OAuth -> AUTHORIZE order -> buyer approval -> authorize -> partial final capture | void,
// and a $1 Payouts batch. Credentials come from env only.

const USAGE = `
Usage (PowerShell: $env:PAYPAL_CLIENT_ID="..."; $env:PAYPAL_CLIENT_SECRET="..."):

  node scripts/smoke-paypal.mjs create [--amount 50.00]
      Get a token, create an intent=AUTHORIZE order (the "paddle"), print the approval link.
      Open it, log in as a SANDBOX PERSONAL buyer (sb-...@personal.example.com), approve.

  node scripts/smoke-paypal.mjs create --card [--amount 50.00]
      Sandbox only: fund the paddle with PayPal's test Visa; authorizes with no browser step.

  node scripts/smoke-paypal.mjs capture --order <ORDER_ID> [--capture 20.00]
  node scripts/smoke-paypal.mjs --order <ORDER_ID> [--capture 20.00]
      After approval: authorize the order, then capture LESS than the hold with
      final_capture=true (winner path). Prints the capture and the auth's final status.

  node scripts/smoke-paypal.mjs void --order <ORDER_ID>     (authorize, then void: non-winner path)
  node scripts/smoke-paypal.mjs void --auth <AUTHORIZATION_ID>

  node scripts/smoke-paypal.mjs payout --to <sandbox-email> [--amount 1.00] [--wallet venmo]
      Send a Payouts batch (treasurer path). Use a sandbox personal account email, or
      payouts-simulator-receiver@paypal.com. Then polls the batch status a few times.

Env: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET (required), PAYPAL_ENV=sandbox|live (default sandbox),
     APP_BASE_URL (optional, used for return/cancel URLs; default http://localhost:3000).
`;

// ---------- args ----------
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  } else positional.push(a);
}
let mode = positional[0] ?? (flags.order ? "capture" : "help");
if (flags.help || flags.h || mode === "help") {
  console.log(USAGE);
  process.exit(0);
}

// ---------- config ----------
const ENV = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
const BASE = ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET?.trim();
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in env.\n" + USAGE);
  process.exit(2);
}
if (ENV !== "sandbox") console.warn(`WARNING: PAYPAL_ENV=${ENV} -> ${BASE}. Real money.`);

// ---------- helpers ----------
function money(v) {
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Bad amount "${v}" (use e.g. 20.00)`);
  const [w, f = ""] = s.split(".");
  return `${Number(w)}.${f.padEnd(2, "0")}`;
}

let token;
async function getToken() {
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail("POST /v1/oauth2/token", res, body);
  console.log(`token ok (${ENV}), expires_in=${body.expires_in}s, scopes include payouts: ${String(body.scope).includes("payouts")}`);
  token = body.access_token;
}

async function pp(method, path, body, requestId = crypto.randomUUID()) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation",
      ...(method === "POST" ? { "PayPal-Request-Id": requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!res.ok) fail(`${method} ${path}`, res, json);
  return { status: res.status, body: json };
}

function fail(what, res, body) {
  const issue = body?.details?.[0]?.issue;
  const debugId = body?.debug_id ?? res.headers.get("paypal-debug-id");
  console.error(`\nFAILED ${what} -> HTTP ${res.status} ${body?.name ?? body?.error ?? ""} ${issue ?? ""}`);
  console.error(`debug_id: ${debugId ?? "n/a"}`);
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

function show(label, obj) {
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(obj, null, 2));
}

async function authorize(orderId) {
  const { body } = await pp("POST", `/v2/checkout/orders/${orderId}/authorize`, {}, `authorize:${orderId}`);
  const auth = body?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) {
    show("authorize response (no authorization found)", body);
    process.exit(1);
  }
  show("authorization (the paddle hold)", {
    order_status: body.status,
    payer: body.payer?.email_address,
    authorization_id: auth.id,
    status: auth.status,
    amount: auth.amount,
    expiration_time: auth.expiration_time,
  });
  return auth;
}

async function authFromFlags() {
  if (flags.auth) return { id: String(flags.auth) };
  if (!flags.order) {
    console.error("Need --order <ORDER_ID> (or --auth <AUTHORIZATION_ID> for void).");
    process.exit(2);
  }
  // If the order is already authorized (e.g. --card create), reuse its authorization.
  const { body: order } = await pp("GET", `/v2/checkout/orders/${flags.order}`);
  const existing = order?.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (existing) {
    console.log(`order ${order.id} already authorized -> ${existing.id} (${existing.status})`);
    return existing;
  }
  if (order.status !== "APPROVED") {
    console.error(`Order ${order.id} is ${order.status}; approve it in the browser first.`);
    process.exit(1);
  }
  return authorize(order.id);
}

// ---------- modes ----------
async function create() {
  const amount = money(flags.amount ?? "50.00");
  const paddleId = `smoke-${Date.now()}`;
  const body = {
    intent: "AUTHORIZE",
    purchase_units: [
      {
        reference_id: paddleId,
        custom_id: paddleId,
        description: "Going Twice smoke-test paddle",
        amount: { currency_code: "USD", value: amount },
      },
    ],
  };
  if (flags.card) {
    if (ENV !== "sandbox") {
      console.error("--card is sandbox-only.");
      process.exit(2);
    }
    // PayPal's published sandbox test Visa; not a real card.
    const y = new Date().getFullYear() + 3;
    body.payment_source = { card: { number: "4111111111111111", expiry: `${y}-12`, name: "Demo Bidder" } };
  } else {
    body.payment_source = {
      paypal: {
        experience_context: {
          brand_name: "Going Twice",
          shipping_preference: "NO_SHIPPING",
          user_action: "CONTINUE",
          return_url: `${APP_BASE_URL}/paddle/approved`,
          cancel_url: `${APP_BASE_URL}/paddle/cancelled`,
        },
      },
    };
  }
  const { body: order } = await pp("POST", "/v2/checkout/orders", body);
  const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  show("order", { id: order.id, status: order.status, intent: order.intent ?? "AUTHORIZE", amount });
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (auth) {
    show("card authorization", { authorization_id: auth.id, status: auth.status, amount: auth.amount });
    console.log(`\nNext: node scripts/smoke-paypal.mjs capture --order ${order.id} --capture 20.00`);
    return;
  }
  console.log(`\nApprove as a sandbox buyer:\n  ${approve}`);
  console.log("(After approval the browser lands on return_url; a 404 there is fine.)");
  console.log(`\nThen: node scripts/smoke-paypal.mjs capture --order ${order.id} --capture 20.00`);
  console.log(`  or: node scripts/smoke-paypal.mjs void --order ${order.id}`);
}

async function capture() {
  const auth = await authFromFlags();
  const amount = money(flags.capture ?? "20.00");
  const { body: cap } = await pp(
    "POST",
    `/v2/payments/authorizations/${auth.id}/capture`,
    {
      amount: { currency_code: "USD", value: amount },
      final_capture: true,
      invoice_id: `GT-SMOKE-${Date.now()}`,
      note_to_payer: "Going Twice: you won! Thank you for supporting the PTA.",
    },
    `capture:${auth.id}:${amount}`,
  );
  show("capture (winner charged)", {
    capture_id: cap.id,
    status: cap.status,
    amount: cap.amount,
    final_capture: cap.final_capture,
    status_details: cap.status_details,
  });
  const { body: after } = await pp("GET", `/v2/payments/authorizations/${auth.id}`);
  show("authorization after capture (remainder released?)", {
    id: after.id,
    status: after.status,
    amount: after.amount,
  });
}

async function voidAuth() {
  const auth = await authFromFlags();
  const { status } = await pp("POST", `/v2/payments/authorizations/${auth.id}/void`, undefined, `void:${auth.id}`);
  const { body: after } = await pp("GET", `/v2/payments/authorizations/${auth.id}`);
  show(`void -> HTTP ${status} (non-winner released)`, { id: after.id, status: after.status, amount: after.amount });
}

async function payout() {
  if (!flags.to || flags.to === true) {
    console.error("Need --to <sandbox-email | +phone | @venmohandle>.");
    process.exit(2);
  }
  const receiver = String(flags.to);
  const recipientType = receiver.startsWith("@") ? "USER_HANDLE" : receiver.startsWith("+") ? "PHONE" : "EMAIL";
  const senderBatchId = `GT-SMOKE-${Date.now()}`;
  const { body: batch } = await pp(
    "POST",
    "/v1/payments/payouts",
    {
      sender_batch_header: { sender_batch_id: senderBatchId, email_subject: "Going Twice smoke-test payout" },
      items: [
        {
          recipient_type: recipientType,
          receiver,
          amount: { value: money(flags.amount ?? "1.00"), currency: "USD" },
          note: "Going Twice: auction proceeds (smoke test)",
          sender_item_id: `${senderBatchId}-1`,
          ...(String(flags.wallet).toLowerCase() === "venmo" ? { recipient_wallet: "Venmo" } : {}),
        },
      ],
    },
    `payout:${senderBatchId}`,
  );
  const id = batch.batch_header.payout_batch_id;
  show("payout batch created", batch.batch_header);
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { body: b } = await pp("GET", `/v1/payments/payouts/${id}`);
    const item = b.items?.[0];
    console.log(
      `poll ${i + 1}: batch=${b.batch_header.batch_status} item=${item?.transaction_status ?? "?"}` +
        (item?.errors ? ` error=${item.errors.name}` : ""),
    );
    if (["SUCCESS", "DENIED", "CANCELED"].includes(b.batch_header.batch_status)) break;
  }
}

const modes = { create, capture, void: voidAuth, payout };
if (!modes[mode]) {
  console.error(`Unknown mode "${mode}".\n` + USAGE);
  process.exit(2);
}
await getToken();
await modes[mode]();
