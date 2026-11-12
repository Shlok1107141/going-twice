// Autopilot gala: three AI bidders with personas bid against each other (and any human paddle)
// while the room's lots run in order. Gemini/Claude only answers "bid now? + one in-character
// line"; AMOUNTS, timing jitter, caps and holds are plain code, and every bid goes through the
// engine's placeBid, which re-validates it like a human bid. Server-only.
import { callClaude, claudeEnabled, extractJson } from "./claude";
import { nextBidFor } from "./agent";
import { money } from "./auctioneer";
import { EngineError, close, createPaddle, hammer, placeBid, startLot, tick, tickSpeed } from "@/lib/auction/engine";
import { getInternal, getState, pushEvent, type Lot } from "@/lib/auction/store";

export type PersonaSpec = {
  name: string;
  emoji: string;
  blurb: string;
  style: "fast" | "thrifty" | "collector";
  /** Never bids above this. */
  cap: number;
  /** Sandbox authorization hold (default 1.5x cap). */
  hold?: number;
  /** Regex source: only bids on lots whose title/description match. */
  likes?: string;
  /** Sits out once it has won this many lots (default 2), so one bidder can't sweep the gala. */
  maxWins?: number;
  /** Personality given to the model. */
  voice: string;
};

export const DEFAULT_PERSONAS: PersonaSpec[] = [
  { name: "Coach Mike", emoji: "🏈", style: "fast", cap: 180, blurb: "Competitive, bids fast, cap $180",
    voice: "Coach Mike, a loud, competitive gym teacher who hates losing and bids fast and often." },
  { name: "Grandma Jo", emoji: "🧶", style: "thrifty", cap: 90, blurb: "Thrifty, only food/family lots, cap $90", likes: "food|pizza|snack|family|basket|dinner|bak(e|ing)",
    voice: "Grandma Jo, a warm, thrifty grandmother who only wants food and family things and hates overpaying." },
  { name: "Dr. Patel", emoji: "🧐", style: "collector", cap: 400, blurb: "Collector, waits then jumps, cap $400",
    voice: "Dr. Patel, a patient, dry-witted collector who watches quietly and then jumps in with a big bid." },
];

export type AutopilotPhase = "idle" | "setup" | "running" | "closing" | "done" | "stopped" | "error";
export type AutopilotStatus = {
  phase: AutopilotPhase;
  running: boolean;
  roomKey: string;
  message: string;
  autoClose: boolean;
  startedAt?: number;
  deadlineAt?: number;
  lotIds: string[];
  lotIndex: number;
  currentLotId?: string;
  aiCalls: number;
  personas: { name: string; emoji: string; blurb: string; paddleId?: string; number?: number; cap: number; hold: number }[];
};

type Agent = { spec: PersonaSpec; paddleId: string; busy: boolean; key: string; actAt: number; dropped: boolean };
type Run = { status: AutopilotStatus; stop: boolean; agents: Agent[]; auctionId: string };

export const MAX_LOTS = 4;
export const MAX_MS = 5 * 60 * 1000;
const AI_BUDGET = Number(process.env.AUTOPILOT_AI_BUDGET) > 0 ? Number(process.env.AUTOPILOT_AI_BUDGET) : 45;

const g = globalThis as unknown as { __gtAutopilot?: Map<string, Run>; __gtApAi?: { last: number; fails: number; pauseUntil: number } };
const runs = () => (g.__gtAutopilot ??= new Map());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const r2 = (n: number) => Math.round(n * 100) / 100;
const scaled = (ms: number) => Math.max(60, ms / tickSpeed());

function idleStatus(roomKey: string): AutopilotStatus {
  return { phase: "idle", running: false, roomKey, message: "Autopilot is off.", autoClose: false, lotIds: [], lotIndex: 0, aiCalls: 0, personas: [] };
}

export function autopilotStatus(roomKey = "main"): AutopilotStatus {
  return runs().get(roomKey)?.status ?? idleStatus(roomKey);
}

