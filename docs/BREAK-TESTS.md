# Break tests (hostile-judge pass)

`scripts/break-tests.mjs` (no dependencies) attacks a running server the way a hostile judge would: racing
bids, double closes, garbage input, odd room codes, and PayPal failures injected in the middle of a close.

```bash
npm run build
# main server: live sandbox keys from .env.local, fault-injection hooks ON (never in production)
GT_TEST_HOOKS=1 TICK_SPEED=10 npx next start -p 3510
# optional second server for the "PAYPAL_ENV=live" and "no Gemini key" cases
PAYPAL_ENV=live GEMINI_API_KEY= GEMINI_API_KEYS= PERSIST=0 npx next start -p 3512

LIVEENV_URL=http://localhost:3512 NOKEY_URL=http://localhost:3512 node scripts/break-tests.mjs http://localhost:3510
# demo mode works too: DEMO_MODE=1 GT_TEST_HOOKS=1 PERSIST=0 npx next start -p 3511
```

`ONLY=case1,case2` runs a subset; `BT_MARKDOWN=1` also prints the results table. Exit code is non-zero on any FAIL.

**Fault injection.** `POST /api/test/hooks?room=X` `{failPayout:"INSUFFICIENT_FUNDS", times, failCapture, gemini429}`
makes the next N payouts / captures in that room (or N Gemini calls, globally) fail before any PayPal or Google
call. It answers 404 unless the server runs with `GT_TEST_HOOKS=1`, and is always off when `PAYPAL_ENV=live`.

## Results (Nov 12, final run)

Live PayPal sandbox (`next start -p 3510`, real test-card authorizations, captures, voids and Payouts): **22 passed, 0 failed, 0 skipped**.
Demo mode (`DEMO_MODE=1`): **19 passed, 0 failed, 3 skipped** (the skipped cases need live PayPal or the second server).

