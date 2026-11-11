# Gala Report (`/report`)

A post-auction (or live) dashboard for the PTA chair, built with **AG Studio** and the **Studio Agent Framework**.
Route: `/report` (add `?room=ABC` to read a specific room; the param is forwarded to `GET /api/state`). It is not linked from other pages.

## What is on the page
- **Overview**: KPI tiles, the **Money flow** widget, the **Paddle board** widget, hammer price vs estimated value, and a lots grid.
- **Ledger and bids**: PayPal ledger grid (kind, amount, PayPal id, status), events by type, bid/event log.
- **Edit report** switches Studio to edit mode: drag, resize, add widgets, and open the **AI Assistant** panel.
- **Load sample gala data** (shown when the auction has no sold lots or ledger yet, and "Load sample data" in the header otherwise) swaps in a clearly labelled, client-side sample dataset. It is never sent anywhere.

## Data
`GET /api/state` is polled every 5 s and turned into four Studio sources (`src/components/report/data.ts`):

| Source | Rows | Notable fields |
|---|---|---|
| `lots` | one per lot | final price, FMV, above-FMV donation, winner, bids, seconds to sold |
| `events` | auction event log | time, type, lot, paddle |
| `ledger` | PayPal money movements | stage (Held / Captured / Released / Paid out), amount, PayPal id, status |
| `paddles` | one per paddle | hold, committed, captured, PayPal status |

## Custom widgets (`src/components/report/widgets.tsx`)
Both register through `createWidgets` (`additionalTypes` + a "Gala" menu group), read data through `widgetApi.getData`, and declare `formatShape` + `ai` metadata so agents can place and configure them.
- **Money flow** (`money-flow`): sankey-style ribbons Held to Captured / Released / Still on hold, and Captured to Paid out. Mapping: `ledger.stage` + sum of `ledger.amount`.
- **Paddle board** (`paddle-board`): per-paddle bars for hold vs committed vs captured with a PayPal status chip. Mapping: `paddles.paddle`, `paddles.status`, sums of hold/committed/captured.

## Studio Agent Framework (Gemini)
- `src/components/report/gemini-adapter.ts`: a small custom `AgLlmAdapter` (one turn = one Gemini `generateContent` call; tool schemas go through `parametersJsonSchema`; Gemini 3 thought signatures are echoed back).
- `src/components/report/ai.ts`: `createAiHarness` with Studio's five built-in agents on `directLlmRunner`, and the lead replaced by a "Gala analyst" (built-in lead prompt + auction domain rules). It delegates to the built-in data / widget / page agents.
- `src/app/api/report-agent/route.ts`: server proxy that holds `GEMINI_API_KEY`. Model `gemini-2.5-flash` (override with `GEMINI_REPORT_MODEL`); on a 429 (free-tier daily quota) or 404 it falls through to `gemini-3.5-flash`, then `gemini-3.5-flash-lite`. `GET /api/report-agent` returns `{configured}`; without the key the AI panel is hidden and the page says so.

Try in Edit mode: "Which lots sold above their estimated value?", "Show captured vs released by paddle".

## Environment
| Variable | Needed | Notes |
|---|---|---|
| `GEMINI_API_KEY` | for the agent | server only |
| `GEMINI_REPORT_MODEL` | no | default `gemini-2.5-flash` |
| `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` | no | **Optional.** Without it AG Studio runs in trial mode: a watermark is shown and a license notice is logged to the browser console (as console errors). Set a trial or paid key to remove both. |

Dependencies added: `ag-studio@3.0.0`, `ag-studio-react@3.0.0` (same version as the AG Grid Studio boilerplate).
