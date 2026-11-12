"use client";

import { useEffect, useState } from "react";
import { AuctionTypePanel } from "@/components/admin/AuctionTypePanel";
import { EventPanel } from "@/components/admin/EventPanel";
import { LotsEditor } from "@/components/admin/LotsEditor";
import { AutopilotPanel } from "@/components/admin/AutopilotPanel";
import { SnapLot } from "@/components/admin/SnapLot";
import { NightInNumbers } from "@/components/proof/NightInNumbers";
import { PayPalProof } from "@/components/proof/PayPalProof";
import { SandboxBadge } from "@/components/SandboxBadge";
import { useRoom, withRoom } from "@/components/SiteNav";
import { btn, PageHeader, panel, Pill, SectionTitle } from "@/components/ui";
import { post } from "@/lib/client/api";
import { findPaddle, headroom, money } from "@/lib/client/format";
import type { LedgerRow, Lot, Paddle } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useOrigin } from "@/lib/client/useOrigin";

function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled,
  className,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  className: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={className}>
        {label}
      </button>
    );
  }
  return (
    <span role="alertdialog" aria-label={confirmLabel} className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger-soft p-1">
      <button
        type="button"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className={btn.danger}
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface">
        Cancel
      </button>
    </span>
  );
}

function QuickPaddle({ disabled, onAdd }: { disabled: boolean; onAdd: (body: { name: string; holdAmount: number; testCard: true }) => void }) {
  const [name, setName] = useState("");
  const [hold, setHold] = useState("250");
  const ok = name.trim().length > 0 && Number(hold) > 0;
  const input = "mt-1 block rounded-md border border-line-strong bg-surface px-2.5 py-2 text-sm text-ink focus:border-ink focus:outline-none";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onAdd({ name: name.trim(), holdAmount: Number(hold), testCard: true });
        setName("");
      }}
      className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-clay/50 bg-clay-soft/40 p-3"
      aria-label="Add a sandbox test-card paddle"
    >
      <label className="text-xs font-medium text-clay-ink">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Dana R." className={`${input} w-36`} />
      </label>
      <label className="text-xs font-medium text-clay-ink">
        Hold $
        <input value={hold} onChange={(e) => setHold(e.target.value)} type="number" min={1} step={1} className={`${input} num w-24`} />
      </label>
      <button type="submit" disabled={disabled || !ok} className={btn.small}>
        Add test-card paddle
      </button>
    </form>
  );
}