export function stopAutopilot(roomKey = "main"): AutopilotStatus {
  const run = runs().get(roomKey);
  if (run && run.status.running) {
    run.stop = true;
    run.status.message = "Stopping after the current step…";
  }
  return autopilotStatus(roomKey);
}

// ---------------------------------------------------------------- decisions

type Decision = { bid: boolean; reason: string };

/** Model guard: spacing between calls, a per-gala budget, and a short breaker after failures. */
async function askModel(run: Run, a: Agent, lot: Lot, amount: number, highName: string | undefined): Promise<Decision | null> {
  const ai = (g.__gtApAi ??= { last: 0, fails: 0, pauseUntil: 0 });
  if (!claudeEnabled() || run.status.aiCalls >= AI_BUDGET || Date.now() < ai.pauseUntil) return null;
  const wait = ai.last + 1200 - Date.now();
  ai.last = Math.max(Date.now(), ai.last + 1200); // reserve our slot before awaiting
  if (wait > 0) await sleep(wait);
  run.status.aiCalls++;
  const reply = await callClaude({
    system:
      `You are ${a.spec.voice} You are a bidder at a live auction. Reply ONLY with JSON ` +
      '{"bid":boolean,"reason":string}. bid = whether you raise the bid right now (lean yes when the lot suits you and the price is within your limit; ' +
      "the system picks the amount and enforces your limit). reason = one line in character, first person, under 18 words, no emojis.",
    user:
      `Lot: ${lot.title}: ${lot.description}\nCurrent high bid: ${lot.highPaddleId ? `${money(lot.highBid)} by ${highName ?? "another bidder"}` : "none yet"}.\n` +
      `Your next bid would be ${money(amount)}; your limit is ${money(a.spec.cap)}.`,
    maxTokens: 100,
    timeoutMs: 6000,
  });
  const j = extractJson<{ bid?: unknown; reason?: unknown }>(reply);
  if (!j || typeof j.bid !== "boolean") {
    if (++ai.fails >= 3) ai.pauseUntil = Date.now() + 30_000;
    return null;
  }
  ai.fails = 0;
  const reason = typeof j.reason === "string" ? j.reason.trim().slice(0, 160) : "";
  return { bid: j.bid, reason };
}

function fallbackReason(a: Agent, lot: Lot, amount: number): string {
  switch (a.spec.style) {
    case "fast": return `${money(amount)} for ${lot.title}? Mine. Nobody beats this team!`;
    case "thrifty": return `${money(amount)} is fair for ${lot.title}, but not a penny over my limit.`;
    default: return `I've watched long enough. ${money(amount)} for ${lot.title}.`;
  }
}

/** One agent considers one lot. Only the yes/no and the line come from the model. */
async function consider(run: Run, a: Agent, lotId: string): Promise<void> {
  try {
    const s = getState();
    const lot = s.lots.find((l) => l.id === lotId);
    const p = s.paddles.find((x) => x.id === a.paddleId);
    if (!lot || !p || lot.status !== "open" || p.status !== "held" || lot.highPaddleId === p.id) return;

    const headroom = r2(p.holdAmount - p.committed);
    const next = nextBidFor(lot);
    // Hard limits in code first.
    if (next > a.spec.cap || next > headroom) {
      if (!a.dropped) {
        a.dropped = true;
        pushEvent({ type: "system", text: `${a.spec.name} drops out of ${lot.title} at ${money(lot.highBid || lot.startPrice)}${next > headroom ? " (hold reached)" : ""}.`, paddleId: p.id, lotId });
      }
      return;
    }
    // Collector waits: moves only once the room has gone quiet.
    const idle = ((Date.now() - getInternal().lastActivityAt) / 1000) * tickSpeed();
    if (a.spec.style === "collector" && idle < 6 && lot.phase === "bidding") return;

    const high = s.paddles.find((x) => x.id === lot.highPaddleId);
    let d = await askModel(run, a, lot, next, high?.name);
    if (!d) d = { bid: true, reason: fallbackReason(a, lot, next) }; // model unavailable: persona heuristic
    if (!d.reason) d.reason = fallbackReason(a, lot, next);
    if (!d.bid) return; // may reconsider on the next look

    // Re-read the lot after the (slow) model call and compute the amount in code.
    const lot2 = getState().lots.find((l) => l.id === lotId);
    if (!lot2 || lot2.status !== "open" || lot2.highPaddleId === p.id) return;
    let amount = nextBidFor(lot2);
    if (a.spec.style === "collector") amount = r2(amount + lot2.increment * Math.floor(rand(2, 5))); // the jump
    amount = r2(Math.min(amount, a.spec.cap, r2(p.holdAmount - p.committed)));
    if (amount < nextBidFor(lot2)) return;
    if (p.agent) p.agent.lastReasoning = d.reason;
    placeBid(p.id, lotId, amount, "agent");
  } catch (e) {
    console.error("[autopilot]", (e as Error).message);
  } finally {
    a.busy = false;
  }
}

