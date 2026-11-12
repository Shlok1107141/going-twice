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
import { btn, Eyebrow } from "@/components/ui";

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
    <div className="mx-auto flex h-[calc(100dvh-var(--nav-h))] min-h-[720px] w-full max-w-[1500px] flex-col px-4 pb-6 pt-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <Eyebrow>For the organizer</Eyebrow>
          <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">Gala Report</h1>
          <p className="mt-3 text-base text-ink-2">
            {useSample
              ? "Sample gala data, not a real auction."
              : state
                ? `Live from the auction${state.status === "closed" ? ", closed" : state.status === "live" ? ", in progress" : ""}.`
                : "Waiting for the first lot to sell."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {useSample && (
            <span className="rounded-full bg-clay-soft px-3 py-1 text-xs font-medium text-clay-ink">Sample data</span>
          )}
          <nav className="flex rounded-md border border-line bg-surface p-1 text-sm" aria-label="Report pages">
            {Object.entries(PAGE_TITLES).map(([id, label]) => (
              <button
                key={id}
                onClick={() => choosePage(id)}
                aria-pressed={pageId === id}
                className={`rounded-sm px-3.5 py-1.5 transition-colors ${pageId === id ? "bg-ink text-canvas" : "text-ink-2 hover:bg-sunken"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={() => changeMode(mode === "edit" ? "view" : "edit")}
            aria-pressed={mode === "edit"}
            className={`${btn.small} ${mode === "edit" ? "!border-ink !bg-sunken" : ""}`}
          >
            {mode === "edit" ? "Done editing" : "Edit report"}
          </button>
          {state && (
            <button
              onClick={() => (useSample ? setSample(null) : setSample(sampleState()))}
              className={btn.small}
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

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
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
    <div className="grid h-full place-items-center rounded-xl border border-line bg-surface p-8 text-center shadow-soft">
      <div className="max-w-md">
        <div className="rule-ornament mx-auto w-40" aria-hidden>
          <span className="h-2 w-2 rotate-45 bg-clay" />
        </div>
        <h2 className="display mt-6 text-4xl text-ink">No gala data yet</h2>
        <p className="mt-3 leading-relaxed text-ink-2">
          {error
            ? "Couldn't reach the auction. Check the server, or look at a sample report in the meantime."
            : "Once the first lot sells, bids, holds and payouts appear here live. Want to see what the report looks like?"}
        </p>
        <button
          onClick={onSample}
          className={`${btn.primary} mt-8`}
        >
          Load sample gala data
        </button>
        <p className="mt-3 text-xs text-muted">Sample data stays in your browser and is clearly labelled.</p>
      </div>
    </div>
  );
}
