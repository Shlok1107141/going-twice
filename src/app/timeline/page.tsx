"use client";

import dynamic from "next/dynamic";

// Bryntum touches window/document on import, so it is client-only.
const TimelineView = dynamic(() => import("@/components/timeline/TimelineView"), {
  ssr: false,
  loading: () => <p className="p-10 text-stone-600">Loading the hold timeline…</p>,
});

export default function TimelinePage() {
  return <TimelineView />;
}
