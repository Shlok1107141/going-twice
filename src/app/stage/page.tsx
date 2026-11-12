"use client";

import { useEffect } from "react";
import { NightInNumbersOverlay } from "@/components/proof/NightInNumbers";
import { QrCode } from "@/components/QrCode";
import { SandboxBadge } from "@/components/SandboxBadge";
import { Wordmark } from "@/components/SiteNav";
import { typeConfig } from "@/lib/auction/auctionTypes";
import { post } from "@/lib/client/api";
import { clock, findPaddle, headroom, money, stageLot } from "@/lib/client/format";
import type { AuctionEvent, Lot, Paddle, State } from "@/lib/client/types";
import { useAuctionState } from "@/lib/client/useAuctionState";
import { useOrigin } from "@/lib/client/useOrigin";
import { useSpeech } from "@/lib/client/useSpeech";

const PERSONA = "Gus";
const PHASES = ["Bidding", "Going once", "Going twice", "Sold"] as const;

/** Index into PHASES for the lot on stage, or -1 when no lot is in play. */
function phaseIndex(lot: Lot | undefined): number {
  if (!lot) return -1;
  if (lot.status === "sold") return 3;
  if (lot.status !== "open") return -1;
  return { bidding: 0, "going-once": 1, "going-twice": 2, sold: 3 }[lot.phase];
}

function statusLine(state: State, lot: Lot | undefined): string {
  if (state.status === "closed") return "The auction has closed";
  if (!lot) return "Doors open";
  if (lot.status === "open") return "Now bidding";
  if (lot.status === "sold") return "Sold";
  if (lot.status === "unsold") return "Passed";
  return state.status === "lobby" ? "Doors open · up first" : "Up next";
}

const eventTone: Record<AuctionEvent["type"], string> = {
  bid: "text-[var(--t-text)]",
  "agent-bid": "text-[#b9c2e0]",
  stall: "text-[var(--t-muted)]",
  "going-once": "text-clay-on-dark",
  "going-twice": "text-clay-on-dark",
  sold: "text-[#a9cdb3]",
  system: "text-[var(--t-muted)]",
};

const eyebrowDark = "eyebrow text-[var(--t-muted)] text-[clamp(0.7rem,0.75vw,0.95rem)]";

