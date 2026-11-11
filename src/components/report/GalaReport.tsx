"use client";

// The Gala Report: one AG Studio dashboard over the auction's state, with two custom widgets and a
// Studio Agent Framework chat (Gemini) so the PTA chair can ask for charts in plain English.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgStudioAiModule, enableStudioDevValidations, type AgReportState, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import type { State } from "@/lib/auction/types";
import { buildGalaAi } from "./ai";
import { buildGalaData, hasReportData, sampleState } from "./data";
import { galaReport, PAGE_TITLES } from "./report";
import { galaTheme } from "./theme";
import { createGalaWidgets, type GalaRegistry } from "./widgets";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const LICENSE = process.env.NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY;

export function GalaReport() {
  const [live, setLive] = useState<State | null>(null);
  const [sample, setSample] = useState<State | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [pageId, setPageId] = useState("overview");
  const [agent, setAgent] = useState<{ configured: boolean } | null>(null);
  const apiRef = useRef<AgStudioApi<GalaRegistry> | null>(null);
  const lastJson = useRef("");

  // --- live data: GET /api/state (forwarding ?room=), refreshed while the page is open -------------
  useEffect(() => {
    let stop = false;
    const room = new URLSearchParams(window.location.search).get("room");
    const url = `/api/state${room ? `?room=${encodeURIComponent(room)}` : ""}`;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as State;
        const json = JSON.stringify([next.lots, next.paddles, next.ledger, next.events]);
        if (!stop && json !== lastJson.current) {
          lastJson.current = json;
          setLive(next);
        }
        if (!stop) setLoadError(false);
      } catch {
        if (!stop) setLoadError(true);
      }
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    fetch("/api/report-agent")
      .then((r) => r.json())
      .then((j: { configured: boolean }) => setAgent(j))
      .catch(() => setAgent({ configured: false }));
  }, []);

  const useSample = sample !== null;
  const state = useSample ? sample : hasReportData(live) ? live : null;
  const data = useMemo(() => (state ? buildGalaData(state) : undefined), [state]);
  const widgets = useMemo(() => createGalaWidgets(), []);
  const ai = useMemo(() => (agent?.configured ? buildGalaAi() : undefined), [agent?.configured]);
  const [initialState] = useState<AgReportState<GalaRegistry>>(() => galaReport());

  const choosePage = useCallback((id: string) => {
    const api = apiRef.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
    setPageId(id);
  }, []);

  const changeMode = (next: AgStudioMode) => {
    setMode(next);
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-[1500px] flex-col px-4 pb-4 pt-5 sm:px-6">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Going Twice</p>
          <h1 className="font-serif text-3xl font-black leading-tight text-stone-900 sm:text-4xl">Gala Report</h1>
          <p className="mt-0.5 text-sm text-stone-600">
            {useSample
              ? "Sample gala data, not a real auction."
              : state
                ? `Live from the auction${state.status === "closed" ? ", closed" : state.status === "live" ? ", in progress" : ""}.`
                : "Waiting for the first lot to sell."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {useSample && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-900">Sample data</span>
          )}
          <nav className="flex rounded-full border border-stone-300 bg-white/70 p-0.5 text-sm" aria-label="Report pages">
            {Object.entries(PAGE_TITLES).map(([id, label]) => (
              <button
                key={id}
                onClick={() => choosePage(id)}
                aria-pressed={pageId === id}
                className={`rounded-full px-3.5 py-1 font-medium transition ${pageId === id ? "bg-stone-900 text-amber-50" : "text-stone-700 hover:bg-amber-100"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => changeMode(mode === "edit" ? "view" : "edit")}
            aria-pressed={mode === "edit"}
            className={`rounded-full border px-3.5 py-1 text-sm font-medium transition ${mode === "edit" ? "border-amber-700 bg-amber-100 text-amber-900" : "border-stone-300 bg-white/70 text-stone-700 hover:bg-amber-100"}`}
          >
            {mode === "edit" ? "Done editing" : "Edit report"}
          </button>
          {state && (
            <button
              onClick={() => (useSample ? setSample(null) : setSample(sampleState()))}
              className="rounded-full border border-stone-300 bg-white/70 px-3.5 py-1 text-sm font-medium text-stone-700 transition hover:bg-amber-100"
            >
              {useSample ? "Back to live data" : "Load sample data"}
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {data ? (
          <AgStudioProvider licenseKey={LICENSE} modules={ai ? [AgStudioAiModule] : undefined}>
            <AgStudio<GalaRegistry>
              style={{ height: "100%", width: "100%" }}
              theme={galaTheme}
              layout={{ widgetBorderEnabled: true }}
              data={data}
              widgets={widgets}
              ai={ai}
              initialState={initialState}
              mode={mode}
              onApiReady={(e) => {
                apiRef.current = e.api;
              }}
              onStateUpdated={(e) => setPageId(e.state.selectedPageId ?? "overview")}
            />
          </AgStudioProvider>
        ) : (
          <EmptyReport
            error={loadError}
            onSample={() => setSample(sampleState())}
          />
        )}
      </div>

      <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
        <span>
          {agent?.configured
            ? "Ask the report agent for charts: open the AI chat in Edit mode."
            : agent
              ? "Report agent is off: set GEMINI_API_KEY on the server to enable it."
              : ""}
        </span>
        <span>Built with AG Studio{LICENSE ? "" : " (trial, no license key set)"}.</span>
      </footer>
    </div>
  );
}

function EmptyReport({ error, onSample }: { error: boolean; onSample: () => void }) {
  return (
    <div className="grid h-full place-items-center rounded-3xl border border-dashed border-stone-300 bg-white/50 p-8 text-center">
      <div className="max-w-md">
        <div className="text-5xl" aria-hidden>
          {"\u{1F528}"}
        </div>
        <h2 className="mt-3 font-serif text-2xl font-bold text-stone-900">No gala data yet</h2>
        <p className="mt-2 text-sm text-stone-600">
          {error
            ? "Couldn't reach the auction. Check the server, or look at a sample report in the meantime."
            : "Once the first lot sells, bids, holds and payouts appear here live. Want to see what the report looks like?"}
        </p>
        <button
          onClick={onSample}
          className="mt-5 rounded-full bg-amber-700 px-6 py-2.5 text-sm font-bold text-amber-50 shadow transition hover:bg-amber-800"
        >
          Load sample gala data
        </button>
        <p className="mt-2 text-xs text-stone-500">Sample data stays in your browser and is clearly labelled.</p>
      </div>
    </div>
  );
}
