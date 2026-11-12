"use client";

import { useState } from "react";
import { clock, findPaddle, money } from "@/lib/client/format";
import type { LedgerRow, State } from "@/lib/client/types";

const API_LABEL: Record<LedgerRow["kind"], string> = {
  authorized: "Orders v2 · AUTHORIZE",
  captured: "Authorizations · capture (final)",
  voided: "Authorizations · void",
  payout: "Payouts · batch",
  receipt: "Invoicing · send + record payment",
};

function chip(row: LedgerRow): { text: string; cls: string } {
  const s = row.status.toUpperCase();
  if (/FAIL|DENIED|ERROR|RETRY/.test(s)) return { text: s.replace(/_/g, " "), cls: "bg-danger-soft text-danger" };
  if (s === "VOIDED") return { text: "VOIDED", cls: "bg-sunken text-muted" };
  if (s === "PAID" || s === "MARKED_AS_PAID" || s === "SUCCESS") return { text: "PAID", cls: "bg-sage-soft text-sage" };
  if (s === "COMPLETED") return { text: "COMPLETED", cls: "bg-sage-soft text-sage" };
  if (s === "CREATED" || s === "AUTHORIZED") return { text: s, cls: "bg-agent-soft text-agent" };
  return { text: s.replace(/_/g, " ") || "PENDING", cls: "bg-clay-soft text-clay-ink" };
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-5)}` : id;
}

function CopyId({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard unavailable: the full id is in the title */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      title={`${id} (click to copy)`}
      aria-label={`Copy PayPal id ${id}`}
      className="inline-flex min-h-6 items-center gap-1.5 rounded border border-line bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-2 hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay"
    >
      <span>{shortId(id)}</span>
      <span aria-live="polite" className="text-[10px] uppercase tracking-wide text-muted">
        {done ? "copied" : "copy"}
      </span>
    </button>
  );
}

export function PayPalProof({ state }: { state: State }) {
  const rows = [...state.ledger].reverse();
  if (rows.length === 0) return <p className="text-muted">No money has moved yet.</p>;
  return (
    <ol className="divide-y divide-line" aria-label="PayPal API calls, newest first">
      {rows.map((r) => {
        const c = chip(r);
        const p = findPaddle(state, r.paddleId);
        return (
          <li key={r.id} className="grid gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-ink">{API_LABEL[r.kind]}</span>
                <span className="num text-xs text-muted">
                  {clock(r.ts)}
                  {p ? ` · #${p.number} ${p.name}` : ""}
                </span>
              </p>
              {r.note && <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">{r.note}</p>}
              <div className="mt-1.5">{r.paypalId ? <CopyId id={r.paypalId} /> : <span className="font-mono text-xs text-muted">no PayPal id</span>}</div>
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
              <span className="num display text-xl text-ink">{money(r.amount)}</span>
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${c.cls}`}>{c.text}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
