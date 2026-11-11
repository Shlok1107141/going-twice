#!/usr/bin/env node
// End-to-end DEMO_MODE flow against a running server. No deps (Node 18+).
//   node scripts/demo-flow.mjs [baseUrl]      (default http://localhost:3000)
// Best with the server started as: DEMO_MODE=1 TICK_SPEED=10 PERSIST=0 npm run dev
// Exits non-zero if any assertion fails.

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;

function check(cond, msg) {
  if (cond) console.log(`  ok   ${msg}`);
  else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
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

// Agent decisions may call an LLM (Gemini/Claude), so poll instead of sleeping a fixed time.
async function waitFor(fn, timeoutMs = 10000) {
  const t0 = Date.now();
  let v;
  while (Date.now() - t0 < timeoutMs) {
    v = await fn();
    if (v) return v;
    await sleep(200);
  }
  return v;
}

async function bid(paddleId, lotId, amount) {
  const r = await api("POST", "/api/bid", { paddleId, lotId, amount });
  return r;
}

async function runUntilClosed(lotId, timeoutMs = 30000) {
  const t0 = Date.now();
  const phases = new Set();
  while (Date.now() - t0 < timeoutMs) {
    await api("POST", "/api/auctioneer/tick");
    const lot = await lotOf(lotId);
    phases.add(lot.phase);
    if (lot.status !== "open") return { lot, phases };
    await sleep(250);
  }
  throw new Error(`lot ${lotId} never closed (is TICK_SPEED set?)`);
}

async function main() {
  console.log(`Going Twice demo flow against ${BASE}`);
  const health = await api("GET", "/api/health");
  check(health.ok === true, "health ok");

  const s0 = await api("POST", "/api/reset");
  check(s0.status === "lobby" && s0.lots.length >= 3 && s0.paddles.length === 0, "reset -> lobby, lots seeded, no paddles");
  check(s0.demoMode === true, "server is in DEMO_MODE");

  // Validation
  const badPaddle = await fetch(BASE + "/api/paddle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", holdAmount: -5 }) });
  check(badPaddle.status === 400, "invalid paddle body -> 400");

  const dana = await api("POST", "/api/paddle", { name: "Dana R.", holdAmount: 300 });
  const marcus = await api("POST", "/api/paddle", { name: "Marcus T.", holdAmount: 150 });
  const priya = await api("POST", "/api/paddle", { name: "Priya S.", holdAmount: 500 });
  check(dana.held === true && typeof dana.paddleId === "string", "demo paddle returns {paddleId, held:true}");
  const agent = await api("POST", "/api/agent", {
    name: "Grandma Jo",
    holdAmount: 200,
    instruction: "Get the pizza basket for the grandkids, up to $70",
    maxBid: 100,
  });
  check(typeof agent.paddleId === "string", "agent paddle created");
  const auth = await api("POST", `/api/paddle/${dana.paddleId}/authorize`, { orderId: "x" });
  check(auth.paddle?.status === "held", "authorize in demo returns held paddle");

  // Lot 1: pizza basket, agent competes (cap $70 from instruction)
  const pizza = "lot-pizza";
  let st = await api("POST", "/api/lot/start", { lotId: pizza });
  check(st.status === "live" && st.currentLotId === pizza, "lot started, auction live");
  // agent may open the bidding itself
  let lot = await waitFor(async () => { const l = await lotOf(pizza); return l.highPaddleId ? l : null; }) ?? (await lotOf(pizza));
  check(lot.highPaddleId === agent.paddleId, "agent opened bidding on a matching lot");
  check((await bid(dana.paddleId, pizza, lot.highBid)).ok === false, "bid not above high bid rejected");
  check((await bid(agent.paddleId, pizza, nextBid(lot))).ok === false, "humans cannot bid as an agent paddle");
  check((await bid(dana.paddleId, pizza, nextBid(lot))).ok === true, "Dana outbids agent");
  check((await bid(dana.paddleId, pizza, nextBid(await lotOf(pizza)))).ok === false, "self-outbid rejected");
  lot = await waitFor(async () => { const l = await lotOf(pizza); return l.highPaddleId === agent.paddleId ? l : null; }) ?? (await lotOf(pizza));
  check(lot.highPaddleId === agent.paddleId, `agent re-bid to ${lot.highBid}`);
  check((await bid(marcus.paddleId, pizza, 200)).ok === false, "Marcus over his $150 hold rejected");
  const reasonBefore = (await state()).paddles.find((p) => p.id === agent.paddleId)?.agent?.lastReasoning;
  check((await bid(marcus.paddleId, pizza, 75)).ok === true, "Marcus jumps to $75");
  await waitFor(async () => (await state()).paddles.find((p) => p.id === agent.paddleId)?.agent?.lastReasoning !== reasonBefore, 8000);
  await sleep(500);
  lot = await lotOf(pizza);
  check(lot.highPaddleId === marcus.paddleId && lot.highBid === 75, "agent stops at its $70 cap");
  st = await state();
  const ag = st.paddles.find((p) => p.id === agent.paddleId);
  check(typeof ag.agent?.lastReasoning === "string" && ag.agent.lastReasoning.length > 0, `agent reasoning: "${ag.agent?.lastReasoning}"`);
  check(st.events.some((e) => e.type === "agent-bid"), "agent-bid event emitted");
  let { lot: l1, phases } = await runUntilClosed(pizza);
  check(l1.status === "sold" && l1.winnerPaddleId === marcus.paddleId && l1.finalPrice === 75, "pizza sold to Marcus for $75 by auto-hammer");
  check(phases.has("going-once") && phases.has("going-twice"), "went through going-once and going-twice");
  st = await state();
  check(st.events.some((e) => e.type === "stall"), "stall event emitted");
  check(st.paddles.find((p) => p.id === marcus.paddleId).committed === 75, "Marcus committed = $75");

  // Lot 2: cabin. Marcus has only $75 room left.
  const cabin = "lot-cabin";
  await api("POST", "/api/lot/start", { lotId: cabin });
  check((await bid(priya.paddleId, cabin, 199)).ok === false, "below start price rejected");
  check((await bid(priya.paddleId, cabin, 200)).ok === true, "Priya opens cabin at $200");
  check((await bid(marcus.paddleId, cabin, 225)).ok === false, "Marcus blocked: committed + bid > hold");
  check((await bid(dana.paddleId, cabin, 225)).ok === true, "Dana $225");
  check((await bid(priya.paddleId, cabin, 250)).ok === true, "Priya $250");
  check((await bid(dana.paddleId, cabin, 325)).ok === false, "Dana $325 over $300 hold rejected");
  ({ lot: l1 } = await runUntilClosed(cabin));
  check(l1.winnerPaddleId === priya.paddleId && l1.finalPrice === 250, "cabin sold to Priya for $250");

  // Lot 3: principal, hammered manually. Lot 4: quilt, no bids -> unsold.
  await api("POST", "/api/lot/start", { lotId: "lot-principal" });
  check((await bid(priya.paddleId, "lot-principal", 60)).ok === true, "Priya $60 on principal");
  st = await api("POST", "/api/lot/hammer", { lotId: "lot-principal" });
  check(st.lots.find((l) => l.id === "lot-principal").status === "sold", "manual hammer sells");
  await api("POST", "/api/lot/start", { lotId: "lot-quilt" });
  ({ lot: l1 } = await runUntilClosed("lot-quilt"));
  check(l1.status === "unsold", "quilt with no bids passes (unsold)");
  check((await bid(dana.paddleId, "lot-quilt", 100)).ok === false, "no bids on a closed lot");

  // Close
  const closed = await api("POST", "/api/close");
  check(closed.status === "closed", "close -> status closed");
  const { paddles, lots, ledger, totals, receipts } = closed;
  const wonBy = (pid) => lots.filter((l) => l.status === "sold" && l.winnerPaddleId === pid).reduce((s, l) => s + l.finalPrice, 0);
  const winners = paddles.filter((p) => wonBy(p.id) > 0);
  const losers = paddles.filter((p) => wonBy(p.id) === 0);
  for (const p of paddles) {
    const caps = ledger.filter((r) => r.kind === "captured" && r.paddleId === p.id && r.status !== "FAILED");
    const voids = ledger.filter((r) => r.kind === "voided" && r.paddleId === p.id && r.status !== "FAILED");
    const capTotal = caps.reduce((s, r) => s + r.amount, 0);
    check(capTotal <= p.holdAmount, `#${p.number} ${p.name}: captured $${capTotal} <= hold $${p.holdAmount}`);
    if (wonBy(p.id) > 0) {
      check(caps.length === 1 && capTotal === wonBy(p.id) && voids.length === 0 && p.status === "captured", `#${p.number} winner: one capture of $${wonBy(p.id)}, no void`);
    } else {
      check(caps.length === 0 && voids.length === 1 && p.status === "voided", `#${p.number} non-winner: voided, never captured`);
    }
  }
  check(winners.length === 2 && losers.length === 2, "2 winners (Marcus, Priya), 2 voided (Dana, agent)");
  const soldTotal = lots.filter((l) => l.status === "sold").reduce((s, l) => s + l.finalPrice, 0);
  check(totals.captured === soldTotal, `captured total $${totals.captured} == hammer total $${soldTotal}`);
  check(totals.paidOut === totals.captured, `paid out $${totals.paidOut} == captured $${totals.captured}`);
  check(ledger.filter((r) => r.kind === "payout").length === 1, "exactly one payout batch");
  check(totals.held === 0, "nothing left on hold");
  check(receipts.length === winners.length && receipts.every((r) => /estimate/i.test(r.text)), "one receipt per winner, with FMV-estimate disclaimer");

  const again = await api("POST", "/api/close");
  check(again.ledger.length === ledger.length && JSON.stringify(again.totals) === JSON.stringify(totals), "second close moves no money");

  console.log("\nLedger:");
  for (const r of again.ledger) {
    const p = paddles.find((x) => x.id === r.paddleId);
    console.log(`  ${r.kind.padEnd(10)} ${(p ? `#${p.number} ${p.name}` : "treasurer").padEnd(20)} $${String(r.amount).padStart(7)}  ${r.status.padEnd(9)} ${r.paypalId ?? ""}`);
  }
  console.log("Totals:", again.totals);
  console.log("Receipt sample:\n" + receipts[0]?.text.split("\n").map((l) => "  | " + l).join("\n"));
  console.log("Caption:", again.caption.text);
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(2);
});
