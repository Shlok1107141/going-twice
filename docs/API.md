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
type State = { status: 'lobby'|'live'|'closed'; demoMode: boolean; currentLotId?: string; lots: Lot[]; paddles: Paddle[]; events: AuctionEvent[]; // newest last, max 50
  caption: { text: string; ts: number }; // what the auctioneer is saying now
  ledger: LedgerRow[]; totals: { held: number; captured: number; voided: number; paidOut: number }; receipts: { paddleId: string; text: string; invoiceId?: string }[] };
```

## Endpoints
| Method + path | Body | Response |
|---|---|---|
| GET `/api/state` | – | `State` (UI polls every 1s; stage may poll 700ms) |
| POST `/api/reset` | – | `State` (fresh demo auction with 3 lots) |
| POST `/api/paddle` | `{name, holdAmount}` | live: `{paddleId, orderId}` (client then renders PayPal buttons with that order); demo: `{paddleId, held:true}` |
| POST `/api/paddle/[id]/authorize` | `{orderId}` | `{paddle}` after server calls authorize; sets status `held` |
| POST `/api/agent` | `{name, holdAmount, instruction, maxBid, lotId?}` | `{paddleId}` creates an agent paddle (held in demo mode; in live mode it uses the same authorize flow by returning `{paddleId, orderId}`) |
| POST `/api/lot/start` | `{lotId}` | `State`; opens the lot, auctioneer announces it |
| POST `/api/bid` | `{paddleId, lotId, amount}` | `{ok:true}` or `{ok:false, error}`; server rule: amount ≥ highBid+increment (or startPrice for first bid), and paddle.committed − (own current high on this lot) + amount ≤ holdAmount |
| POST `/api/auctioneer/tick` | – | `{ok:true}`; the stage calls it every 2s; server decides stall / going-once / going-twice / auto-hammer by elapsed time since last bid (stall ≥8s, going-once ≥14s, going-twice ≥18s, sold ≥22s; demo may use `TICK_SPEED` multiplier) |
| POST `/api/lot/hammer` | `{lotId}` | `State`; force sold now |
| POST `/api/close` | – | `State`; one capture per winning paddle (sum of its won lots, final_capture), void every other held authorization, Payouts batch of captured total to TREASURER_PAYPAL_EMAIL, Claude-written receipt per winner (+ PayPal invoice marked paid in live mode); sets status `closed` |
| POST `/api/webhooks/paypal` | PayPal event | `200`; verify signature in live mode, update ledger status |

Idempotency: `/api/close` must be safe to call twice (second call returns current state without new money movement).

## UI conventions
- Stage plays `state.caption.text` aloud with `speechSynthesis` when `caption.ts` changes (user must click "Start sound" once), and always shows captions.
- Paddle view stores `paddleId` in `localStorage` key `gt.paddleId`.
- Next bid amount shown = `max(startPrice, highBid + increment)`.