function PhaseTrack({ lot }: { lot: Lot | undefined }) {
  const at = phaseIndex(lot);
  return (
    <ol aria-label="Lot phase" className="grid grid-cols-4 gap-[0.8vw]">
      {PHASES.map((label, i) => {
        const done = at > i;
        const current = at === i;
        const sold = current && i === 3;
        return (
          <li key={label} aria-current={current ? "step" : undefined}>
            <div className="relative h-[3px] overflow-hidden rounded-full bg-[var(--t-line)]">
              {(done || current) && (
                <div
                  key={`${label}-${current}`}
                  className={`anim-sweep absolute inset-0 rounded-full ${current ? (sold ? "bg-[#a9cdb3]" : "bg-clay") : "bg-[var(--t-text)]/70"}`}
                />
              )}
            </div>
            <p
              className={`mt-[0.6vw] text-[clamp(0.8rem,1vw,1.3rem)] transition-colors ${
                current ? (sold ? "font-medium text-[#a9cdb3]" : "font-medium text-clay-on-dark") : done ? "text-[var(--t-text)]/80" : "text-[var(--t-muted)]/70"
              } ${current && i === 1 ? "anim-breathe" : current && i === 2 ? "anim-breathe-fast" : ""}`}
            >
              {label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function RosterRow({ p, leading }: { p: Paddle; leading: boolean }) {
  const used = p.holdAmount > 0 ? Math.min(100, (p.committed / p.holdAmount) * 100) : 0;
  return (
    <li className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-[0.8vw] gap-y-[0.3vw] rounded-md px-[0.6vw] py-[0.45vw] ${leading ? "bg-clay/15" : ""}`}>
      <span className="num display min-w-[2.2ch] text-center text-[clamp(1.1rem,1.5vw,2rem)] leading-none text-clay-on-dark">{p.number}</span>
      <span className="min-w-0 truncate text-[clamp(0.85rem,1vw,1.35rem)] text-[var(--t-text)]">
        {p.name}
        {p.kind === "agent" && <span className="ml-2 text-[0.75em] text-[#b9c2e0]">AI</span>}
      </span>
      <span className="num text-right text-[clamp(0.75rem,0.9vw,1.2rem)] text-[var(--t-muted)]">
        {p.status === "pending" ? "awaiting hold" : p.status === "held" ? `${money(headroom(p))} left` : p.status === "captured" ? "charged" : "released"}
      </span>
      <div className="col-span-3 col-start-1 ml-[calc(2.2ch+0.8vw)] h-[3px] overflow-hidden rounded-full bg-[var(--t-line)]" aria-hidden>
        {p.status === "held" && <div className="h-full rounded-full bg-[var(--t-text)]/70 transition-[width] duration-500" style={{ width: `${used}%` }} />}
      </div>
    </li>
  );
}

export default function StagePage() {
  const { state, error } = useAuctionState(800);
  const origin = useOrigin();
  const room = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("room");
  const joinUrl = origin ? `${origin}/paddle${room ? `?room=${encodeURIComponent(room)}` : ""}` : "";
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
      <main className="theatre grid min-h-screen place-items-center">
        <div className="text-center">
          <Wordmark size="lg" tone="light" />
          <p className="display anim-breathe mt-6 text-3xl italic text-[var(--t-muted)]">
            {error ? "Reconnecting to the auction house…" : "Opening the auction house…"}
          </p>
        </div>
      </main>
    );
  }

  const lot = stageLot(state);
  const lotIndex = lot ? state.lots.findIndex((l) => l.id === lot.id) + 1 : 0;
  const sold = lot?.status === "sold";
  const leader = lot ? findPaddle(state, sold ? lot.winnerPaddleId : lot.highPaddleId) : undefined;
  const hasBid = !!lot && lot.highBid > 0;
  const shownAmount = lot ? (sold ? (lot.finalPrice ?? lot.highBid) : hasBid ? lot.highBid : lot.startPrice) : 0;
  const ticker = state.events.filter((e) => e.type !== "stall").reverse().slice(0, 8);
  const roster = [...state.paddles].sort((a, b) => a.number - b.number);
  const t = state.totals;
  const ledger = [
    ["Held", t.held],
    ["Captured", t.captured],
    ["Released", t.voided],
    ["Paid out", t.paidOut],
  ] as const;
  const premium = state.settings?.premiumPct ?? 0;

  return (
    <main className="theatre grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] gap-[1.4vw] px-[2.2vw] py-[1.6vw] lg:h-screen lg:overflow-hidden">
      {/* Masthead */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--t-line)] pb-[1.1vw]">
        <div className="flex flex-wrap items-baseline gap-x-[1.6vw] gap-y-2">
          <Wordmark size="lg" tone="light" />
          <span className={eyebrowDark}>
            {state.event?.name ?? typeConfig(state.auctionType).stageLabel}
            {lot && lotIndex > 0 ? ` · Lot ${lotIndex} of ${state.lots.length}` : ""}
          </span>
          {premium > 0 && <span className="text-[clamp(0.75rem,0.85vw,1.1rem)] text-clay-on-dark">Plus {premium}% buyer&apos;s premium</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {error && (
            <span role="status" className="rounded-full border border-clay-on-dark/50 px-3 py-1 text-sm text-clay-on-dark">
              Reconnecting&hellip;
            </span>
          )}
          <SandboxBadge tone="dark" className="text-[clamp(0.7rem,0.8vw,1rem)]" />
          {speech.supported &&
            (speech.enabled ? (
              <button
                type="button"
                onClick={speech.toggleMute}
                aria-pressed={speech.muted}
                className="rounded-md border border-[var(--t-line)] px-4 py-1.5 text-sm text-[var(--t-text)] transition-colors hover:border-[var(--t-muted)]"
              >
                {speech.muted ? "Unmute Gus" : "Mute"}
              </button>
            ) : (
              <button type="button" onClick={speech.start} className="rounded-md bg-canvas px-4 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-white">
                Start sound
              </button>
            ))}
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-[2vw] lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
        {/* The lot */}
        <section aria-label="Current lot" className="flex min-h-0 flex-col">
          {lot ? (
            <>
              <div key={lot.id} className="anim-rise flex items-start gap-[1.8vw]">
                {lot.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lot.image}
                    alt={lot.title}
                    className="h-[max(5rem,min(16vw,30vh))] w-[max(5rem,min(16vw,30vh))] shrink-0 rounded-lg border border-[var(--t-line)] bg-[var(--t-panel)] object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="grid h-[max(5rem,min(14vw,26vh))] w-[max(5rem,min(14vw,26vh))] shrink-0 place-items-center rounded-lg border border-[var(--t-line)] bg-[var(--t-panel)] text-[max(3.15rem,min(7vw,13vh))]"
                  >
                    {lot.emoji}
                  </div>
                )}
                <div className="min-w-0 pt-[0.3vw]">
                  <p className="eyebrow text-[clamp(0.7rem,0.8vw,1rem)] text-clay-on-dark">{statusLine(state, lot)}</p>
                  <h2 className="display mt-[0.5vw] line-clamp-2 text-[max(2.25rem,min(5vw,9.5vh))] text-[var(--t-text)]">{lot.title}</h2>
                  {lot.description && (
                    <p className="mt-[0.6vw] line-clamp-2 max-w-[60ch] text-[max(0.9rem,min(1.25vw,2.4vh))] leading-snug text-[var(--t-muted)]">{lot.description}</p>
                  )}
                  <p className="mt-[0.6vw] flex flex-wrap gap-x-[1.2vw] text-[max(0.9rem,min(1.15vw,2.2vh))] text-[var(--t-muted)]">
                    {!!lot.fmv && lot.sources?.length ? (
                      <span>
                        Est. value <span className="num text-[var(--t-text)]">{money(lot.fmv)}</span> · via Channel3
                      </span>
                    ) : null}
                    {lot.consignor && <span>From {lot.consignor}</span>}
                    {lot.unit === "head" && (lot.quantity ?? 0) > 1 && <span>{lot.quantity} head, one bid for the lot</span>}
                  </p>
                </div>
              </div>

              <div className="mt-auto pt-[1.6vw]">
                <PhaseTrack lot={lot} />

                {sold ? (
                  <div key={`sold-${lot.id}`} role="status" aria-live="polite" className="relative mt-[1.6vw] overflow-hidden rounded-xl border border-[#a9cdb3]/40 bg-[#a9cdb3]/[0.06] px-[2vw] py-[1.4vw]">
                    <div className="glint pointer-events-none absolute inset-0" aria-hidden />
                    <div className="flex flex-wrap items-end justify-between gap-[1.4vw]">
                      <div>
                        <p className="anim-sold display text-[max(3.6rem,min(8vw,15vh))] uppercase italic leading-none text-[#cfe3d4]">Sold</p>
                        <p className="mt-[0.6vw] text-[max(0.9rem,min(1.7vw,3.2vh))] text-[var(--t-text)]">
                          {leader ? (
                            <>
                              to Paddle <span className="num display text-[1.25em] text-clay-on-dark">{leader.number}</span> · {leader.name}
                            </>
                          ) : (
                            "Hammer down"
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={eyebrowDark}>Hammer price</p>
                        <p className="num display anim-bump text-[max(4.5rem,min(10vw,19vh))] leading-none text-[var(--t-text)]">{money(shownAmount)}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-[1.6vw] grid items-end gap-[2vw] md:grid-cols-[auto_minmax(0,1fr)]">
                    <div>
                      <p className={eyebrowDark}>{hasBid ? "Current bid" : lot.status === "open" ? "Opening bid" : "Starts at"}</p>
                      <p key={shownAmount} aria-live="polite" className="num display anim-bump mt-[0.4vw] text-[max(5.85rem,min(13vw,25vh))] leading-[0.85] text-[var(--t-text)]">
                        {money(shownAmount)}
                      </p>
                    </div>
                    <div className="pb-[0.8vw]">
                      <p className={eyebrowDark}>High bidder</p>
                      {leader ? (
                        <p key={leader.id} className="anim-rise mt-[0.4vw] text-[max(1.08rem,min(2.4vw,4.6vh))] leading-tight text-[var(--t-text)]">
                          <span className="num display mr-[0.6vw] text-[1.35em] text-clay-on-dark">{leader.number}</span>
                          {leader.name}
                          {leader.kind === "agent" && <span className="ml-[0.6vw] text-[0.55em] text-[#b9c2e0]">AI agent</span>}
                        </p>
                      ) : (
                        <p className="display mt-[0.4vw] text-[max(0.99rem,min(2.2vw,4.2vh))] italic text-[var(--t-muted)]">
                          {lot.status === "open" ? "Awaiting the first paddle" : "—"}
                        </p>
                      )}
                      {lot.status === "open" && (
                        <p className="mt-[0.5vw] text-[max(0.9rem,min(1.25vw,2.4vh))] text-[var(--t-muted)]">
                          Next bid <span className="num text-[var(--t-text)]">{money(Math.max(lot.startPrice, lot.highBid + lot.increment))}</span>
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-center">
              <div>
                <p className="display text-[max(1.8rem,min(4vw,7vh))] text-[var(--t-text)]">The room is being prepared.</p>
                <p className="mt-3 text-[max(0.9rem,min(1.3vw,2.4vh))] text-[var(--t-muted)]">Lots will appear here as the organizer adds them.</p>
              </div>
            </div>
          )}
        </section>

        {/* Right rail */}
        <aside className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-[1.2vw]">
          <section aria-label="Join the auction" className="flex items-center gap-[1.2vw] rounded-xl border border-[var(--t-line)] bg-[var(--t-panel)] p-[1vw]">
            <QrCode value={joinUrl} label="QR code linking to the bidder paddle page" className="h-[max(5rem,min(8vw,15vh))] w-[max(5rem,min(8vw,15vh))] shrink-0" />
            <div className="min-w-0">
              <p className="display text-[clamp(1.2rem,1.7vw,2.3rem)] leading-tight text-[var(--t-text)]">Raise a paddle</p>
              <p className="mt-1 text-[clamp(0.75rem,0.85vw,1.1rem)] text-[var(--t-muted)]">Scan to bid. PayPal holds, never charges, until you win.</p>
              <p className="mt-1 break-all font-mono text-[clamp(0.65rem,0.7vw,0.95rem)] text-[var(--t-muted)]/80">{joinUrl}</p>
            </div>
          </section>

          <section aria-label="Bid ticker" className="flex min-h-0 flex-col overflow-hidden">
            <h3 className={`${eyebrowDark} border-b border-[var(--t-line)] pb-[0.5vw]`}>The floor</h3>
            {ticker.length === 0 ? (
              <p className="display mt-[0.8vw] text-[clamp(1rem,1.3vw,1.7rem)] italic text-[var(--t-muted)]">Quiet, for now.</p>
            ) : (
              <ul className="min-h-0 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                {ticker.map((e, i) => (
                  <li
                    key={e.id}
                    className="anim-rise flex items-baseline justify-between gap-3 border-b border-[var(--t-line)]/60 py-[0.45vw]"
                    style={{ opacity: Math.max(0.35, 1 - i * 0.1) }}
                  >
                    <span className={`min-w-0 text-[clamp(0.8rem,0.95vw,1.3rem)] leading-snug ${eventTone[e.type]}`}>{e.text}</span>
                    <span className="num shrink-0 text-[clamp(0.65rem,0.7vw,0.95rem)] text-[var(--t-muted)]">{clock(e.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Paddle roster">
            <h3 className={`${eyebrowDark} border-b border-[var(--t-line)] pb-[0.5vw]`}>Paddles &amp; headroom</h3>
            {roster.length === 0 ? (
              <p className="mt-[0.8vw] text-[clamp(0.85rem,1vw,1.3rem)] text-[var(--t-muted)]">No paddles yet. Scan the code to join.</p>
            ) : (
              <ul className="mt-[0.4vw] space-y-[0.1vw]">
                {roster.slice(0, 5).map((p) => (
                  <RosterRow key={p.id} p={p} leading={lot?.status === "open" && lot.highPaddleId === p.id} />
                ))}
                {roster.length > 5 && <li className="px-[0.6vw] pt-[0.3vw] text-[clamp(0.75rem,0.85vw,1.1rem)] text-[var(--t-muted)]">+{roster.length - 5} more paddles</li>}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {/* Gus + money */}
      <div className="grid gap-[2vw] border-t border-[var(--t-line)] pt-[1.2vw] lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)]">
        <section aria-label={`${PERSONA}, the auctioneer`} className="flex min-w-0 items-center gap-[1.4vw]">
          <div className="shrink-0 text-center">
            <p className="display text-[clamp(1.1rem,1.4vw,1.9rem)] italic leading-none text-clay-on-dark">{PERSONA}</p>
            <div aria-hidden className="mx-auto mt-[0.4vw] flex h-[1.2vw] min-h-3 w-8 items-end justify-center gap-[3px]">
              {[0, 1, 2, 3].map((i) =>
                speech.speaking ? (
                  <span key={i} className="speak-bar h-full w-[3px] rounded bg-clay-on-dark" style={{ animationDelay: `${i * 0.12}s` }} />
                ) : (
                  <span key={i} className="h-[3px] w-[3px] rounded-full bg-[var(--t-line)]" />
                ),
              )}
            </div>
          </div>
          <div aria-hidden className="h-[max(5rem,min(4.5vw,8vh))] w-px shrink-0 bg-[var(--t-line)]" />
          <blockquote aria-live="polite" className="min-w-0 flex-1">
            <p key={state.caption.ts} className="anim-fade display line-clamp-2 text-[max(0.95rem,min(2.1vw,4vh))] italic leading-snug text-[var(--t-text)]">
              {state.caption.text ? <>&ldquo;{state.caption.text}&rdquo;</> : <span className="text-[var(--t-muted)]">{PERSONA} is clearing his throat&hellip;</span>}
            </p>
          </blockquote>
        </section>

        <section aria-label="Money ledger" className="grid grid-cols-4 divide-x divide-[var(--t-line)]">
          {ledger.map(([label, amount]) => (
            <div key={label} className="min-w-0 px-[0.8vw] first:pl-0">
              <p className={eyebrowDark}>{label}</p>
              <p className="num display mt-[0.3vw] truncate text-[clamp(1.2rem,2vw,2.8rem)] leading-none text-[var(--t-text)]">{money(amount)}</p>
            </div>
          ))}
        </section>
      </div>
      <NightInNumbersOverlay state={state} />
    </main>
  );
}