function RoomLinks({ room }: { room: string }) {
  const origin = useOrigin();
  const [copied, setCopied] = useState<string | null>(null);
  const links = [
    ["Auction stage", "/stage", "The big screen"],
    ["Bid", "/paddle", "Bidders' phones"],
    ["PayPal", "/paypal", "Every PayPal call"],
    ["Report", "/report", "Settlement report"],
    ["Timeline", "/timeline", "Hold timeline"],
  ] as const;
  async function copy(url: string, key: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked: the link is still visible
    }
  }
  return (
    <section aria-labelledby="links-h" className={panel}>
      <SectionTitle id="links-h" hint={room ? `Every link below opens room ${room.toUpperCase()}.` : "Shared demo room. Start your own room from the home page for a private one."}>
        Room links
      </SectionTitle>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {links.map(([label, path, hint]) => {
          const href = withRoom(path, room);
          return (
            <li key={path} className="flex items-center justify-between gap-2 rounded-lg border border-line px-4 py-3">
              <a href={href} target={path === "/stage" ? "_blank" : undefined} rel="noreferrer" className="min-w-0 hover:underline hover:underline-offset-4">
                <span className="block font-medium text-ink">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </a>
              <button type="button" onClick={() => copy(`${origin}${href}`, path)} className={btn.small} aria-label={`Copy ${label} link`}>
                {copied === path ? "Copied" : "Copy"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PayoutRetry({ row, onRetried }: { row: LedgerRow; onRetried: () => Promise<void> }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    // A GET on a POST-only route answers 405; a missing route answers 404.
    fetch(withRoom("/api/payout/retry", new URLSearchParams(window.location.search).get("room") ?? ""), { method: "GET", cache: "no-store" })
      .then((r) => !off && setAvailable(r.status !== 404))
      .catch(() => !off && setAvailable(false));
    return () => {
      off = true;
    };
  }, []);

  async function retry() {
    setBusy(true);
    setMsg(null);
    try {
      await post("/api/payout/retry", { ledgerId: row.id });
      setMsg("Payout retried.");
      await onRetried();
    } catch (e) {
      const m = e instanceof Error ? e.message : "Retry failed";
      if (/\(404\)/.test(m)) setAvailable(false);
      setMsg(m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-danger/30 bg-danger-soft px-6 py-4">
      <div>
        <p className="font-medium text-danger">Payout pending &middot; {money(row.amount)} not yet delivered</p>
        <p className="mt-1 text-sm text-ink-2">
          PayPal returned <span className="font-mono">{row.status}</span>
          {row.note ? ` — ${row.note}` : ""}. Captures are safe; only the transfer to the organizer needs another try.
        </p>
        {msg && <p className="mt-1 text-sm text-ink-2">{msg}</p>}
      </div>
      {available && (
        <button type="button" onClick={retry} disabled={busy} className={btn.danger}>
          {busy ? "Retrying…" : "Retry payout"}
        </button>
      )}
    </section>
  );
}

/** The whole job of hosting, in order. Ticks fill in as the auction moves along. */
function HostGuide({ room, done }: { room: string; done: [boolean, boolean, boolean, boolean] }) {
  const [lots, bidders, started, closed] = done;
  const steps: [string, string, boolean][] = [
    ["Set it up", "Name the event and add your lots in the sections below. Sample lots are already here so you can try it straight away.", lots],
    ["Bring in bidders", "Open the stage on a big screen. Bidders scan its code and PayPal holds their amount. To try it alone, add a test bidder or the AI bidders below.", bidders],
    ["Run each lot", "Press Start on a lot. Gus calls the bids, and the hammer falls by itself when bidding stops. Press Hammer to end a lot sooner.", started],
    ["Close and settle", "Press Close auction. PayPal charges each winner what they won, releases every other hold, pays out the proceeds and sends receipts.", closed],
  ];
  const next = steps.findIndex((s) => !s[2]);
  return (
    <section aria-labelledby="guide-h" className={panel}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionTitle id="guide-h" hint="Four steps. The highlighted one is what to do next.">
          How to host
        </SectionTitle>
        <p className="mb-4 flex flex-wrap gap-3">
          <a href={withRoom("/stage", room)} target="_blank" rel="noreferrer" className={btn.secondary}>
            Open the stage
          </a>
          <a href={withRoom("/paypal", room)} className={btn.secondary}>
            PayPal page
          </a>
        </p>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([title, text, ok], i) => (
          <li key={title} className={`bg-surface p-5 ${i === next ? "ring-2 ring-inset ring-clay/60" : ""}`}>
            <p className="flex items-center justify-between">
              <span className="num display text-xl text-clay-ink">{i + 1}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${ok ? "bg-sage-soft text-sage" : i === next ? "bg-clay-soft text-clay-ink" : "bg-sunken text-muted"}`}>
                {ok ? "Done" : i === next ? "Do this next" : "Later"}
              </span>
            </p>
            <h3 className="display mt-2 text-xl text-ink">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AdminPage() {
  const room = useRoom();
  const { state, error, refresh } = useAuctionState(1000);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(key: string, path: string, body?: unknown) {
    setBusy(key);
    setActionError(null);
    try {
      await post(path, body);
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return (
      <main className="mx-auto w-full max-w-6xl 2xl:max-w-[88rem] flex-1 px-4 py-12 sm:px-6">
        <div className="h-24 animate-pulse rounded-xl bg-sunken" />
        <p role="status" className="mt-6 text-center text-muted">
          {error ? `Can't reach the server: ${error}` : "Opening the control room…"}
        </p>
      </main>
    );
  }

  const t = state.totals;
  const board = [
    ["Held", t.held, "Authorized on paddles"],
    ["Captured", t.captured, "Charged to winners"],
    ["Released", t.voided, "Returned to bidders"],
    ["Paid out", t.paidOut, "Sent to the organizer"],
  ] as const;
  const closed = state.status === "closed";
  const openLot = state.lots.find((l) => l.status === "open");
  const paddleName = (id?: string) => {
    const p = findPaddle(state, id);
    return p ? `#${p.number} ${p.name}` : "—";
  };
  const ledger = [...state.ledger].reverse();
  const lastPayout = ledger.find((r) => r.kind === "payout");
  const payoutStuck = lastPayout && /^(FAILED|PENDING_RETRY)$/i.test(lastPayout.status) ? lastPayout : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl 2xl:max-w-[88rem] flex-1 space-y-10 px-4 pb-24 pt-10 sm:px-6">
      <PageHeader
        eyebrow={room ? `Host · Room ${room.toUpperCase()}` : "Host"}
        title={state.event?.name ?? "Your auction"}
        lede="Everything the organizer needs on one page: set up the auction, run each lot, then close it and let PayPal settle everyone."
        actions={
          <>
            <Pill value={state.status} />
            <Pill value="mode" label={state.demoMode ? "Demo mode" : "Live PayPal"} />
            <SandboxBadge />
          </>
        }
      />

      <HostGuide
        room={room}
        done={[state.lots.length > 0, state.paddles.length > 0, state.lots.some((l) => l.status !== "pending"), closed]}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton label="Close auction" confirmLabel="Yes, capture & close" disabled={busy !== null || closed} onConfirm={() => act("close", "/api/close")} className={btn.primary} />
        <ConfirmButton label="Reset room" confirmLabel="Yes, reset everything" disabled={busy !== null} onConfirm={() => act("reset", "/api/reset")} className={btn.secondary} />
        {(state.testCards || state.demoMode) && !closed && <QuickPaddle disabled={busy !== null} onAdd={(body) => act("paddle", "/api/paddle", body)} />}
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {busy ? "Working…" : error ? `Connection problem: ${error}` : ""}
        </span>
      </div>
      {actionError && (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 font-medium text-danger">
          {actionError}
        </p>
      )}

      {payoutStuck && <PayoutRetry row={payoutStuck} onRetried={refresh} />}

      <section aria-label="Totals" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {board.map(([label, v, hint]) => (
          <div key={label} className="bg-surface p-6">
            <p className="eyebrow text-muted">{label}</p>
            <p className="num display mt-2 text-4xl text-ink">{money(v)}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </section>

      {closed && <NightInNumbers state={state} className="rounded-xl border border-line bg-surface p-6 shadow-soft" />}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className={panel} aria-labelledby="lots-h">
          <SectionTitle id="lots-h" hint={openLot ? "One lot runs at a time. Hammer it to open the next." : "Start a lot to put it on the stage."}>
            Lots
          </SectionTitle>
          {state.lots.length === 0 ? (
            <p className="text-muted">No lots yet. Snap one below or apply an auction type.</p>
          ) : (
            <ul className="divide-y divide-line">
              {state.lots.map((l: Lot, i) => {
                const holder = findPaddle(state, l.status === "sold" ? l.winnerPaddleId : l.highPaddleId);
                return (
                  <li key={l.id} className={`flex flex-wrap items-center justify-between gap-3 py-4 ${l.status === "open" ? "-mx-3 rounded-md bg-clay-soft/50 px-3" : ""}`}>
                    <span className="flex min-w-0 items-start gap-3">
                      <span className="num w-6 shrink-0 pt-0.5 text-sm text-muted">{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block font-medium text-ink">
                          <span aria-hidden>{l.emoji} </span>
                          {l.title}
                        </span>
                        <span className="num block text-sm text-muted">
                          {l.highBid > 0 ? money(l.status === "sold" ? (l.finalPrice ?? l.highBid) : l.highBid) : `Opens at ${money(l.startPrice)}`}
                          {holder ? ` · ${paddleName(holder.id)}` : ""}
                          {l.status === "open" ? ` · ${l.phase.replace("-", " ")}` : ""}
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill value={l.status} />
                      {l.status === "pending" && (
                        <button
                          type="button"
                          disabled={busy !== null || closed || !!openLot}
                          onClick={() => act(`start ${l.id}`, "/api/lot/start", { lotId: l.id })}
                          title={openLot ? "Hammer the open lot first" : undefined}
                          className={btn.small}
                        >
                          Start
                        </button>
                      )}
                      {l.status === "open" && (
                        <button type="button" disabled={busy !== null} onClick={() => act(`hammer ${l.id}`, "/api/lot/hammer", { lotId: l.id })} className={`${btn.primary} px-3 py-1.5 text-sm`}>
                          Hammer
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={panel} aria-labelledby="pad-h">
          <SectionTitle id="pad-h" hint="Each paddle is a PayPal authorization. Headroom is what it can still bid.">
            Paddles
          </SectionTitle>
          {state.paddles.length === 0 ? (
            <p className="text-muted">No paddles yet. Share the Paddle link or add a test-card paddle.</p>
          ) : (
            <ul className="divide-y divide-line">
              {state.paddles.map((p: Paddle) => {
                const used = p.holdAmount > 0 ? Math.min(100, (p.committed / p.holdAmount) * 100) : 0;
                return (
                  <li key={p.id} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate">
                        <span className="num display mr-2 text-xl text-clay-ink">{p.number}</span>
                        <span className="text-ink">{p.name}</span>
                        {p.kind === "agent" && <span className="ml-2 rounded-sm bg-agent-soft px-1.5 py-0.5 text-xs text-agent">AI</span>}
                      </span>
                      <Pill value={p.status} />
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <div className="h-full rounded-full bg-ink" style={{ width: `${used}%` }} />
                    </div>
                    <p className="num mt-1.5 text-xs text-muted">
                      {money(p.committed)} committed of {money(p.holdAmount)} &middot; {money(headroom(p))} headroom
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {state.event && <EventPanel key={`${state.event.name}|${state.event.organizer}|${state.event.beneficiary}|${state.event.tagline ?? ""}`} event={state.event} onSaved={refresh} />}

      <LotsEditor lots={state.lots} closed={closed} onChanged={refresh} />

      <AutopilotPanel />

      <AuctionTypePanel
        key={state.auctionType ?? "charity"}
        current={state.auctionType ?? "charity"}
        settings={state.settings}
        disabled={busy !== null}
        onApply={(body) => act("type", "/api/auction/type", body)}
      />

      <SnapLot />

      <RoomLinks room={room} />

      <section className={panel} aria-labelledby="led-h">
        <SectionTitle id="led-h" hint="Every PayPal call, newest first. Sandbox ids.">
          PayPal proof
        </SectionTitle>
        <PayPalProof state={state} />
      </section>

      <section className={panel} aria-labelledby="rec-h">
        <SectionTitle id="rec-h">Receipts</SectionTitle>
        {state.receipts.length === 0 ? (
          <p className="text-muted">Receipts appear after the auction closes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {state.receipts.map((r) => (
              <li key={r.paddleId}>
                <details className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-ink">
                    <span>
                      {paddleName(r.paddleId)}
                      {r.invoiceId && <span className="ml-3 font-mono text-xs text-muted">invoice {r.invoiceId}</span>}
                    </span>
                    <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">{r.text}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
