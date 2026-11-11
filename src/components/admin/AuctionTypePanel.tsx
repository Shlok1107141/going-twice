"use client";

import { useState } from "react";
import { AUCTION_TYPE_LIST, typeConfig } from "@/lib/auction/auctionTypes";
import type { AuctionSettings, AuctionType } from "@/lib/client/types";

type Body = { type: AuctionType; settings: { premiumPct?: number; commissionPct?: number; organizerEmail?: string; consignorEmails?: string[] } };

/** Pick the kind of auction. Applying resets the room with that type's sample lots. */
export function AuctionTypePanel({ current, settings, disabled, onApply }: { current: AuctionType; settings?: AuctionSettings; disabled: boolean; onApply: (body: Body) => void }) {
  const [picked, setPicked] = useState<AuctionType>(current);
  const [premium, setPremium] = useState<string>("");
  const [commission, setCommission] = useState<string>("");
  const [organizer, setOrganizer] = useState("");
  const [consignors, setConsignors] = useState("");
  const [asking, setAsking] = useState(false);
  const cfg = typeConfig(picked);
  const same = picked === current;

  function choose(t: AuctionType) {
    setPicked(t);
    setPremium("");
    setCommission("");
    setAsking(false);
  }

  function apply() {
    const s: Body["settings"] = {};
    if (cfg.editable.premium && premium !== "") s.premiumPct = Number(premium);
    if (cfg.editable.commission && commission !== "") s.commissionPct = Number(commission);
    if (organizer.trim()) s.organizerEmail = organizer.trim();
    const list = consignors.split(/[,\s]+/).filter(Boolean);
    if (cfg.editable.consignors && list.length) s.consignorEmails = list;
    setAsking(false);
    onApply({ type: picked, settings: s });
  }

  const input = "mt-1 block w-28 rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm font-normal text-stone-900";
  const label = "text-xs font-bold uppercase tracking-wider text-stone-700";

  return (
    <section className="rounded-2xl border border-stone-300 bg-white p-4 shadow-sm" aria-labelledby="type-h">
      <h2 id="type-h" className="font-bold text-stone-900">Auction type</h2>
      <p className="mb-3 text-sm text-stone-600">Built for the school gala. Works for any live auction. Applying a type resets this room with that type&apos;s sample lots.</p>
      <div role="radiogroup" aria-labelledby="type-h" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {AUCTION_TYPE_LIST.map((t) => {
          const on = picked === t.type;
          return (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(t.type)}
              className={`rounded-xl border-2 p-3 text-left transition ${on ? "border-amber-600 bg-amber-50" : "border-stone-300 bg-white hover:border-amber-400"}`}
            >
              <span aria-hidden className="text-3xl">{t.icon}</span>
              <span className="mt-1 block font-bold text-stone-900">
                {t.label}
                {t.type === current && <span className="ml-2 rounded-full bg-stone-900 px-2 py-0.5 text-xs text-amber-100">current</span>}
              </span>
              <span className="mt-1 block text-sm text-stone-700">{t.blurb}</span>
              <span className="mt-2 flex flex-wrap gap-1">
                {t.keyNumbers.map((k) => (
                  <span key={k} className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-semibold text-stone-800">{k}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {cfg.editable.premium && (
          <label className={label}>
            Buyer&apos;s premium %
            <input type="number" min={0} max={50} step={0.5} value={premium} onChange={(e) => setPremium(e.target.value)} placeholder={String(same && settings ? settings.premiumPct : cfg.defaults.premiumPct)} className={input} />
          </label>
        )}
        {cfg.editable.commission && (
          <label className={label}>
            House commission %
            <input type="number" min={0} max={60} step={0.5} value={commission} onChange={(e) => setCommission(e.target.value)} placeholder={String(same && settings ? settings.commissionPct : cfg.defaults.commissionPct)} className={input} />
          </label>
        )}
        <label className={label}>
          {cfg.payoutPlan === "consignment" ? "House payout email" : "Organizer payout email"}
          <input type="email" value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder="default: treasurer" className={`${input} w-56`} />
        </label>
        {cfg.editable.consignors && (
          <label className={label}>
            Consignor emails (comma separated)
            <input value={consignors} onChange={(e) => setConsignors(e.target.value)} placeholder="default: sandbox buyers" className={`${input} w-64`} />
          </label>
        )}
        {asking ? (
          <span role="alertdialog" aria-label="Confirm auction type" className="inline-flex items-center gap-2 rounded-lg border-2 border-rose-700 bg-rose-50 p-1">
            <button type="button" autoFocus onClick={apply} className="rounded-md bg-rose-700 px-3 py-1.5 font-bold text-white hover:bg-rose-800">
              Yes, reset as {cfg.label}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-md px-3 py-1.5 font-bold text-stone-800 hover:bg-stone-200">Cancel</button>
          </span>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setAsking(true)} className="rounded-lg bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-50">
            Apply type &amp; reset room
          </button>
        )}
      </div>
      <p className="mt-2 text-sm text-stone-600">{cfg.payoutLabel}.</p>
    </section>
  );
}
