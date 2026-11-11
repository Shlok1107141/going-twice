# Going Twice

**An AI auctioneer for school charity auctions where every bidder's paddle is a PayPal authorization hold.** Bidders approve once, tap to bid, and pay only what they win. The gavel is the checkout.

## Demo
- Hosted app: https://going-twice.onrender.com (Render free tier; first load can take a moment to wake)
- Video (under 3 min): https://youtu.be/u8RJl0X-BTE
- Runs fully in the **PayPal sandbox**. No real money moves.

## The problem
School and PTA auctions run on paper bid sheets and a payment line at the end of the night. Winners leave early, bids get ghosted, cards fail the next day, and volunteers chase the money for weeks. The auction is the fun part; the checkout is where the money leaks.

## How it works
1. **Get a paddle.** A bidder picks a ceiling and approves one PayPal order with `intent=AUTHORIZE`. That hold is the paddle and the bidding limit.
2. **Bid.** Bidders tap on their phone. Code validates every bid against the hold. The AI auctioneer "Gus" chants, reacts to bids and calls going once, going twice, sold.
3. **Send an agent (optional).** An absentee bidder takes one sentence ("cabin weekend, up to $400"), bids live inside the parent's hold, and shows its reasoning on stage.
4. **Close.** Each winner is captured once for what they won (less than the hold, `final_capture`). Every other hold is voided.
5. **Settle.** Proceeds are paid to the PTA treasurer via Payouts, and each winner gets an AI-written donation receipt (a PayPal invoice marked paid in live mode).

## How PayPal is used
Plain REST, no SDK (`src/lib/paypal`). Sandbox only.

| API | Call | Why |
|---|---|---|
| Orders v2 | `POST /v2/checkout/orders` (`intent=AUTHORIZE`) and `/authorize` | The paddle: a hold that is also the bidder's ceiling |
| Payments v2 | `POST /v2/payments/authorizations/{id}/capture` with `final_capture: true` | Charge a winner less than the hold; the remainder is released. Verified live: $20 captured against a $50 hold, COMPLETED |
| Payments v2 | `POST /v2/payments/authorizations/{id}/void` | Release holds of bidders who won nothing. Verified live: VOIDED |
| Payouts v1 | `POST /v1/payments/payouts` | Send captured proceeds to the PTA treasurer. Verified live: SUCCESS |
| Invoicing v2 | create, send, record payment | Donation receipt as a paid invoice |
| Webhooks | `POST /api/webhooks/paypal` (signature verified) | Confirm capture, void and payout events on the live board |

Idempotency keys are deterministic per action, so a retried close cannot double-charge.

## How AI is used
- **Model:** Google **Gemini** (`gemini-2.5-flash`) via the Gemini API (free tier). If `ANTHROPIC_API_KEY` is set, the same roles run on Claude via the Anthropic API instead.
- **Auctioneer "Gus":** a templated chant fills the gaps instantly; AI lines drop in on events (new bid, stall, sold). Spoken with the browser Web Speech API, always captioned.
- **Absentee-bidder agent:** the AI decides whether a lot matches and whether to bid, with a visible reasoning line. Code computes the amount and validates it against the hold.
- **Receipts:** the AI writes donation receipt text (fair-market-value wording).

**AI proposes, code decides money.** The model never gates a bid, a capture, a void or a payout. Without any AI key, canned lines are used and everything still works.

## Architecture
Next.js 16 (App Router, TypeScript), in-memory state with SSE-style polling, REST to PayPal, hosted on Render. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Internal API contract: [docs/API.md](docs/API.md).

## Quick start for judges

### (a) Demo mode, no keys
```bash
npm install
npm run dev
```
Open http://localhost:3000, then:
- `/stage` the big-screen auction (click to enable sound)
- `/paddle` register a paddle or an absentee agent
- `/admin` control room: money board and close

With no PayPal keys, holds, captures, voids, payouts and receipts are simulated with `DEMO-...` ids. The full flow is playable.

### (b) Real PayPal sandbox mode
```bash
cp .env.example .env.local   # fill in values, then npm run dev
```

| Variable | Purpose |
|---|---|
| `PAYPAL_ENV` | `sandbox` (default) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox REST app (server only). Setting the client id turns demo mode off |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same client id, for the browser |
| `PAYPAL_WEBHOOK_ID` | Webhook registered for `<APP_BASE_URL>/api/webhooks/paypal` |
| `TREASURER_PAYPAL_EMAIL` | Sandbox account that receives the payout |
| `GEMINI_API_KEY` | Gemini key from aistudio.google.com/apikey (optional; `GEMINI_MODEL` overrides the model) |
| `ANTHROPIC_API_KEY` | Optional; use Claude instead (`ANTHROPIC_MODEL` overrides the model) |
| `APP_BASE_URL` | Public URL, e.g. `http://localhost:3000` |
| `DEMO_MODE=1` | Force demo mode even with keys set |

Sandbox test accounts (buyers, treasurer): not required. Use the "Use sandbox test card" option on /paddle to create real sandbox holds with no login (buyer logins for the PayPal popup are provided to judges in the Devpost testing notes).

## Testing walkthrough (about 4 minutes)
1. Open `/stage` on a laptop and click to start sound.
2. In another window open `/paddle`. Create a paddle (sandbox test-card option creates a real sandbox hold without logging in, or approve with a sandbox buyer). Make a second paddle.
3. Optional: create an absentee agent with a sentence like "cabin weekend, up to $400".
4. Start a lot in `/admin` or on stage. Bid from the paddle windows; Gus reacts and the agent bids with its reasoning shown.
5. Let it go once, twice, sold. Repeat for another lot.
6. Click Close in `/admin`. Expect one capture per winner (less than the hold), voids for the rest, a payout to the treasurer, and a receipt per winner.
7. Check the PayPal sandbox dashboard (Activity) to confirm.

## Sponsor tools
- **PayPal:** Orders, Payments (authorize, capture, void), Payouts, Invoicing, Webhooks; PayPal AI Toolkit plugin and REST docs.
- **APIMatic:** Context Plugin for PayPal [VERIFY-if-used].
- **Render:** hosting.

## Built with Claude Code, multi-agent
Built with Claude Code using Claude Fable, Opus and Sonnet as parallel agents (engine, PayPal library, UI, AI layer, docs), coordinated against a shared API contract ([docs/API.md](docs/API.md)).

## License
MIT. See [LICENSE](LICENSE).
