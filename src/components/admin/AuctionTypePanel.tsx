"use client";

import { useState } from "react";
import { AUCTION_TYPE_LIST, typeConfig } from "@/lib/auction/auctionTypes";
import type { AuctionSettings, AuctionType } from "@/lib/client/types";
import { btn, panel, SectionTitle } from "@/components/ui";

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

  const input = "num mt-2 block w-28 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm font-normal text-ink focus:border-ink focus:outline-none";
  const label = "text-sm font-medium text-ink-2";

  return (
    <section className={panel} aria-labelledby="type-h">
      <SectionTitle id="type-h" hint="Built for the school gala. Works for any live auction. Applying a type resets this room with that type&apos;s sample lots.">
        Auction type
      </SectionTitle>
      <div role="radiogroup" aria-labelledby="type-h" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {AUCTION_TYPE_LIST.map((t) => {
          const on = picked === t.type;
          return (
            <button
              key={t.type}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(t.type)}
              className={`flex flex-col rounded-lg border p-5 text-left transition-colors ${on ? "border-ink bg-sunken/60 ring-1 ring-ink" : "border-line bg-surface hover:border-line-strong"}`}
            >
              <span aria-hidden className="text-2xl">{t.icon}</span>
              <span className="display mt-3 block text-xl text-ink">
                {t.label}
                {t.type === current && <span className="ml-2 rounded-full bg-ink px-2 py-0.5 align-middle font-sans text-[11px] text-canvas">current</span>}
              </span>
              <span className="mt-2 block text-sm leading-relaxed text-ink-2">{t.blurb}</span>
              <span className="mt-auto flex flex-wrap gap-1 pt-4">
                {t.keyNumbers.map((k) => (
                  <span key={k} className="rounded-sm bg-sunken px-1.5 py-0.5 text-xs text-ink-2">{k}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-4">
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
          <span role="alertdialog" aria-label="Confirm auction type" className="inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger-soft p-1">
            <button type="button" autoFocus onClick={apply} className={btn.danger}>
              Yes, reset as {cfg.label}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-md px-3 py-2 text-sm text-ink-2 hover:bg-surface">Cancel</button>
          </span>
        ) : (
          <button type="button" disabled={disabled} onClick={() => setAsking(true)} className={btn.secondary}>
            Apply type &amp; reset room
          </button>
        )}
      </div>
      <p className="mt-4 text-sm text-muted">{cfg.payoutLabel}.</p>
    </section>
  );
}
