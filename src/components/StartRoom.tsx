"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="rounded-2xl bg-amber-600 px-6 py-4 text-lg font-black uppercase text-white shadow hover:bg-amber-700 disabled:bg-stone-300 disabled:text-stone-700"
      >
        {busy ? "Creating your room…" : "Start your own room"}
      </button>
      <p className="mt-2 text-sm text-stone-700">Your own private auction: nobody else&apos;s bids or Reset can touch it.</p>
      {error && <p role="alert" className="mt-2 text-sm font-semibold text-rose-900">{error}</p>}
    </div>
  );
}
