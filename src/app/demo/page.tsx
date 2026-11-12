"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AutopilotStatus } from "@/lib/ai/autopilot";
import { NightInNumbers } from "@/components/proof/NightInNumbers";
import { CopyId } from "@/components/proof/PayPalProof";
import { SandboxBadge } from "@/components/SandboxBadge";
import { useRoom, withRoom } from "@/components/SiteNav";
import { btn, Pill } from "@/components/ui";
import { post } from "@/lib/client/api";
import { clock, findPaddle, money, stageLot } from "@/lib/client/format";
import type { LedgerRow, Lot, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useGusPrep } from "@/lib/client/useGusPrep";
import { useSpeech, useVoiceStatus } from "@/lib/client/useSpeech";

const box = "rounded-xl border border-line bg-surface shadow-soft";
const head = "flex items-baseline justify-between gap-3 border-b border-line px-5 py-3.5";
const h2 = "display text-xl text-ink";

const API: Record<LedgerRow["kind"], string> = {
  authorized: "Orders v2 · AUTHORIZE",
  captured: "Authorizations · capture",
  voided: "Authorizations · void",
  payout: "Payouts · batch",
  receipt: "Invoicing · paid invoice",
};
const WHAT: Record<LedgerRow["kind"], string> = {
  authorized: "Hold placed: this is the bidder's paddle",
  captured: "Winner charged what they won",
  voided: "Hold released, nothing charged",
  payout: "Proceeds sent to the organizer",
  receipt: "Receipt sent to the winner",
};
const bad = (r: LedgerRow) => /FAIL|DENIED|ERROR|RETRY/i.test(r.status);

