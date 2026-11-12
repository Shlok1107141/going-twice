"use client";

import { useState } from "react";
import { btn, fieldLabel, panel, Pill, SectionTitle } from "@/components/ui";
import { post, send } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import type { Lot } from "@/lib/client/types";

const input =
  "mt-1.5 block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-base text-ink focus:border-ink focus:outline-none";

function LotRow({ lot, index, onChanged }: { lot: Lot; index: number; onChanged: () => Promise<void> | void }) {
  const editable = lot.status === "pending";
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({
    title: lot.title,
    description: lot.description,
    emoji: lot.emoji,
    startPrice: String(lot.startPrice),
    increment: String(lot.increment),
    fmv: String(lot.fmv ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });
  const url = `/api/lot/${encodeURIComponent(lot.id)}`;

  async function run(fn: () => Promise<unknown>, done?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
      done?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () => send("PATCH", url, { title: d.title, description: d.description, emoji: d.emoji, startPrice: Number(d.startPrice), increment: Number(d.increment), fmv: Number(d.fmv) }),
      () => setOpen(false),
    );
  };

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="num mr-2 text-sm text-muted">{index + 1}</span>
          <span aria-hidden>{lot.emoji} </span>
          <span className="font-medium text-ink">{lot.title}</span>
          <span className="num ml-2 text-sm text-muted">
            from {money(lot.startPrice)}, +{money(lot.increment)}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Pill value={lot.status} />
          {editable && (
            <>
              <button type="button" className={btn.small} aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? "Close" : "Edit"}
              </button>
              {asking ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger-soft p-1">
                  <button type="button" disabled={busy} autoFocus className={btn.danger} onClick={() => run(() => send("DELETE", url))}>
                    Remove lot
                  </button>
                  <button type="button" className="rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface" onClick={() => setAsking(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className={btn.small} disabled={busy} onClick={() => setAsking(true)}>
                  Remove
                </button>
              )}
            </>
          )}
        </span>
      </div>
      {err && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {err}
        </p>
      )}
      {open && editable && (
        <form onSubmit={save} className="mt-4 grid gap-4 rounded-lg border border-line bg-sunken/40 p-4 sm:grid-cols-[5rem_1fr]">
          <label className={fieldLabel}>
            Emoji
            <input value={d.emoji} onChange={set("emoji")} maxLength={8} className={`${input} text-center`} />
          </label>
          <label className={fieldLabel}>
            Title
            <input value={d.title} onChange={set("title")} maxLength={120} required className={input} />
          </label>
          <label className={`${fieldLabel} sm:col-span-2`}>
            Description
            <textarea value={d.description} onChange={set("description")} maxLength={600} rows={3} className={input} />
          </label>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <label className={fieldLabel}>
              Start $
              <input value={d.startPrice} onChange={set("startPrice")} type="number" min={1} step="any" required className={`${input} num`} />
            </label>
            <label className={fieldLabel}>
              Step $
              <input value={d.increment} onChange={set("increment")} type="number" min={1} step="any" required className={`${input} num`} />
            </label>
            <label className={fieldLabel}>
              Value $
              <input value={d.fmv} onChange={set("fmv")} type="number" min={0} step="any" className={`${input} num`} />
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={btn.primary}>
              {busy ? "Saving…" : "Save lot"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Add, edit and remove lots. Only lots that have not started can be changed. */
export function LotsEditor({ lots, closed, onChanged }: { lots: Lot[]; closed: boolean; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/lot");
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add a lot");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel} aria-labelledby="lotedit-h">
      <SectionTitle id="lotedit-h" hint="Edit titles, descriptions and prices before a lot starts. Started lots are locked.">
        Lots editor
      </SectionTitle>
      {lots.length === 0 ? (
        <p className="text-muted">No lots yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lots.map((l, i) => (
            <LotRow key={`${l.id}:${l.status}:${l.title}:${l.startPrice}:${l.increment}:${l.description}:${l.emoji}:${l.fmv}`} lot={l} index={i} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} disabled={busy || closed} className={btn.secondary}>
          Add a lot
        </button>
        {err && (
          <span role="alert" className="text-sm text-danger">
            {err}
          </span>
        )}
      </div>
    </section>
  );
}
