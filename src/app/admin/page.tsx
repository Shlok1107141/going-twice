"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AuctionTypePanel } from "@/components/admin/AuctionTypePanel";
import { AutopilotPanel } from "@/components/admin/AutopilotPanel";
import { SnapLot } from "@/components/admin/SnapLot";
import { SandboxBadge } from "@/components/SandboxBadge";
import { post } from "@/lib/client/api";
import { clock, findPaddle, headroom, money } from "@/lib/client/format";
import type { Lot, Paddle } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";

const badge: Record<string, string> = {
  open: "bg-amber-200 text-amber-950",
  pending: "bg-stone-200 text-stone-800",
  sold: "bg-emerald-100 text-emerald-900",
  unsold: "bg-stone-300 text-stone-800",
  held: "bg-sky-100 text-sky-900",
  captured: "bg-emerald-100 text-emerald-900",
  voided: "bg-rose-100 text-rose-900",
  lobby: "bg-stone-200 text-stone-800",
  live: "bg-amber-200 text-amber-950",
  closed: "bg-stone-900 text-amber-100",
};

const noopSub = () => () => {};
function useSearch(): string {
  return useSyncExternalStore(noopSub, () => window.location.search, () => "");
}

const th = "px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-stone-600";
const td = "px-3 py-2 align-top";
const panel = "rounded-2xl border border-stone-300 bg-white p-4 shadow-sm";