function useAutopilot(room: string, on: boolean): AutopilotStatus | null {
  const [s, setS] = useState<AutopilotStatus | null>(null);
  useEffect(() => {
    if (!on) return;
    let stop = false;
    const load = () =>
      fetch(withRoom("/api/autopilot", room), { cache: "no-store" })
        .then((r) => r.json())
        .then((j: AutopilotStatus) => {
          if (!stop) setS(j);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [room, on]);
  return s;
}

/** Holds → each lot → settle, with where the demo is now. */
function Progress({ state, auto }: { state: State; auto: AutopilotStatus | null }) {
  const lotIds = auto?.lotIds?.length ? auto.lotIds : state.lots.slice(0, 3).map((l) => l.id);
  const lots = lotIds.map((id) => state.lots.find((l) => l.id === id)).filter((l): l is Lot => !!l);
  const closed = state.status === "closed";
  const steps: { label: string; sub: string; done: boolean; now: boolean }[] = [
    { label: "Paddles", sub: "PayPal holds", done: state.paddles.length > 0, now: auto?.phase === "setup" },
    ...lots.map((l, i) => ({
      label: `Lot ${i + 1}`,
      sub: l.title,
      done: l.status === "sold" || l.status === "unsold",
      now: l.status === "open",
    })),
    { label: "Settle", sub: "Capture, release, pay out", done: closed, now: auto?.phase === "closing" },
  ];
  return (
    <ol aria-label="Demo progress" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {steps.map((s) => (
        <li
          key={s.label}
          aria-current={s.now ? "step" : undefined}
          className={`rounded-lg border px-3 py-2 ${s.now ? "border-clay bg-clay-soft" : s.done ? "border-line bg-sage-soft/50" : "border-line bg-surface"}`}
        >
          <p className="flex items-center justify-between gap-2 text-sm font-medium text-ink">
            {s.label}
            <span className={`text-[11px] font-medium ${s.now ? "text-clay-ink" : s.done ? "text-sage" : "text-muted"}`}>{s.now ? "Now" : s.done ? "Done" : ""}</span>
          </p>
          <p className="truncate text-xs text-muted">{s.sub}</p>
        </li>
      ))}
    </ol>
  );
}

function StagePanel({ state, speech }: { state: State; speech: ReturnType<typeof useSpeech> }) {
  const lot = stageLot(state);
  const sold = lot?.status === "sold";
  const leader = lot ? findPaddle(state, sold ? lot.winnerPaddleId : lot.highPaddleId) : undefined;
  const amount = lot ? (sold ? (lot.finalPrice ?? lot.highBid) : lot.highBid > 0 ? lot.highBid : lot.startPrice) : 0;
  const voice = useVoiceStatus();
  const phase = !lot ? "" : sold ? "Sold" : lot.status === "unsold" ? "Passed" : lot.status === "open" ? { bidding: "Bidding", "going-once": "Going once", "going-twice": "Going twice", sold: "Sold" }[lot.phase] : "Up next";
  return (
    <section aria-labelledby="stage-h" className={`${box} flex flex-col`}>
      <div className={head}>
        <h2 id="stage-h" className={h2}>
          The auction
        </h2>
        <span className="text-xs text-muted">what the room sees</span>
      </div>
      <div className="flex flex-1 flex-col gap-5 p-5">
        {lot ? (
          <div>
            <p className="flex items-center justify-between gap-2">
              <span className="eyebrow text-muted">Lot {state.lots.indexOf(lot) + 1}</span>
              {phase && <Pill value={sold ? "sold" : lot.status === "open" ? "open" : "pending"} label={phase} />}
            </p>
            <p className="display mt-2 text-3xl text-ink">
              <span aria-hidden>{lot.emoji} </span>
              {lot.title}
            </p>
            <p className="eyebrow mt-4 text-muted">{sold ? "Hammer price" : lot.highBid > 0 ? "Current bid" : "Opening bid"}</p>
            <p key={amount} className="num display anim-bump text-6xl text-ink">
              {money(amount)}
            </p>
            <p className="mt-1 text-sm text-ink-2">{leader ? `${sold ? "Won by" : "High bidder:"} #${leader.number} ${leader.name}` : lot.status === "open" ? "Waiting for the first bid" : ""}</p>
          </div>
        ) : (
          <p className="text-muted">The lots appear here.</p>
        )}
        <blockquote className="mt-auto rounded-lg bg-sunken/70 p-4">
          <p className="flex items-center gap-2 text-xs text-muted">
            <span className="font-medium text-clay-ink">Gus</span>
            <span aria-hidden className="flex h-3 items-end gap-[2px]">
              {[0, 1, 2, 3].map((i) =>
                speech.speaking ? (
                  <span key={i} className="speak-bar h-full w-[2px] rounded bg-clay" style={{ animationDelay: `${i * 0.12}s` }} />
                ) : (
                  <span key={i} className="h-[2px] w-[2px] rounded-full bg-line-strong" />
                ),
              )}
            </span>
            AI auctioneer
          </p>
          <p key={state.caption.ts} aria-live="polite" className="anim-fade display mt-2 text-lg italic leading-snug text-ink">
            &ldquo;{state.caption.text}&rdquo;
          </p>
          <p className="mt-2 text-[11px] text-muted">
            {state.caption.kind === "pitch" ? "This sentence was written by Gemini for this lot. " : "Line built in code from the auction's state. "}
            Voice: Kokoro, open source{voice.state === "loading" ? ` (loading ${voice.pct}%)` : ""}.
          </p>
        </blockquote>
      </div>
    </section>
  );
}

function AgentsPanel({ state, auto }: { state: State; auto: AutopilotStatus | null }) {
  const personas = auto?.personas ?? [];
  const decisions = auto?.decisions ?? [];
  const lot = stageLot(state);
  return (
    <section aria-labelledby="agents-h" className={`${box} flex min-h-0 flex-col`}>
      <div className={head}>
        <h2 id="agents-h" className={h2}>
          The AI bidders
        </h2>
        <span className="text-xs text-muted">{auto ? `${auto.aiCalls} Gemini calls` : ""}</span>
      </div>
      <ul className="grid grid-cols-3 gap-px border-b border-line bg-line">
        {personas.map((p) => {
          const pad = state.paddles.find((x) => x.id === p.paddleId);
          const leading = !!pad && lot?.highPaddleId === pad.id && lot.status === "open";
          const left = pad ? Math.max(0, pad.holdAmount - pad.committed) : p.hold;
          return (
            <li key={p.name} className={`bg-surface px-3 py-3 ${leading ? "bg-clay-soft/60" : ""}`}>
              <p className="truncate text-sm font-medium text-ink">
                <span aria-hidden>{p.emoji} </span>
                {p.name}
              </p>
              <p className="num mt-0.5 text-xs text-muted">
                limit {money(p.cap)} · hold {money(p.hold)}
              </p>
              <p className="num mt-1 text-xs text-ink-2">{pad ? (pad.status === "held" ? `${money(left)} left to bid` : pad.status === "captured" ? "charged" : pad.status === "voided" ? "hold released" : "placing hold…") : "placing hold…"}</p>
              {leading && <p className="mt-1 text-[11px] font-medium text-clay-ink">Winning now</p>}
            </li>
          );
        })}
        {personas.length === 0 && <li className="col-span-3 bg-surface px-4 py-3 text-sm text-muted">The bidders take their seats when the demo starts.</li>}
      </ul>
      <p className="px-5 pt-3 text-xs leading-relaxed text-muted">
        Gemini decides <em>whether</em> to bid, in character. Code picks the amount and blocks anything over the bidder&apos;s limit or PayPal hold.
      </p>
      <ol aria-label="Bidder decisions, newest first" className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-5 pb-3 lg:max-h-[26rem]">
        {decisions.length === 0 && <li className="py-3 text-sm text-muted">Decisions appear here as the bidders think.</li>}
        {decisions.map((d) => (
          <li key={`${d.ts}-${d.name}`} className="anim-rise py-2.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-medium text-ink">{d.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.action === "bid" ? "bg-clay-soft text-clay-ink" : "bg-sunken text-ink-2"}`}>
                {d.action === "bid" ? `bids ${money(d.amount)}` : d.action === "pass" ? "passes" : "drops out"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${d.by === "gemini" ? "bg-agent-soft text-agent" : "border border-line text-muted"}`}>
                {d.by === "gemini" ? "decided by Gemini" : "decided by a rule"}
              </span>
              <span className="num ml-auto text-[11px] text-muted">{clock(d.ts)}</span>
            </p>
            <p className="mt-1 text-sm leading-snug text-ink-2">&ldquo;{d.reason}&rdquo;</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PayPalPanel({ state }: { state: State }) {
  const rows = [...state.ledger].reverse();
  return (
    <section aria-labelledby="pp-h" className={`${box} flex min-h-0 flex-col`}>
      <div className={head}>
        <h2 id="pp-h" className={h2}>
          PayPal, live
        </h2>
        <span className="text-xs text-muted">{state.demoMode ? "simulated" : "sandbox REST API"}</span>
      </div>
      <dl className="grid grid-cols-4 gap-px border-b border-line bg-line text-center">
        {(
          [
            ["Held", state.totals.held],
            ["Charged", state.totals.captured],
            ["Released", state.totals.voided],
            ["Paid out", state.totals.paidOut],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="bg-surface px-2 py-2.5">
            <dt className="eyebrow text-[10px] text-muted">{k}</dt>
            <dd className="num display text-lg text-ink">{money(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="px-5 pt-3 text-xs leading-relaxed text-muted">Each row is a request the server sent to PayPal, with the id PayPal returned. Bids cost nothing: money moves only at the hold and at the close.</p>
      <ol aria-label="PayPal calls, newest first" className="min-h-0 flex-1 divide-y divide-line overflow-y-auto px-5 pb-3 lg:max-h-[26rem]">
        {rows.length === 0 && <li className="py-3 text-sm text-muted">No PayPal calls yet.</li>}
        {rows.map((r) => {
          const p = findPaddle(state, r.paddleId);
          return (
            <li key={r.id} className="anim-rise py-2.5">
              <p className="flex items-baseline justify-between gap-3">
                <span className="font-mono text-xs text-ink-2">{API[r.kind]}</span>
                <span className="num display text-lg text-ink">{money(r.amount)}</span>
              </p>
              <p className="mt-0.5 text-sm text-ink">
                {WHAT[r.kind]}
                {p ? ` · #${p.number} ${p.name}` : ""}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                {r.paypalId && <CopyId id={r.paypalId} />}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${bad(r) ? "bg-danger-soft text-danger" : "bg-sage-soft text-sage"}`}>{r.status.replace(/_/g, " ")}</span>
                <span className="num text-[11px] text-muted">{clock(r.ts)}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function UnderTheHood({ state, auto, room }: { state: State; auto: AutopilotStatus | null; room: string }) {
  const ok = state.ledger.filter((r) => !bad(r));
  const n = (k: LedgerRow["kind"]) => ok.filter((r) => r.kind === k).length;
  const voice = useVoiceStatus();
  const pitches = state.lots.filter((l) => l.pitch).length;
  const byGemini = auto?.decisions.filter((d) => d.by === "gemini").length ?? 0;
  const items: { name: string; role: string; now: string; href?: string }[] = [
    { name: "PayPal Orders v2", role: "Each paddle is an order with intent AUTHORIZE: a hold, not a charge.", now: `${n("authorized")} holds placed` },
    { name: "PayPal Authorizations", role: "At the close: capture each winner's total, void every other hold.", now: `${n("captured")} captured · ${n("voided")} voided` },
    { name: "PayPal Payouts", role: "Sends the proceeds to the organizer (or splits them with consignors).", now: `${n("payout")} payout batches` },
    { name: "PayPal Invoicing", role: "Each winner's receipt is a PayPal invoice, sent and marked paid.", now: `${n("receipt")} receipts` },
    { name: "Google Gemini", role: "Writes Gus's sentence for each lot and decides, in character, whether a bidder raises.", now: `${pitches} lot sentences · ${byGemini} bidder decisions` },
    { name: "Kokoro (open source)", role: "Gus's voice. Common lines are pre-rendered; the rest is rendered in your browser.", now: voice.state === "ready" ? "voice model loaded" : voice.state === "loading" ? `loading ${voice.pct}%` : "pre-rendered lines" },
    { name: "AG Grid · AG Studio", role: "The settlement report for this auction, with an assistant you can question.", now: "open the report", href: withRoom("/report", room) },
    { name: "Bryntum Scheduler", role: "Every paddle's hold on a timeline, from authorization to capture or release.", now: "open the timeline", href: withRoom("/timeline", room) },
    { name: "Channel3", role: "When a host photographs an item, finds retail listings to estimate its value.", now: "used in Host · Snap a lot" },
    { name: "Render", role: "Hosts the app. A Render Workflows settlement is built in and off by default.", now: "serving this page" },
  ];
  return (
    <section aria-labelledby="hood-h">
      <h2 id="hood-h" className="display text-2xl text-ink">
        Under the hood
      </h2>
      <p className="mt-1 text-sm text-muted">What each service is doing in this auction.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map((i) => {
          const inner = (
            <>
              <p className="text-sm font-medium text-ink">{i.name}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{i.role}</p>
              <p className={`num mt-2 text-xs font-medium ${i.href ? "text-clay-ink underline underline-offset-4" : "text-sage"}`}>{i.now}</p>
            </>
          );
          return (
            <li key={i.name} className="rounded-lg border border-line bg-surface p-4">
              {i.href ? (
                <a href={i.href} target="_blank" rel="noreferrer" className="block">
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function DemoPage() {
  const room = useRoom();
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  // Opened without a room (the Demo tab): make a fresh demo room and come back with it.
  useEffect(() => {
    if (!ready || room) return;
    fetch("/api/room/new", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { room?: string }) => {
        if (j.room) window.location.replace(`/demo?room=${encodeURIComponent(j.room)}`);
      })
      .catch(() => {});
  }, [ready, room]);
  if (!ready || !room) {
    return (
      <main className="flex-1 px-4 py-16 text-center">
        <p role="status" className="anim-breathe text-muted">
          Opening a demo auction room…
        </p>
      </main>
    );
  }
  return <Demo />;
}

const noop = () => () => {};

function Demo() {
  const room = useRoom();
  const { state, error } = useAuctionState(500);
  const speech = useSpeech(state?.caption);
  const [phase, setPhase] = useState<"intro" | "starting" | "running">("intro");
  const [startError, setStartError] = useState<string | null>(null);
  const auto = useAutopilot(room, !!room);
  useGusPrep(state);

  async function start() {
    speech.start();
    setStartError(null);
    setPhase("starting");
    try {
      await post("/api/autopilot", { action: "start", autoClose: true });
      setPhase("running");
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "The demo could not start.");
      setPhase("intro");
    }
  }

  if (!state) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
        <div className="h-24 animate-pulse rounded-xl bg-sunken" />
        <p role="status" className="mt-6 text-center text-muted">
          {error ? `Can't reach the server: ${error}` : "Opening the demo room…"}
        </p>
      </main>
    );
  }

  const closed = state.status === "closed";
  const started = phase === "running" || !!auto?.running || state.paddles.length > 0 || state.status !== "lobby";
  const failed = auto?.phase === "error";

  return (
    <main className="mx-auto w-full max-w-[96rem] flex-1 space-y-6 px-4 pb-20 pt-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow flex flex-wrap items-center gap-3 text-clay-ink">
            Demo · how it works <SandboxBadge />
            <span className="font-mono text-xs normal-case tracking-normal text-muted">room {room.toUpperCase()}</span>
          </p>
          <h1 className="display mt-2 text-3xl text-ink sm:text-4xl">The auction, the AI bidders and PayPal, side by side.</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {speech.enabled ? (
            <button type="button" onClick={speech.toggleMute} aria-pressed={speech.muted} className={btn.small}>
              {speech.muted ? "Unmute Gus" : "Mute Gus"}
            </button>
          ) : (
            started && (
              <button type="button" onClick={speech.start} className={btn.small}>
                Turn on Gus&apos;s voice
              </button>
            )
          )}
          <a href={withRoom("/stage", room)} target="_blank" rel="noreferrer" className={btn.small}>
            Full-screen stage
          </a>
          <a href={withRoom("/paddle", room)} target="_blank" rel="noreferrer" className={btn.small}>
            Bid yourself
          </a>
        </div>
      </header>

      <Progress state={state} auto={auto} />
      {auto?.message && started && !closed && (
        <p role="status" className="text-sm text-ink-2">
          {auto.message}
        </p>
      )}
      {failed && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {auto?.message}
        </p>
      )}

      {closed && (
        <section aria-labelledby="done-h" className="rounded-2xl border border-sage/40 bg-sage-soft/40 p-6">
          <h2 id="done-h" className="display text-3xl text-ink">
            Settled. That&apos;s the whole house.
          </h2>
          <p className="mt-2 max-w-3xl text-ink-2">
            Every winner was charged once, for exactly what they won. Every other hold was released. The proceeds were paid out and each winner got a receipt. Nobody stood in a payment line.
          </p>
          <NightInNumbers state={state} className="mt-5" />
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={withRoom("/paypal", room)} className={btn.primary}>
              Every PayPal call for this auction
            </a>
            <a href={withRoom("/report", room)} className={btn.secondary}>
              Settlement report (AG Studio)
            </a>
            <a href={withRoom("/timeline", room)} className={btn.secondary}>
              Hold timeline (Bryntum)
            </a>
            <Link href="/#own" className={btn.accent}>
              Now run your own auction &rarr;
            </Link>
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.15fr)]">
        <StagePanel state={state} speech={speech} />
        <AgentsPanel state={state} auto={auto} />
        <PayPalPanel state={state} />
      </div>

      <UnderTheHood state={state} auto={auto} room={room} />

      {!started && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/40 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="intro-h" className="w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-lift sm:p-10">
            <p className="eyebrow text-clay-ink">Demo auction · about 4 minutes</p>
            <h2 id="intro-h" className="display mt-3 text-4xl text-ink sm:text-5xl">
              See how the house works.
            </h2>
            <ol className="mt-6 space-y-3 text-[15px] leading-relaxed text-ink-2 sm:text-base">
              <li>
                <span className="num mr-2 text-clay-ink">1</span>Three AI bidders each get a paddle. A paddle is a real PayPal sandbox authorization hold.
              </li>
              <li>
                <span className="num mr-2 text-clay-ink">2</span>Gus, the AI auctioneer, sells three lots out loud. You watch each bidder decide, and each PayPal call land.
              </li>
              <li>
                <span className="num mr-2 text-clay-ink">3</span>At the end PayPal charges the winners, releases every other hold, pays out the proceeds and sends receipts.
              </li>
            </ol>
            <p className="mt-5 text-sm text-muted">Turn your sound on. To bid against the AI bidders, use &ldquo;Bid yourself&rdquo; once it starts.</p>
            {startError && (
              <p role="alert" className="mt-4 text-sm font-medium text-danger">
                {startError}
              </p>
            )}
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <button type="button" onClick={start} disabled={phase === "starting"} className={`${btn.accent} px-6 py-3.5 text-base`}>
                {phase === "starting" ? "Placing the PayPal holds…" : "Start the demo, with sound"}
              </button>
              <Link href="/" className={btn.quiet}>
                Back
              </Link>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
