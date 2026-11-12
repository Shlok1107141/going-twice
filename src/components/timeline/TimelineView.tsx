"use client";

import "@bryntum/scheduler/fontawesome/css/fontawesome.css";
import "@bryntum/scheduler/fontawesome/css/solid.css";
import "@bryntum/scheduler/scheduler.css";
import "@bryntum/scheduler/svalbard-light.css";
import "./timeline.css";

import type { Scheduler } from "@bryntum/scheduler";
import { BryntumScheduler, type BryntumSchedulerProps } from "@bryntum/scheduler-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { post, roomParam, withRoomQuery } from "@/lib/client/api";
import type { State } from "@/lib/client/types";
import { DAY, NIGHT_ID, buildModel, sampleState, type Kind, type Model, type Rec } from "./model";
import { btn, Eyebrow } from "@/components/ui";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

type Zoom = "tonight" | "lifetime";

const levelStyle: Record<Rec["level"], string> = {
  urgent: "border-danger/30 bg-danger-soft text-danger",
  soon: "border-clay/30 bg-clay-soft/70 text-clay-ink",
  amber: "border-line-strong bg-sunken text-ink",
};
const levelLabel: Record<Rec["level"], string> = { urgent: "Act now", soon: "Soon", amber: "Hammered" };

export default function TimelineView() {
  const schedRef = useRef<{ instance: Scheduler } | null>(null);
  const [live, setLive] = useState<State | null>(null);
  const [sample, setSample] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>("tonight");
  const [now, setNow] = useState(() => Date.now());
  const [follow, setFollow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [room] = useState(() => roomParam());
  const [initSpan] = useState(() => ({ s: new Date(Date.now() - 30 * 60_000), e: new Date(Date.now() + 30 * 60_000) }));
  const lastSig = useRef("");
  const fitted = useRef<Zoom | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch(withRoomQuery("/api/state"), { cache: "no-store" });
        if (!res.ok) throw new Error(`State request failed (${res.status})`);
        const data = (await res.json()) as State;
        if (!stopped) {
          setLive(data);
          setError(null);
          setNow(Date.now());
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Connection lost");
      }
      if (!stopped) timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const liveHasData = !!live && (live.paddles.length > 0 || live.lots.some((l) => l.status !== "pending"));
  const state = sample ?? (liveHasData ? live : null);
  const isSample = !!sample;
  const model: Model | null = useMemo(() => (state ? buildModel(state, now) : null), [state, now]);

  // Push data into Bryntum imperatively, only when something actually changed.
  useEffect(() => {
    const s = schedRef.current?.instance;
    if (!s || !model) return;
    const sig = JSON.stringify([model.resources, model.events.map((e) => [e.id, +e.startDate, +e.endDate, e.name])]);
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      s.resourceStore.data = model.resources as never;
      s.eventStore.data = model.events as never;
    }
  }, [model]);

  // Fit the viewport when the zoom preset changes (not on every poll, so scrolling is preserved).
  useEffect(() => {
    const s = schedRef.current?.instance;
    if (!s || !model || fitted.current === zoom) return;
    if (zoom === "tonight") {
      const times = model.events.filter((e) => e.resourceId === NIGHT_ID).map((e) => +e.startDate);
      const start = Math.min(...(times.length ? times : [now - 30 * 60_000])) - 5 * 60_000;
      s.zoomTo({ startDate: new Date(start), endDate: new Date(Math.max(now + 20 * 60_000, start + 50 * 60_000)) });
    } else {
      const a = model.authAt ?? now;
      const end = Math.max(...model.events.map((e) => +e.endDate), now) + DAY;
      s.zoomTo({ startDate: new Date(Math.min(a, now) - 12 * 3600_000), endDate: new Date(end) });
    }
    fitted.current = zoom;
  }, [zoom, model, now]);

  // Follow live: keep "now" in view while an auction runs.
  useEffect(() => {
    const s = schedRef.current?.instance;
    if (!follow || !s) return;
    const c = state?.status === "live" ? now : Date.now();
    s.scrollToDate(new Date(c), { block: "center", animate: true });
  }, [follow, now, state?.status]);

  const onZoom = (z: Zoom) => {
    fitted.current = null;
    setZoom(z);
  };
  const loadSample = () => {
    lastSig.current = "";
    fitted.current = null;
    setSample(sampleState(Date.now()));
    setNow(Date.now());
  };
  const clearSample = () => {
    lastSig.current = "";
    fitted.current = null;
    setSample(null);
  };

  const runClose = useCallback(async () => {
    if (!model?.closeReady || isSample) return;
    if (!window.confirm("Close the auction now? This captures every winning paddle and voids all other holds.")) return;
    setBusy(true);
    setMsg(null);
    try {
      await post("/api/close");
      setMsg("Auction closed: winners captured, other holds released.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Close failed");
    } finally {
      setBusy(false);
    }
  }, [model, isSample]);

  const schedulerProps = useMemo(
    () => ({
      readOnly: true,
      rowHeight: 52,
      barMargin: 8,
      eventLayout: "none" as const,
      viewPreset: "minuteAndHour",
      useInitialAnimation: false,
      columns: [
        {
          text: "Paddle",
          field: "name",
          width: 230,
          renderer: ({ record }: { record: { data: Record<string, unknown> } }) => {
            const d = record.data as { name: string; paddleNo?: number; who: string; amount?: number };
            if (d.who === "clock") return `<div class="tl-res"><span class="tl-av">⏱️</span><div><b>Clock</b><small>now · honor · expiry</small></div></div>`;
            if (d.who === "night") return `<div class="tl-res"><span class="tl-av">🔨</span><div><b>Auction night</b><small>run of show</small></div></div>`;
            return `<div class="tl-res"><span class="tl-av">${d.who === "agent" ? "🤖" : "🧑"}</span><div><b><i>#${d.paddleNo}</i> ${esc(d.name)}</b><small>${d.who === "agent" ? "AI agent" : "Human"} · $${d.amount} hold</small></div></div>`;
          },
        },
      ],
      features: {
                eventDrag: false,
        eventResize: false,
        eventEdit: false,
        eventMenu: false,
        scheduleMenu: false,
        cellMenu: false,
        headerMenu: false,
        timeAxisHeaderMenu: false,
        columnLines: true,
        eventTooltip: {
          template: ({ eventRecord }: { eventRecord: { tip?: string; name?: string; startDate: Date } }) =>
            `<div class="tl-tip"><b>${esc(eventRecord.name || "Bid")}</b><div>${esc(eventRecord.tip ?? "")}</div><small>${eventRecord.startDate.toLocaleString()}</small></div>`,
        },
      },
      eventRenderer: ({ eventRecord, renderData }: Parameters<NonNullable<BryntumSchedulerProps["eventRenderer"]>>[0]) => {
        const d = eventRecord as unknown as { kind: Kind; name: string };
        (renderData.cls as unknown as Record<string, boolean>)[`tl-${d.kind}`] = true;
        return esc(d.name);
      },
    }),
    [],
  );

  const empty = !state;
  const roomLabel = room ? room.toUpperCase() : "MAIN";

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-8 px-4 pb-16 pt-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <Eyebrow>Settlement</Eyebrow>
          <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">Hold Timeline</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-ink-2">
            Every paddle is a PayPal authorization hold: <span className="font-medium text-ink">3 days of honor</span>, then valid until <span className="font-medium text-ink">day 29</span>, then released. Capture in time, or reauthorize.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-ink-2">Room {roomLabel}</span>
          <button onClick={() => setFollow((f) => !f)} aria-pressed={follow} className={`rounded-md border px-3.5 py-1.5 text-sm transition-colors ${follow ? "border-ink bg-ink text-canvas" : "border-line bg-surface text-ink-2 hover:bg-sunken"}`}>
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${follow ? "bg-clay" : "bg-line-strong"}`} aria-hidden />Follow live
          </button>
          <div role="group" aria-label="Zoom" className="inline-flex rounded-md border border-line bg-surface p-1 text-sm">
            {([["tonight", "Tonight (minutes)"], ["lifetime", "Hold lifetime (days)"]] as const).map(([z, label]) => (
              <button key={z} onClick={() => onZoom(z)} aria-pressed={zoom === z} className={`rounded-sm px-3.5 py-1.5 transition-colors ${zoom === z ? "bg-ink text-canvas" : "text-ink-2 hover:bg-sunken"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {isSample && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-clay/50 bg-clay-soft/50 px-4 py-3 text-sm text-ink-2">
          <span><span className="font-medium text-clay-ink">Sample data.</span> Invented paddles and holds of mixed age, so every risk state is visible. Nothing here touches your auction.</span>
          <button onClick={clearSample} className={btn.small}>Back to live data</button>
        </div>
      )}
      {error && !state && <p role="status" className="rounded-md bg-danger-soft px-4 py-3 text-sm text-danger">Can not reach the auction: {error}. Retrying…</p>}

      {empty ? (
        <section className="grid place-items-center rounded-xl border border-line bg-surface px-6 py-24 text-center shadow-soft">
          <div className="max-w-md">
            <div className="rule-ornament mx-auto w-40" aria-hidden>
              <span className="h-2 w-2 rotate-45 bg-clay" />
            </div>
            <h2 className="display mt-6 text-4xl text-ink">No holds on the clock yet</h2>
            <p className="mt-3 leading-relaxed text-ink-2">Once paddles register and lots open in room {roomLabel}, their authorization holds appear here and tick toward the honor period and expiry.</p>
            <button onClick={loadSample} className={`${btn.primary} mt-8`}>Load sample (fake data)</button>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-label="Hold timeline" className="min-w-0 overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
            <div className="tl-legend flex flex-wrap gap-x-6 gap-y-2 border-b border-line bg-canvas px-5 py-3 text-xs text-ink-2">
              <span><i className="tl-sw tl-sw-honor" />Honor period (3 d)</span>
              <span><i className="tl-sw tl-sw-validity" />Valid to expiry (29 d)</span>
              <span><i className="tl-sw tl-sw-bid" />Bid</span>
              <span><i className="tl-sw tl-sw-capture" />Captured</span>
              <span><i className="tl-sw tl-sw-void" />Voided</span>
              <span><i className="tl-sw tl-sw-lot" />Lot run-of-show</span>
              <span className="ml-auto text-muted">Hover any bar for PayPal ids and amounts</span>
            </div>
            <p className="border-b border-line bg-canvas px-5 pb-3 text-xs text-muted">Each bar is a PayPal authorization; PayPal events and AI bidders move it.</p>
            <div className="tl-host">
              <BryntumScheduler ref={schedRef as never} {...schedulerProps} startDate={initSpan.s} endDate={initSpan.e} />
            </div>
          </section>

          <aside aria-label="Settlement risk" className="flex flex-col gap-3">
            <div className="rounded-xl border border-line bg-surface p-6 shadow-soft">
              <h2 className="display text-2xl text-ink">Settlement risk</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {model && model.recs.length === 0 ? "Nothing needs attention." : `${model?.recs.length ?? 0} item(s) to look at.`} {model?.healthy ? `${model.healthy} hold(s) comfortably inside the honor period.` : ""}
              </p>
            </div>
            {model?.recs.map((r) => (
              <article key={r.id} className={`rounded-lg border p-4 ${levelStyle[r.level]}`}>
                <div className="eyebrow opacity-80">{levelLabel[r.level]}</div>
                <h3 className="mt-1 font-medium text-ink">{r.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-2">{r.detail}</p>
                {r.action === "close" && (
                  <button
                    onClick={runClose}
                    disabled={busy || isSample || !model.closeReady}
                    title={isSample ? "Sample data: nothing to close" : !model.closeReady ? "Available once the auction is live and every lot is sold or passed" : "POST /api/close"}
                    className={`${btn.primary} mt-3 px-4 py-2 text-sm`}
                  >
                    {busy ? "Closing…" : "Capture & close auction"}
                  </button>
                )}
              </article>
            ))}
            {model && model.recs.length === 0 && (
              <p className="rounded-lg border border-sage/30 bg-sage-soft p-4 text-sm text-sage">All open holds are healthy. Check back as the honor clock runs.</p>
            )}
            {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
            <p className="text-xs leading-relaxed text-muted">
              Reauthorization is shown as advice only; this page never moves money except through the existing close endpoint, and only when every lot is decided.
            </p>
            <p className="text-xs text-muted">Built with Bryntum Scheduler</p>
            {!isSample && <button onClick={loadSample} className="self-start text-xs text-muted underline underline-offset-4 hover:text-ink">Load sample data</button>}
          </aside>
        </div>
      )}
    </main>
  );
}