| Case | Expected | Result | Fix (bug found) |
|---|---|---|---|
| concurrent-same-bid | Two paddles bid the same amount in the same ms: exactly one wins, exposure counted once | PASS: 1 accepted, loser told "Bid must be at least $45" | none needed (`placeBid` is synchronous, so atomic in Node) |
| bid-storm-invariant | 40 racing bids from 2 paddles: each paddle's `committed` equals the high bid it holds; never over hold | PASS: 20 accepted, invariant holds | none needed |
| bid-over-headroom | Bid above the hold is refused with the room left | PASS: "That would go over your $40 hold (room left: $40)" | none needed |
| bid-wrong-lot-state | Bids on a pending lot, a sold lot, unknown ids, garbage amounts (`"abc"`, -5, 1e12, 75.001, null, `{}`), non-JSON body: refused, never 5xx | PASS: 13 refused | none needed |
| garbage-paddle-input | Negative / zero / huge / `"NaN"` / string / 3-decimal holds, empty / 41-char / non-string names, bad email, non-JSON: 400. XSS name stored verbatim and returned as JSON text, not present in any server HTML. Bidi/zero-width characters stripped | PASS: 14 bad registrations 400; XSS round-trips as text | **Bug:** names like `"‮Evil"` (right-to-left override) could flip the stage text. **Fix:** `text()` in `src/lib/auction/http.ts` strips control, zero-width and bidi characters from names, agent instructions and lot titles |
| paddle-number-race | 5 parallel registrations get 5 distinct paddle numbers | PASS: 101..105 | **Bug:** the number was `100 + paddles.length + 1`, computed before the PayPal await, so parallel test-card registrations (autopilot creates its 3 bidders with `Promise.all`) shared a number, and the capture `invoice_id` / receipt invoice number (`GT-<auction>-<number>`) collided. **Fix:** number reserved synchronously from `Internal.paddleNo` |
| double-close | Two concurrent closes plus a third: one capture per winner, one void per loser, one payout, third close adds no rows; afterwards bids / lot starts / paddles are refused | PASS: captured $120, 1 void, paid out $120 | none needed for the money (shared in-flight promise); late writes were already refused once `closed` |
| close-zero-bids | Paddles but no bids: all voided, $0 captured, no payout row, `closed` | PASS: `payoutStatus.state = "none"` | none needed |
| close-empty-room | Close a room with no paddles | PASS | none needed |
| close-with-unauthorized-paddle | Lot hammered; one paddle never approved its PayPal order. Close settles the rest; authorizing that paddle afterwards is refused | PASS: late authorize 409 | **Bug:** `/api/paddle/:id/authorize` after close placed a real hold that nothing would ever capture or void. **Fix:** authorize refuses once a close has started; if a reset/close lands while the authorize call is in flight, the fresh authorization is voided and the call returns 409. Double-clicked authorize calls share one PayPal call (no duplicate ledger rows) |
| testcard-when-live-env | `PAYPAL_ENV=live` server refuses `testCard:true` with 400 before any PayPal call; test hooks 404 | PASS | none needed |
| autopilot-start-twice | Two concurrent starts: one 200, one 409 | PASS: 200/409 | none needed (slot claimed before the first await) |
| reset-during-autopilot | Reset while autopilot runs, and while it is still placing its holds: loop stops, the fresh auction has no leaked paddles | PASS: "The auction was reset, so autopilot stopped."; reset during setup: start 409, 0 leaked paddles | **Bug:** a reset during a test-card authorization pushed the new paddle into the discarded auction, leaving a live sandbox hold nobody would void. **Fix:** `abandonIfStale()` re-checks the auction id after every PayPal await and voids the orphan hold; reset / type switch now also void the old auction's live holds (best effort) and are refused while a close is running |
| room-codes | `../../etc/passwd`, 5000 chars, `<script>`, `%00`, unicode, spaces, header variants: never 5xx, never touch a file outside `.data/state-<CODE>.json` | PASS: fall back to `MAIN` | none needed (regex-gated codes) |
| 300-rooms | 300 rooms: at most 200 in memory (LRU), a room holding paddles survives, polling unknown codes allocates nothing | PASS: 200 in memory; keeper kept; evicted room reloaded from disk | **Bug:** every `GET /api/state?room=<random>` created a room, so a scanner could evict real rooms, and with `PERSIST=0` an evicted room (holds and all) was simply lost. **Fix:** GET `/api/state` and `/api/health` use `peekState()` (shared pristine lobby for unused codes, no allocation); eviction with `PERSIST=0` drops empty rooms first and only overflows softly (up to 2x) rather than lose a live one |
| snap-bad-input | Non-image bytes labelled image/png, wrong mime, text file via multipart: 400. Over 4 MB: 413. Gemini rate-limited on every key and model: 429 + `Retry-After` | PASS: 400/413/400/400; 429 | **Bugs:** a renamed non-image was sent to Gemini (quota burnt) and came back as a generic 422; an all-429 Gemini answer also showed as "could not recognize". **Fix:** magic-byte check, early `content-length` check (413), and `recognizeItem` now reports `rate-limited` -> 429 with a readable message |
| report-agent-input | Bad JSON / missing or malformed body: 400, never 5xx | PASS | **Fix:** body must be a Gemini `contents[]` body, 512 KB cap, 20 requests/min per instance (the route spends the server's Gemini quota) |
| report-agent-no-key | Server with no Gemini key: `GET` says `configured:false`, `POST` 503 with a readable message, snap 503 | PASS | **Bug:** with only `GEMINI_API_KEYS` set (no `GEMINI_API_KEY`), report agent, Snap-a-lot, TTS and the Gemini fallback all claimed "not configured". **Fix:** all use `geminiKey()` (first of either variable) |
| webhook-hostile | Forged signature, unknown ids, junk body, array body: 200, ignored, ledger unchanged | PASS | none needed |
| payout-insufficient-funds | Payout fails with INSUFFICIENT_FUNDS mid-close: captures and voids final, status `closed`, a `PENDING_RETRY` row noted "payout pending — retry"; `POST /api/payout/retry` retries only the payout: a failing retry says so (502), concurrent retries pay once, later retries are no-ops | PASS (live: real sandbox payout batch sent on the retry) | **Bug:** a failed payout left the auction `live` and stuck: "close again" was the only path, and nothing told the organizer captures were already done. **Fix:** see "Payout pending" below |
| capture-fails-mid-close | One capture fails: room frozen (bids, new paddles, lot starts refused), re-close captures only the failed one, never twice | PASS: captured $115 = paid out | **Bug:** between a partly failed close and the retry, the auction was still `live`: new paddles (real holds) could join and new lots open, and they would be settled by a close the organizer thought was a retry. **Fix:** `Internal.closeStarted` freezes the room from the first close on |
| cold-start-cheap | `/api/health` and `/api/state` fast, `no-store`, never create rooms | PASS: health median 3 ms, state 2 ms / 1.3 KB | `/api/health` no longer creates or touches room state; both are read-only (Render free tier spins down; the first request only pays the Node start) |

## Payout pending (what the UI shows)

When the Payouts batch fails (e.g. `INSUFFICIENT_FUNDS` on the business balance), the close still finishes:
every winner is captured, every other hold is voided, receipts go out, and `state.status` is `"closed"`. Then:

- the ledger has one `payout` row with `status: "PENDING_RETRY"` and a note starting `payout pending — retry (POST /api/payout/retry): ...`;
- `state.payoutStatus = { state: "retry", amount, error, attempts }` (`"sent"` with `batchId` once paid, `"none"` when nothing was captured);
- `totals.paidOut` stays 0 until the retry succeeds.

`GET /api/payout/retry?room=X` returns `{available:true, pending}`. `POST /api/payout/retry?room=X` (optional body `{ledgerId}`)
re-sends only the payout with the same `sender_batch_id` (`close-<auctionId>`, which PayPal never pays twice) and a fresh
PayPal-Request-Id per attempt. On success the pending row becomes `RETRIED`, new `payout` rows are added and
`totals.paidOut == totals.captured`. Still failing: HTTP 502 with `{ok:false, error}`. Already paid: `{ok:true, retried:false}`.
`POST /api/close` on a closed auction never moves money (unchanged).
