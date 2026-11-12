#!/usr/bin/env node
// Hostile-judge break tests against a running server. No deps (Node 20+).
//   node scripts/break-tests.mjs [baseUrl]            (default http://localhost:3510)
// Works in demo mode and live sandbox mode (live cases make real sandbox test-card holds).
// Best with the server started with fault-injection hooks on (never in production):
//   GT_TEST_HOOKS=1 TICK_SPEED=10 npx next start -p 3510
// Optional extra servers for the cases that need a different server env (SKIPPED when unset):
//   LIVEENV_URL  a server with PAYPAL_ENV=live          (test-card paddles must be refused)
//   NOKEY_URL    a server with no GEMINI_API_KEY(S)     (report agent / snap must say "not configured")
// ONLY=name1,name2 runs a subset. Prints a table; exits non-zero if any case FAILs.

const BASE = (process.argv[2] || "http://localhost:3510").replace(/\/$/, "");
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = Date.now().toString(36).toUpperCase().slice(-5);
let roomSeq = 0;
const newRoom = (p = "B") => `${p}${tag}${(roomSeq++).toString(36).toUpperCase()}`.slice(0, 12);

async function call(method, path, { body, room, headers = {}, base = BASE, raw } = {}) {
  const url = base + path + (room ? `${path.includes("?") ? "&" : "?"}room=${room}` : "");
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined && raw === undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, ms: performance.now() - t0, headers: res.headers };
}
const post = (path, body, room, extra) => call("POST", path, { body, room, ...extra });
const get = (path, room, extra) => call("GET", path, { room, ...extra });
const state = async (room) => (await get("/api/state", room)).json;

