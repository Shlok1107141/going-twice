"use client";

import { useState } from "react";
import { btn, field } from "@/components/ui";

/** Join an auction that someone else is hosting, by its room code. */
export function JoinRoom({ compact = false }: { compact?: boolean }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"bid" | "watch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clean = code.trim().toUpperCase();
  const valid = /^[A-Z0-9]{4,12}$/.test(clean);

  async function go(where: "bid" | "watch") {
    if (!valid) return setError("Room codes are 4 to 12 letters and numbers.");
    setBusy(where);
    setError(null);
    try {
      const res = await fetch(`/api/room/check?room=${encodeURIComponent(clean)}`, { cache: "no-store" });
      const { exists } = (await res.json()) as { exists?: boolean };
      if (!exists) {
        setError(`There is no auction with the code ${clean} yet. Check the code with the host.`);
        setBusy(null);
        return;
      }
      window.location.assign(`${where === "bid" ? "/paddle" : "/stage"}?room=${encodeURIComponent(clean)}`);
    } catch {
      setError("Could not reach the server. Try again.");
      setBusy(null);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void go("bid");
      }}
      aria-label="Join an auction with a room code"
    >
      <label htmlFor="join-code" className="block text-sm font-medium text-ink-2">
        Room code
      </label>
      <div className={`mt-2 flex flex-wrap gap-3 ${compact ? "" : "sm:flex-nowrap"}`}>
        <input
          id="join-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12))}
          placeholder="e.g. K7QM2X"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className={`${field} mt-0 min-w-0 flex-1 font-mono uppercase tracking-widest`}
        />
        <button type="submit" disabled={busy !== null} className={`${btn.primary} px-5 py-3`}>
          {busy === "bid" ? "Joining…" : "Join and bid"}
        </button>
      </div>
      <button type="button" onClick={() => go("watch")} disabled={busy !== null} className={`${btn.quiet} mt-2 px-0`}>
        {busy === "watch" ? "Opening…" : "Or just watch its stage"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
