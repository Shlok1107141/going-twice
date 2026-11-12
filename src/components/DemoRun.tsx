"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrCode } from "@/components/QrCode";
import { btn } from "@/components/ui";
import { useOrigin } from "@/lib/client/useOrigin";

type Phase = "idle" | "room" | "autopilot" | "done";

/** One-click judge path: fresh room, autopilot with AI bidders and auto-close, then the stage. */
export function DemoRun() {
  const router = useRouter();
  const origin = useOrigin();
  const [phase, setPhase] = useState<Phase>("idle");
  const [room, setRoom] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setNote(null);
    setPhase("room");
    let code: string | undefined;
    try {
      const res = await fetch("/api/room/new", { cache: "no-store" });
      code = ((await res.json()) as { room?: string }).room;
      if (!code) throw new Error("no room");
    } catch {
      setError("Could not create a room. Try again.");
      setPhase("idle");
      return;
    }
    setRoom(code);
    setPhase("autopilot");
    try {
      const res = await fetch(`/api/autopilot?room=${encodeURIComponent(code)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", autoClose: true }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setNote("The AI bidders could not start, so the room is empty. You can start Autopilot from Admin.");
    }
    setPhase("done");
    const stage = `/stage?room=${encodeURIComponent(code)}`;
    if (!window.open(stage, "_blank")) router.push(stage);
  }

  const busy = phase === "room" || phase === "autopilot";
  const paddle = room ? `/paddle?room=${encodeURIComponent(room)}` : "";
  const stage = room ? `/stage?room=${encodeURIComponent(room)}` : "";

  return (
    <div>
      <button type="button" onClick={run} disabled={busy} className={`${btn.accent} px-6 py-3.5 text-base`}>
        {phase === "room" ? "Creating a room…" : phase === "autopilot" ? "Seating the AI bidders…" : "Run the 60-second demo"}
        {!busy && <span aria-hidden>&rarr;</span>}
      </button>
      <p className="mt-3 text-sm text-muted">One click: a private room, AI bidders and Gus the auctioneer, settled at the end.</p>
      <p role="status" aria-live="polite" className="sr-only">
        {phase === "room" ? "Creating a room" : phase === "autopilot" ? "Starting autopilot" : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {phase === "done" && room && (
        <div className="mt-5 flex flex-wrap items-center gap-5 rounded-xl border border-line bg-surface p-4">
          {origin && <QrCode value={`${origin}${paddle}`} label="Scan to join as a bidder" className="h-24 w-24 shrink-0" />}
          <div className="min-w-0 text-sm text-ink-2">
            <p className="font-medium text-ink">Room {room} is live.</p>
            {note && <p className="mt-1 text-danger">{note}</p>}
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <a className="underline underline-offset-4 hover:text-ink" href={stage} target="_blank" rel="noreferrer">
                Open the stage
              </a>
              <a className="underline underline-offset-4 hover:text-ink" href={paddle} target="_blank" rel="noreferrer">
                Join as a bidder
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