function Pill({ value }: { value: string }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge[value] ?? "bg-stone-200 text-stone-800"}`}>{value}</span>;
}

function ConfirmButton({ label, confirmLabel, onConfirm, disabled, className }: { label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean; className: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={`${className} disabled:opacity-50`}>
        {label}
      </button>
    );
  }
  return (
    <span role="alertdialog" aria-label={confirmLabel} className="inline-flex items-center gap-2 rounded-lg border-2 border-rose-700 bg-rose-50 p-1">
      <button
        type="button"
        autoFocus
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className="rounded-md bg-rose-700 px-3 py-1.5 font-bold text-white hover:bg-rose-800"
      >
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="rounded-md px-3 py-1.5 font-bold text-stone-800 hover:bg-stone-200">
        Cancel
      </button>
    </span>
  );
}

function QuickPaddle({ disabled, onAdd }: { disabled: boolean; onAdd: (body: { name: string; holdAmount: number; testCard: true }) => void }) {
  const [name, setName] = useState("");
  const [hold, setHold] = useState("250");
  const ok = name.trim().length > 0 && Number(hold) > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onAdd({ name: name.trim(), holdAmount: Number(hold), testCard: true });
        setName("");
      }}
      className="flex flex-wrap items-end gap-2 rounded-lg border-2 border-dashed border-rose-700 bg-rose-50 p-2"
      aria-label="Add a sandbox test-card paddle"
    >
      <label className="text-xs font-bold uppercase tracking-wider text-rose-900">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Dana R." className="mt-1 block w-32 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-stone-900" />
      </label>
      <label className="text-xs font-bold uppercase tracking-wider text-rose-900">
        Hold $
        <input value={hold} onChange={(e) => setHold(e.target.value)} type="number" min={1} step={1} className="mt-1 block w-20 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-normal text-stone-900" />
      </label>
      <button type="submit" disabled={disabled || !ok} className="rounded-md bg-rose-700 px-3 py-1.5 text-sm font-bold text-white hover:bg-rose-800 disabled:opacity-50">
        Add test-card paddle
      </button>
    </form>
  );
}

export default function AdminPage() {
  const search = useSearch();
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
      <main className="grid min-h-screen place-items-center p-6">
        <p className="text-lg text-stone-700">{error ? `Can't reach the server: ${error}` : "Loading…"}</p>
      </main>
    );
  }

  const t = state.totals;
  const board = [
    ["Held", t.held, "text-amber-800"],
    ["Captured", t.captured, "text-emerald-800"],
    ["Released", t.voided, "text-stone-800"],
    ["Paid out", t.paidOut, "text-indigo-800"],
  ] as const;
  const closed = state.status === "closed";
  const openLot = state.lots.find((l) => l.status === "open");
  const paddleName = (id?: string) => {
    const p = findPaddle(state, id);
    return p ? `#${p.number} ${p.name}` : "—";
  };
  const ledger = [...state.ledger].reverse();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <nav aria-label="Auction pages" className="flex flex-wrap gap-2 text-sm font-bold">
        {[
          ["Open stage", "/stage"],
          ["Bidder page", "/paddle"],
          ["Gala report", "/report"],
        ].map(([text, href]) => (
          <a key={href} href={`${href}${search}`} className="rounded-full border border-stone-300 bg-white px-3 py-1 text-stone-800 hover:bg-amber-50">
            {text}
          </a>
        ))}
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-xs font-bold uppercase tracking-widest text-amber-800 hover:underline">
            Going Twice
          </Link>
          <h1 className="font-serif text-3xl font-black text-stone-900">Admin</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Pill value={state.status} />
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-800">{state.demoMode ? "Demo mode" : "Live PayPal"}</span>
          <SandboxBadge />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <ConfirmButton
          label="Reset demo"
          confirmLabel="Yes, reset everything"
          disabled={busy !== null}
          onConfirm={() => act("reset", "/api/reset")}
          className="rounded-lg border-2 border-stone-800 bg-white px-5 py-2 font-bold text-stone-900 hover:bg-stone-100"
        />
        <ConfirmButton
          label="Close auction"
          confirmLabel="Yes, capture & close"
          disabled={busy !== null || closed}
          onConfirm={() => act("close", "/api/close")}
          className="rounded-lg bg-stone-900 px-5 py-2 font-bold text-white hover:bg-stone-700"
        />
        {(state.testCards || state.demoMode) && !closed && (
          <QuickPaddle disabled={busy !== null} onAdd={(body) => act("paddle", "/api/paddle", body)} />
        )}
        {busy && <span role="status" className="text-sm font-semibold text-stone-700">Working&hellip;</span>}
        {error && <span role="status" className="text-sm font-bold text-rose-800">Connection problem: {error}</span>}
      </div>
      {actionError && (
        <p role="alert" className="rounded-lg bg-rose-100 p-3 font-semibold text-rose-900">
          {actionError}
        </p>
      )}

      <AuctionTypePanel
        key={state.auctionType ?? "charity"}
        current={state.auctionType ?? "charity"}
        settings={state.settings}
        disabled={busy !== null}
        onApply={(body) => act("type", "/api/auction/type", body)}
      />

      <section aria-label="Totals" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {board.map(([label, v, color]) => (
          <div key={label} className={panel}>
            <p className="text-xs font-bold uppercase tracking-widest text-stone-600">{label}</p>
            <p className={`text-3xl font-black tabular-nums ${color}`}>{money(v)}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={panel} aria-labelledby="lots-h">
          <h2 id="lots-h" className="mb-3 font-bold text-stone-900">Lots</h2>
          <ul className="divide-y divide-stone-200">
            {state.lots.map((l: Lot) => {
              const holder = findPaddle(state, l.status === "sold" ? l.winnerPaddleId : l.highPaddleId);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="font-semibold text-stone-900">
                      <span aria-hidden>{l.emoji} </span>
                      {l.title}
                    </span>
                    <span className="block text-sm text-stone-600">
                      {l.highBid > 0 ? money(l.status === "sold" ? (l.finalPrice ?? l.highBid) : l.highBid) : `Start ${money(l.startPrice)}`}
                      {holder ? ` · ${paddleName(holder.id)}` : ""}
                      {l.status === "open" ? ` · ${l.phase}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Pill value={l.status} />
                    <button
                      type="button"
                      disabled={busy !== null || closed || l.status !== "pending" || !!openLot}
                      onClick={() => act(`start ${l.id}`, "/api/lot/start", { lotId: l.id })}
                      title={openLot && l.status === "pending" ? "Hammer the open lot first" : undefined}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-stone-300 disabled:text-stone-700"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || l.status !== "open"}
                      onClick={() => act(`hammer ${l.id}`, "/api/lot/hammer", { lotId: l.id })}
                      className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:text-stone-700"
                    >
                      Hammer
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={panel} aria-labelledby="pad-h">
          <h2 id="pad-h" className="mb-3 font-bold text-stone-900">Paddles</h2>
          {state.paddles.length === 0 ? (
            <p className="text-stone-600">No paddles yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Name</th>
                    <th className={`${th} text-right`}>Hold</th>
                    <th className={`${th} text-right`}>Committed</th>
                    <th className={`${th} text-right`}>Headroom</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {state.paddles.map((p: Paddle) => (
                    <tr key={p.id}>
                      <td className={`${td} font-black`}>{p.number}</td>
                      <td className={td}>
                        {p.name}
                        {p.kind === "agent" && <span className="ml-1 rounded bg-indigo-100 px-1.5 text-xs font-bold text-indigo-900">AI</span>}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{money(p.holdAmount)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(p.committed)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(headroom(p))}</td>
                      <td className={td}>
                        <Pill value={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <AutopilotPanel />

      <SnapLot />

      <section className={panel} aria-labelledby="led-h">
        <h2 id="led-h" className="mb-3 font-bold text-stone-900">Ledger</h2>
        {ledger.length === 0 ? (
          <p className="text-stone-600">No money movement yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Paddle</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={th}>PayPal id</th>
                  <th className={th}>Status</th>
                  <th className={th}>Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {ledger.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap font-mono text-xs`}>{clock(r.ts)}</td>
                    <td className={`${td} font-semibold`}>{r.kind}</td>
                    <td className={td}>{paddleName(r.paddleId)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(r.amount)}</td>
                    <td className={`${td} break-all font-mono text-xs`}>{r.paypalId ?? "—"}</td>
                    <td className={td}>{r.status}</td>
                    <td className={`${td} text-stone-600`}>{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={panel} aria-labelledby="rec-h">
        <h2 id="rec-h" className="mb-3 font-bold text-stone-900">Receipts</h2>
        {state.receipts.length === 0 ? (
          <p className="text-stone-600">Receipts appear after the auction closes.</p>
        ) : (
          <ul className="space-y-2">
            {state.receipts.map((r) => (
              <li key={r.paddleId}>
                <details className="rounded-lg border border-stone-300 bg-stone-50 p-3">
                  <summary className="cursor-pointer font-semibold text-stone-900">
                    {paddleName(r.paddleId)}
                    {r.invoiceId && <span className="ml-2 font-mono text-xs font-normal text-stone-600">invoice {r.invoiceId}</span>}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-stone-800">{r.text}</p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
