"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { PayPalButtons } from "@/components/PayPalButtons";
import { InstallHint } from "@/components/InstallHint";
import { JoinRoom } from "@/components/JoinRoom";
import { useRoom } from "@/components/SiteNav";
import { SandboxBadge } from "@/components/SandboxBadge";
import { btn, Eyebrow, field, fieldLabel } from "@/components/ui";
import { post } from "@/lib/client/api";
import { findPaddle, headroom, isBidEvent, money, nextBid } from "@/lib/client/format";
import type { Paddle, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useStoredValue } from "@/lib/client/useStoredValue";

const PRESETS = [100, 250, 500];
const card = "rounded-xl border border-line bg-surface p-6 shadow-soft";
const testCardBtn =
  "inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-clay/60 bg-clay-soft/50 px-4 py-3 text-[15px] font-medium text-clay-ink transition-colors hover:bg-clay-soft disabled:opacity-50";

type Created = { paddleId: string; orderId?: string; held?: boolean };

function HoldPicker({ value, onChange, idPrefix }: { value: number; onChange: (n: number) => void; idPrefix: string }) {
  return (
    <fieldset>
      <legend className={fieldLabel}>Hold amount</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {PRESETS.map((n) => (
          <button
            key={n}
            id={`${idPrefix}-${n}`}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(n)}
            className={`num display rounded-md border py-3 text-2xl transition-colors ${
              value === n ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink hover:border-ink-2"
            }`}
          >
            ${n}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">Authorized on PayPal, charged only for lots you win.</p>
    </fieldset>
  );
}

function HoldExplainer() {
  return (
    <details className="group rounded-lg border border-line bg-sunken/60 px-4 py-3 text-sm text-ink-2">
      <summary className="cursor-pointer list-none font-medium text-ink marker:hidden">
        <span className="inline-flex w-full items-center justify-between">
          How a PayPal hold works
          <span aria-hidden className="text-muted transition-transform group-open:rotate-45">+</span>
        </span>
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 leading-relaxed">
        <li>PayPal reserves your hold amount. Nothing leaves your account.</li>
        <li>You can bid up to that amount across every lot tonight.</li>
        <li>When the auction closes, you&apos;re charged exactly what you won. The rest is released.</li>
      </ol>
    </details>
  );
}

function Notice({ tone, children, role = "status" }: { tone: "info" | "good" | "bad" | "dark"; children: ReactNode; role?: "status" | "alert" }) {
  const look = {
    info: "border-line bg-sunken text-ink-2",
    good: "border-sage/30 bg-sage-soft text-sage",
    bad: "border-danger/30 bg-danger-soft text-danger",
    dark: "border-ink bg-ink text-canvas",
  }[tone];
  return (
    <p role={role} aria-live="polite" className={`rounded-lg border px-4 py-3 text-center text-[15px] font-medium ${look}`}>
      {children}
    </p>
  );
}

function RegisterCard({ onCreated, testCards }: { onCreated: (c: Created) => void; testCards?: boolean }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [hold, setHold] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent, testCard = false) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<Created>("/api/paddle", { name: name.trim(), holdAmount: hold, ...(email.trim() ? { email: email.trim() } : {}), ...(testCard ? { testCard: true } : {}) });
      onCreated(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not register");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-6`} aria-labelledby="reg-h">
      <div>
        <Eyebrow>Welcome to the floor</Eyebrow>
        <h1 id="reg-h" className="display mt-2 text-4xl text-ink">
          Get your paddle
        </h1>
        <p className="mt-2 leading-relaxed text-ink-2">Choose a hold. PayPal reserves it; you&apos;re only charged for what you win.</p>
      </div>
      <div>
        <label htmlFor="reg-name" className={fieldLabel}>
          Your name
        </label>
        <input id="reg-name" className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Dana R." required maxLength={40} />
      </div>
      <div>
        <label htmlFor="reg-email" className={fieldLabel}>
          Email for your receipt <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="reg-email" type="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" maxLength={254} />
      </div>
      <HoldPicker value={hold} onChange={setHold} idPrefix="reg-hold" />
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="space-y-3">
        <button type="submit" disabled={busy || !name.trim()} className={`${btn.primary} w-full py-4 text-base`}>
          {busy ? "Getting your paddle…" : "Continue with PayPal"}
        </button>
        {testCards && (
          <button type="button" onClick={(e) => submit(e, true)} disabled={busy || !name.trim()} className={testCardBtn}>
            Use a sandbox test card &middot; no login
          </button>
        )}
      </div>
      <HoldExplainer />
    </form>
  );
}

/** Small "Back" control at the top of a step card: returns to the first step. */
function BackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="-mr-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-2 transition-colors hover:bg-sunken hover:text-ink">
      <span aria-hidden>&larr;</span>
      {label}
    </button>
  );
}

