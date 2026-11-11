# Going Twice — Architecture

An AI auctioneer runs a school charity auction out loud. Each bidder's **paddle is one PayPal authorization hold** (Orders v2 `intent=AUTHORIZE`). At the close, each winner is captured once for what they won (`final_capture:true`, less than the hold), everyone else is voided, the proceeds go to the PTA treasurer through one Payouts batch, and each winner gets a PayPal invoice receipt marked paid.

Stack: Next.js 16 (App Router, TypeScript) on Render (one instance), REST to PayPal via `src/lib/paypal` (no SDK), Claude for the auctioneer voice and the absentee agent, browser `speechSynthesis` for TTS, SSE for live updates.

**Rule zero: the AI never gates money.** Code validates bids and runs every PayPal call. Claude only writes lines, chooses pacing, and turns one sentence into an absentee bidding policy.

---

## 1. Components

```
 Projector page (/room)        Phone bidder page (/bid/[paddle])     Organizer page (/admin)
   lot, price, captions, TTS     paddle register (PayPal button), tap-to-bid   open/hammer/close, money board
        │ SSE /api/events             │ POST /api/bid                          │ POST /api/lot/[id]/hammer, /api/close
        └──────────────┬──────────────┴───────────────────────────────────────┘
                       ▼
              Auction engine (src/lib/auction)  ── emits events ──► Event bus (in-process)
                │ state in JSON store                                │
                │                                                   ├─► Auctioneer (Claude, on events) → caption + pacing
                │                                                   ├─► Absentee agent (deterministic proxy + Claude line)
                ▼                                                   └─► SSE fan-out to all pages
         src/lib/paypal  ──REST──►  PayPal sandbox (Orders v2, Payments v2, Payouts v1, Invoicing v2)
                ▲
   POST /api/webhooks/paypal  ◄── PayPal webhooks (verified) → status lights
```

## 2. State machines

**Auction:** `DRAFT → OPEN` (paddles can register) `→ LIVE` (lots running) `→ CLOSING` (money calls in flight) `→ SETTLED` (all captures/voids done, payout sent) — or `CLOSE_FAILED` (some money call failed; retryable, idempotent).