/** Per poll: decide who should look at the lot. Reaction delays are jittered in code. */
function pollAgents(run: Run, lotId: string): void {
  const lot = getState().lots.find((l) => l.id === lotId);
  if (!lot || lot.status !== "open") return;
  const now = Date.now();
  for (const a of run.agents) {
    if (a.busy) continue;
    if (getState().lots.filter((l) => l.status === "sold" && l.winnerPaddleId === a.paddleId).length >= (a.spec.maxWins ?? 2)) continue; // spread the wins around
    if (a.spec.likes && !new RegExp(a.spec.likes, "i").test(`${lot.title} ${lot.description}`)) continue;
    const key = `${lot.highPaddleId ?? "-"}:${lot.highBid}`;
    if (key !== a.key) {
      a.key = key;
      const [lo, hi] = a.spec.style === "fast" ? [1100, 2600] : a.spec.style === "thrifty" ? [3000, 6000] : [1500, 3000];
      a.actAt = now + scaled(rand(lo, hi));
    }
    if (lot.highPaddleId === a.paddleId || now < a.actAt) continue;
    a.busy = true;
    a.actAt = now + scaled(rand(2500, 4000)); // next look if nothing changes
    void consider(run, a, lotId);
  }
}

// ---------------------------------------------------------------- run loop

async function runLoop(run: Run): Promise<void> {
  const st = run.status;
  const aborted = () => run.stop || getInternal().auctionId !== run.auctionId || Date.now() > (st.deadlineAt ?? 0);
  try {
    for (let i = 0; i < st.lotIds.length; i++) {
      if (aborted()) break;
      st.lotIndex = i;
      const lotId = st.lotIds[i];
      st.currentLotId = lotId;
      const lot = getState().lots.find((l) => l.id === lotId);
      if (!lot || (lot.status !== "pending" && lot.status !== "open")) continue;
      st.message = `Lot ${i + 1} of ${st.lotIds.length}: ${lot.title}`;
      for (const a of run.agents) {
        a.key = "";
        a.dropped = false;
        a.actAt = Date.now() + scaled(rand(1200, 2200));
      }
      startLot(lotId);
      while (!aborted()) {
        const cur = getState().lots.find((l) => l.id === lotId);
        if (!cur || cur.status !== "open") break;
        tick(); // Gus keeps time even if no stage is open
        pollAgents(run, lotId);
        await sleep(600);
      }
      if (aborted()) break;
      await sleep(scaled(2500));
    }
    if (getInternal().auctionId !== run.auctionId) {
      st.phase = "stopped";
      st.message = "The auction was reset, so autopilot stopped.";
    } else if (run.stop) {
      st.phase = "stopped";
      st.message = "Autopilot stopped. Paddles stay live; close the auction when ready.";
    } else {
      if (Date.now() > (st.deadlineAt ?? 0)) {
        const open = getState().lots.find((l) => l.status === "open");
        if (open) hammer(open.id);
      }
      if (st.autoClose) {
        st.phase = "closing";
        st.message = "Closing: capturing winners, releasing holds, paying out…";
        // Network blips happen: close is idempotent and only retries what failed.
        for (let k = 0; k < 4; k++) {
          await close();
          if (getState().status === "closed") break;
          await sleep(1500);
        }
      }
      const settled = getState().status === "closed";
      st.phase = st.autoClose && !settled ? "error" : "done";
      st.message = !st.autoClose ? "Gala complete. Close the auction to settle." : settled ? "Gala complete and settled." : "Gala complete, but some payments need attention. Press Close in admin to retry.";
    }
  } catch (e) {
    console.error("[autopilot]", (e as Error).message);
    st.phase = "error";
    st.message = e instanceof Error ? e.message.slice(0, 200) : "Autopilot failed";
  } finally {
    st.running = false;
    st.currentLotId = undefined;
  }
}

