#!/usr/bin/env node
// End-to-end DEMO_MODE flow against a running server. No deps (Node 18+).
//   node scripts/demo-flow.mjs [baseUrl]      (default http://localhost:3000)
// Best with the server started as: DEMO_MODE=1 TICK_SPEED=10 PERSIST=0 npm run dev
// Exits non-zero if any assertion fails.

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
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
  const badPaddle = await fetch(BASE + inRoom("/api/paddle"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", holdAmount: -5 }) });
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

  // Charity stays the default hero, unchanged by auction types.
  check(closed.auctionType === "charity" && closed.settings?.premiumPct === 0, "default auction type is charity with no premium");
  check(ledger.filter((r) => r.kind === "captured").every((r) => !/premium/i.test(r.note ?? "")), "charity captures carry no premium");

  await typeScenarios();

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
  process.exit(failures ? 1 : 0);
}

// ---- auction types: each scenario runs in its own room
async function typeScenarios() {
  const R = (suffix) => ROOM + suffix;
  const call = async (room, method, path, body) => {
    const res = await fetch(BASE + inRoom(path, room), { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ...json };
  };
  const tp = async (room, name, hold) => (await call(room, "POST", "/api/paddle", { name, holdAmount: hold })).paddleId;
  const b = (room, paddleId, lotId, amount) => call(room, "POST", "/api/bid", { paddleId, lotId, amount });
  const start = (room, lotId) => call(room, "POST", "/api/lot/start", { lotId });
  const hammer = (room, lotId) => call(room, "POST", "/api/lot/hammer", { lotId });

  console.log("\nAuction types");
  const bad1 = await call(R("B1"), "POST", "/api/auction/type", { type: "bogus" });
  check(bad1.status === 400, "unknown auction type -> 400");
  const bad2 = await call(R("B1"), "POST", "/api/auction/type", { type: "collectibles", settings: { premiumPct: 99 } });
  check(bad2.status === 400, "premium out of range -> 400");

  // ---- collectibles: buyer's premium on top; a bid must fit hammer x (1 + premium) inside the hold
  const C = R("C");
  let st = await call(C, "POST", "/api/auction/type", { type: "collectibles" });
  check(st.auctionType === "collectibles" && st.settings.premiumPct === 10 && st.status === "lobby" && st.lots.length === 4, "collectibles: type switched, 10% premium, 4 sample lots");
  const ca = await tp(C, "Alex", 300);
  const cb = await tp(C, "Bea", 500);
  await start(C, "lot-ceramic");
  check((await b(C, ca, "lot-ceramic", 90)).ok === true, "collectibles: Alex opens at $90");
  check((await b(C, cb, "lot-ceramic", 100)).ok === true, "collectibles: Bea $100");
  const over = await b(C, ca, "lot-ceramic", 280);
  check(over.ok === false && /premium/i.test(over.error), `collectibles: $280 hammer + 10% = $308 > $300 hold rejected (${over.error})`);
  check((await b(C, ca, "lot-ceramic", 270)).ok === true, "collectibles: $270 + 10% = $297 fits the $300 hold");
  await hammer(C, "lot-ceramic");
  await start(C, "lot-print");
  check((await b(C, cb, "lot-print", 200)).ok === true, "collectibles: Bea $200 on the print");
  await hammer(C, "lot-print");
  const cc = await call(C, "POST", "/api/close");
  const capA = cc.ledger.find((r) => r.kind === "captured" && r.paddleId === ca);
  const capB = cc.ledger.find((r) => r.kind === "captured" && r.paddleId === cb);
  const holdA = cc.paddles.find((p) => p.id === ca).holdAmount;
  check(capA.amount === 297 && capA.amount <= holdA, `collectibles: Alex captured $${capA.amount} = $270 x 1.10, within $${holdA} hold`);
  check(capB.amount === 220 && /premium/i.test(capB.note), `collectibles: Bea captured $${capB.amount} = $200 x 1.10 (${capB.note})`);
  check(cc.totals.captured === 517 && cc.totals.paidOut === 517, "collectibles: captured and paid out $517 = $470 hammer + $47 premium");
  const cpay = cc.ledger.filter((r) => r.kind === "payout");
  check(cpay.length === 1 && cpay[0].amount === 517, "collectibles: one payout line to the house");
  check(
    cc.receipts.length === 2 && cc.receipts.every((r) => /sales receipt/i.test(r.text) && /buyer's premium/i.test(r.text) && !/fair market|FMV/i.test(r.text)),
    "collectibles: sales receipts show hammer, premium, total (no FMV)",
  );
  const cc2 = await call(C, "POST", "/api/close");
  check(cc2.ledger.length === cc.ledger.length && JSON.stringify(cc2.totals) === JSON.stringify(cc.totals), "collectibles: second close moves no money");

  // ---- estate: consignment payout split in one batch
  const E = R("E");
  st = await call(E, "POST", "/api/auction/type", {
    type: "estate",
    settings: { organizerEmail: "house.test@example.com", consignorEmails: ["hendricks.test@example.com", "alvarez.test@example.com"] },
  });
  check(st.auctionType === "estate" && st.settings.commissionPct === 15 && st.settings.premiumPct === 0, "estate: type switched, 15% commission");
  check(st.lots.every((l) => l.consignor) && !JSON.stringify(st).includes("hendricks.test@"), "estate: lots have consignors; emails are not exposed in state");
  const ea = await tp(E, "Eli", 1000);
  await start(E, "lot-sideboard");
  check((await b(E, ea, "lot-sideboard", 200)).ok === true, "estate: Eli $200 on the sideboard (Hendricks)");
  await hammer(E, "lot-sideboard");
  await start(E, "lot-silver");
  check((await b(E, ea, "lot-silver", 300)).ok === true, "estate: Eli $300 on the silver (Alvarez)");
  await hammer(E, "lot-silver");
  const ec = await call(E, "POST", "/api/close");
  const epay = ec.ledger.filter((r) => r.kind === "payout");
  const sum = Math.round(epay.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  check(ec.totals.captured === 500 && sum === 500 && ec.totals.paidOut === 500, `estate: payout items sum $${sum} = captured $${ec.totals.captured}`);
  check(epay.length === 3 && new Set(epay.map((r) => r.paypalId)).size === 1, "estate: one payout batch with 3 items (2 consignors + house)");
  const hend = epay.find((r) => /hendricks\.test@/.test(r.note));
  const alv = epay.find((r) => /alvarez\.test@/.test(r.note));
  const house = epay.find((r) => /to house/.test(r.note));
  check(hend?.amount === 170 && alv?.amount === 255 && house?.amount === 75, `estate: consignors $${hend?.amount} + $${alv?.amount} (85%), house $${house?.amount} (15%)`);
  check(epay.every((r) => /consignor 85% \/ house 15%/.test(r.note)), "estate: ledger notes show the split");
  check(ec.receipts.length === 1 && /consignor credit/i.test(ec.receipts[0].text) && /sales receipt/i.test(ec.receipts[0].text), "estate: sales receipt shows the consignor credit");
  const ec2 = await call(E, "POST", "/api/close");
  check(ec2.ledger.length === ec.ledger.length, "estate: second close moves no money");

  // ---- editable event + lot CRUD; receipts and Gus use the edited organizer
  const V = R("V");
  st = await call(V, "GET", "/api/state");
  check(st.event?.organizer === "Maple Street Elementary PTA" && st.event.currency === "USD", "event: charity default template present");
  let r = await call(V, "PATCH", "/api/event", { name: "Harvest Night <b>2026</b>", organizer: "Cedar Valley Rotary", beneficiary: "the food bank" });
  check(r.event?.organizer === "Cedar Valley Rotary" && !/[<>]/.test(r.event.name), "event: PATCH edits fields and strips markup");
  r = await call(V, "PATCH", "/api/event", { organizer: "" });
  check(r.error && /organizer/.test(r.error), "event: empty organizer rejected");
  r = await call(V, "PATCH", "/api/event", { name: "x".repeat(200) });
  check(!!r.error, "event: over-long name rejected");
  const nl = await call(V, "POST", "/api/lot");
  check(nl.lot?.status === "pending" && nl.lot.title, "lot: blank lot created");
  const lid = nl.lot.id;
  r = await call(V, "PATCH", `/api/lot/${lid}`, { title: "Pie of the Year", description: "<script>x</script>Apple", emoji: "P", startPrice: 20, increment: 5, fmv: 30 });
  check(r.lot?.title === "Pie of the Year" && r.lot.startPrice === 20 && !/[<>]/.test(r.lot.description), "lot: PATCH edits and sanitizes");
  r = await call(V, "PATCH", `/api/lot/${lid}`, { startPrice: -5 });
  check(!!r.error, "lot: negative price rejected");
  const vp = await tp(V, "Vera", 500);
  await start(V, lid);
  check((await call(V, "PATCH", `/api/lot/${lid}`, { title: "Nope" })).error !== undefined, "lot: cannot edit once started");
  check((await call(V, "DELETE", `/api/lot/${lid}`)).error !== undefined, "lot: cannot delete once started");
  check((await b(V, vp, lid, 20)).ok === true, "lot: bid on the new lot");
  await hammer(V, lid);
  const dl = await call(V, "POST", "/api/lot");
  check((await call(V, "DELETE", `/api/lot/${dl.lot.id}`)).ok === true && !(await call(V, "GET", "/api/state")).lots.some((l) => l.id === dl.lot.id), "lot: pending lot deleted");
  const vc = await call(V, "POST", "/api/close");
  check(vc.receipts.length === 1 && /Cedar Valley Rotary/.test(vc.receipts[0].text) && !/Maple Street/.test(vc.receipts[0].text), "receipt uses the edited organizer");
  check(/the food bank/.test(vc.caption.text) && /Harvest Night/.test(vc.caption.text), "gus: closing line names the edited event and beneficiary");

  // ---- farm: larger increments, per-head units
  st = await call(R("F"), "POST", "/api/auction/type", { type: "farm" });
  check(st.auctionType === "farm" && st.lots.every((l) => l.increment >= 50) && st.lots.some((l) => l.unit === "head"), "farm: larger increments, per-head lots");
}

main().catch((e) => {
  console.error("ERROR", e.message);
  process.exit(2);
});
