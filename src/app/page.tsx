import Link from "next/link";
import { SandboxBadge } from "@/components/SandboxBadge";
import { StartRoom } from "@/components/StartRoom";
import { Eyebrow } from "@/components/ui";
import { AUCTION_TYPE_LIST } from "@/lib/auction/auctionTypes";

const steps = [
  ["Raise a paddle", "Scan the code on the screen. Pick a hold amount, and PayPal reserves it. Nothing is charged."],
  ["Bid with one tap", "Gus, the AI auctioneer, calls the room. Every bid is backed by real, held funds."],
  ["The hammer falls", "Winners are captured for exactly what they won. Every other hold is released."],
  ["Proceeds paid out", "Money goes to the organizer with a receipt for each winner. No checkout line."],
];

const footer = [
  ["/stage", "Stage"],
  ["/paddle", "Paddle"],
  ["/admin", "Admin"],
  ["/report", "Report"],
  ["/timeline", "Timeline"],
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
        <p className="display mt-6 text-[34px] text-ink">Weekend at the lake house</p>
        <p className="mt-2 text-sm text-muted">Est. value $1,200 &middot; via Channel3</p>
        <div className="my-8 h-px bg-line" />
        <p className="eyebrow text-muted">Current bid</p>
        <p className="num display mt-2 text-7xl text-ink">$840</p>
        <div className="mt-6 flex items-center justify-between text-sm">
          <span className="text-ink-2">
            Paddle <span className="num font-medium text-ink">12</span> &middot; Dana R.
          </span>
          <span className="text-muted">$160 headroom</span>
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
      <section className="mx-auto grid w-full max-w-6xl items-center gap-16 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
        <div className="anim-rise">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>An AI auction house</Eyebrow>
            <SandboxBadge />
          </div>
          <h1 className="display mt-6 text-[52px] text-ink sm:text-7xl lg:text-[84px]">
            The gavel is
            <br />
            the checkout.
          </h1>
          <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
            Every bidder&apos;s paddle is a PayPal authorization hold, so bids are backed by real funds and nobody is
            charged until the hammer falls.
          </p>
          <p className="display mt-6 max-w-xl text-2xl italic text-clay-ink">
            Built for the school gala. Works for any live auction &mdash; in the room or online.
          </p>
          <ul aria-label="Auction types" className="mt-8 flex flex-wrap gap-2">
            {AUCTION_TYPE_LIST.map((t) => (
              <li key={t.type} className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-ink-2">
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </li>
            ))}
          </ul>
          <div className="mt-10">
            <StartRoom />
          </div>
        </div>
        <SpecimenCard />
      </section>

      <section aria-labelledby="how-h" className="border-y border-line bg-surface/60">
        <div className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6">
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

      <footer className="mx-auto mt-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12 text-sm text-muted sm:px-6">
        <p>Going Twice &middot; PayPal sandbox demo</p>
        <nav aria-label="Screens">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {footer.map(([href, label]) => (
              <li key={href}>
                <Link href={href} className="hover:text-ink hover:underline hover:underline-offset-4">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </main>
  );
}