**Lot:** `QUEUED → OPEN → GOING_ONCE → GOING_TWICE → SOLD | PASSED`
- Any valid bid in `GOING_ONCE/GOING_TWICE` drops the lot back to `OPEN` (that's the drama).
- `PASSED` = no bids, or reserve not met.
- Stall timer: no bid for N s in `OPEN` → `lot.stalled` event (auctioneer chants, then goes once).
- `SOLD` records `winnerPaddleId` and `hammerPrice`. **No money moves at hammer**; it only commits the exposure.

**Paddle:** `PENDING_APPROVAL → AUTHORIZED → (WINNER → CAPTURED) | (NON_WINNER → VOIDED)`, with side states `APPROVAL_CANCELLED`, `AUTH_FAILED`, `CAPTURE_PENDING` (capture status PENDING, resolved by webhook), `CAPTURE_FAILED`.

**Bid validation (in code, atomic):**
1. Auction `LIVE`, lot `OPEN|GOING_ONCE|GOING_TWICE`, paddle `AUTHORIZED`.
2. `amount ≥ currentPrice + increment` (increment table: <$100 → $5, <$500 → $10, else $25).
3. **Ceiling check:** `sum(hammerPrice of lots this paddle already won) + amount ≤ paddle.authorizedAmount`. This guarantees one capture ≤ hold, so we never rely on over-capture.
4. Not already the high bidder on this lot.

## 3. Data model (JSON store)

One file `data/store.json`, held in memory and written through on every mutation behind an in-process mutex (single Render instance; a Render disk, or just reseeding on boot, is fine for a demo). Money is always a 2-decimal **string**, computed via integer cents (`toCents`/`centsToAmount` in `src/lib/paypal/client.ts`). Currency is USD only.

```ts
Auction  { id, name, status, treasurer: { type: "EMAIL"|"PHONE"|"USER_HANDLE", receiver }, currentLotId?,
           payoutBatchId?, payoutStatus?, createdAt }
Lot      { id, auctionId, order, title, description, imageUrl, fmv /* fair market value */, startPrice,
           reserve?, status, currentPrice, highPaddleId?, winnerPaddleId?, hammerPrice?, openedAt?, soldAt? }
Paddle   { id, auctionId, number, displayName, email, kind: "HUMAN"|"AGENT", ceiling,
           orderId, authorizationId?, authorizedAmount?, authExpiresAt?, status,
           captureId?, capturedAmount?, invoiceId?, agentPolicy?: AgentPolicy }
Bid      { id, lotId, paddleId, amount, source: "TAP"|"AGENT"|"FLOOR", at }
AgentPolicy { sentence, rules: [{ lotId, max, priority }], fallback?: string }
MoneyEvent  { id, at, kind: "ORDER_CREATED"|"AUTHORIZED"|"CAPTURED"|"VOIDED"|"PAYOUT"|"INVOICE"|"ERROR",
              paddleId?, amount?, paypalId, debugId?, raw? }      // the "agent trace" panel
WebhookEvent { id /* PayPal event id, dedupe key */, type, resourceId, verified, receivedAt }
```

## 4. API routes (App Router route handlers, `export const runtime = "nodejs"`)

Next 15+: dynamic `params` is a Promise (`const { id } = await params`).

| Route | Does |
|---|---|
| `POST /api/paddle` `{auctionId, name, email, ceiling}` | Create paddle + `createAuthorizeOrder({amount: ceiling, paddleId})`. Returns `{ id: orderId }` for the JS SDK `createOrder`. |
| `POST /api/paddle/[orderId]/authorize` | JS SDK `onApprove` → `authorizeOrder(orderId)` → store `authorizationId`, `authorizedAmount`, `authExpiresAt`; paddle `AUTHORIZED`; emit `paddle.authorized`. |
| `POST /api/paddle/agent` `{auctionId, name, email, ceiling, sentence}` | Absentee paddle: same order flow, plus Claude turns the sentence into `AgentPolicy`. |
| `GET /api/state` | Snapshot for page load. |
| `GET /api/events` | SSE stream of engine events. |
| `POST /api/bid` `{lotId, paddleId, amount}` | Validate (section 2), append Bid, emit `bid.placed`. |
| `POST /api/lot/[id]/open` | Organizer opens next lot. |
| `POST /api/lot/[id]/advance` | Going once / twice (auctioneer or organizer). |
| `POST /api/lot/[id]/hammer` | `SOLD` (or `PASSED`); emit `lot.hammered`. No PayPal call. |
| `POST /api/close` `{auctionId}` | Settlement (section 5). Idempotent: re-running only retries what failed. |
| `POST /api/webhooks/paypal` | `readVerifiedEvent(req)`; dedupe by event id; update paddle/payout lights; emit `money.*`. Always 200 after dedupe. |
| `POST /api/auctioneer` (internal) | Event → Claude → `{line, action}`; called from the event bus, not the browser. |

## 5. Money flow

```
Bidder phone          App server                         PayPal
 │ tap "Get paddle"    │                                   │
 │──createOrder()────► POST /api/paddle ──POST /v2/checkout/orders {intent:AUTHORIZE, amount: ceiling, custom_id: paddleId}──►
 │◄──{id}──────────────│◄──────────────────────────────── order CREATED
 │ PayPal popup: buyer logs in (sandbox personal), approves
 │──onApprove(orderID)► POST /api/paddle/:id/authorize ─POST /v2/checkout/orders/:id/authorize──►
 │                     │◄─────── authorization {id, status CREATED, amount, expiration_time}   (webhook PAYMENT.AUTHORIZATION.CREATED)
 │   ... live auction; bids never touch PayPal; hammer just records winner + price ...
 Organizer: Close ───► POST /api/close
                       │ for each AUTHORIZED paddle (sequential, 1 at a time, deterministic request ids):
                       │   won > 0 → POST /v2/payments/authorizations/:auth/capture
                       │              {amount: sum(hammerPrice), final_capture:true, invoice_id:"GT-<auction>-<paddle>",
                       │               note_to_payer, soft_descriptor:"GOINGTWICE PTA"}       (PAYMENT.CAPTURE.COMPLETED)
                       │              remainder of the hold is released by final_capture
                       │   won = 0 → POST /v2/payments/authorizations/:auth/void               (PAYMENT.AUTHORIZATION.VOIDED)
                       │ payout: POST /v1/payments/payouts  sender_batch_id:"close-<auction>"
                       │   one item → treasurer (EMAIL | PHONE | USER_HANDLE+Venmo), amount = Σ capture net_amount
                       │   (seller_receivable_breakdown.net_amount)                             (PAYMENT.PAYOUTSBATCH.SUCCESS / PAYOUTS-ITEM.*)
                       │ receipts (best-effort, after money): per winner
                       │   POST /v2/invoicing/invoices (lines = lots won, AI FMV text in note) → /send
                       │   → POST /invoices/:id/payments {method:"PAYPAL", amount: captured}   (INVOICING.INVOICE.PAID)
                       ▼ Auction SETTLED; board shows "every winning bid collected, $0 left on hold"
```

- **Front end button.** Use the JS SDK v5 script: `https://www.paypal.com/sdk/js?client-id=<NEXT_PUBLIC_PAYPAL_CLIENT_ID>&currency=USD&intent=authorize`. `intent=authorize` is required, or the SDK rejects an AUTHORIZE order. `createOrder` returns the order id string, and `onApprove(data)` uses `data.orderID`. If you use v6 instead, `createOrder` returns `{orderId}`, `onApprove` gets `data.orderId`, and `session.start()` must be given the invoked promise.
- **Scripted demo bidders:** `createAuthorizeOrder({testCard})` authorizes immediately with PayPal's sandbox test Visa, so no popup is needed (sandbox only).
- **Idempotency keys** (PayPal-Request-Id, defaults in `src/lib/paypal`): `authorize:<orderId>`, `capture:<authId>:<amount>`, `void:<authId>`, `payout:<senderBatchId>`, `invoice:<invoiceNumber>`. A retried `/api/close` cannot double-charge.
- **Truth order:** synchronous API responses update state; webhooks only *confirm* (lights turn green) and resolve `PENDING` captures. The demo never waits on a webhook.
- **Library map:** `createAuthorizeOrder`, `authorizeOrder`, `getOrder` (orders.ts) · `captureAuthorization`, `voidAuthorization`, `reauthorize`, `getAuthorization` (authorizations.ts) · `createPayoutBatch`, `getPayoutBatch` (payouts.ts) · `createAndSendReceiptInvoice`, `recordPayment` (invoicing.ts) · `verifyWebhookSignature`, `readVerifiedEvent`, `WEBHOOK_EVENTS` (webhooks.ts). Errors throw `PayPalError` with `status`, `paypalName`, `issue` and `debugId`.

## 6. AI hooks (event bus)

Engine events: `auction.live`, `lot.opened`, `bid.placed`, `lot.stalled`, `lot.going_once`, `lot.going_twice`, `lot.hammered`, `lot.passed`, `paddle.authorized`, `agent.outbid`, `auction.closing`, `money.captured`, `money.voided`, `money.payout`, `auction.settled`.

- **Auctioneer (Claude, fast model).** A deterministic chant engine fills the gaps ("fifty, now sixty, sixty, who'll give me sixty…"). On `lot.opened`, `bid.placed` (debounced ~600 ms), `lot.stalled`, `lot.going_twice`, `lot.hammered`, `agent.outbid` and `money.captured`, the server calls Claude with lot info, the last 5 bids, paddle display names and a pacing state. Claude returns JSON `{ line, action: "hold"|"going_once"|"going_twice"|"sold" }`. The action is only a *suggestion* and the engine checks it: `sold` is accepted only if no bid arrived in the last 3 s. The line goes to SSE, then TTS and captions. Fallback is a templated line if Claude takes more than 1.5 s.
- **Absentee agent.** At registration, Claude parses one sentence ("cabin weekend up to $400; if I lose it, art basket up to $150") into `AgentPolicy` against the lot catalog, and the parsed policy is shown back to the parent. During the sale a **deterministic proxy** reacts to `bid.placed` and `lot.opened`. It bids the minimum increment if `max` allows and the ceiling check passes, after a 1–2 s "human" delay, through the same `POST /api/bid` path with `source:"AGENT"`. It re-plans its fallbacks on `lot.hammered`. Claude writes the optional "agent says" caption, so the paddle on the projector has a voice.
- **Receipts.** At close, Claude writes one fair-market-value line per lot ("FMV $120; your deductible portion is $280"). It goes into the invoice note and line descriptions.

## 7. Environment variables (`.env.local`, never committed; `.env.example` lists names only)

| Var | Notes |
|---|---|
| `PAYPAL_ENV` | `sandbox` (default) or `live`. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app (merchant type). Server only. |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same client id, for the JS SDK script tag. |
| `PAYPAL_WEBHOOK_ID` | Id of the webhook registered for `https://<render-app>/api/webhooks/paypal`. |
| `APP_BASE_URL` | Public URL (Render), used for return/cancel URLs. |
| `TREASURER_RECEIVER`, `TREASURER_TYPE` | e.g. sandbox personal email + `EMAIL`. |
| `ANTHROPIC_API_KEY`, `AUCTIONEER_MODEL` | Claude for the auctioneer, agent and receipts. |
| `DATA_FILE` | Default `data/store.json`. |
| `PAYPAL_WEBHOOK_ALLOW_UNVERIFIED` | `1` only in dev, to accept Webhooks Simulator events. |

## 8. Sandbox gotchas → mitigations

| Gotcha | Mitigation |
|---|---|
| Partial capture on **PayPal-wallet** auths may need account enablement; multiple captures definitely do. | One capture per paddle with `final_capture:true` (capturing ≤ authorized is allowed for any type). Prove it with `scripts/smoke-paypal.mjs` in H0–2, both wallet and `--card`. |
| Reauthorize only works after the 3-day honor period. | Not demoed; the auction settles the same night. `reauthorize()` exists for the narrative. |
| Payouts: needs the Payouts feature on the app, a confirmed and **funded** sandbox business account (`INSUFFICIENT_FUNDS`, `REQUIRED_SCOPE_MISSING`, `SENDER_EMAIL_UNCONFIRMED`). It is async. | Enable it in the dashboard and mint a new token (the smoke test prints whether the token scope includes payouts). Top up the business balance. Pay a sandbox personal email so the money arriving is visible. Poll `getPayoutBatch` and use webhooks. |
| Webhooks need public HTTPS; delivery takes 10–75 s; Simulator events **fail** verification. | Deploy to Render in H0–1. The UI never waits on webhooks. Trigger real events. Accept simulated events only when `PAYPAL_WEBHOOK_ALLOW_UNVERIFIED=1` (dev). |
| Signature verification needs the exact raw body. | `readVerifiedEvent(req)` reads `req.text()` and splices the raw JSON into the verify request. |
| Token expiry (~9 h) mid-demo. | Token cache refreshes 5 min before `expires_in`, and retries once on 401. |
| `PAYPAL_REQUEST_ID_PREVIOUSLY_USED` / `DUPLICATE_INVOICE_ID` / duplicate `sender_batch_id`. | Deterministic keys per logical action; unique `invoice_id` per auction+paddle; new auction id per rehearsal. |
| Buyer approval must use sandbox personal accounts at sandbox.paypal.com. | 3 US sandbox personal accounts, each in its own browser profile and pre-logged-in. |
| Card funding through raw `payment_source.card` may be refused on some sandbox apps. | Use it only for scripted bidders; if it is refused, those bidders approve in the popup too. |
| Dashboard "Negative Testing" left on breaks everything. | Leave it off; use the `PayPal-Mock-Response` header for failure beats. |
| Capture returns `PENDING` (some card/eCheck cases). | Paddle `CAPTURE_PENDING`; `PAYMENT.CAPTURE.COMPLETED` webhook flips it. |
| JS SDK v5 needs `intent=authorize` in the script URL. | See section 5. |

## 9. Build order (~20 h, deadline Fri Nov 13 01:30 IST)

| Hours | Work | Done when |
|---|---|---|
| H0–1 | Sandbox app, features (Payouts, Invoicing), 3 US personal buyers, business top-up, `.env.local`. Render deploy of the scaffold; register webhook → `PAYPAL_WEBHOOK_ID`. | Render URL live |
| H1–2 | `smoke-paypal.mjs`: create → approve → capture partial; create → void; `--card`; payout $1. | All four print COMPLETED / VOIDED / SUCCESS |
| H2–5 | JSON store + auction engine (state machines, bid validation, ceiling check) + event bus + SSE; unit tests for the bid rules. | Scripted auction runs headless |
| H5–7 | Paddle registration (JS SDK button → `/api/paddle` → `/authorize`), phone bid page. | Real sandbox hold shows on the board |
| H7–12 | **Voice loop first:** chant engine + Claude auctioneer + TTS + captions on the projector page. 30-second opening rehearsed. Go/no-go at H12 (else captions + hammer sting). | Room feels live |
| H12–14 | `/api/close`: captures, voids, payout, money board + agent trace; webhook route + lights. | Close settles 3 paddles end to end |
| H14–16 | Absentee agent: sentence → policy, proxy bidder, agent captions. | Agent wins one lot, loses one |
| H16–17 | Receipts: Claude FMV lines → invoice → send → record payment. | Winner's sandbox inbox shows the receipt as paid |
| H17–18 | Failure beats (`PayPal-Mock-Response` decline at capture → retry path), idempotent re-close. | — |
| H18–20 | Seed demo data, rehearse, record (≤3 min), README, submit. | Submitted |