let MODE = { demo: true, testCards: false, hooks: false };
const paddle = async (room, name = "Bidder", holdAmount = 500, extra = {}) => {
  const r = await post("/api/paddle", { name, holdAmount, testCard: true, ...extra }, room);
  if (r.status !== 200 || !r.json?.paddleId) throw new Error(`paddle ${name}: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.paddleId;
};
const fresh = async (p) => {
  const room = newRoom(p);
  const r = await post("/api/reset", undefined, room);
  if (r.status !== 200) throw new Error(`reset ${r.status}`);
  return room;
};
const nextBid = (lot) => (lot.highPaddleId ? Math.round((lot.highBid + lot.increment) * 100) / 100 : lot.startPrice);
const lotOf = async (room, id) => (await state(room)).lots.find((l) => l.id === id);
const no5xx = (rs) => rs.every((r) => r.status < 500);
const hooks = (room, h) => post("/api/test/hooks", h, room);
const settledLedger = (s) => ({
  caps: s.ledger.filter((r) => r.kind === "captured" && r.status !== "FAILED"),
  voids: s.ledger.filter((r) => r.kind === "voided" && r.status !== "FAILED"),
  pays: s.ledger.filter((r) => r.kind === "payout"),
});

// ---------------------------------------------------------------- cases
// Each case: [name, expected, async fn() -> detail string | throws]. `need` gates on mode.

const cases = [];
const def = (name, expected, fn, need) => cases.push({ name, expected, fn, need });
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

def("concurrent-same-bid", "two paddles bid the same amount in the same ms: exactly one wins, exposure counted once", async () => {
  const room = await fresh();
  const [a, b] = await Promise.all([paddle(room, "Ann"), paddle(room, "Ben")]);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  const amt = (await lotOf(room, "lot-pizza")).startPrice;
  const rs = await Promise.all([post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: amt }, room), post("/api/bid", { paddleId: b, lotId: "lot-pizza", amount: amt }, room)]);
  const oks = rs.filter((r) => r.json?.ok === true).length;
  const s = await state(room);
  const lot = s.lots.find((l) => l.id === "lot-pizza");
  const committed = s.paddles.reduce((t, p) => t + p.committed, 0);
  assert(oks === 1, `expected 1 ok, got ${oks}: ${JSON.stringify(rs.map((r) => r.json))}`);
  assert(lot.highBid === amt && committed === amt, `highBid ${lot.highBid}, total committed ${committed}`);
  return `1 accepted, loser told "${rs.find((r) => !r.json.ok).json.error}"`;
});

def("bid-storm-invariant", "40 racing bids from 2 paddles: committed == high bids held, never over hold", async () => {
  const room = await fresh();
  const [a, b] = await Promise.all([paddle(room, "Ann", 300), paddle(room, "Ben", 300)]);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  const rs = await Promise.all(
    Array.from({ length: 40 }, (_, k) => post("/api/bid", { paddleId: k % 2 ? a : b, lotId: "lot-pizza", amount: 40 + 5 * Math.floor(k / 2) }, room)),
  );
  const s = await state(room);
  const lot = s.lots.find((l) => l.id === "lot-pizza");
  for (const p of s.paddles) {
    const own = lot.highPaddleId === p.id ? lot.highBid : 0;
    assert(p.committed === own, `paddle ${p.number} committed ${p.committed} but holds high bid ${own}`);
    assert(p.committed <= p.holdAmount, "over hold");
  }
  assert(no5xx(rs), "5xx during storm");
  return `${rs.filter((r) => r.json?.ok).length} accepted, high $${lot.highBid}, invariant holds`;
});

def("bid-over-headroom", "bid above the paddle's hold is refused with the room left", async () => {
  const room = await fresh();
  const lot = (await state(room)).lots.find((l) => l.id === "lot-pizza");
  const a = await paddle(room, "Tight", lot.startPrice);
  await post("/api/lot/start", { lotId: lot.id }, room);
  const r = await post("/api/bid", { paddleId: a, lotId: lot.id, amount: lot.startPrice + lot.increment * 5 }, room);
  assert(r.status === 200 && r.json.ok === false && /hold/.test(r.json.error), JSON.stringify(r.json));
  return r.json.error;
});

def("bid-wrong-lot-state", "bids on a pending lot, a sold lot, unknown ids, or garbage amounts are refused, never 5xx", async () => {
  const room = await fresh();
  const a = await paddle(room, "Ann");
  const rs = [];
  rs.push(await post("/api/bid", { paddleId: a, lotId: "lot-cabin", amount: 200 }, room)); // pending
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 40 }, room);
  await post("/api/lot/hammer", { lotId: "lot-pizza" }, room);
  rs.push(await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 100 }, room)); // sold
  await post("/api/lot/start", { lotId: "lot-quilt" }, room);
  rs.push(await post("/api/bid", { paddleId: "p-999", lotId: "lot-quilt", amount: 75 }, room));
  rs.push(await post("/api/bid", { paddleId: a, lotId: "nope", amount: 75 }, room));
  for (const amount of ["abc", -5, 0, 1e12, 75.001, null, {}, "75; DROP TABLE"]) rs.push(await post("/api/bid", { paddleId: a, lotId: "lot-quilt", amount }, room));
  rs.push(await post("/api/bid", undefined, room, { raw: "{not json" }));
  assert(no5xx(rs), `5xx: ${rs.filter((r) => r.status >= 500).map((r) => r.text).join(" | ")}`);
  assert(rs.every((r) => r.json?.ok === false), `an invalid bid was accepted: ${JSON.stringify(rs.map((r) => r.json))}`);
  const lot = await lotOf(room, "lot-quilt");
  assert(!lot.highPaddleId, "garbage bid moved the lot");
  return `${rs.length} invalid bids refused (e.g. "${rs[0].json.error}", "${rs[1].json.error}")`;
});

def("garbage-paddle-input", "negative/huge/NaN/string holds and bad names -> 400; XSS name stored verbatim as text; bidi chars stripped", async () => {
  const room = await fresh();
  const bad = [
    { name: "X", holdAmount: -5 }, { name: "X", holdAmount: 0 }, { name: "X", holdAmount: 1e9 }, { name: "X", holdAmount: "NaN" },
    { name: "X", holdAmount: "100" }, { name: "X", holdAmount: null }, { name: "X", holdAmount: 10.005 }, { name: "", holdAmount: 50 },
    { name: "x".repeat(41), holdAmount: 50 }, { name: 42, holdAmount: 50 }, { name: { a: 1 }, holdAmount: 50 }, { name: "‮​", holdAmount: 50 },
    { name: "X", holdAmount: 50, email: "not-an-email" },
  ];
  const rs = await Promise.all(bad.map((b) => post("/api/paddle", { ...b, testCard: true }, room)));
  const raw = await post("/api/paddle", undefined, room, { raw: "]]]" });
  assert([...rs, raw].every((r) => r.status === 400), `statuses ${[...rs, raw].map((r) => r.status)}`);
  const xss = `<img src=x onerror=alert(1)><script>alert("gt")</script>`.slice(0, 40);
  const id = await paddle(room, xss, 60);
  const id2 = await paddle(room, "‮Evil​ Twin", 60);
  const s = await state(room);
  assert(s.paddles.find((p) => p.id === id)?.name === xss, "XSS name was altered/escaped server-side (should be stored as plain text)");
  assert(s.paddles.find((p) => p.id === id2)?.name === "Evil Twin", `bidi not stripped: ${JSON.stringify(s.paddles.find((p) => p.id === id2)?.name)}`);
  const ag = await post("/api/agent", { name: "A", holdAmount: 50, instruction: "x", maxBid: 80, testCard: true }, room);
  assert(ag.status === 400, `agent maxBid>hold -> ${ag.status}`);
  const pages = await Promise.all(["/stage", "/admin", "/paddle"].map((p) => get(p, room)));
  const leaked = pages.filter((p) => p.text.includes("<img src=x onerror"));
  assert(leaked.length === 0, "raw XSS name appears unescaped in server HTML");
  return `${bad.length + 1} bad registrations -> 400; XSS name round-trips as JSON text, not in any HTML`;
});

def("paddle-number-race", "5 parallel registrations get 5 distinct paddle numbers (capture invoice_id derives from it)", async () => {
  const room = await fresh();
  await Promise.all([1, 2, 3, 4, 5].map((k) => paddle(room, `P${k}`, 50)));
  const nums = (await state(room)).paddles.map((p) => p.number);
  assert(new Set(nums).size === 5, `numbers ${nums}`);
  return `numbers ${nums.sort().join(",")}`;
});

def("double-close", "two concurrent closes + a third: one capture per winner, one void per loser, one payout, no extra money rows", async () => {
  const room = await fresh();
  const [a, b, c] = await Promise.all([paddle(room, "Ann", 300), paddle(room, "Ben", 300), paddle(room, "Cat", 300)]);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 40 }, room);
  await post("/api/bid", { paddleId: b, lotId: "lot-pizza", amount: 45 }, room);
  await post("/api/lot/start", { lotId: "lot-quilt" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-quilt", amount: 75 }, room);
  const [r1, r2] = await Promise.all([post("/api/close", undefined, room), post("/api/close", undefined, room)]);
  assert(r1.status === 200 && r2.status === 200, `close statuses ${r1.status}/${r2.status}`);
  const s1 = await state(room);
  const n1 = s1.ledger.length;
  const r3 = await post("/api/close", undefined, room);
  const s = await state(room);
  const { caps, voids, pays } = settledLedger(s);
  assert(s.status === "closed" && r3.status === 200, `status ${s.status}`);
  assert(caps.length === 2 && voids.length === 1, `caps ${caps.length} voids ${voids.length}`);
  assert(pays.length === 1 && s.totals.paidOut === s.totals.captured, `payout rows ${pays.length}, paidOut ${s.totals.paidOut} vs captured ${s.totals.captured}`);
  assert(s.ledger.length === n1, "third close added ledger rows");
  assert(s.paddles.find((p) => p.id === c).status === "voided", "non-bidder not voided");
  const late = await post("/api/bid", { paddleId: a, lotId: "lot-cabin", amount: 200 }, room);
  const lateLot = await post("/api/lot/start", { lotId: "lot-cabin" }, room);
  const latePaddle = await post("/api/paddle", { name: "Late", holdAmount: 50, testCard: true }, room);
  assert(late.json.ok === false && lateLot.status === 409 && latePaddle.status === 409, "closed auction still accepted bids/lots/paddles");
  return `captured $${s.totals.captured} (2 winners), 1 void, paid out $${s.totals.paidOut}; 3rd close no-op; late bid/lot/paddle refused`;
});

def("close-zero-bids", "close with paddles but no bids: everyone voided, $0 captured, no payout, status closed", async () => {
  const room = await fresh();
  await Promise.all([paddle(room, "Ann", 100), paddle(room, "Ben", 100)]);
  const r = await post("/api/close", undefined, room);
  const s = r.json;
  const { caps, voids, pays } = settledLedger(s);
  assert(r.status === 200 && s.status === "closed", `status ${r.status} ${s?.status}`);
  assert(caps.length === 0 && voids.length === 2 && pays.length === 0 && s.totals.held === 0, `caps ${caps.length} voids ${voids.length} pays ${pays.length}`);
  return `2 holds released, payoutStatus ${s.payoutStatus?.state}`;
});

def("close-empty-room", "close a room with no paddles at all", async () => {
  const room = await fresh();
  const r = await post("/api/close", undefined, room);
  assert(r.status === 200 && r.json.status === "closed", `${r.status}`);
  return "closed cleanly";
});

def("close-with-unauthorized-paddle", "lot hammered, one paddle never authorized: close settles the rest; authorizing afterwards is refused (no orphan hold)", async () => {
  const room = await fresh();
  const pend = await post("/api/paddle", { name: "Never Approved", holdAmount: 100 }, room); // no testCard: PayPal order awaiting buyer approval
  assert(pend.status === 200 && pend.json.orderId, `pending paddle: ${pend.text.slice(0, 200)}`);
  const a = await paddle(room, "Ann", 200);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 40 }, room);
  await post("/api/lot/hammer", { lotId: "lot-pizza" }, room);
  const c = await post("/api/close", undefined, room);
  const s = c.json;
  const p = s.paddles.find((x) => x.id === pend.json.paddleId);
  assert(s.status === "closed" && p.status === "pending", `status ${s.status}, pending paddle ${p.status}`);
  const wrong = await post(`/api/paddle/${pend.json.paddleId}/authorize`, { orderId: "WRONG" }, room);
  const late = await post(`/api/paddle/${pend.json.paddleId}/authorize`, { orderId: pend.json.orderId }, room);
  assert(wrong.status === 400, `wrong orderId -> ${wrong.status}`);
  assert(late.status === 409, `authorize after close -> ${late.status} ${late.text.slice(0, 120)}`);
  return `closed with captured $${s.totals.captured}; late authorize -> 409 "${late.json.error}"`;
}, "live");

def("testcard-when-live-env", "PAYPAL_ENV=live server refuses testCard paddles with 400 (no PayPal call)", async () => {
  const base = process.env.LIVEENV_URL.replace(/\/$/, "");
  const st = (await get("/api/state", newRoom(), { base })).json;
  const r = await call("POST", "/api/paddle", { body: { name: "Card", holdAmount: 50, testCard: true }, room: newRoom(), base });
  assert(st.testCards === false, `state.testCards ${st.testCards}`);
  assert(r.status === 400 && /sandbox/.test(r.json?.error), `${r.status} ${r.text}`);
  const h = await call("POST", "/api/test/hooks", { body: { failPayout: "INSUFFICIENT_FUNDS" }, base });
  assert(h.status === 404, `test hooks reachable on live env: ${h.status}`);
  return `400 "${r.json.error}"; test hooks 404 on live env`;
}, "liveenv");

def("autopilot-start-twice", "two concurrent autopilot starts: one 200, one 409", async () => {
  const room = await fresh();
  const rs = await Promise.all([post("/api/autopilot", { action: "start" }, room), post("/api/autopilot", { action: "start" }, room)]);
  const codes = rs.map((r) => r.status).sort();
  await post("/api/autopilot", { action: "stop" }, room);
  await waitAutopilotIdle(room);
  assert(codes[0] === 200 && codes[1] === 409, `statuses ${codes}`);
  return `statuses ${codes.join("/")}`;
});

async function waitAutopilotIdle(room, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = (await get("/api/autopilot", room)).json;
    if (!s.running) return s;
    await sleep(300);
  }
  throw new Error("autopilot never stopped");
}

def("reset-during-autopilot", "reset while autopilot runs (and during its setup): loop stops, fresh room has no leaked paddles", async () => {
  const room = await fresh();
  const st = await post("/api/autopilot", { action: "start" }, room);
  assert(st.status === 200, `start ${st.status} ${st.text.slice(0, 120)}`);
  await sleep(1500);
  const r = await post("/api/reset", undefined, room);
  const ap = await waitAutopilotIdle(room);
  const s = await state(room);
  assert(r.status === 200 && ap.phase === "stopped", `reset ${r.status}, autopilot ${ap.phase}: ${ap.message}`);
  assert(s.paddles.length === 0 && s.lots.every((l) => l.status === "pending"), "state after reset not fresh");
  // Reset during setup (live: paddles are mid-authorization when the reset lands).
  const st2 = post("/api/autopilot", { action: "start" }, room);
  await sleep(50);
  await post("/api/reset", undefined, room);
  const st2r = await st2;
  await waitAutopilotIdle(room);
  await sleep(500);
  const s2 = await state(room);
  assert(s2.paddles.length === 0, `paddles leaked into the fresh auction: ${s2.paddles.length}`);
  return `stopped: "${ap.message}"; reset-during-setup start -> ${st2r.status}, 0 leaked paddles`;
});

def("room-codes", "odd/long/traversal room codes never 5xx and never escape the room sandbox", async () => {
  const codes = ["../../etc/passwd", "A".repeat(5000), "<script>", "abc%00def", "ÄÖÜ", "room code", "..\\..\\x", ""];
  const rs = await Promise.all(codes.map((c) => call("GET", `/api/state?room=${encodeURIComponent(c)}`)));
  const hs = await Promise.all(codes.slice(0, 3).map((c) => call("GET", "/api/state", { headers: { "x-gt-room": c.slice(0, 200) } })));
  const w = await call("POST", `/api/lot/add?room=${encodeURIComponent("../../evil")}`, { body: { title: "x", startPrice: 1, increment: 1, fmv: 0 } });
  assert([...rs, ...hs].every((r) => r.status === 200 && Array.isArray(r.json?.lots)), `statuses ${rs.map((r) => r.status)}`);
  assert(w.status < 500, `write with traversal code -> ${w.status}`);
  const lower = await state("abc12");
  const upper = await state("ABC12");
  assert(JSON.stringify(lower.lots) === JSON.stringify(upper.lots), "case-insensitive codes differ");
  return `${codes.length} odd codes -> 200 (fall back to MAIN, regex-gated file names)`;
});

def("300-rooms", "300 rooms: memory stays at <=200 rooms (LRU), a room with paddles survives, polling unknown rooms allocates nothing", async () => {
  const keeper = await fresh("K");
  const kp = await paddle(keeper, "Keeper", 50);
  const before = (await get("/api/health")).json.rooms;
  await Promise.all(Array.from({ length: 50 }, () => get("/api/state", newRoom("Z"))));
  const afterPeek = (await get("/api/health")).json.rooms;
  assert(afterPeek === before, `polling unknown rooms allocated rooms: ${before} -> ${afterPeek}`);
  const made = [];
  for (let k = 0; k < 300; k += 25) {
    await Promise.all(
      Array.from({ length: 25 }, async (_, j) => {
        const room = newRoom("R");
        made.push(room);
        const r = await post("/api/lot/add", { title: `room-lot-${k + j}`, startPrice: 5, increment: 1, fmv: 0 }, room);
        if (r.status !== 200) throw new Error(`lot/add ${r.status}`);
      }),
    );
  }
  const h = (await get("/api/health")).json;
  const ks = await state(keeper);
  const first = await state(made[0]);
  assert(h.rooms <= 200, `rooms in memory ${h.rooms}`);
  assert(ks.paddles.some((p) => p.id === kp), "room with a paddle was lost to eviction");
  const persisted = first.lots.some((l) => l.title.startsWith("room-lot-"));
  return `rooms in memory ${h.rooms}; keeper paddle kept; first evicted room ${persisted ? "reloaded from disk" : "dropped (PERSIST=0, empty room)"}`;
});

def("snap-bad-input", "Snap-a-lot: non-image -> 400, >4 MB -> 413, Gemini 429 everywhere -> 429 + Retry-After (no 5xx)", async () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082", "hex");
  const notImg = await post("/api/lot/snap", { image: Buffer.from("%PDF-1.7 definitely not a photo").toString("base64"), mimeType: "image/png" });
  const big = await post("/api/lot/snap", { image: "A".repeat(6 * 1024 * 1024), mimeType: "image/jpeg" });
  const wrongMime = await post("/api/lot/snap", { image: png.toString("base64"), mimeType: "application/pdf" });
  const fd = new FormData();
  fd.append("image", new Blob(["hello"], { type: "text/plain" }), "x.txt");
  const multi = await call("POST", "/api/lot/snap", { raw: fd });
  const rs = [notImg, big, wrongMime, multi];
  if (notImg.status === 503) return "vision not configured on this server: every snap -> 503 (no Gemini key)";
  assert(notImg.status === 400 && wrongMime.status === 400 && multi.status === 400, `statuses ${rs.map((r) => r.status)}`);
  assert(big.status === 413, `big -> ${big.status}`);
  let limited = "SKIP (no test hooks)";
  if (MODE.hooks) {
    await hooks(undefined, { gemini429: 20 });
    const rl = await post("/api/lot/snap", { image: png.toString("base64"), mimeType: "image/png" });
    await hooks(undefined, { gemini429: 0 });
    assert(rl.status === 429 && rl.headers.get("retry-after"), `rate-limited -> ${rl.status} ${rl.text.slice(0, 120)}`);
    limited = `429 "${rl.json.error}"`;
  }
  return `400/413/400/400; rate-limited: ${limited}`;
});

def("report-agent-input", "report agent: bad JSON / missing body -> 400 (never 5xx); GET reports configured", async () => {
  const g = await get("/api/report-agent");
  const a = await call("POST", "/api/report-agent", { raw: "{{{" });
  const b = await post("/api/report-agent", { body: {} });
  const c = await post("/api/report-agent", { body: "x".repeat(10) });
  if (!g.json.configured) {
    assert([a, b, c].every((r) => r.status === 503), `${[a, b, c].map((r) => r.status)}`);
    return "not configured: 503 for every POST";
  }
  assert(a.status === 400 && b.status === 400 && c.status === 400, `${[a, b, c].map((r) => r.status)}`);
  return "configured; garbage -> 400";
});

def("report-agent-no-key", "server without any Gemini key: GET configured:false, POST -> 503 with a readable message; snap -> 503", async () => {
  const base = process.env.NOKEY_URL.replace(/\/$/, "");
  const g = await call("GET", "/api/report-agent", { base });
  const p = await call("POST", "/api/report-agent", { base, body: { body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } } });
  const s = await call("POST", "/api/lot/snap", { base, body: { image: "AAAA", mimeType: "image/png" } });
  assert(g.json.configured === false && p.status === 503 && s.status === 503, `${JSON.stringify(g.json)} ${p.status} ${s.status}`);
  return `503 "${p.json.error.message}"`;
}, "nokey");

def("webhook-hostile", "webhooks with bad signature / unknown ids / junk body -> 200 and ignored, ledger untouched", async () => {
  const room = await fresh();
  const a = await paddle(room, "Ann", 100);
  const before = await state(room);
  const authId = before.paddles.find((p) => p.id === a).authorizationId;
  const fakeHeaders = { "paypal-transmission-id": "fake", "paypal-transmission-sig": "fake", "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://evil.example/cert.pem", "paypal-transmission-time": new Date().toISOString() };
  const rs = await Promise.all([
    post("/api/webhooks/paypal", { id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.VOIDED", resource: { id: "UNKNOWN-ID" } }, undefined, { headers: fakeHeaders }),
    post("/api/webhooks/paypal", { id: "WH-2", event_type: "PAYMENT.CAPTURE.DECLINED", resource: { id: authId } }, undefined, { headers: fakeHeaders }),
    call("POST", "/api/webhooks/paypal", { raw: "not json at all" }),
    post("/api/webhooks/paypal", []),
  ]);
  const after = await state(room);
  assert(rs.every((r) => r.status === 200), `statuses ${rs.map((r) => r.status)}`);
  if (!MODE.demo) {
    assert(rs[0].json.ignored === true && rs[1].json.ignored === true, `forged events not ignored: ${JSON.stringify(rs.map((r) => r.json))}`);
  }
  assert(JSON.stringify(after.ledger) === JSON.stringify(before.ledger), "ledger changed");
  return MODE.demo ? "demo (unverified allowed): unknown ids ignored, ledger untouched" : "forged signature ignored, unknown ids ignored, ledger untouched";
});

def("payout-insufficient-funds", "payout fails with INSUFFICIENT_FUNDS mid-close: captures/voids final, status closed, 'payout pending — retry' row; /api/payout/retry pays once, idempotently", async () => {
  const room = await fresh();
  const pre = await post("/api/payout/retry", undefined, room);
  assert(pre.status === 409, `retry before close -> ${pre.status}`);
  const [a, b] = await Promise.all([paddle(room, "Ann", 200), paddle(room, "Ben", 200)]);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 40 }, room);
  await post("/api/lot/hammer", { lotId: "lot-pizza" }, room);
  const h = await hooks(room, { failPayout: "INSUFFICIENT_FUNDS", times: 2 });
  assert(h.status === 200, `hooks ${h.status}`);
  const c = await post("/api/close", undefined, room);
  let s = c.json;
  const { caps, voids } = settledLedger(s);
  const pending = s.ledger.filter((r) => r.kind === "payout" && r.status === "PENDING_RETRY");
  assert(c.status === 200 && s.status === "closed", `close ${c.status} status ${s.status}`);
  assert(caps.length === 1 && voids.length === 1 && s.totals.held === 0, `caps ${caps.length} voids ${voids.length} held ${s.totals.held}`);
  assert(pending.length === 1 && /payout pending — retry/.test(pending[0].note) && /INSUFFICIENT_FUNDS/.test(pending[0].note), `pending rows ${JSON.stringify(pending)}`);
  assert(s.payoutStatus?.state === "retry" && s.totals.paidOut === 0, `payoutStatus ${JSON.stringify(s.payoutStatus)} paidOut ${s.totals.paidOut}`);
  const again = await post("/api/close", undefined, room);
  assert(again.json.ledger.length === s.ledger.length, "re-close moved money");
  const r1 = await post("/api/payout/retry", undefined, room); // hook still has 1 failure left
  assert(r1.status === 502 && r1.json.ok === false && r1.json.payoutStatus.attempts === 2, `first retry ${r1.status} ${JSON.stringify(r1.json.payoutStatus)}`);
  const [r2, r3] = await Promise.all([post("/api/payout/retry", undefined, room), post("/api/payout/retry", undefined, room)]);
  const r4 = await post("/api/payout/retry", undefined, room);
  s = await state(room);
  const ok = s.ledger.filter((r) => r.kind === "payout" && !["PENDING_RETRY", "RETRIED", "FAILED"].includes(r.status));
  assert(r2.json.ok && r3.json.ok && r4.json.ok && r4.json.retried === false, `retries ${[r2, r3, r4].map((r) => JSON.stringify({ s: r.status, ok: r.json.ok, re: r.json.retried }))}`);
  assert(ok.length === 1 && s.totals.paidOut === s.totals.captured && s.payoutStatus.state === "sent", `payout rows ${ok.length}, paidOut ${s.totals.paidOut} vs ${s.totals.captured}`);
  assert(s.ledger.filter((r) => r.status === "PENDING_RETRY").length === 0, "pending row left behind");
  return `closed with pending payout $${s.payoutStatus.amount}; retry #1 failed again (502), concurrent retries paid once (${ok[0].paypalId}), later retry no-op`;
}, "hooks");

