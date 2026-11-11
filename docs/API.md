# Going Twice: internal API contract (UI ⇄ server)

Shared by the engine/API agent and the UI agent. All JSON. Money = number of USD dollars with up to 2 decimals in this API (convert to PayPal 2-decimal strings only inside src/lib/paypal). Base: same origin (`/api/...`).

## Modes
`DEMO_MODE` is true when `PAYPAL_CLIENT_ID` is unset or `DEMO_MODE=1`. In demo mode no PayPal calls are made: paddle "authorization" is simulated, capture/void/payout/receipt entries are simulated with fake ids (`DEMO-...`). Anthropic calls fall back to canned lines when `ANTHROPIC_API_KEY` is unset. The app must be fully playable end to end in demo mode.

## Types
```ts
type Paddle = { id: string; number: number; name: string; kind: 'human'|'agent'; holdAmount: number; committed: number; // committed = sum of current winning bids not yet captured
  status: 'pending'|'held'|'captured'|'voided'; agent?: { instruction: string; maxBid: number; lastReasoning?: string }; authorizationId?: string; orderId?: string };
type Lot = { id: string; title: string; description: string; emoji: string; startPrice: number; increment: number; status: 'pending'|'open'|'sold'|'unsold'; highBid: number; highPaddleId?: string; winnerPaddleId?: string; finalPrice?: number; phase: 'bidding'|'going-once'|'going-twice'|'sold' };
type AuctionEvent = { id: string; ts: number; type: 'bid'|'agent-bid'|'stall'|'going-once'|'going-twice'|'sold'|'system'; text: string; paddleId?: string; lotId?: string };
type LedgerRow = { id: string; ts: number; kind: 'authorized'|'captured'|'voided'|'payout'|'receipt'; paddleId?: string; amount: number; paypalId?: string; status: string; note?: string };
type State = { status: 'lobby'|'live'|'closed'; demoMode: boolean; testCards?: boolean; // live sandbox: testCard paddles allowed currentLotId?: string; lots: Lot[]; paddles: Paddle[]; events: AuctionEvent[]; // newest last, max 50
  caption: { text: string; ts: number }; // what the auctioneer is saying now
  ledger: LedgerRow[]; totals: { held: number; captured: number; voided: number; paidOut: number }; receipts: { paddleId: string; text: string; invoiceId?: string }[] };
```

## Endpoints
| Method + path | Body | Response |
|---|---|---|
| GET `/api/state` (all endpoints accept `?room=CODE`, see Rooms) | – | `State` (UI polls every 1s; stage may poll 700ms) |
| POST `/api/reset` | – | `State` (fresh demo auction with 3 lots) |
| POST `/api/paddle` | `{name, holdAmount, testCard?, email?}` | live: `{paddleId, orderId}` (client then renders PayPal buttons with that order); live + `testCard:true` (sandbox only): `{paddleId, held:true}`; demo: `{paddleId, held:true}` |
| POST `/api/paddle/[id]/authorize` | `{orderId}` | `{paddle}` after server calls authorize; sets status `held` |
| POST `/api/agent` | `{name, holdAmount, instruction, maxBid, lotId?, testCard?, email?}` | `{paddleId, held:true}` creates an agent paddle (held in demo mode or with `testCard:true`; otherwise in live mode it uses the same authorize flow by returning `{paddleId, orderId}`) |
| POST `/api/lot/start` | `{lotId}` | `State`; opens the lot, auctioneer announces it |
| POST `/api/bid` | `{paddleId, lotId, amount}` | `{ok:true}` or `{ok:false, error}`; server rule: amount ≥ highBid+increment (or startPrice for first bid), and paddle.committed − (own current high on this lot) + amount ≤ holdAmount |
| POST `/api/auctioneer/tick` | – | `{ok:true}`; the stage calls it every 2s; server decides stall / going-once / going-twice / auto-hammer by elapsed time since last bid (stall ≥8s, going-once ≥14s, going-twice ≥18s, sold ≥22s; demo may use `TICK_SPEED` multiplier) |
| POST `/api/lot/hammer` | `{lotId}` | `State`; force sold now |
| POST `/api/close` | – | `State`; one capture per winning paddle (sum of its won lots, final_capture), void every other held authorization, Payouts batch of captured total to TREASURER_PAYPAL_EMAIL, Claude-written receipt per winner (+ PayPal invoice marked paid in live mode); sets status `closed` |
| POST `/api/webhooks/paypal` | PayPal event | `200`; verify signature in live mode, update ledger status |

**Sandbox test-card paddles.** When the server runs with live keys and `PAYPAL_ENV=sandbox` (`state.testCards === true`), `testCard:true` makes the server create the AUTHORIZE order with PayPal's published sandbox test Visa as `payment_source.card` and authorize it immediately: a real sandbox authorization id, no buyer login, paddle is `held` at once. Rejected with 400 when `PAYPAL_ENV=live`; ignored in demo mode. Optional `email` is the receipt address (otherwise the PayPal payer email; card paddles have none, so their receipt invoice is skipped unless `email` is given).

Idempotency: `/api/close` must be safe to call twice (second call returns current state without new money movement).

