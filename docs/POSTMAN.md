# Postman: run the judge flow in one click

The repo ships a Postman Collection (v2.1) and environment that drive the whole auction through the public API
and assert the money rules with `pm.test`:

- `docs/postman/GoingTwice.postman_collection.json`
- `docs/postman/GoingTwice.postman_environment.json` (`baseUrl`, `room`)

## Import (Postman app)

1. **Import** (top left) -> drop both files from `docs/postman/`.
2. Pick the **Going Twice (local)** environment (top right) and set `baseUrl`: `http://localhost:3510` for a local
   `next start -p 3510`, or the Render URL. Leave `room` empty: the first request creates a fresh room and stores it.
3. Right-click the collection -> **Run collection** -> Run. Run the folders in order (the default).

## Command line (Newman)

```bash
npx newman run docs/postman/GoingTwice.postman_collection.json \
  -e docs/postman/GoingTwice.postman_environment.json --env-var baseUrl=http://localhost:3510
```

## What it does

| Folder | Requests | Key assertions |
|---|---|---|
| 1. Room | `GET /api/room/new`, `POST /api/reset` | fresh 6-char room; lobby with lots and no paddles |
| 2. Paddles | 3 x `POST /api/paddle` `{testCard:true}` ($200/$300/$150), `POST /api/agent` (absentee AI, quilt up to $120, $150 hold), `GET /api/state` | each paddle `held`; `totals.held == 800`; one `authorized` ledger row per paddle |
| 3. Live bidding | start pizza lot, bids $40 / $45, a too-low bid and an over-the-hold bid (both refused), $60, hammer; start quilt, poll until the absentee agent bids, a human counter-bid, hammer | refused bids come back `ok:false` with a reason; pizza sold to Avery for $60; agent is high bidder on the quilt and never exceeds its cap |
| 4. Close | `POST /api/close` twice, `GET /api/payout/retry`, `GET /api/state` | status `closed`; **every capture < that paddle's hold**; one capture per winner; **non-winners voided** (Casey); `totals.held == 0`; **payout == captured**; second close adds no ledger rows; receipt per winner |

In live sandbox mode every id in the ledger is a real PayPal id (authorizations, captures, voids, payout batch,
invoices); in demo mode they are `DEMO-...`. The Final state request logs the ledger to the Postman console.

## Verified

Newman 6.2.3 against `next start -p 3510`:

- live PayPal sandbox: 24 requests, **57 assertions, 0 failed** (captured $160, released $450, paid out $160, real payout batch);
- demo mode: 23 requests, **56 assertions, 0 failed**.

(The agent poll repeats itself with `pm.execution.setNextRequest` until the agent has bid, so the request count varies by one or two.)
