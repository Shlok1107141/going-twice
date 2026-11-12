"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { DemoRun } from "@/components/DemoRun";
import { JoinRoom } from "@/components/JoinRoom";
import { useRoom } from "@/components/SiteNav";
import { StartRoom } from "@/components/StartRoom";

const noop = () => () => {};

/**
 * Every auction lives in a room. Pages that show an auction (stage, bid, host, PayPal, report, timeline)
 * render only with a room code; without one they offer the three ways in instead of a shared room.
 */
export function RoomGate({ children }: { children: ReactNode }) {
  const room = useRoom();
  const ready = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!ready) return <main className="flex-1" aria-busy="true" />;
  if (room) return <>{children}</>;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-16 pt-12 sm:px-6">
      <p className="eyebrow text-clay-ink">Pick an auction</p>
      <h1 className="display mt-2 text-4xl text-ink">This page belongs to an auction.</h1>
      <p className="mt-3 leading-relaxed text-ink-2">Every auction has its own room and room code. Join one, host your own, or watch the demo.</p>
      <div className="mt-8 rounded-xl border border-line bg-surface p-6 shadow-soft">
        <JoinRoom />
      </div>
      <div className="mt-6 flex flex-wrap gap-4">
        <StartRoom />
        <DemoRun />
      </div>
    </main>
  );
}
