# Going Twice

**Going Twice turns any live auction into a one-tap checkout: every paddle is a PayPal authorization hold, an AI auctioneer runs the room, and the gavel settles everyone.**

Built for charity galas first, and also for estate and consignment sales, art and collectibles (with a buyer's premium) and farm auctions.

- **Live app:** https://going-twice.onrender.com
- **Video (under 3 minutes):** https://youtu.be/u8RJl0X-BTE
- Everything runs in the **PayPal sandbox**. No real money moves.

## Try it in two minutes

No sign-in and no keys are needed on the live app.

1. Open https://going-twice.onrender.com. The first load can take up to a minute while the free server wakes.
2. Click **Watch the demo auction**, then **Start the demo, with sound**.
3. The demo page shows the whole system side by side, for about four minutes:
   - **The auction:** the lot, the current bid, and Gus, the AI auctioneer, calling it out loud.
   - **The AI bidders:** three bidders, each with a real PayPal sandbox hold. Every decision is listed with who made it: Gemini, or a rule in code (for example, "over my limit").
   - **PayPal, live:** every request the server sends to PayPal, with the id PayPal returned.
   - **Under the hood:** what each service (PayPal APIs, Gemini, Kokoro, AG Studio, Bryntum, Channel3, Render) is doing in this auction.
4. When it settles, open **Every PayPal call for this auction**, the **settlement report** (AG Studio) or the **hold timeline** (Bryntum).

To bid against the AI bidders yourself, click **Bid yourself** while the demo runs and use the sandbox test card.

## Then run your own

The demo shows how it works. Your own auction is the product itself.

- **Host an auction** creates a private room with its own **room code**. The Host page shows the code and a QR code, and walks through four steps:
  1. **Set it up.** Name the event, pick the auction type and add lots. You can photograph an item and let the app draft the lot.
  2. **Bring in bidders.** Put the stage on a big screen. Bidders join with the code or the QR, and PayPal holds the amount they choose. That hold is their paddle.
  3. **Run each lot.** Press Start. Gus calls the bids, and the hammer falls by itself when bidding stops.
  4. **Close and settle.** One button. PayPal charges each winner what they won, releases every other hold, pays out the proceeds and sends receipts.
- **Join an auction**: type a room code on the home page to bid, or to watch its stage.

The **PayPal** page in the top bar follows the money for whichever room you are in.

## The problem

Live auctions still end with a payment line. Winners leave early, bids get ghosted, cards fail the next day, and volunteers or staff chase the money for weeks. The auction is the fun part. The checkout is where the money leaks.

Going Twice moves the checkout to the start. A bidder approves one PayPal hold when they pick up a paddle, so every bid in the room is already backed by held funds, and closing the auction is a single button.

## How PayPal is used

Plain REST against the sandbox, no SDK (`src/lib/paypal`).

| API | Call | What it does here |
|---|---|---|
| Orders v2 | `POST /v2/checkout/orders` with `intent=AUTHORIZE`, then `/authorize` | The paddle: a hold that is also the bidder's spending limit |
| Payments v2 | `POST /v2/payments/authorizations/{id}/capture` with `final_capture: true` | Charges a winner exactly what they won, which is less than the hold; the rest is released |
| Payments v2 | `POST /v2/payments/authorizations/{id}/void` | Releases the hold of every bidder who won nothing |
| Payouts v1 | `POST /v1/payments/payouts` | Sends the proceeds to the organizer. For estate sales one batch splits each lot between its consignor and the house commission |
| Invoicing v2 | create, send, record payment | The receipt: a PayPal invoice already marked paid |
| Webhooks | `POST /api/webhooks/paypal`, signature verified | Confirms captures, voids and payouts |

Details that matter for real money:

- **Bids are checked in code against the hold.** A bidder can never win more than PayPal has authorized.
- **Idempotency.** Every call carries a deterministic `PayPal-Request-Id`, so a retried close cannot charge twice. A `DUPLICATE_TRANSACTION` reply is resolved by looking up the capture that already exists.
- **Failure handling.** Timeouts, retries with backoff, token refresh on 401, and typed errors. If the payout fails (for example, insufficient sandbox balance), the captures and releases still complete and the payout can be retried on its own.

## How AI is used

The model is Google **Gemini**, through the Gemini API. The rule throughout is **AI proposes, code decides money**: a model never sets an amount, and never gates a capture, a void or a payout.

| Where | What the model does | What code does |
|---|---|---|
| **Gus, the auctioneer** | Writes one sentence per lot that sells it to the room (one call for the whole catalogue) | Builds every other line, decides pacing, and calls going once, going twice, sold |
| **Absentee bidding agent** | Reads a bidder's one-sentence instruction ("the cabin weekend, up to $400") and judges whether a lot matches | Computes the bid, and enforces the bidder's limit and hold |
| **AI bidders in the demo** | Decide in character whether to raise | Pick the amount, the timing and the limits |
| **Snap a lot** | Reads a photo of an item and drafts the title and description | Looks up retail listings through Channel3 and derives the estimated value |
| **Receipts** | Writes the receipt text | Supplies every number |
| **Report assistant** | Answers questions about the settled auction in the report | Runs the queries on the auction's own data |

Without a Gemini key the app still works: each lot's own description is used as Gus's sentence, and the agent falls back to keyword matching.

### Gus's voice

Gus speaks with **Kokoro-82M**, an open-source text-to-speech model (Apache-2.0, https://github.com/hexgrad/kokoro). There is one voice and no paid speech API.

- Lines known in advance (the fixed calls, money amounts, the sample catalogues) are rendered with Kokoro ahead of time into `public/gus/clips`, so a bid is answered within half a second. `scripts/gus-clips.mjs` and `scripts/gus-clips.py` regenerate them.
- Anything else (a custom lot, a bidder's name, the sentence Gemini wrote) is rendered by the same Kokoro voice in the browser, in a web worker (`public/gus/worker.js`, using kokoro-js). The stage prepares these before they are needed.
- When a bid arrives, Gus stops whatever he was saying and answers the bid.

## Sponsor tools

| Tool | Where it is used |
|---|---|
| **AG Grid / AG Studio** | `/report`: the settlement report, with custom widgets and an assistant that answers questions about the auction |
| **Bryntum Scheduler** | `/timeline`: each paddle's hold on a timeline, from authorization to capture or release |
| **Channel3** | Snap a lot: retail listings for a photographed item, used to estimate its fair market value |
| **Render** | Hosting (`render.yaml`). A Render Workflows settlement is implemented in `workflows/` and is off by default; see `docs/WORKFLOWS.md` |
| **APIMatic** | Its PayPal skills guided the REST client's timeouts, retries and typed errors; notes in `docs/APIMATIC.md` |
| **Postman** | `docs/postman`: a collection that runs the whole flow against a server (58 assertions) |

AG Studio and Bryntum run on trial licences.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

With no keys at all the app runs in **demo mode**: holds, captures, releases, payouts and receipts are simulated with `DEMO-…` ids, and the whole flow is playable.

For real sandbox calls, copy `.env.example` to `.env.local` and fill it in:

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | A PayPal sandbox REST app |
| `PAYPAL_WEBHOOK_ID` | Optional: verifies webhook signatures |
| `TREASURER_PAYPAL_EMAIL` | Sandbox account that receives the payout |
| `SANDBOX_BUYER_EMAILS` | Sandbox buyer emails (no passwords) for test-card receipts and default consignors |
| `GEMINI_API_KEY`, `GEMINI_API_KEYS` | Gemini key, plus optional extra keys that are rotated when one is rate limited |
| `APP_BASE_URL` | The app's own URL |

## Tests

Each script takes the server URL, so the same checks run locally and against the live app.

```bash
node --env-file=.env.local scripts/live-flow.mjs http://localhost:3000       # full charity flow with real sandbox calls
node --env-file=.env.local scripts/autopilot-flow.mjs http://localhost:3000  # the demo auction
node scripts/break-tests.mjs http://localhost:3000                           # failure cases
```

`AUCTION_TYPE=estate` (or `collectibles`, `farm`) runs `live-flow.mjs` for another auction type. The Postman collection is described in `docs/POSTMAN.md`, and the failure cases in `docs/BREAK-TESTS.md`.

## Architecture

Next.js 16 (App Router, TypeScript, Tailwind), REST to PayPal, hosted on Render. Each auction is a room with its own state; pages poll `/api/state`. More in `docs/ARCHITECTURE.md` and `docs/API.md`.

## Limits

- Sandbox only. Rooms live in the server's memory, so a redeploy clears them.
- Estimated values on charity receipts are estimates from retail listings, not tax advice.
- The free Render instance sleeps when idle, so the first request can take up to a minute.
- Gus's voice for custom text needs a one-time download of about 90 MB in the browser. Pre-rendered lines play without it.

## License

MIT. See `LICENSE`.
