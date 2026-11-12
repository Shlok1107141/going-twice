#!/usr/bin/env node
// End-to-end LIVE (PayPal sandbox) flow against a running server. No deps (Node 20+).
//   node --env-file=.env.local scripts/live-flow.mjs [baseUrl]   (default http://localhost:3100)
// Server: live keys, PAYPAL_ENV=sandbox, e.g. `PERSIST=0 TICK_SPEED=10 npx next dev -p 3100`.
// Paddles use `testCard:true` (PayPal's sandbox test Visa), so every hold is a real sandbox
// authorization with no buyer login. If PAYPAL_CLIENT_ID/SECRET are in this process's env too,
// the script cross-checks authorization statuses directly with PayPal.
// Exits non-zero if any assertion fails.

const BASE = (process.argv[2] || "http://localhost:3100").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
// Each run uses its own fresh room so parallel judges/runs never collide.
const ROOM = process.env.ROOM || "T" + Date.now().toString(36).toUpperCase().slice(-8);
const inRoom = (path, room = ROOM) => `${path}${path.includes("?") ? "&" : "?"}room=${room}`;

function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + inRoom(path), {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 500) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const state = () => api("GET", "/api/state");
const lotOf = async (id) => (await state()).lots.find((l) => l.id === id);
const nextBid = (lot) => (lot.highPaddleId ? lot.highBid + lot.increment : lot.startPrice);
const bid = (paddleId, lotId, amount) => api("POST", "/api/bid", { paddleId, lotId, amount });
const isReal = (id) => typeof id === "string" && id.length > 5 && !id.startsWith("DEMO-");

async function runUntilClosed(lotId, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await api("POST", "/api/auctioneer/tick");
    const lot = await lotOf(lotId);
    if (lot.status !== "open") return lot;
    await sleep(300);
  }
  throw new Error(`lot ${lotId} never closed (is TICK_SPEED set?)`);
}

