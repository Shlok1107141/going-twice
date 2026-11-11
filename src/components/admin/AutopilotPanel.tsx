"use client";

import { useCallback, useEffect, useState } from "react";
import { post } from "@/lib/client/api";

type Status = {
  phase: "idle" | "setup" | "running" | "closing" | "done" | "stopped" | "error";
  running: boolean;
  message: string;
  lotIds: string[];
  lotIndex: number;
  aiCalls: number;
  personas: { name: string; emoji: string; blurb: string; number?: number; cap: number; hold: number }[];
};

const PERSONAS: Status["personas"] = [
  { emoji: "🏈", name: "Coach Mike", blurb: "Competitive, bids fast, cap $180", cap: 180, hold: 270 },
  { emoji: "🧶", name: "Grandma Jo", blurb: "Thrifty, food and family lots, cap $90", cap: 90, hold: 135 },
  { emoji: "🧐", name: "Dr. Patel", blurb: "Collector, waits then jumps, cap $400", cap: 400, hold: 600 },
];

export function AutopilotPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [autoClose, setAutoClose] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/autopilot", { cache: "no-store" });
      if (res.ok) setSt((await res.json()) as Status);
    } catch {
      // keep last status
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 1500);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    setErr(null);
    try {
      setSt(await post<Status>("/api/autopilot", { action, autoClose }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      void load();
    }
  };

  const running = st?.running ?? false;
  const chips = st && st.personas.length > 0 ? st.personas : PERSONAS;
  const lotsTotal = st?.lotIds.length ?? 0;

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-amber-700 bg-gradient-to-br from-stone-900 via-stone-900 to-amber-950 p-5 text-amber-50 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-300">Agentic gala</p>
          <h2 className="font-serif text-2xl font-black sm:text-3xl">Run a full gala on autopilot</h2>
          <p className="mt-1 text-sm text-amber-100/90">
            Three AI bidders, each with a real PayPal hold, bid against each other and against you. Join from /paddle to jump in; Gus calls every lot, and the holds settle at the end.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || running}
              onClick={() => void act("start")}
              className="rounded-lg bg-amber-400 px-4 py-2 font-black text-stone-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {busy && !running ? "Starting…" : running ? "Running…" : "Start autopilot"}
            </button>
            <button
              type="button"
              disabled={busy || !running}
              onClick={() => void act("stop")}
              className="rounded-lg border-2 border-amber-300 px-4 py-2 font-bold text-amber-100 hover:bg-amber-900 disabled:opacity-40"
            >
              Stop
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-amber-100">
            <input type="checkbox" checked={autoClose} disabled={running} onChange={(e) => setAutoClose(e.target.checked)} className="h-4 w-4 accent-amber-400" />
            Auto-close and settle when the lots are done
          </label>
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Autopilot bidders">
        {chips.map((p) => (
          <li key={p.name} className="rounded-full border border-amber-500/60 bg-stone-800 px-3 py-1.5 text-sm">
            <span aria-hidden="true">{p.emoji} </span>
            <strong>{p.name}</strong>
            {p.number ? <span className="text-amber-300"> #{p.number}</span> : null}
            <span className="text-amber-100/80"> · {p.blurb}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-sm font-semibold" role="status" aria-live="polite">
        {err ? (
          <span className="text-rose-300">{err}</span>
        ) : st && st.phase !== "idle" ? (
          <>
            <span className="mr-2 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-black uppercase text-stone-950">{st.phase}</span>
            {st.message}
            {running && lotsTotal > 0 ? (
              <span className="text-amber-200">
                {" "}
                ({Math.min(st.lotIndex + 1, lotsTotal)}/{lotsTotal})
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-amber-100/80">Ready. Up to 4 lots, 5 minutes. Needs a fresh (unclosed) auction.</span>
        )}
      </p>
    </section>
  );
}
