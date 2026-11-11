#!/usr/bin/env node
// End-to-end AUTOPILOT gala against a running server (live PayPal sandbox, or demo mode).
//   node --env-file=.env.local scripts/autopilot-flow.mjs [baseUrl]   (default http://localhost:3405)
// Server: e.g. `PERSIST=0 TICK_SPEED=3 npx next start -p 3405`. A scripted human paddle joins and
// bids too. Asserts: >=3 lots sold, no paddle over its hold, winners captured below the hold,
// everyone else voided, payout = captured. Exits non-zero if any assertion fails.

const BASE = (process.argv[2] || "http://localhost:3405").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return { status: res.status, json };
}
const state = async () => (await api("GET", "/api/state")).json;
const isReal = (id) => typeof id === "string" && id.length > 5 && !id.startsWith("DEMO-");

// Optional direct PayPal cross-check.
const PP_BASE = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let ppToken;
async function ppGet(path) {
  for (let k = 0; k < 3; k++) {
    try {
      return await ppGet1(path);
    } catch {
      ppToken = undefined; // flaky network: retry
    }
  }
  return null;
}
async function ppGet1(path) {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) return null;
  if (!ppToken) {
    const r = await fetch(PP_BASE + "/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${process.env.PAYPAL_CLIENT_ID.trim()}:${process.env.PAYPAL_CLIENT_SECRET.trim()}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    ppToken = (await r.json()).access_token;
  }
  const r = await fetch(PP_BASE + path, { headers: { Authorization: `Bearer ${ppToken}` } });
  return r.ok ? r.json() : { httpStatus: r.status };
}

async function main() {
  console.log(`Going Twice AUTOPILOT flow against ${BASE}`);
  const health = (await api("GET", "/api/health")).json;
  const live = health.demoMode === false;
  console.log(`  mode: ${live ? "LIVE PayPal sandbox" : "demo (simulated)"}`);

  await api("POST", "/api/reset");
  const joinBody = { name: "Judge Jess", holdAmount: 300, testCard: true, email: "judge.gt-test@example.com" };
  // The first PayPal call after a cold server start can hit a transient network error: retry once.
  const human = (await api("POST", "/api/paddle", joinBody).catch(async () => (await api("POST", "/api/reset"), api("POST", "/api/paddle", joinBody)))).json;
  check(Boolean(human.paddleId), "human paddle joined");

  const started = await api("POST", "/api/autopilot", { action: "start", autoClose: true });
  check(started.status === 200 && started.json.running === true, "autopilot started");
  const again = await api("POST", "/api/autopilot", { action: "start" });
  check(again.status === 409, "second start is refused (max 1 autopilot)");

  // The human bids on the quilt now and then; everything else is autopilot.
  const t0 = Date.now();
  let status;
  while (Date.now() - t0 < 6 * 60 * 1000) {
    status = (await api("GET", "/api/autopilot")).json;
    if (!status.running) break;
    const s = await state();
    const lot = s.lots.find((l) => l.id === s.currentLotId && l.status === "open");
    if (lot && lot.id === "lot-quilt" && lot.highPaddleId !== human.paddleId) {
      await api("POST", "/api/bid", { paddleId: human.paddleId, lotId: lot.id, amount: lot.highPaddleId ? lot.highBid + lot.increment : lot.startPrice });
    }
    await sleep(2500);
  }
  check(status && !status.running && status.phase === "done", `autopilot finished (phase=${status?.phase}; "${status?.message}"; ${status?.aiCalls} model calls)`);

  const s = await state();
  const sold = s.lots.filter((l) => l.status === "sold");
  console.log("  lots:", s.lots.map((l) => `${l.title}=${l.status}${l.finalPrice ? " $" + l.finalPrice : ""}${l.winnerPaddleId ? " -> " + s.paddles.find((p) => p.id === l.winnerPaddleId)?.name : ""}`).join(" | "));
  check(s.status === "closed", "auction closed by autopilot");
  check(sold.length >= 3, `>=3 lots sold (${sold.length})`);

  const agentBids = s.events.filter((e) => e.type === "agent-bid");
  check(agentBids.length >= 3, `agent-bid events with reasoning visible (${agentBids.length} in last 50)`);
  if (agentBids[0]) console.log(`  sample: ${agentBids[agentBids.length - 1].text}`);

  let capturedSum = 0;
  for (const p of s.paddles) {
    const won = sold.filter((l) => l.winnerPaddleId === p.id).reduce((a, l) => a + l.finalPrice, 0);
    check(won <= p.holdAmount, `${p.name}: won $${won} <= hold $${p.holdAmount}`);
    const cap = s.ledger.find((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED");
    const voided = s.ledger.find((r) => r.kind === "voided" && r.paddleId === p.id && r.status !== "FAILED");
    if (won > 0) {
      check(p.status === "captured" && cap && Math.abs(cap.amount - won) < 0.005, `${p.name}: captured $${cap?.amount} (= won), hold $${p.holdAmount}`);
      check(!live || isReal(cap?.paypalId), `${p.name}: capture id ${cap?.paypalId}`);
      capturedSum += cap?.amount ?? 0;
    } else {
      check(p.status === "voided" && Boolean(voided), `${p.name}: hold voided`);
    }
    if (live && p.authorizationId) {
      const a = await ppGet(`/v2/payments/authorizations/${p.authorizationId}`);
      if (a) console.log(`       PayPal says authorization ${p.authorizationId}: ${a.status ?? a.httpStatus}`);
      check(!a || (won > 0 ? ["CAPTURED", "PARTIALLY_CAPTURED"].includes(a.status) : a.status === "VOIDED"), `${p.name}: PayPal authorization state consistent`);
    }
  }
  const payout = s.ledger.find((r) => r.kind === "payout" && r.status !== "FAILED");
  check(Boolean(payout) && Math.abs(payout.amount - capturedSum) < 0.005 && Math.abs(s.totals.paidOut - s.totals.captured) < 0.005, `payout $${payout?.amount} = captured $${capturedSum}`);
  check(!live || isReal(payout?.paypalId), `payout batch id ${payout?.paypalId}`);

  console.log(failures ? `\n${failures} assertion(s) FAILED` : "\nAll autopilot assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
