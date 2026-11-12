"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { btn } from "@/components/ui";

/** Creates a fresh auction room and sends the organizer to its admin screen. */
export function StartRoom() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/room/new", { cache: "no-store" });
      const { room } = (await res.json()) as { room?: string };
      if (!room) throw new Error("no room");
      router.push(`/admin?room=${encodeURIComponent(room)}`);
    } catch {
      setError("Could not create a room. Try again.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={start} disabled={busy} className={`${btn.primary} px-6 py-3.5 text-base`}>
        {busy ? "Creating your room…" : "Start your own room"}
        {!busy && <span aria-hidden>&rarr;</span>}
      </button>
      <p className="mt-3 text-sm text-muted">A private auction of your own. Nobody else&apos;s bids or resets can touch it.</p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
