"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { PayPalButtons } from "@/components/PayPalButtons";
import { SandboxBadge } from "@/components/SandboxBadge";
import { post } from "@/lib/client/api";
import { findPaddle, headroom, isBidEvent, money, nextBid } from "@/lib/client/format";
import type { Paddle, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useStoredValue } from "@/lib/client/useStoredValue";

const PRESETS = [100, 250, 500];
const card = "rounded-2xl border border-stone-300 bg-white p-4 shadow-sm";
const label = "block text-xs font-bold uppercase tracking-widest text-stone-600";
const input =
  "mt-1 w-full rounded-xl border-2 border-stone-300 bg-white px-3 py-3 text-lg text-stone-900 placeholder:text-stone-500 focus:border-amber-600";

type Created = { paddleId: string; orderId?: string; held?: boolean };

function HoldPicker({ value, onChange, idPrefix }: { value: number; onChange: (n: number) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className={label}>Hold amount (authorized, charged only if you win)</legend>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            id={`${idPrefix}-${n}`}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={`rounded-xl border-2 py-3 text-xl font-black ${
              value === n ? "border-amber-700 bg-amber-600 text-white" : "border-stone-300 bg-white text-stone-900 hover:border-amber-600"
            }`}
          >
            ${n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <Link href="/" className="font-serif text-2xl font-black text-stone-900">
        Going Twice
      </Link>
      <SandboxBadge />
    </header>
  );
}

function RegisterCard({ onCreated, testCards }: { onCreated: (c: Created) => void; testCards?: boolean }) {
  const [name, setName] = useState("");
  const [hold, setHold] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent, testCard = false) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<Created>("/api/paddle", { name: name.trim(), holdAmount: hold, ...(testCard ? { testCard: true } : {}) });
      onCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-4`} aria-labelledby="reg-h">
      <div>
        <h1 id="reg-h" className="font-serif text-3xl font-black text-stone-900">Get your paddle</h1>
        <p className="mt-1 text-stone-700">Pick a hold. PayPal reserves it on your account; you are only charged for lots you win.</p>
      </div>
      <div>
        <label htmlFor="reg-name" className={label}>Your name</label>
        <input id="reg-name" className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Dana R." required maxLength={40} />
      </div>
      <HoldPicker value={hold} onChange={setHold} idPrefix="reg-hold" />
      {error && <p role="alert" className="rounded-lg bg-rose-100 p-3 text-sm font-semibold text-rose-900">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()} className="w-full rounded-2xl bg-amber-600 py-4 text-xl font-black uppercase text-white shadow hover:bg-amber-700 disabled:bg-stone-300 disabled:text-stone-700">
        {busy ? "Getting your paddle…" : "Get my paddle"}
      </button>
      {testCards && (
        <button type="button" onClick={(e) => submit(e, true)} disabled={busy || !name.trim()} className="w-full rounded-2xl border-2 border-dashed border-rose-700 bg-rose-50 py-3 text-base font-bold text-rose-900 hover:bg-rose-100 disabled:opacity-50">
          Use sandbox test card &mdash; no login
        </button>
      )}
    </form>
  );
}

function AuthorizeCard({ paddle, orderId, onDone }: { paddle: Paddle; orderId?: string; onDone: () => void }) {
  const oid = orderId ?? paddle.orderId;
  return (
    <section className={`${card} space-y-3`} aria-labelledby="auth-h">
      <h2 id="auth-h" className="font-serif text-2xl font-black text-stone-900">
        Authorize your {money(paddle.holdAmount)} hold
      </h2>
      <p className="text-stone-700">
        Paddle #{paddle.number} for {paddle.name}. Approve in PayPal to reserve funds. Nothing is charged unless you win.
      </p>
      {oid ? <PayPalButtons paddleId={paddle.id} orderId={oid} onAuthorized={onDone} /> : <p className="text-stone-600">Preparing your PayPal order&hellip;</p>}
    </section>
  );
}

function BidScreen({ state, paddle, refresh }: { state: State; paddle: Paddle; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [bidError, setBidError] = useState<string | null>(null);

  const lot = state.lots.find((l) => l.id === state.currentLotId);
  const open = !!lot && lot.status === "open";
  const winning = open && lot.highPaddleId === paddle.id;
  const hasBid = !!lot && (lot.highPaddleId === paddle.id || state.events.some((e) => isBidEvent(e) && e.paddleId === paddle.id && e.lotId === lot.id));
  const next = lot ? nextBid(lot) : 0;
  const need = lot ? paddle.committed - (winning ? lot.highBid : 0) + next : 0;
  const room = headroom(paddle);
  const won = state.lots.filter((l) => l.status === "sold" && l.winnerPaddleId === paddle.id);
  const receipt = state.receipts.find((r) => r.paddleId === paddle.id);

  let reason: string | null = null;
  if (paddle.status !== "held") reason = paddle.status === "captured" ? "Your hold was charged. Thank you!" : "Your hold was released.";
  else if (state.status === "closed") reason = "The auction has closed.";
  else if (state.status === "lobby") reason = "The auction hasn't started yet.";
  else if (!open) reason = "Waiting for the next lot to open.";
  else if (winning) reason = "You're the high bidder. Sit tight!";
  else if (need > paddle.holdAmount) reason = `Over your hold: this bid needs ${money(need - paddle.holdAmount)} more than your ${money(paddle.holdAmount)} hold.`;

  async function bid() {
    if (!lot || reason || busy) return;
    setBusy(true);
    setBidError(null);
    try {
      await post("/api/bid", { paddleId: paddle.id, lotId: lot.id, amount: next });
      navigator.vibrate?.(60);
      setFlash(true);
      setTimeout(() => setFlash(false), 500);
      await refresh();
    } catch (e) {
      setBidError(e instanceof Error ? e.message : "Bid failed");
      navigator.vibrate?.([40, 60, 40]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  let status: { text: string; cls: string } | null = null;
  if (open && winning) status = { text: `You're winning at ${money(lot.highBid)}!`, cls: "bg-emerald-100 text-emerald-900" };
  else if (open && hasBid) status = { text: `Outbid. ${money(lot.highBid)} leads. Bid ${money(next)} to take it back.`, cls: "bg-rose-100 text-rose-900" };
  else if (open) status = { text: lot.highBid > 0 ? `${money(lot.highBid)} leads. Jump in!` : "No bids yet. Be the first!", cls: "bg-amber-100 text-amber-900" };

  return (
    <div className="space-y-4">
      <section className="text-center" aria-label="Your paddle">
        <p className="text-xs font-bold uppercase tracking-widest text-stone-600">Your paddle</p>
        <p className="font-serif text-[6.5rem] font-black leading-none text-stone-900">{paddle.number}</p>
        <p className="text-lg text-stone-700">{paddle.name}</p>
      </section>

      <section className={`${card} grid grid-cols-3 gap-2 text-center`} aria-label="Your PayPal hold">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-600">Hold</p>
          <p className="text-xl font-black tabular-nums">{money(paddle.holdAmount)}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-600">Committed</p>
          <p className="text-xl font-black tabular-nums">{money(paddle.committed)}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-stone-600">Headroom</p>
          <p className="text-xl font-black tabular-nums text-emerald-800">{money(room)}</p>
        </div>
        <p className="col-span-3 text-xs text-stone-600">Authorized, not charged unless you win.</p>
      </section>

      {lot && (
        <section className={card} aria-label="Current lot">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-800">{open ? "Now bidding" : lot.status === "sold" ? "Just sold" : "Lot"}</p>
          <p className="mt-1 flex items-start gap-3 text-xl font-bold text-stone-900">
            <span aria-hidden className="text-4xl leading-none">{lot.emoji}</span>
            <span className="min-w-0 break-words">{lot.title}</span>
          </p>
          <p className="mt-1 text-stone-700">{lot.description}</p>
          <p className="mt-2 text-stone-700">
            {lot.highBid > 0 ? "Current bid" : "Opening bid"} <strong className="text-2xl text-stone-900">{money(lot.highBid > 0 ? lot.highBid : lot.startPrice)}</strong>
            {lot.status === "open" && lot.phase !== "bidding" && <span className="ml-2 font-bold uppercase text-orange-800">{lot.phase.replace("-", " ")}</span>}
          </p>
        </section>
      )}

      {status && (
        <p role="status" aria-live="polite" className={`rounded-xl p-3 text-center text-lg font-bold ${status.cls}`}>
          {status.text}
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={bid}
          disabled={!!reason || busy || !lot}
          aria-describedby="bid-reason"
          className={`w-full rounded-3xl bg-amber-600 py-9 text-4xl font-black uppercase tracking-wide text-white shadow-lg hover:bg-amber-700 active:bg-amber-800 disabled:bg-stone-300 disabled:text-stone-700 disabled:shadow-none ${flash ? "anim-tap" : ""}`}
        >
          {busy ? "Bidding…" : lot ? `Bid ${money(next)}` : "Bid"}
        </button>
        <p id="bid-reason" role={bidError ? "alert" : undefined} className={`mt-2 min-h-6 text-center text-sm font-semibold ${bidError ? "text-rose-800" : "text-stone-700"}`}>
          {bidError ?? reason ?? ""}
        </p>
      </div>

      {won.length > 0 && (
        <section className={card} aria-label="Lots you won">
          <h2 className="font-bold text-stone-900">You won</h2>
          <ul className="mt-1 divide-y divide-stone-200">
            {won.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-words">{l.emoji} {l.title}</span>
                <span className="font-black tabular-nums">{money(l.finalPrice ?? l.highBid)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipt && (
        <section className={card} aria-label="Your receipt">
          <h2 className="font-bold text-stone-900">Your receipt</h2>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{receipt.text}</p>
        </section>
      )}
    </div>
  );
}

function AbsenteeSection({ state, refresh }: { state: State; refresh: () => Promise<void> }) {
  const stored = useStoredValue("gt.agentPaddleId");
  const [name, setName] = useState("");
  const [hold, setHold] = useState(250);
  const [instruction, setInstruction] = useState("");
  const [maxBid, setMaxBid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | undefined>();

  const agent = findPaddle(state, stored.value ?? undefined);

  async function submit(e: FormEvent, testCard = false) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<Created>("/api/agent", { name: name.trim(), holdAmount: hold, instruction: instruction.trim(), maxBid: Number(maxBid), ...(testCard ? { testCard: true } : {}) });
      setOrderId(res.orderId);
      stored.set(res.paddleId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} space-y-4`} aria-labelledby="abs-h">
      <div>
        <h2 id="abs-h" className="font-serif text-2xl font-black text-stone-900">Absentee bid</h2>
        <p className="mt-1 text-stone-700">Can&apos;t be here? Tell an AI agent what you want and your limit. It bids for you.</p>
      </div>

      {agent ? (
        <div className="space-y-3">
          <p className="text-lg font-bold text-stone-900">
            Agent paddle #{agent.number} <span className="font-normal text-stone-700">for {agent.name}</span>
          </p>
          {agent.status === "pending" ? (
            <AuthorizeCard paddle={agent} orderId={orderId} onDone={refresh} />
          ) : (
            <p className="text-sm text-stone-700">
              Hold {money(agent.holdAmount)} &middot; committed {money(agent.committed)} &middot; max bid {money(agent.agent?.maxBid)} &middot; {agent.status}
            </p>
          )}
          {agent.agent?.instruction && <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-800">&ldquo;{agent.agent.instruction}&rdquo;</p>}
          <div aria-live="polite" className="rounded-lg border-l-4 border-indigo-700 bg-indigo-50 p-3 text-sm text-indigo-950">
            <p className="text-xs font-bold uppercase tracking-widest text-indigo-800">Agent&apos;s thinking</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{agent.agent?.lastReasoning ?? "Waiting for a lot that matches…"}</p>
          </div>
          <button type="button" onClick={() => stored.set(null)} className="text-sm font-semibold text-stone-700 underline">
            Set up a different agent
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="abs-name" className={label}>Your name</label>
            <input id="abs-name" className={input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
          </div>
          <HoldPicker value={hold} onChange={setHold} idPrefix="abs-hold" />
          <div>
            <label htmlFor="abs-instr" className={label}>What do you want?</label>
            <textarea id="abs-instr" className={input} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} required placeholder="e.g. I'd love the pizza night basket, but only if it stays reasonable." maxLength={400} />
          </div>
          <div>
            <label htmlFor="abs-max" className={label}>Max bid ($)</label>
            <input id="abs-max" className={input} type="number" inputMode="numeric" min={1} step={1} value={maxBid} onChange={(e) => setMaxBid(e.target.value)} required />
          </div>
          {error && <p role="alert" className="rounded-lg bg-rose-100 p-3 text-sm font-semibold text-rose-900">{error}</p>}
          <button type="submit" disabled={busy || !name.trim() || !instruction.trim() || !(Number(maxBid) > 0)} className="w-full rounded-2xl bg-stone-900 py-3 text-lg font-black uppercase text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:text-stone-700">
            {busy ? "Sending…" : "Send my agent"}
          </button>
          {state.testCards && (
            <button type="button" onClick={(e) => submit(e, true)} disabled={busy || !name.trim() || !instruction.trim() || !(Number(maxBid) > 0)} className="w-full rounded-2xl border-2 border-dashed border-rose-700 bg-rose-50 py-3 text-base font-bold text-rose-900 hover:bg-rose-100 disabled:opacity-50">
              Use sandbox test card &mdash; no login
            </button>
          )}
        </form>
      )}
    </section>
  );
}

export default function PaddlePage() {
  const { state, error, refresh } = useAuctionState(800);
  const stored = useStoredValue("gt.paddleId");
  const [pendingOrder, setPendingOrder] = useState<string | undefined>();
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => setSettling(false), 4000);
    return () => clearTimeout(t);
  }, [settling]);

  const paddle = state && stored.value ? findPaddle(state, stored.value) : undefined;

  async function created(c: Created) {
    setPendingOrder(c.orderId);
    setSettling(true);
    stored.set(c.paddleId);
    await refresh();
  }

  function forget() {
    stored.set(null);
    setPendingOrder(undefined);
  }

  let body: React.ReactNode;
  if (!state || !stored.ready) {
    body = <p className="py-16 text-center text-lg text-stone-700">{error ? "Reconnecting…" : "Loading…"}</p>;
  } else if (!stored.value) {
    body = <RegisterCard onCreated={created} testCards={state.testCards} />;
  } else if (!paddle) {
    body = settling ? (
      <p className="py-16 text-center text-lg text-stone-700">Getting your paddle&hellip;</p>
    ) : (
      <section className={`${card} space-y-3`}>
        <h1 className="font-serif text-2xl font-black text-stone-900">Paddle not found</h1>
        <p className="text-stone-700">That paddle isn&apos;t in this auction. The demo may have been reset.</p>
        <button type="button" onClick={forget} className="w-full rounded-2xl bg-amber-600 py-3 text-lg font-black uppercase text-white hover:bg-amber-700">
          Register again
        </button>
      </section>
    );
  } else if (paddle.status === "pending") {
    body = <AuthorizeCard paddle={paddle} orderId={pendingOrder} onDone={refresh} />;
  } else {
    body = <BidScreen state={state} paddle={paddle} refresh={refresh} />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 overflow-x-hidden px-4 py-4">
      <Header />
      {state && state.status === "closed" && (
        <p role="status" className="rounded-xl bg-stone-900 p-3 text-center font-bold text-amber-200">The auction has closed. Thank you for supporting the school!</p>
      )}
      {error && state && <p role="status" className="rounded-xl bg-rose-100 p-2 text-center text-sm font-bold text-rose-900">Connection lost. Retrying&hellip;</p>}
      {body}
      {state && stored.ready && state.status !== "closed" && <AbsenteeSection state={state} refresh={refresh} />}
      {paddle && (
        <button type="button" onClick={forget} className="self-center pb-4 text-sm font-semibold text-stone-700 underline">
          Not you? Use a different paddle
        </button>
      )}
    </main>
  );
}
