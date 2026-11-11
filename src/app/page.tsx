import Link from "next/link";
import { SandboxBadge } from "@/components/SandboxBadge";
import { StartRoom } from "@/components/StartRoom";

const screens = [
  { href: "/stage", title: "Stage", emoji: "\u{1F3AD}", blurb: "The big screen for the room: lot, bids, Gus the auctioneer, and a QR code to join." },
  { href: "/paddle", title: "Paddle", emoji: "\u{1F4F1}", blurb: "A bidder's phone: get a paddle, authorize a hold, and bid with one giant button." },
  { href: "/admin", title: "Admin", emoji: "\u{1F9FE}", blurb: "Organizer controls: start lots, hammer, close, and watch every dollar." },
];

const steps = [
  ["Get a paddle", "Scan the QR code and pick a hold amount."],
  ["Hold, don't pay", "PayPal authorizes the hold. Nothing is charged yet."],
  ["Bid live", "Gus calls the room while you tap one button."],
  ["Win and capture", "At close, winners are charged once; every other hold is released."],
  ["Paid out", "Proceeds go to the school treasurer, with a receipt for each winner."],
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-12 px-6 py-14">
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-amber-800">Charity auction house</p>
          <SandboxBadge />
        </div>
        <h1 className="mt-3 font-serif text-6xl font-black leading-none text-stone-900 sm:text-8xl">Going Twice</h1>
        <p className="mt-5 max-w-2xl text-xl text-stone-700 sm:text-2xl">
          An AI auctioneer for school charity auctions. Every bidder&apos;s paddle is a PayPal authorization hold, so bids are backed by real funds and nobody is charged until the hammer falls.
        </p>
        <div className="mt-6">
          <StartRoom />
        </div>
      </section>

      <nav aria-label="Screens" className="grid gap-4 sm:grid-cols-3">
        {screens.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-2xl border-2 border-stone-300 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-amber-600 hover:shadow-lg"
          >
            <p aria-hidden className="text-4xl">{s.emoji}</p>
            <h2 className="mt-3 font-serif text-3xl font-black text-stone-900">
              {s.title} <span className="inline-block transition group-hover:translate-x-1">&rarr;</span>
            </h2>
            <p className="mt-2 text-stone-700">{s.blurb}</p>
          </Link>
        ))}
      </nav>

      <section aria-labelledby="how-h">
        <h2 id="how-h" className="text-sm font-bold uppercase tracking-[0.3em] text-stone-600">How it works</h2>
        <ol className="mt-4 grid gap-3 sm:grid-cols-5">
          {steps.map(([title, text], i) => (
            <li key={title} className="rounded-xl border border-stone-300 bg-white/80 p-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-900 font-black text-amber-300">{i + 1}</span>
              <h3 className="mt-2 font-bold text-stone-900">{title}</h3>
              <p className="mt-1 text-sm text-stone-700">{text}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
