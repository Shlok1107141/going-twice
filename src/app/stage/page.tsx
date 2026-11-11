"use client";

import { useEffect } from "react";
import { QrCode } from "@/components/QrCode";
import { SandboxBadge } from "@/components/SandboxBadge";
import { post } from "@/lib/client/api";
import { clock, findPaddle, headroom, isBidEvent, money, stageLot } from "@/lib/client/format";
import type { AuctionEvent, Lot, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useOrigin } from "@/lib/client/useOrigin";
import { useSpeech } from "@/lib/client/useSpeech";

const PERSONA = "Gus";

type Banner = { label: string; cls: string; anim: string };

function bannerFor(state: State, lot: Lot | undefined): Banner {
  if (state.status === "closed") return { label: "AUCTION CLOSED", cls: "bg-stone-900 text-amber-100", anim: "anim-pop" };
  if (!lot) return { label: "DOORS OPEN", cls: "bg-stone-200 text-stone-800", anim: "" };
  if (lot.status === "sold") return { label: "SOLD!", cls: "bg-emerald-700 text-white", anim: "anim-sold" };
  if (lot.status === "unsold") return { label: "PASSED", cls: "bg-stone-300 text-stone-800", anim: "anim-pop" };
  if (lot.status === "pending") return { label: state.status === "lobby" ? "DOORS OPEN" : "UP NEXT", cls: "bg-stone-200 text-stone-800", anim: "" };
  switch (lot.phase) {
    case "going-once":
      return { label: "GOING ONCE…", cls: "bg-amber-500 text-stone-950", anim: "anim-pulse" };
    case "going-twice":
      return { label: "GOING TWICE…", cls: "bg-orange-700 text-white", anim: "anim-pulse-fast" };
    case "sold":
      return { label: "SOLD!", cls: "bg-emerald-700 text-white", anim: "anim-sold" };
    default:
      return { label: "BIDDING", cls: "bg-amber-200 text-amber-950", anim: "anim-pop" };
  }
}

const eventStyle: Record<AuctionEvent["type"], string> = {
  bid: "text-stone-900",
  "agent-bid": "text-indigo-900",
  stall: "text-stone-500",
  "going-once": "text-amber-800",
  "going-twice": "text-orange-800",
  sold: "text-emerald-800 font-bold",
  system: "text-stone-500",
};

