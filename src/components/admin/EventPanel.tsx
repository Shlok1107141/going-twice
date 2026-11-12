"use client";

import { useState } from "react";
import { btn, fieldLabel, panel, SectionTitle } from "@/components/ui";
import { send } from "@/lib/client/api";
import type { EventInfo } from "@/lib/client/types";

const input =
  "mt-2 block w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none";

/** Inline-editable event details. Names are plain text; the server strips markup characters. */
export function EventPanel({ event, onSaved }: { event: EventInfo; onSaved: () => Promise<void> | void }) {
  const [draft, setDraft] = useState({ name: event.name, organizer: event.organizer, beneficiary: event.beneficiary, tagline: event.tagline ?? "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty =
    draft.name !== event.name || draft.organizer !== event.organizer || draft.beneficiary !== event.beneficiary || draft.tagline !== (event.tagline ?? "");
  const set = (k: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setMsg(null);
    setDraft({ ...draft, [k]: e.target.value });
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await send("PATCH", "/api/event", draft);
      await onSaved();
      setMsg({ ok: true, text: "Saved." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={panel} aria-labelledby="event-h">
      <SectionTitle id="event-h" hint="Shown on the stage and paddle screens, spoken by Gus, and printed on receipts and payouts.">
        Event setup
      </SectionTitle>
      <form onSubmit={save} className="grid gap-5 sm:grid-cols-2">
        <label className={fieldLabel}>
          Event name
          <input value={draft.name} onChange={set("name")} maxLength={80} required className={input} />
        </label>
        <label className={fieldLabel}>
          Organizer
          <input value={draft.organizer} onChange={set("organizer")} maxLength={80} required className={input} />
        </label>
        <label className={fieldLabel}>
          Proceeds go to
          <input value={draft.beneficiary} onChange={set("beneficiary")} maxLength={100} required className={input} />
        </label>
        <label className={fieldLabel}>
          Tagline <span className="font-normal text-muted">(optional)</span>
          <input value={draft.tagline} onChange={set("tagline")} maxLength={120} className={input} />
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button type="submit" disabled={busy || !dirty} className={btn.primary}>
            {busy ? "Saving…" : "Save event"}
          </button>
          <span className="text-sm text-muted">Currency: {event.currency}</span>
          <span role="status" aria-live="polite" className={`text-sm ${msg && !msg.ok ? "text-danger" : "text-muted"}`}>
            {msg?.text}
          </span>
        </div>
      </form>
    </section>
  );
}
