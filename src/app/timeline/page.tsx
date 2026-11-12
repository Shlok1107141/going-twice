"use client";

import dynamic from "next/dynamic";
import { RoomGate } from "@/components/RoomGate";

// Bryntum touches window/document on import, so it is client-only.
const TimelineView = dynamic(() => import("@/components/timeline/TimelineView"), {
  ssr: false,
  loading: () => <p role="status" className="anim-breathe mx-auto w-full max-w-[1400px] px-6 py-16 text-muted">Loading the hold timeline…</p>,
});

export default function TimelinePage() {
  return (
    <RoomGate>
      <TimelineView />
    </RoomGate>
  );
}