def("capture-fails-mid-close", "one capture fails mid-close: room frozen (no bids/paddles), re-close captures only what failed, no double capture", async () => {
  const room = await fresh();
  const [a, b] = await Promise.all([paddle(room, "Ann", 200), paddle(room, "Ben", 200)]);
  await post("/api/lot/start", { lotId: "lot-pizza" }, room);
  await post("/api/bid", { paddleId: a, lotId: "lot-pizza", amount: 40 }, room);
  await post("/api/lot/start", { lotId: "lot-quilt" }, room);
  await post("/api/bid", { paddleId: b, lotId: "lot-quilt", amount: 75 }, room);
  await hooks(room, { failCapture: 1 });
  const c1 = await post("/api/close", undefined, room);
  assert(c1.status === 200 && c1.json.status !== "closed", `first close status ${c1.json.status}`);
  const failedRows = c1.json.ledger.filter((r) => r.kind === "captured" && r.status === "FAILED").length;
  const bidFrozen = await post("/api/bid", { paddleId: a, lotId: "lot-cabin", amount: 200 }, room);
  const lotFrozen = await post("/api/lot/start", { lotId: "lot-cabin" }, room);
  const padFrozen = await post("/api/paddle", { name: "Sneaky", holdAmount: 50, testCard: true }, room);
  assert(lotFrozen.status === 409 && padFrozen.status === 409 && bidFrozen.json.ok === false, `frozen? lot ${lotFrozen.status} paddle ${padFrozen.status}`);
  const c2 = await post("/api/close", undefined, room);
  const s = c2.json;
  const caps = s.ledger.filter((r) => r.kind === "captured" && r.status !== "FAILED");
  const perPaddle = new Set(caps.map((r) => r.paddleId));
  assert(s.status === "closed" && failedRows === 1 && caps.length === 2 && perPaddle.size === 2, `status ${s.status}, failed ${failedRows}, caps ${caps.length}`);
  assert(s.totals.paidOut === s.totals.captured, "payout != captured");
  return `1 capture failed -> room frozen (409s); re-close captured only the failed one; captured $${s.totals.captured} = paid out`;
}, "hooks");