export async function startAutopilot(opts: { personas?: PersonaSpec[]; lots?: string[]; autoClose?: boolean; roomKey?: string } = {}): Promise<AutopilotStatus> {
  const roomKey = opts.roomKey ?? "main";
  // One autopilot per process, whichever room.
  for (const r of runs().values()) if (r.status.running) throw new EngineError(409, "Autopilot is already running");
  const s = getState();
  if (s.status === "closed") throw new EngineError(409, "Auction is closed. Reset it first.");
  const wanted = opts.lots?.length ? opts.lots : s.lots.filter((l) => l.status === "pending").map((l) => l.id);
  const lotIds = wanted.filter((id) => s.lots.some((l) => l.id === id && (l.status === "pending" || l.status === "open"))).slice(0, MAX_LOTS);
  if (lotIds.length === 0) throw new EngineError(409, "No unsold lots left to run");
  const specs = (opts.personas?.length ? opts.personas : DEFAULT_PERSONAS).slice(0, 5);

  const status: AutopilotStatus = {
    phase: "setup", running: true, roomKey, message: "Giving each bidder a PayPal hold…", autoClose: opts.autoClose === true,
    startedAt: Date.now(), deadlineAt: Date.now() + MAX_MS, lotIds, lotIndex: 0, aiCalls: 0,
    personas: specs.map((p) => ({ name: p.name, emoji: p.emoji, blurb: p.blurb, cap: p.cap, hold: p.hold ?? Math.round(p.cap * 1.5) })),
  };
  const run: Run = { status, stop: false, agents: [], auctionId: getInternal().auctionId };
  runs().set(roomKey, run); // claim the slot before any await

  try {
    // Real sandbox test-card authorizations (simulated in demo mode), in parallel.
    const made = await Promise.all(
      specs.map(async (spec, k) => {
        const input = {
          name: spec.name,
          holdAmount: status.personas[k].hold,
          testCard: true,
          // lotId points nowhere on purpose: the engine's own absentee agent then stands down and autopilot drives these paddles.
          agent: { instruction: `Autopilot persona: ${spec.blurb}`, maxBid: spec.cap, lotId: "__autopilot__" },
        };
        let paddle: Awaited<ReturnType<typeof createPaddle>>["paddle"];
        for (let attempt = 0; ; attempt++) {
          try {
            ({ paddle } = await createPaddle(input));
            break;
          } catch (e) {
            if (e instanceof EngineError || attempt >= 2) throw e; // retry only transient network/PayPal failures
            await sleep(800);
          }
        }
        status.personas[k].paddleId = paddle.id;
        status.personas[k].number = paddle.number;
        status.personas[k].hold = paddle.holdAmount;
        return { spec, paddleId: paddle.id };
      }),
    );
    run.agents = made.map((m) => ({ spec: m.spec, paddleId: m.paddleId, busy: false, key: "", actAt: 0, dropped: false }));
  } catch (e) {
    status.phase = "error";
    status.running = false;
    status.message = e instanceof Error ? e.message.slice(0, 200) : "Could not create bidder paddles";
    throw e;
  }
  status.phase = "running";
  pushEvent({ type: "system", text: `Autopilot gala: ${specs.map((p) => p.name).join(", ")} take their paddles. Humans can join from /paddle at any time.` });
  void runLoop(run);
  return status;
}