export default function StagePage() {
  const { state, error } = useAuctionState(800);
  const origin = useOrigin();
  const speech = useSpeech(state?.caption);
  const live = state?.status === "live";

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      post("/api/auctioneer/tick").catch(() => {});
    }, 2000);
    return () => clearInterval(id);
  }, [live]);

  if (!state) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="font-serif text-4xl text-stone-600">{error ? "Reconnecting to the auction house…" : "Opening the auction house…"}</p>
      </main>
    );
  }

  const lot = stageLot(state);
  const lotIndex = lot ? state.lots.findIndex((l) => l.id === lot.id) + 1 : 0;
  const banner = bannerFor(state, lot);
  const leader = lot ? findPaddle(state, lot.status === "sold" ? lot.winnerPaddleId : lot.highPaddleId) : undefined;
  const hasBid = !!lot && lot.highBid > 0;
  const shownAmount = lot ? (lot.status === "sold" ? (lot.finalPrice ?? lot.highBid) : hasBid ? lot.highBid : lot.startPrice) : 0;
  const ticker = state.events.filter((e) => e.type !== "stall").reverse().slice(0, 9);
  const roster = [...state.paddles].sort((a, b) => a.number - b.number);
  const t = state.totals;
  const ledger = [
    ["Held", t.held, "text-amber-800"],
    ["Captured", t.captured, "text-emerald-800"],
    ["Released", t.voided, "text-stone-700"],
    ["Paid out", t.paidOut, "text-indigo-800"],
  ] as const;

  return (
    <main className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] gap-[1.1vw] p-[1.4vw] lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <h1 className="font-serif text-[clamp(1.8rem,2.6vw,3.2rem)] font-black leading-none text-stone-900">Going Twice</h1>
          <span className="text-[clamp(0.8rem,1.1vw,1.3rem)] font-semibold uppercase tracking-[0.25em] text-amber-800">
            Charity Auction{lot && lotIndex > 0 ? ` · Lot ${lotIndex} of ${state.lots.length}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {error && <span role="status" className="rounded-full bg-rose-100 px-3 py-1 text-sm font-bold text-rose-900">Reconnecting&hellip;</span>}
          <SandboxBadge className="!text-[clamp(0.7rem,0.95vw,1.1rem)]" />
          {speech.supported &&
            (speech.enabled ? (
              <button
                type="button"
                onClick={speech.toggleMute}
                aria-pressed={speech.muted}
                className="rounded-full border-2 border-stone-800 bg-white px-4 py-1.5 text-sm font-bold text-stone-900 hover:bg-stone-100"
              >
                {speech.muted ? "Muted — tap to unmute" : "Sound on — mute"}
              </button>
            ) : (
              <button type="button" onClick={speech.start} className="rounded-full bg-amber-600 px-5 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow hover:bg-amber-700">
                Start sound
              </button>
            ))}
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-[1.1vw] lg:grid-cols-[1.9fr_1fr]">
        {/* Lot card */}
        <section aria-label="Current lot" className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-stone-300 bg-white p-[2vw] shadow-lg">
          {lot ? (
            <>
              <div className="flex items-center gap-[1.6vw]">
                <div aria-hidden className="grid h-[min(7vw,13vh)] w-[min(7vw,13vh)] shrink-0 place-items-center rounded-3xl bg-amber-50 text-[min(4.6vw,8.5vh)] ring-2 ring-amber-200">
                  {lot.emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-[clamp(0.8rem,1.1vw,1.3rem)] font-semibold uppercase tracking-[0.25em] text-amber-800">
                    {lot.status === "open" ? "Now bidding" : lot.status === "pending" ? "Up next" : lot.status === "sold" ? "Just sold" : "Lot closed"}
                  </p>
                  <h2 className="font-serif text-[min(3.6vw,7vh)] font-black leading-[1.05] text-stone-900">{lot.title}</h2>
                  <p className="mt-1 line-clamp-2 text-[min(1.5vw,2.8vh)] leading-snug text-stone-600">{lot.description}</p>
                </div>
              </div>

              <div className="mt-auto grid items-end gap-[1.4vw] pt-[1.4vw] md:grid-cols-[auto_1fr]">
                <div>
                  <p className="text-[clamp(0.8rem,1.1vw,1.3rem)] font-semibold uppercase tracking-[0.25em] text-stone-500">
                    {lot.status === "sold" ? "Sold for" : hasBid ? "Current bid" : "Opening bid"}
                  </p>
                  <p key={shownAmount} className="anim-bump text-[min(10vw,19vh)] font-black leading-none tabular-nums text-stone-900">
                    {money(shownAmount)}
                  </p>
                </div>
                <div className="pb-[0.6vw]">
                  <p className="text-[clamp(0.8rem,1.1vw,1.3rem)] font-semibold uppercase tracking-[0.25em] text-stone-500">
                    {lot.status === "sold" ? "Winner" : "High bidder"}
                  </p>
                  {leader ? (
                    <p className="text-[min(3.2vw,6vh)] font-extrabold leading-tight text-stone-900">
                      <span className="mr-3 inline-block rounded-xl bg-stone-900 px-3 text-amber-300">#{leader.number}</span>
                      {leader.name}
                      {leader.kind === "agent" && <span className="ml-3 text-[0.5em] font-bold uppercase tracking-widest text-indigo-800">AI agent</span>}
                    </p>
                  ) : (
                    <p className="text-[min(2.4vw,4.5vh)] font-semibold text-stone-500">
                      {lot.status === "open" ? "Waiting for the first paddle" : "—"}
                    </p>
                  )}
                  {lot.status === "open" && (
                    <p className="mt-1 text-[min(1.5vw,2.8vh)] text-stone-600">
                      Next bid {money(Math.max(lot.startPrice, lot.highBid + lot.increment))}
                    </p>
                  )}
                </div>
              </div>

              <div
                key={banner.label}
                role="status"
                aria-live="polite"
                className={`mt-[1.2vw] shrink-0 rounded-2xl px-6 py-[0.8vw] text-center text-[min(4.4vw,8.4vh)] font-black uppercase leading-none tracking-wide ${banner.cls} ${banner.anim}`}
              >
                {banner.label}
              </div>
            </>
          ) : (
            <p className="font-serif text-5xl text-stone-500">No lots yet.</p>
          )}
        </section>

        {/* Right column */}
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-[1.1vw]">
          <section aria-label="Join the auction" className="flex items-center gap-4 rounded-3xl border border-stone-300 bg-white p-4 shadow">
            <QrCode value={origin ? `${origin}/paddle` : ""} label="QR code linking to the bidder paddle page" className="h-[min(8vw,15vh)] w-[min(8vw,15vh)] shrink-0" />
            <div className="min-w-0">
              <p className="font-serif text-[clamp(1.1rem,1.6vw,2rem)] font-black leading-tight text-stone-900">Scan to get a paddle</p>
              <p className="mt-1 break-all font-mono text-[clamp(0.7rem,0.95vw,1.2rem)] text-stone-600">{origin ? `${origin}/paddle` : ""}</p>
            </div>
          </section>

          <section aria-label="Bid ticker" className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-stone-300 bg-white p-4 shadow">
            <h3 className="text-[clamp(0.75rem,1vw,1.2rem)] font-bold uppercase tracking-[0.25em] text-stone-500">Live ticker</h3>
            {ticker.length === 0 ? (
              <p className="mt-3 text-lg text-stone-500">Nothing yet. The gavel is warming up.</p>
            ) : (
              <ul className="mt-2 divide-y divide-stone-200 overflow-hidden">
                {ticker.map((e) => (
                  <li key={e.id} className="anim-slide-in flex items-baseline justify-between gap-3 py-[0.3vw]">
                    <span className={`text-[clamp(0.85rem,1.2vw,1.5rem)] ${eventStyle[e.type]} ${isBidEvent(e) ? "font-bold" : ""}`}>{e.text}</span>
                    <span className="shrink-0 font-mono text-[clamp(0.65rem,0.85vw,1rem)] text-stone-500">{clock(e.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Paddle roster" className="rounded-3xl border border-stone-300 bg-white p-4 shadow">
            <h3 className="text-[clamp(0.75rem,1vw,1.2rem)] font-bold uppercase tracking-[0.25em] text-stone-500">Paddles &amp; holds</h3>
            {roster.length === 0 ? (
              <p className="mt-2 text-lg text-stone-500">No paddles yet. Scan the code to join.</p>
            ) : (
              <ul className="mt-2 space-y-0.5 overflow-hidden">
                {roster.slice(0, 5).map((p) => {
                  const leading = lot?.status === "open" && lot.highPaddleId === p.id;
                  return (
                    <li key={p.id} className={`flex items-center justify-between gap-3 rounded-lg px-2 py-[0.15vw] ${leading ? "bg-amber-100" : ""}`}>
                      <span className="truncate text-[clamp(0.8rem,1.05vw,1.3rem)] font-bold text-stone-900">
                        <span className="mr-2 inline-block min-w-[2.4ch] rounded-md bg-stone-900 px-1.5 text-center text-amber-300">{p.number}</span>
                        {p.name}
                        {p.kind === "agent" ? " · AI" : ""}
                      </span>
                      <span className="shrink-0 text-right text-[clamp(0.75rem,0.95vw,1.2rem)] tabular-nums text-stone-700">
                        {p.status === "pending" ? (
                          <span className="font-semibold text-stone-500">awaiting hold</span>
                        ) : p.status === "held" ? (
                          <>
                            <span className="font-bold">{money(p.holdAmount)}</span> hold &middot; <span className="font-bold text-emerald-800">{money(headroom(p))}</span> left
                          </>
                        ) : (
                          <span className="font-semibold">{p.status === "captured" ? "charged" : "released"}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
                {roster.length > 5 && <li className="px-2 text-sm font-semibold text-stone-500">+{roster.length - 5} more paddles</li>}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <div className="grid gap-[1.1vw] lg:grid-cols-[1.9fr_1fr]">
        <section aria-label={`${PERSONA}, the auctioneer`} className="flex items-center gap-[1.4vw] rounded-3xl bg-stone-900 px-[2vw] py-[1.3vw] text-stone-100 shadow-lg">
          <div className="shrink-0 text-center">
            <div aria-hidden className="grid h-[min(5.5vw,10vh)] w-[min(5.5vw,10vh)] place-items-center rounded-full bg-amber-500 text-[min(3vw,5.5vh)]">
              {"\u{1F528}"}
            </div>
            <p className="mt-1 text-sm font-extrabold uppercase tracking-widest text-amber-300">{PERSONA}</p>
          </div>
          <p aria-live="polite" className="min-w-0 flex-1 font-serif text-[min(2.4vw,4.6vh)] italic leading-snug">
            {state.caption.text ? <>&ldquo;{state.caption.text}&rdquo;</> : <span className="text-stone-400">{PERSONA} is clearing his throat&hellip;</span>}
          </p>
          <div aria-hidden className="flex h-8 w-10 shrink-0 items-end gap-1" title={speech.speaking ? "Speaking" : ""}>
            {speech.speaking && [0, 1, 2, 3].map((i) => <span key={i} className="speak-bar h-full w-1.5 rounded bg-amber-400" style={{ animationDelay: `${i * 0.12}s` }} />)}
          </div>
        </section>

        <section aria-label="Money ledger" className="grid grid-cols-4 gap-2 rounded-3xl border border-stone-300 bg-white px-4 py-3 shadow">
          {ledger.map(([label, amount, color]) => (
            <div key={label} className="min-w-0 text-center">
              <p className="text-[clamp(0.6rem,0.8vw,1rem)] font-bold uppercase tracking-widest text-stone-500">{label}</p>
              <p className={`text-[clamp(1rem,1.9vw,2.4rem)] font-black tabular-nums ${color}`}>{money(amount)}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