// Optional direct PayPal cross-check (same creds as the server).
const PP_BASE = (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let ppToken;
async function ppGet(path) {
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
  console.log(`Going Twice LIVE (sandbox) flow against ${BASE}`);
  const health = await api("GET", "/api/health");
  check(health.ok === true && health.demoMode === false, "health ok, server is NOT in demo mode");

  if (process.env.AUCTION_TYPE === "estate") return estateFlow();
  if (process.env.AUCTION_TYPE === "collectibles") return collectiblesFlow();

  const s0 = await api("POST", "/api/reset");
  check(s0.status === "lobby" && s0.paddles.length === 0, "reset -> lobby, no paddles");
  check(s0.testCards === true, "server allows sandbox test-card paddles");

  const mk = (name, holdAmount, email) => api("POST", "/api/paddle", { name, holdAmount, testCard: true, email });
  const dana = await mk("Dana R.", 300, "dana.gt-test@example.com");
  const marcus = await mk("Marcus T.", 150, "marcus.gt-test@example.com");
  const priya = await mk("Priya S.", 500, "priya.gt-test@example.com");
  const agent = await api("POST", "/api/agent", {
    name: "Grandma Jo",
    holdAmount: 200,
    instruction: "Get the pizza basket for the grandkids, up to $70",
    maxBid: 100,
    testCard: true,
    email: "jo.gt-test@example.com",
  });
  for (const [n, r] of [["Dana", dana], ["Marcus", marcus], ["Priya", priya], ["agent", agent]]) {
    check(r.held === true && typeof r.paddleId === "string" && !r.orderId, `${n}: test-card paddle held immediately (${r.error ?? r.paddleId})`);
  }
  let st = await state();
  for (const p of st.paddles) {
    check(p.status === "held" && isReal(p.authorizationId) && isReal(p.orderId), `#${p.number} ${p.name}: real sandbox auth ${p.authorizationId} (order ${p.orderId})`);
  }
  const auths = Object.fromEntries(st.paddles.map((p) => [p.id, p.authorizationId]));

  // Lot 1: pizza. Agent competes (cap $70 from its instruction), Marcus wins at $75.
  const pizza = "lot-pizza";
  await api("POST", "/api/lot/start", { lotId: pizza });
  let lot;
  for (let k = 0; k < 40; k++) {
    await sleep(250);
    lot = await lotOf(pizza);
    if (lot.highPaddleId) break;
  }
  check(lot.highPaddleId === agent.paddleId, `agent opened bidding at $${lot.highBid}`);
  check((await bid(dana.paddleId, pizza, nextBid(lot))).ok === true, "Dana outbids agent");
  for (let k = 0; k < 40; k++) {
    await sleep(250);
    lot = await lotOf(pizza);
    if (lot.highPaddleId === agent.paddleId) break;
  }
  check((await bid(marcus.paddleId, pizza, 75)).ok === true, "Marcus jumps to $75");
  await sleep(2500);
  lot = await runUntilClosed(pizza);
  check(lot.status === "sold" && lot.winnerPaddleId === marcus.paddleId && lot.finalPrice === 75, `pizza SOLD to Marcus for $${lot.finalPrice}`);

  // Lot 2: cabin. Priya wins at $250.
  const cabin = "lot-cabin";
  await api("POST", "/api/lot/start", { lotId: cabin });
  check((await bid(priya.paddleId, cabin, 200)).ok === true, "Priya opens cabin at $200");
  check((await bid(dana.paddleId, cabin, 225)).ok === true, "Dana $225");
  check((await bid(priya.paddleId, cabin, 250)).ok === true, "Priya $250");
  lot = await runUntilClosed(cabin);
  check(lot.status === "sold" && lot.winnerPaddleId === priya.paddleId && lot.finalPrice === 250, `cabin SOLD to Priya for $${lot.finalPrice}`);

  // Close: real captures, voids, payout, receipts.
  const t0 = Date.now();
  const closed = await api("POST", "/api/close");
  console.log(`  ..   close took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check(closed.status === "closed", "close -> status closed");
  const { paddles, lots, ledger, totals, receipts } = closed;
  const wonBy = (pid) => lots.filter((l) => l.status === "sold" && l.winnerPaddleId === pid).reduce((s, l) => s + l.finalPrice, 0);
  for (const p of paddles) {
    const caps = ledger.filter((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED");
    const voids = ledger.filter((r) => r.kind === "voided" && r.paddleId === p.id && r.status !== "FAILED");
    if (wonBy(p.id) > 0) {
      const c = caps[0];
      check(caps.length === 1 && c.amount === wonBy(p.id) && c.amount < p.holdAmount && isReal(c.paypalId) && c.status === "COMPLETED",
        `#${p.number} ${p.name}: capture ${c?.paypalId} $${c?.amount} < hold $${p.holdAmount}, ${c?.status}`);
      const a = await ppGet(`/v2/payments/authorizations/${auths[p.id]}`);
      if (a) check(["CAPTURED", "PARTIALLY_CAPTURED"].includes(a.status), `  PayPal says auth ${auths[p.id]} is ${a.status}`);
    } else {
      check(caps.length === 0 && voids.length === 1 && voids[0].paypalId === auths[p.id] && p.status === "voided", `#${p.number} ${p.name}: VOIDED ${voids[0]?.paypalId}`);
      const a = await ppGet(`/v2/payments/authorizations/${auths[p.id]}`);
      if (a) check(a.status === "VOIDED", `  PayPal says auth ${auths[p.id]} is ${a.status}`);
    }
  }
  const payout = ledger.find((r) => r.kind === "payout");
  check(payout && isReal(payout.paypalId) && payout.status !== "FAILED" && payout.amount === totals.captured, `payout batch ${payout?.paypalId} $${payout?.amount} ${payout?.status}`);
  if (payout && isReal(payout.paypalId)) {
    const b = await ppGet(`/v1/payments/payouts/${payout.paypalId}`);
    if (b) console.log(`  ..   PayPal payout batch status now: ${b.batch_header?.batch_status ?? JSON.stringify(b)}`);
  }
  const winners = paddles.filter((p) => wonBy(p.id) > 0);
  check(receipts.length === winners.length && receipts.every((r) => r.text.length > 40), `${receipts.length} receipts generated`);
  for (const r of ledger.filter((x) => x.kind === "receipt")) {
    check(r.status !== "FAILED", `receipt ${r.paypalId ?? "(no invoice)"} ${r.status}${r.note ? ` (${r.note})` : ""}`);
    if (r.paypalId) {
      const inv = await ppGet(`/v2/invoicing/invoices/${r.paypalId}`);
      if (inv) console.log(`  ..   PayPal invoice ${r.paypalId} status: ${inv.status ?? JSON.stringify(inv)}`);
    }
  }
  check(totals.held === 0 && totals.paidOut === totals.captured, `totals: captured $${totals.captured}, released $${totals.voided}, paid out $${totals.paidOut}`);

  const again = await api("POST", "/api/close");
  check(again.ledger.length === ledger.length, "second close moves no money");

  console.log("\nLedger:");
  for (const r of again.ledger) {
    const p = paddles.find((x) => x.id === r.paddleId);
    console.log(`  ${r.kind.padEnd(10)} ${(p ? `#${p.number} ${p.name}` : "treasurer").padEnd(20)} $${String(r.amount).padStart(7)}  ${r.status.padEnd(14)} ${r.paypalId ?? ""}${r.note ? `  (${r.note})` : ""}`);
  }
  console.log("Receipt sample:\n" + receipts[0]?.text.split("\n").map((l) => "  | " + l).join("\n"));
  // Rooms are isolated: another room is untouched by this run, and resetting it leaves this room alone.
  const other = ROOM + "X";
  const os = await (await fetch(BASE + inRoom("/api/state", other))).json();
  check(os.status === "lobby" && os.paddles.length === 0 && os.ledger.length === 0, `room ${other} is untouched by room ${ROOM}`);
  const before = await state();
  await fetch(BASE + inRoom("/api/reset", other), { method: "POST" });
  const after = await state();
  check(after.status === before.status && after.paddles.length === before.paddles.length && after.ledger.length === before.ledger.length, `resetting room ${other} does not affect room ${ROOM}`);
  const rn = await (await fetch(BASE + "/api/room/new")).json();
  check(/^[A-Z0-9]{1,12}$/.test(rn.room ?? ""), `GET /api/room/new -> ${rn.room}`);

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

// AUCTION_TYPE=estate: consignment sale. One real Payouts batch pays two consignors and the house.
// Consignor emails default to SANDBOX_BUYER_*, the house to TREASURER_PAYPAL_EMAIL (set on the server).
async function estateFlow() {
  const st0 = await api("POST", "/api/auction/type", { type: "estate" });
  check(st0.auctionType === "estate" && st0.settings?.commissionPct === 15 && st0.lots.length === 4, "estate room created: 15% commission, 4 sample lots");
  const eli = await api("POST", "/api/paddle", { name: "Eli K.", holdAmount: 600, testCard: true });
  check(eli.held === true, `test-card paddle held (${eli.error ?? eli.paddleId})`);
  const auth = (await state()).paddles[0].authorizationId;
  check(isReal(auth), `real sandbox authorization ${auth}`);
  for (const [lotId, amount] of [["lot-sideboard", 200], ["lot-silver", 300]]) {
    await api("POST", "/api/lot/start", { lotId });
    check((await bid(eli.paddleId, lotId, amount)).ok === true, `Eli bids $${amount} on ${lotId}`);
    await api("POST", "/api/lot/hammer", { lotId });
  }
  const closed = await api("POST", "/api/close");
  check(closed.status === "closed", "close -> closed");
  const { ledger, totals, receipts } = closed;
  const cap = ledger.find((r) => r.kind === "captured");
  check(cap && isReal(cap.paypalId) && cap.amount === 500 && cap.status === "COMPLETED", `capture ${cap?.paypalId} $${cap?.amount} ${cap?.status}`);
  const pays = ledger.filter((r) => r.kind === "payout");
  const batchId = pays[0]?.paypalId;
  const sum = Math.round(pays.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  check(pays.length >= 2 && isReal(batchId) && new Set(pays.map((r) => r.paypalId)).size === 1 && pays.every((r) => r.status !== "FAILED"), `one real payout batch ${batchId} with ${pays.length} items`);
  check(sum === totals.captured && totals.paidOut === totals.captured, `payout items sum $${sum} = captured $${totals.captured}`);
  check(pays.every((r) => /consignor 85% \/ house 15%/.test(r.note)), "ledger notes show the 85/15 split");
  for (const r of pays) console.log(`  ..   $${r.amount}  ${r.note}`);
  if (isReal(batchId)) {
    const b = await ppGet(`/v1/payments/payouts/${batchId}`);
    if (b?.items) {
      console.log(`  ..   PayPal batch ${batchId}: ${b.batch_header?.batch_status}`);
      for (const it of b.items) console.log(`  ..   item ${it.payout_item_id} ${it.payout_item?.amount?.value} ${it.transaction_status}`);
      const paypalSum = b.items.reduce((t, it) => t + Math.round(Number(it.payout_item?.amount?.value) * 100), 0);
      check(b.items.length === pays.length && paypalSum === Math.round(totals.captured * 100), `PayPal batch holds ${b.items.length} items summing $${paypalSum / 100}`);
    }
  }
  check(receipts.length === 1 && /sales receipt/i.test(receipts[0].text) && /consignor credit/i.test(receipts[0].text), "sales receipt with consignor credit");
  for (const r of ledger.filter((x) => x.kind === "receipt")) console.log(`  ..   receipt invoice ${r.paypalId ?? "(none)"} ${r.status}${r.note ? ` (${r.note})` : ""}`);
  const again = await api("POST", "/api/close");
  check(again.ledger.length === ledger.length, "second close moves no money");
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

// AUCTION_TYPE=collectibles: 10% buyer's premium. Capture = hammer + premium (still below the hold),
// the loser is voided, one payout of the captured total to the house.
async function collectiblesFlow() {
  const st0 = await api("POST", "/api/auction/type", { type: "collectibles" });
  check(st0.auctionType === "collectibles" && st0.settings?.premiumPct === 10, "collectibles room created: 10% buyer's premium");
  const ivy = await api("POST", "/api/paddle", { name: "Ivy R.", holdAmount: 300, testCard: true });
  const max = await api("POST", "/api/paddle", { name: "Max T.", holdAmount: 300, testCard: true });
  check(ivy.held === true && max.held === true, "two test-card paddles held");
  await api("POST", "/api/lot/start", { lotId: "lot-vinyl" });
  check((await bid(ivy.paddleId, "lot-vinyl", 120)).ok === true, "Ivy bids $120");
  check((await bid(max.paddleId, "lot-vinyl", 140)).ok === true, "Max bids $140");
  const over = await bid(ivy.paddleId, "lot-vinyl", 280);
  check(over.ok === false && /premium/.test(over.error ?? ""), `$280 + 10% premium refused against a $300 hold (${over.error})`);
  check((await bid(ivy.paddleId, "lot-vinyl", 160)).ok === true, "Ivy bids $160");
  await api("POST", "/api/lot/hammer", { lotId: "lot-vinyl" });
  const closed = await api("POST", "/api/close");
  check(closed.status === "closed", "close -> closed");
  const { ledger, totals } = closed;
  const cap = ledger.find((r) => r.kind === "captured" && r.status !== "FAILED");
  check(cap && isReal(cap.paypalId) && cap.amount === 176 && cap.amount < 300, `capture ${cap?.paypalId} $${cap?.amount} = $160 hammer + $16 premium, below the $300 hold`);
  const v = ledger.find((r) => r.kind === "voided");
  check(v && v.paddleId === max.paddleId && isReal(v.paypalId), `Max's hold voided (${v?.paypalId})`);
  const pays = ledger.filter((r) => r.kind === "payout");
  check(pays.length === 1 && isReal(pays[0].paypalId) && totals.paidOut === totals.captured && totals.captured === 176, `payout ${pays[0]?.paypalId} $${totals.paidOut} = captured`);
  const again = await api("POST", "/api/close");
  check(again.ledger.length === ledger.length, "second close moves no money");
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(2);
});
