"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "./types";

/** Polls GET /api/state. `refresh()` fetches immediately (e.g. right after a user action). */
export function useAuctionState(intervalMs = 800) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> | null = null;

    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`State request failed (${res.status})`);
        const data = (await res.json()) as State;
        if (!stopped) {
          setState(data);
          setError(null);
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "Connection lost");
      }
    };

    const load = () => {
      if (!inflight) {
        inflight = fetchOnce().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    };
    loadRef.current = load;

    const loop = async () => {
      await load();
      if (!stopped) timer = setTimeout(loop, intervalMs);
    };
    loop();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);

  const refresh = useCallback(() => loadRef.current(), []);
  return { state, error, refresh };
}
