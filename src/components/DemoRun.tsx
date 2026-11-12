"use client";

import { useState } from "react";
import { btn } from "@/components/ui";

/** One click for judges: a fresh private room, then the stage, where the demo auction starts with sound. */
export function DemoRun({ label = "Watch the demo auction" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/new", { cache: "no-store" });
      const { room } = (await res.json()) as { room?: string };
      if (!room) throw new Error("no room");
      // A full page load (not a client-side route change): the stage needs its own response headers
      // so Gus's in-browser voice can use several threads.
      window.location.assign(`/stage?room=${encodeURIComponent(room)}&demo=1`);
    } catch {
      setError("Could not create a room. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={run} disabled={busy} className={`${btn.accent} px-6 py-3.5 text-base`}>
        {busy ? "Opening the auction room…" : label}
        {!busy && <span aria-hidden>&rarr;</span>}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
