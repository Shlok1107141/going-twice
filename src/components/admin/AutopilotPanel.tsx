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
      const res = await fetch("/api/autopilot" + (typeof window !== "undefined" ? window.location.search : ""), { cache: "no-store" });
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
    <section aria-labelledby="auto-h" className="overflow-hidden rounded-xl bg-ink p-8 text-canvas shadow-lift">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-xl">
          <p className="eyebrow text-clay-on-dark">No bidders handy?</p>
          <h2 id="auto-h" className="display mt-2 text-3xl sm:text-4xl">Let three AI bidders run it</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-canvas/75">
            Three AI bidders, each with a real PayPal hold, bid against each other and against anyone who joins with your room code. Gus calls every lot, and the holds settle at the end.
          </p>
        </div>
        <div className="flex flex-col items-start gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || running}
              onClick={() => void act("start")}
              className="rounded-md bg-canvas px-5 py-2.5 text-[15px] font-medium text-ink transition-colors hover:bg-white disabled:opacity-60"
            >
              {busy && !running ? "Starting…" : running ? "Running…" : "Start the AI bidders"}
            </button>
            <button
              type="button"
              disabled={busy || !running}
              onClick={() => void act("stop")}
              className="rounded-md border border-canvas/30 px-5 py-2.5 text-[15px] text-canvas transition-colors hover:border-canvas/60 disabled:opacity-40"
            >
              Stop
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-canvas/80">
            <input type="checkbox" checked={autoClose} disabled={running} onChange={(e) => setAutoClose(e.target.checked)} className="h-4 w-4 accent-[#d9a083]" />
            Auto-close and settle when the lots are done
          </label>
        </div>
      </div>

      <ul className="mt-6 flex flex-wrap gap-2" aria-label="Autopilot bidders">
        {chips.map((p) => (
          <li key={p.name} className="rounded-full border border-canvas/15 px-3.5 py-1.5 text-sm text-canvas/90">
            <span aria-hidden="true">{p.emoji} </span>
            <span className="font-medium text-canvas">{p.name}</span>
            {p.number ? <span className="num text-clay-on-dark"> #{p.number}</span> : null}
            <span className="text-canvas/60"> · {p.blurb}</span>
          </li>
        ))}
      </ul>

      <p className="mt-6 border-t border-canvas/10 pt-4 text-sm" role="status" aria-live="polite">
        {err ? (
          <span className="text-[#f0a99c]">{err}</span>
        ) : st && st.phase !== "idle" ? (
          <>
            <span className="mr-2 rounded-full bg-clay-on-dark px-2 py-0.5 text-xs font-medium capitalize text-ink">{st.phase}</span>
            {st.message}
            {running && lotsTotal > 0 ? (
              <span className="num text-clay-on-dark">
                {" "}
                ({Math.min(st.lotIndex + 1, lotsTotal)}/{lotsTotal})
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-canvas/65">Ready. Up to 4 lots, 5 minutes. Needs a fresh (unclosed) auction.</span>
        )}
      </p>
    </section>
  );
}
