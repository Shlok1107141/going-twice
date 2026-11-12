"use client";

import { DemoRun } from "@/components/DemoRun";
import { NightInNumbers } from "@/components/proof/NightInNumbers";
import { CopyId, PayPalProof } from "@/components/proof/PayPalProof";
import { PayPalSetup } from "@/components/PayPalSetup";
import { useSyncExternalStore } from "react";
import { SandboxBadge } from "@/components/SandboxBadge";
import { useRoom, withRoom } from "@/components/SiteNav";
import { PageHeader, panel, Pill, SectionTitle } from "@/components/ui";
import { money } from "@/lib/client/format";
import type { LedgerRow, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";

const failed = (r: LedgerRow) => /FAIL|DENIED|ERROR|RETRY/i.test(r.status);
const sum = (rows: LedgerRow[]) => rows.reduce((a, r) => a + r.amount, 0);

/** The four things PayPal does for an auction, in order, with what has happened so far. */
function steps(state: State) {
  const ok = state.ledger.filter((r) => !failed(r));
  const of = (kind: LedgerRow["kind"]) => ok.filter((r) => r.kind === kind);
  const [held, captured, voided, payouts, receipts] = [of("authorized"), of("captured"), of("voided"), of("payout"), of("receipt")];
  const closed = state.status === "closed";
  return [
    {
      title: "Hold",
      api: "Orders v2 · intent AUTHORIZE",
      text: "A bidder joins by letting PayPal hold an amount. That hold is their paddle: they can bid up to it, and nothing is charged.",
      figure: money(sum(held)),
      count: `${held.length} ${held.length === 1 ? "hold" : "holds"} placed`,
      done: held.length > 0,
    },
    {
      title: "Capture",
      api: "Authorizations · capture (final)",
      text: "When the auction closes, each winner is charged exactly what they won, which is never more than their hold.",
      figure: money(sum(captured)),
      count: `${captured.length} ${captured.length === 1 ? "winner" : "winners"} charged`,
      done: captured.length > 0 || (closed && held.length > 0),
    },
    {
      title: "Release",
      api: "Authorizations · void",
      text: "Everyone who did not win gets their whole hold back. A winner's unused remainder is released by the final capture.",
      figure: money(state.totals.voided),
      count: `${voided.length} ${voided.length === 1 ? "hold" : "holds"} voided`,
      done: voided.length > 0 || (closed && held.length > 0),
    },
    {
      title: "Pay out",
      api: "Payouts · batch, then Invoicing",
      text: "The proceeds go to the organizer (or are split with consignors), and each winner gets a paid PayPal invoice as a receipt.",
      figure: money(sum(payouts)),
      count: `${payouts.length} ${payouts.length === 1 ? "payout" : "payouts"} · ${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"}`,
      done: payouts.length > 0,
    },
  ];
}

function Bidders({ state }: { state: State }) {
  if (state.paddles.length === 0) return <p className="text-muted">No bidders yet.</p>;
  const rows = [...state.paddles].sort((a, b) => a.number - b.number);
  const ledgerSum = (id: string, kind: LedgerRow["kind"]) => sum(state.ledger.filter((r) => r.paddleId === id && r.kind === kind && !failed(r)));
  return (
    <ul className="divide-y divide-line">
      {rows.map((p) => {
        const won = state.lots.filter((l) => l.status === "sold" && l.winnerPaddleId === p.id);
        const captured = ledgerSum(p.id, "captured");
        const settled = p.status === "captured" || p.status === "voided";
        const invoice = state.receipts.find((r) => r.paddleId === p.id)?.invoiceId;
        return (
          <li key={p.id} className="grid gap-x-6 gap-y-2 py-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] sm:items-center">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="num display text-2xl text-clay-ink">{p.number}</span>
                <span className="font-medium text-ink">{p.name}</span>
                {p.kind === "agent" && <span className="rounded-sm bg-agent-soft px-1.5 py-0.5 text-xs text-agent">AI</span>}
                <Pill value={p.status} label={p.status === "held" ? "hold active" : p.status === "captured" ? "charged" : p.status === "voided" ? "released" : "awaiting hold"} />
              </p>
              <p className="mt-1 text-sm text-muted">{won.length ? `Won ${won.map((l) => l.title).join(", ")}` : state.status === "closed" ? "Won nothing" : "No winning bid yet"}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.authorizationId && <CopyId id={p.authorizationId} />}
                {invoice && <CopyId id={invoice} />}
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="eyebrow text-[11px] text-muted">Held</dt>
                <dd className="num display mt-0.5 text-xl text-ink">{money(p.holdAmount)}</dd>
              </div>
              <div>
                <dt className="eyebrow text-[11px] text-muted">{settled ? "Charged" : "Winning now"}</dt>
                <dd className="num display mt-0.5 text-xl text-ink">{money(settled ? captured : p.committed)}</dd>
              </div>
              <div>
                <dt className="eyebrow text-[11px] text-muted">{settled ? "Released" : "Free to bid"}</dt>
                <dd className="num display mt-0.5 text-xl text-ink">{money(settled ? Math.max(0, p.holdAmount - captured) : Math.max(0, p.holdAmount - p.committed))}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

export default function PayPalPage() {
  // Inside a room: that auction's PayPal trail. Outside one: how to set up PayPal or a card.
  const room = useRoom();
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!ready) return <main className="flex-1" aria-busy="true" />;
  return room ? <PayPalTrail /> : <PayPalSetup />;
}

const noop = () => () => {};

function PayPalTrail() {
  const room = useRoom();
  const { state, error } = useAuctionState(1000);

  if (!state) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 2xl:max-w-[88rem]">
        <div className="h-24 animate-pulse rounded-xl bg-sunken" />
        <p role="status" className="mt-6 text-center text-muted">
          {error ? `Can't reach the server: ${error}` : "Loading the PayPal trail…"}
        </p>
      </main>
    );
  }

  const closed = state.status === "closed";
  const empty = state.ledger.length === 0;
  const list = steps(state);
  const current = closed ? -1 : list.findIndex((s) => !s.done);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 px-4 pb-24 pt-10 sm:px-6 2xl:max-w-[88rem]">
      <PageHeader
        eyebrow={room ? `PayPal · Room ${room.toUpperCase()}` : "PayPal"}
        title="Every PayPal call, as it happens."
        lede={
          closed
            ? "This auction is settled. Below is each request PayPal handled for it, with the id PayPal returned."
            : "This page follows the money for one auction, live. Each row is a request the server sent to PayPal, with the id PayPal returned."
        }
        actions={
          <>
            <Pill value={state.status} label={closed ? "Settled" : state.status === "live" ? "Auction live" : "Not started"} />
            <Pill value="mode" label={state.demoMode ? "Simulated PayPal" : "PayPal sandbox API"} />
            <SandboxBadge />
          </>
        }
      />

      {empty && (
        <section className={panel}>
          <SectionTitle hint="PayPal has not been called for this room yet. Run the demo auction and this page fills in as the money moves.">Nothing here yet</SectionTitle>
          <DemoRun />
        </section>
      )}

      <section aria-label="What PayPal does for an auction">
        <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {list.map((s, i) => (
            <li key={s.title} className={`flex flex-col bg-surface p-6 ${i === current ? "ring-2 ring-inset ring-clay/60" : ""}`}>
              <p className="flex items-center justify-between gap-2">
                <span className="num display text-2xl text-clay-ink">{String(i + 1).padStart(2, "0")}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.done ? "bg-sage-soft text-sage" : i === current ? "bg-clay-soft text-clay-ink" : "bg-sunken text-muted"}`}>
                  {s.done ? "Done" : i === current ? "Next" : "Waiting"}
                </span>
              </p>
              <h2 className="display mt-3 text-2xl text-ink">{s.title}</h2>
              <p className="mt-1 font-mono text-xs text-muted">{s.api}</p>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-ink-2">{s.text}</p>
              <p className="num display mt-5 text-4xl text-ink">{s.figure}</p>
              <p className="mt-1 text-xs text-muted">{s.count}</p>
            </li>
          ))}
        </ol>
        {!closed && !empty && (
          <p role="status" className="mt-3 text-sm text-muted">
            Capture, release and payout run together when the auction closes. Until then the holds just sit there, and bids are checked against them.
          </p>
        )}
      </section>

      {closed && <NightInNumbers state={state} className="rounded-xl border border-line bg-surface p-6 shadow-soft" />}

      <section className={panel} aria-labelledby="bidders-h">
        <SectionTitle id="bidders-h" hint="One row per paddle. The grey chips are PayPal ids: the authorization, and the invoice once it is sent.">
          Bidder by bidder
        </SectionTitle>
        <Bidders state={state} />
      </section>

      <section className={panel} aria-labelledby="calls-h">
        <SectionTitle id="calls-h" hint="Newest first. Click an id to copy it and look it up in the PayPal developer dashboard.">
          The call log
        </SectionTitle>
        <PayPalProof state={state} />
      </section>

      {state.receipts.length > 0 && (
        <section className={panel} aria-labelledby="receipts-h">
          <SectionTitle id="receipts-h" hint="Sent to each winner as a paid PayPal invoice. Values are estimates, not tax advice.">
            Receipts
          </SectionTitle>
          <ul className="divide-y divide-line">
            {state.receipts.map((r) => {
              const p = state.paddles.find((x) => x.id === r.paddleId);
              return (
                <li key={r.paddleId}>
                  <details className="group py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-ink">
                      <span>
                        {p ? `#${p.number} ${p.name}` : "Winner"}
                        {r.invoiceId && <span className="ml-3 font-mono text-xs text-muted">invoice {r.invoiceId}</span>}
                      </span>
                      <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
                        +
                      </span>
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-2">{r.text}</p>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-sm text-muted">
        <a className="underline underline-offset-4 hover:text-ink" href={withRoom("/stage", room)}>
          Back to the auction
        </a>
        {" · "}
        <a className="underline underline-offset-4 hover:text-ink" href={withRoom("/admin", room)}>
          Host controls
        </a>
      </p>
    </main>
  );
}
