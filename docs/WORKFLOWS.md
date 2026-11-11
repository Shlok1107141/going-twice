# Settlement on Render Workflows

When the auction closes, Going Twice settles every paddle: one PayPal capture per winner, a void for
everyone else, one Payouts batch to the treasurer, then receipts. With `RENDER_WORKFLOWS=1` that work runs as a
**Render Workflow** (TypeScript SDK `@renderinc/sdk`), fanned out across Render instances. Without it,
the original in-process settlement runs, so local and demo mode are unchanged.

## Shape

```
POST /api/close -> engine.close() -> settle()                      (src/lib/settlement/index.ts)
  in-process (default)   engine.doClose(), as before
  Render Workflows       build SettlementPlan -> render.workflows.startTask("<slug>/settleAuction", [plan])
                           settleAuction (workflows/tasks.ts)
                             1. fan out  captureWinner x N  +  voidHold x M    (ctx.run, one instance each)
                             2. wait for all
                             3. sendPayout   (one batch, amount = what was actually captured)
                             4. fan out  issueReceipt x K   (winners whose capture succeeded)
                         -> results applied to the ledger: "... settled by Render Workflows run <id>"
```

- **Idempotent.** Leaf tasks reuse the `PayPal-Request-Id` keys already in `src/lib/paypal/*`
  (`capture:<auth>:<amount>`, `void:<auth>`, `payout:close-<auction>`, `invoice:<number>`), so a Render retry
  can never move money twice. The run itself is started with an idempotency key (hash of the plan + ledger
  length), so a re-sent close re-attaches to the in-flight run instead of starting another.
- **Retries.** Each leaf task has Render's retry policy (`maxRetries: 3`, 1 s base, x2 backoff). Transient
  errors (network, 429, 5xx) throw and are retried; permanent PayPal refusals (declined, invalid) return
  `ok:false` and are recorded as `FAILED` ledger rows. As in-process, any failed capture/void stops before the
  payout, and closing again retries only what failed.
- **Receipt text** (Claude) is written by the web app before the run and passed in the plan, so workflow
  instances need only PayPal credentials, not the auction state or AI keys.
- If the run is still going after ~105 s (route limit is 120 s) the close returns and says so; close again to
  re-attach and collect results.

## Files

| Path | Role |
| --- | --- |
| `workflows/tasks.ts` | The five tasks (`captureWinner`, `voidHold`, `sendPayout`, `issueReceipt`, root `settleAuction`) |
| `workflows/index.ts` | Workflow service entry (`npx tsx workflows/index.ts`) |
| `workflows/mock-server.ts` | Dev-only stand-in for `render workflows dev` (port 8120) |
| `src/lib/settlement/steps.ts` | The four PayPal steps, state-free, shared by the tasks |
| `src/lib/settlement/index.ts` | `settle()`: executor choice, plan builder, run trigger, ledger apply |
| `render.yaml` | `type: workflow` service `going-twice-settlement` + web-service env vars |

## Env

| Where | Var | Notes |
| --- | --- | --- |
| web | `RENDER_WORKFLOWS=1` | turns the executor on (anything else = in-process) |
| web | `RENDER_API_KEY` | Render API key; the SDK reads it automatically |
| web | `RENDER_WORKFLOW_SLUG` | workflow service slug, `going-twice-settlement` (task slug is `<slug>/settleAuction`) |
| workflow | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` | same PayPal app as the web service |

If `RENDER_WORKFLOWS=1` but key/slug are missing, the app logs a warning and settles in-process.

## Deploy (dashboard)

1. Push the repo. Dashboard > **New > Blueprint** (or sync the existing Blueprint): it creates the web service
   and the `going-twice-settlement` workflow. Or create the workflow by hand: **New > Workflow**, link the repo,
   language Node, region = the web service's region, build `npm ci`, start `npx tsx workflows/index.ts`.
2. On the workflow: set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (and `PAYPAL_ENV=sandbox`). Deploy.
3. Workflow > Definitions should list the five tasks. Use **Run Task** on `settleAuction` to smoke test.
4. Account Settings > **API Keys** > create a key. On the web service set `RENDER_API_KEY`, `RENDER_WORKFLOWS=1`,
   `RENDER_WORKFLOW_SLUG` (the workflow's slug as shown on a task's page, `<slug>/<task>`).
5. Close an auction; the ledger rows read "settled by Render Workflows run trn-...", and the run appears under the
   workflow's Runs with the captures/voids as parallel child runs.

## Local development

- With the Render CLI (>= 2.35): `render workflows dev -- npx tsx workflows/index.ts` (port 8120), then run the
  app with `RENDER_USE_LOCAL_DEV=true RENDER_WORKFLOWS=1 RENDER_WORKFLOW_SLUG=going-twice-settlement`.
- Without the CLI: `npx tsx workflows/mock-server.ts` serves the same endpoints and executes the tasks in-process.
- Demo mode also goes through the workflow when enabled (the tasks return simulated `DEMO-...` ids).

## Pricing

Workflows run on per-task compute plans (default `flex`, per-second billing; see render.com/docs/workflows-limits).
A settlement run is a few seconds of 1 CPU per task, i.e. cents. Whether a workspace needs a paid plan to create
Workflow services is not stated in the docs; the hackathon credits imply a billing-enabled workspace.
