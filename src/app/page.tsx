import { SandboxBadge } from "@/components/SandboxBadge";
import { DemoRun } from "@/components/DemoRun";
import { StartRoom } from "@/components/StartRoom";
import { JoinRoom } from "@/components/JoinRoom";
import { Eyebrow } from "@/components/ui";
import { AUCTION_TYPE_LIST } from "@/lib/auction/auctionTypes";

const steps = [
  ["Raise a paddle", "A bidder scans the code on the screen and picks an amount. PayPal holds it. Nothing is charged."],
  ["Bid with one tap", "Gus, the AI auctioneer, calls the room. Every bid is checked against that bidder's hold."],
  ["The hammer falls", "Winners are charged exactly what they won. Every other hold is released in full."],
  ["Proceeds paid out", "The money goes to the organizer, and each winner gets a PayPal invoice as a receipt."],
];

function SpecimenCard() {
  return (
    <figure aria-label="Example of a live lot" className="relative mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-lift">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-muted">Lot 4 of 12</p>
          <span className="inline-flex items-center gap-2 rounded-full bg-clay-soft px-3 py-1 text-xs font-medium text-clay-ink">
            <span aria-hidden className="anim-breathe h-1.5 w-1.5 rounded-full bg-clay" />
            Going twice
          </span>
        </div>
        <p className="display mt-6 text-[34px] text-ink">Weekend at the lake cabin</p>
        <p className="mt-2 text-sm text-muted">Est. value $1,200 &middot; via Channel3</p>
        <div className="my-8 h-px bg-line" />
        <p className="eyebrow text-muted">Current bid</p>
        <p className="num display mt-2 text-7xl text-ink">$840</p>
        <div className="mt-6 flex items-center justify-between text-sm">
          <span className="text-ink-2">
            Paddle <span className="num font-medium text-ink">12</span> &middot; Dana R.
          </span>
          <span className="text-muted">$160 left on hold</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full w-[84%] rounded-full bg-ink" />
        </div>
      </div>
      <figcaption className="mt-4 text-center text-sm text-muted">Each paddle is a PayPal authorization hold.</figcaption>
    </figure>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pt-20 2xl:max-w-[88rem]">
        <div className="anim-rise">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>Live auctions, one-tap checkout</Eyebrow>
            <SandboxBadge />
          </div>
          <h1 className="display mt-6 text-[clamp(2.5rem,7vw,5.25rem)] text-ink">Live auctions where every paddle is a PayPal hold.</h1>
          <p className="mt-8 max-w-xl text-[clamp(1rem,1.4vw,1.2rem)] leading-relaxed text-ink-2">
            Going Twice turns any live auction into a one-tap checkout: every paddle is a PayPal authorization hold, an AI auctioneer runs the room, and the gavel settles everyone.
          </p>
          <ul aria-label="Auction types" className="mt-8 flex flex-wrap gap-2">
            {AUCTION_TYPE_LIST.map((t) => (
              <li key={t.type} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink-2">
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </li>
            ))}
          </ul>
        </div>
        <SpecimenCard />
      </section>

      <section aria-labelledby="start-h" className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6 2xl:max-w-[88rem]">
        <h2 id="start-h" className="sr-only">
          Get started
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col rounded-2xl border border-clay/40 bg-surface p-7 shadow-soft sm:p-9">
            <p className="eyebrow text-clay-ink">See how it works</p>
            <h3 className="display mt-2 text-3xl text-ink sm:text-4xl">Watch a demo auction</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              The blueprint, running. Three AI bidders with real PayPal sandbox holds, Gus calling the lots out loud, and beside them each bidder&apos;s decision and every PayPal call as it lands. About four minutes, and it settles itself. No sign-in.
            </p>
            <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
              <li>&middot; Gemini deciding, code enforcing the limits</li>
              <li>&middot; Holds, captures, releases, payout and receipts, with PayPal ids</li>
              <li>&middot; The report (AG Studio) and the hold timeline (Bryntum) at the end</li>
            </ul>
            <div className="mt-auto pt-7">
              <DemoRun />
            </div>
          </div>
          <div id="own" className="flex scroll-mt-24 flex-col rounded-2xl border border-line bg-surface p-7 shadow-soft sm:p-9">
            <p className="eyebrow text-clay-ink">Use it for real</p>
            <h3 className="display mt-2 text-3xl text-ink sm:text-4xl">Run your own auction</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
              Host one: you get a room code, your own event and lots, a stage for the big screen and a host page that settles everything with one button. Or join one someone else is hosting.
            </p>
            <div className="mt-6">
              <StartRoom />
            </div>
            <div className="mt-7 border-t border-line pt-6">
              <JoinRoom />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-h" className="border-y border-line bg-surface/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 2xl:max-w-[88rem]">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-h" className="display mt-3 max-w-2xl text-4xl text-ink sm:text-5xl">
            Four moments, one tap each.
          </h2>
          <ol className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([title, text], i) => (
              <li key={title} className="border-t border-ink pt-6">
                <span className="num display text-2xl text-clay-ink">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="display mt-3 text-2xl text-ink">{title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12 text-sm text-muted sm:px-6 2xl:max-w-[88rem]">
        <p>Going Twice</p>
        <a className="hover:text-ink hover:underline hover:underline-offset-4" href="https://github.com/Shlok1107141/going-twice">
          Source on GitHub
        </a>
      </footer>
    </main>
  );
}