## UI conventions
- Stage plays `state.caption.text` aloud with `speechSynthesis` when `caption.ts` changes (user must click "Start sound" once), and always shows captions.
- Paddle view stores `paddleId` in `localStorage` key `gt.paddleId`.
- Next bid amount shown = `max(startPrice, highBid + increment)`.

## Rooms
Every request runs in an isolated auction **room**, chosen by `?room=CODE` on the URL (or an `x-gt-room` header). `CODE` is 1-12 alphanumeric characters, case-insensitive (canonicalised to upper case); missing or invalid means `MAIN`. Each room has its own state, ids, ledger and persistence file (`.data/state-<ROOM>.json`); up to 200 rooms stay in memory (least recently used is evicted, but stays on disk). Pages forward their own `?room=` on every API call automatically (`src/lib/client/api.ts`, `useAuctionState.ts`), the stage QR encodes `/paddle?room=CODE`, and the paddle id in localStorage is scoped per room.

- `GET /api/room/new` returns `{room}`, a fresh random 6-character code. The landing page's "Start your own room" button uses it and opens `/admin?room=CODE`.
- Server side: wrap every route handler in `withRoom(req, () => ...)` from `@/lib/auction/room`; engine and store functions then read `currentRoom()` implicitly (AsyncLocalStorage, which also follows timers and promises started inside). Use `runInRoom(code, fn)` when there is no request.
- `POST /api/webhooks/paypal` has no room: the server looks up which room's ledger holds the referenced authorization/capture/payout/invoice id (global id-to-room index, with a scan of persisted rooms as fallback) and applies the event there. Events for unknown ids are ignored.

## Email on test-card paddles
`email` (optional, `POST /api/paddle` and `/api/agent`) is the address for the PayPal invoice receipt. The `/paddle` registration form has an optional "Email for your receipt" field. When `testCard:true` is used in live sandbox mode (`PAYPAL_ENV=sandbox`) and no email is given, the server assigns the next sandbox buyer email round-robin from env `SANDBOX_BUYER_1..3` (format `email:password`; only the part before the first colon is used, passwords are never stored or exposed), so receipt invoices are created.

## Gemini resilience
Short auctioneer lines use `GEMINI_FAST_MODEL` (default `gemini-2.5-flash-lite`); other calls use `GEMINI_MODEL`. On HTTP 429 the call retries once after 1.2 s, then callers fall back to scripted text. A global limiter allows at most 12 Gemini calls per minute. The Anthropic path is unchanged.

## Auction types
Built for the school gala (the default, `charity`); works for any live auction. `src/lib/auction/auctionTypes.ts` holds the per-type config (label, Gus persona and lines, 4 sample lots, receipt kind, payout plan, defaults). `State` gains `auctionType: 'charity'|'estate'|'collectibles'|'farm'` and `settings: {premiumPct, commissionPct}`; `Lot` gains optional `consignor`, `unit` (`head`|`lot`) and `quantity`. Payout/consignor emails are kept server-side only (never in `State`). Rooms persisted before this default to `charity`.

| Method + path | Body | Response |
|---|---|---|
| POST `/api/auction/type` | `{type, settings?: {premiumPct?, commissionPct?, organizerEmail?, consignorEmails?}}` | `State`: the room is reset with that type's sample lots. 400 on an unknown type or out-of-range numbers (premium 0-50, commission 0-60). `premiumPct` is ignored for `charity`, `commissionPct` for everything but `estate`. `organizerEmail` (house payout) defaults to `TREASURER_PAYPAL_EMAIL`; `consignorEmails` (one per consignor, in order of first appearance) default to the `SANDBOX_BUYER_*` emails (passwords never read). `POST /api/reset` keeps the room's type and settings. |

| Type | Defaults | Receipts | Payout (one Payouts batch) |
|---|---|---|---|
| `charity` | no premium, +$10 steps | donation receipt with FMV (unchanged) | captured total to the organizer |
| `estate` | 15% commission, premium 0 | sales receipt incl. consignor credit | per consignor: hammer minus commission; house: commission (+ any premium) |
| `collectibles` | 10% buyer's premium | sales receipt: hammer, premium, total | captured total to the house |
| `farm` | no premium, $100+ steps, per head / per lot | sales receipt | captured total to the seller |

Money rules (all integer cents in code):
- Capture per winner = hammer total + `round(hammer total x premiumPct / 100)`. With `premiumPct = 0` this is exactly the old behavior.
- Bid validation: `committed - own + amount` plus the premium on that sum must fit in `holdAmount`; the error names the premium.
- Estate payout: per sold lot `credit = hammer - round(hammer x commissionPct / 100)`, summed per consignor email; the house gets `captured - sum(credits)`. Items always sum to the captured total. The ledger gets one `payout` row per item (all sharing the batch's `paypalId`) with notes like `consignor 85% / house 15%: <lots> to consignor <email>`. A lot without a consignor email goes to the house.
- Idempotency is unchanged: `payoutDone` plus the `close-<auctionId>` batch id mean a second close moves no money.
- Gus: persona and vocabulary per type are passed into the Claude prompt and the template lines (`{consignor}`, `{each}` per-head quotes, "plus buyer's premium").