function AuthorizeCard({ paddle, orderId, onDone, onBack }: { paddle: Paddle; orderId?: string; onDone: () => void; onBack?: () => void }) {
  const oid = orderId ?? paddle.orderId;
  return (
    <section className={`${card} space-y-4`} aria-labelledby="auth-h">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Paddle {paddle.number}</Eyebrow>
        {onBack && <BackButton onClick={onBack} />}
      </div>
      <h2 id="auth-h" className="display text-3xl text-ink">
        Authorize your <span className="num">{money(paddle.holdAmount)}</span> hold
      </h2>
      <p className="leading-relaxed text-ink-2">Approve in PayPal to reserve funds for {paddle.name}. Nothing is charged unless you win.</p>
      {oid ? <PayPalButtons paddleId={paddle.id} orderId={oid} onAuthorized={onDone} /> : <p className="anim-breathe text-muted">Preparing your PayPal order&hellip;</p>}
    </section>
  );
}

function Meter({ paddle }: { paddle: Paddle }) {
  const room = headroom(paddle);
  const used = paddle.holdAmount > 0 ? Math.min(100, (paddle.committed / paddle.holdAmount) * 100) : 0;
  return (
    <section className={card} aria-label="Your PayPal hold">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-muted">Headroom</p>
          <p className="num display mt-1 text-4xl text-ink">{money(room)}</p>
        </div>
        <p className="pb-1 text-right text-sm text-muted">
          of <span className="num text-ink-2">{money(paddle.holdAmount)}</span> held
        </p>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-label="Hold committed"
        aria-valuemin={0}
        aria-valuemax={paddle.holdAmount}
        aria-valuenow={paddle.committed}
      >
        <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${used}%` }} />
      </div>
      <p className="mt-3 text-sm text-muted">
        <span className="num text-ink-2">{money(paddle.committed)}</span> committed to winning bids. Authorized, not charged.
      </p>
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
  const won = state.lots.filter((l) => l.status === "sold" && l.winnerPaddleId === paddle.id);
  const receipt = state.receipts.find((r) => r.paddleId === paddle.id);

  let reason: string | null = null;
  if (paddle.status !== "held") reason = paddle.status === "captured" ? "Your hold was charged. Thank you!" : "Your hold was released.";
  else if (state.status === "closed") reason = "The auction has closed.";
  else if (state.status === "lobby") reason = "The auction hasn't started yet.";
  else if (!open) reason = "Waiting for the next lot to open.";
  else if (winning) reason = "You're the high bidder. Sit tight.";
  else if (need > paddle.holdAmount) reason = `Over your hold: this bid needs ${money(need - paddle.holdAmount)} more than your ${money(paddle.holdAmount)} hold.`;

  async function bid() {
    if (!lot || reason || busy) return;
    setBusy(true);
    setBidError(null);
    try {
      await post("/api/bid", { paddleId: paddle.id, lotId: lot.id, amount: next });
      navigator.vibrate?.(60);
      setFlash(true);
      setTimeout(() => setFlash(false), 400);
      await refresh();
    } catch (e) {
      setBidError(e instanceof Error ? e.message : "Bid failed");
      navigator.vibrate?.([40, 60, 40]);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  let status: { text: string; tone: "good" | "bad" | "info" } | null = null;
  if (open && winning) status = { text: `You're winning at ${money(lot.highBid)}`, tone: "good" };
  else if (open && hasBid) status = { text: `Outbid — ${money(lot.highBid)} leads`, tone: "bad" };
  else if (open) status = { text: lot.highBid > 0 ? `${money(lot.highBid)} leads. Jump in.` : "No bids yet. Be the first.", tone: "info" };

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-4 border-b border-line pb-6" aria-label="Your paddle">
        <div className="min-w-0">
          <p className="eyebrow text-muted">Your paddle</p>
          <p className="mt-1 truncate text-lg text-ink-2">{paddle.name}</p>
        </div>
        <p className="num display text-[88px] leading-[0.8] text-ink">{paddle.number}</p>
      </section>

      {lot ? (
        <section aria-label="Current lot">
          <div className="flex items-start gap-4">
            {lot.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lot.image} alt="" className="h-16 w-16 shrink-0 rounded-md border border-line object-cover" />
            ) : (
              <span aria-hidden className="grid h-16 w-16 shrink-0 place-items-center rounded-md border border-line bg-surface text-3xl">
                {lot.emoji}
              </span>
            )}
            <div className="min-w-0">
              <p className="eyebrow text-clay-ink">
                {open ? (lot.phase === "bidding" ? "Now bidding" : lot.phase.replace("-", " ")) : lot.status === "sold" ? "Just sold" : "Up next"}
              </p>
              <h2 className="display mt-1 break-words text-3xl text-ink">{lot.title}</h2>
            </div>
          </div>
          {lot.description && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{lot.description}</p>}
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-sm text-muted">{lot.highBid > 0 ? "Current bid" : "Opening bid"}</span>
            <span key={lot.highBid} className="num display anim-bump text-4xl text-ink">
              {money(lot.highBid > 0 ? lot.highBid : lot.startPrice)}
            </span>
          </div>
        </section>
      ) : (
        <p className="display py-6 text-center text-2xl italic text-muted">The first lot is on its way.</p>
      )}

      {status && <Notice tone={status.tone}>{status.text}</Notice>}

      <div>
        <button
          type="button"
          onClick={bid}
          disabled={!!reason || busy || !lot}
          aria-describedby="bid-reason"
          className={`flex min-h-[112px] w-full flex-col items-center justify-center rounded-xl bg-clay-ink px-6 text-white shadow-lift transition-colors hover:bg-[#8f4426] active:bg-[#7a3a20] disabled:bg-sunken disabled:text-muted disabled:shadow-none ${flash ? "anim-tap" : ""}`}
        >
          <span className="eyebrow opacity-80">{busy ? "Placing bid" : "Bid"}</span>
          <span className="num display mt-1 text-5xl leading-none">{lot ? money(next) : "—"}</span>
        </button>
        <p
          id="bid-reason"
          role={bidError ? "alert" : undefined}
          className={`mt-3 min-h-6 text-center text-sm ${bidError ? "font-medium text-danger" : "text-muted"}`}
        >
          {bidError ?? reason ?? ""}
        </p>
      </div>

      <Meter paddle={paddle} />
      <HoldExplainer />

      {won.length > 0 && (
        <section className={card} aria-labelledby="won-h">
          <h2 id="won-h" className="display text-2xl text-ink">
            You won
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {won.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 break-words text-ink-2">
                  <span aria-hidden>{l.emoji} </span>
                  {l.title}
                </span>
                <span className="num display text-xl text-ink">{money(l.finalPrice ?? l.highBid)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {receipt && (
        <section className={card} aria-labelledby="rcpt-h">
          <h2 id="rcpt-h" className="display text-2xl text-ink">
            Your receipt
          </h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">{receipt.text}</p>
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
  const ready = !!name.trim() && !!instruction.trim() && Number(maxBid) > 0;

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
    <section className="space-y-6 border-t border-line pt-10" aria-labelledby="abs-h">
      <div>
        <Eyebrow>Can&apos;t be in the room?</Eyebrow>
        <h2 id="abs-h" className="display mt-2 text-3xl text-ink">
          Leave an absentee bid
        </h2>
        <p className="mt-2 leading-relaxed text-ink-2">Tell an AI agent what you&apos;d like and your limit. It bids on your behalf, never above your max.</p>
      </div>

      {agent ? (
        <div className={`${card} space-y-4`}>
          <p className="text-lg text-ink">
            Agent paddle <span className="num display text-2xl">{agent.number}</span> <span className="text-muted">for {agent.name}</span>
          </p>
          {agent.status === "pending" ? (
            <AuthorizeCard paddle={agent} orderId={orderId} onDone={refresh} onBack={() => stored.set(null)} />
          ) : (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              {[
                ["Hold", money(agent.holdAmount)],
                ["Committed", money(agent.committed)],
                ["Max bid", money(agent.agent?.maxBid)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-muted">{k}</dt>
                  <dd className="num mt-0.5 font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {agent.agent?.instruction && <p className="display border-l-2 border-line-strong pl-4 text-lg italic text-ink-2">&ldquo;{agent.agent.instruction}&rdquo;</p>}
          <div aria-live="polite" className="rounded-lg bg-agent-soft p-4 text-sm text-agent">
            <p className="eyebrow">Agent&apos;s thinking</p>
            <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-ink-2">{agent.agent?.lastReasoning ?? "Waiting for a lot that matches…"}</p>
          </div>
          <button type="button" onClick={() => stored.set(null)} className={`${btn.quiet} px-0`}>
            Set up a different agent
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className={`${card} space-y-6`}>
          <div>
            <label htmlFor="abs-name" className={fieldLabel}>
              Your name
            </label>
            <input id="abs-name" className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
          </div>
          <HoldPicker value={hold} onChange={setHold} idPrefix="abs-hold" />
          <div>
            <label htmlFor="abs-instr" className={fieldLabel}>
              What would you like?
            </label>
            <textarea
              id="abs-instr"
              className={field}
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              required
              placeholder="e.g. The pizza night basket, if it stays reasonable."
              maxLength={400}
            />
          </div>
          <div>
            <label htmlFor="abs-max" className={fieldLabel}>
              Max bid ($)
            </label>
            <input id="abs-max" className={`${field} num`} type="number" inputMode="numeric" min={1} step={1} value={maxBid} onChange={(e) => setMaxBid(e.target.value)} required />
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <div className="space-y-3">
            <button type="submit" disabled={busy || !ready} className={`${btn.secondary} w-full py-3.5`}>
              {busy ? "Sending…" : "Send my agent"}
            </button>
            {state.testCards && (
              <button type="button" onClick={(e) => submit(e, true)} disabled={busy || !ready} className={testCardBtn}>
                Use a sandbox test card &middot; no login
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <p className="sr-only" role="status">
        {label}
      </p>
      <div className="h-24 animate-pulse rounded-xl bg-sunken" />
      <div className="h-40 animate-pulse rounded-xl bg-sunken" />
      <div className="h-28 animate-pulse rounded-xl bg-sunken" />
      <p className="text-center text-sm text-muted">{label}</p>
    </div>
  );
}

export default function PaddlePage() {
  const room = useRoom();
  const router = useRouter();
  if (!room) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pb-16 pt-10">
        <section className={`${card} space-y-4`}>
          <div className="flex items-center justify-between gap-3">
            <h1 className="display text-3xl text-ink">Join an auction</h1>
            <BackButton onClick={() => router.push("/")} label="Home" />
          </div>
          <p className="leading-relaxed text-ink-2">Enter the room code from the host, or scan the code on the auction screen.</p>
          <JoinRoom compact />
        </section>
      </main>
    );
  }
  return <PaddleRoom room={room} />;
}

function PaddleRoom({ room }: { room: string }) {
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

  let body: ReactNode;
  if (!state || !stored.ready) {
    body = <Skeleton label={error ? "Reconnecting to the auction…" : "Finding your seat…"} />;
  } else if (!stored.value) {
    body = <RegisterCard onCreated={created} testCards={state.testCards} />;
  } else if (!paddle) {
    body = settling ? (
      <Skeleton label="Getting your paddle…" />
    ) : (
      <section className={`${card} space-y-4`}>
        <h1 className="display text-3xl text-ink">We can&apos;t find that paddle</h1>
        <p className="leading-relaxed text-ink-2">It isn&apos;t in this auction. The room may have been reset.</p>
        <button type="button" onClick={forget} className={`${btn.primary} w-full py-3.5`}>
          Register again
        </button>
      </section>
    );
  } else if (paddle.status === "pending") {
    body = <AuthorizeCard paddle={paddle} orderId={pendingOrder} onDone={refresh} onBack={forget} />;
  } else {
    body = <BidScreen state={state} paddle={paddle} refresh={refresh} />;
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 pb-16 pt-6">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-ink-2">
          {state?.event ? (
            <>
              <span className="font-medium text-ink">{state.event.name}</span> &middot; room <span className="font-mono">{room.toUpperCase()}</span>
            </>
          ) : null}
        </p>
        <SandboxBadge />
      </div>
      {state && state.status === "closed" && <Notice tone="dark">The auction has closed. Thank you for your support.</Notice>}
      {error && state && <Notice tone="bad">Connection lost. Retrying&hellip;</Notice>}
      {body}
      {state && stored.ready && state.status !== "closed" && <AbsenteeSection state={state} refresh={refresh} />}
      <InstallHint />
      {paddle && (
        <button type="button" onClick={forget} className={`${btn.quiet} self-center`}>
          Not you? Use a different paddle
        </button>
      )}
    </main>
  );
}