def("cold-start-cheap", "/api/health and /api/state answer fast, never create rooms, no-store", async () => {
  const room = newRoom("C");
  const t = [];
  for (let k = 0; k < 5; k++) t.push((await get("/api/health", room)).ms);
  const st = await get("/api/state", room);
  const h = (await get("/api/health")).json;
  const before = h.rooms;
  await Promise.all(Array.from({ length: 20 }, () => get("/api/health", newRoom("H"))));
  const after = (await get("/api/health")).json.rooms;
  const med = t.sort((x, y) => x - y)[2];
  assert(before === after, `health allocated rooms ${before}->${after}`);
  assert(st.headers.get("cache-control")?.includes("no-store"), "state cacheable");
  assert(med < 250, `health median ${med.toFixed(0)} ms`);
  return `health median ${med.toFixed(0)} ms, state ${st.ms.toFixed(0)} ms / ${(st.text.length / 1024).toFixed(1)} KB`;
});

// ---------------------------------------------------------------- run

const results = [];
async function main() {
  const s0 = await state(newRoom());
  const hk = await post("/api/test/hooks", {}, newRoom());
  MODE = { demo: s0.demoMode, testCards: !!s0.testCards, hooks: hk.status === 200 };
  console.log(`Break tests against ${BASE}: ${MODE.demo ? "DEMO" : "LIVE sandbox"} mode, test hooks ${MODE.hooks ? "on" : "off"}\n`);
  for (const c of cases) {
    if (ONLY.length && !ONLY.includes(c.name)) continue;
    const skip =
      (c.need === "live" && MODE.demo && "needs live sandbox (demo paddles are always held)") ||
      (c.need === "hooks" && !MODE.hooks && "needs GT_TEST_HOOKS=1") ||
      (c.need === "liveenv" && !process.env.LIVEENV_URL && "set LIVEENV_URL") ||
      (c.need === "nokey" && !process.env.NOKEY_URL && "set NOKEY_URL");
    if (skip) {
      results.push({ ...c, result: "SKIP", detail: skip });
      console.log(`  SKIP ${c.name}: ${skip}`);
      continue;
    }
    const t0 = Date.now();
    try {
      const detail = await c.fn();
      results.push({ ...c, result: "PASS", detail });
      console.log(`  PASS ${c.name} (${Date.now() - t0} ms): ${detail}`);
    } catch (e) {
      results.push({ ...c, result: "FAIL", detail: e.message });
      console.log(`  FAIL ${c.name} (${Date.now() - t0} ms): ${e.message}`);
    }
  }
  const fails = results.filter((r) => r.result === "FAIL").length;
  console.log(`\n${results.filter((r) => r.result === "PASS").length} passed, ${fails} failed, ${results.filter((r) => r.result === "SKIP").length} skipped`);
  if (process.env.BT_MARKDOWN) {
    console.log("\n| Case | Expected | Result |\n|---|---|---|");
    for (const r of results) console.log(`| ${r.name} | ${r.expected} | ${r.result}: ${String(r.detail).replace(/\|/g, "/")} |`);
  }
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
