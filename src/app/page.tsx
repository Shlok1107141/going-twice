import Link from "next/link";

const screens = [
  { href: "/stage", title: "Stage", blurb: "Big-screen view for the room." },
  { href: "/paddle", title: "Paddle", blurb: "Bidder's phone: bid with one tap." },
  { href: "/admin", title: "Admin", blurb: "Organizer controls and money board." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-700">Charity auction house</p>
      <h1 className="mt-2 font-serif text-6xl font-bold text-stone-900">Going Twice</h1>
      <p className="mt-4 text-xl text-stone-700">
        An AI auctioneer for school charity auctions, where every bidder&apos;s paddle is a PayPal authorization hold.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {screens.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-xl border border-stone-300 bg-white p-5 shadow-sm transition hover:border-amber-600 hover:shadow">
            <h2 className="text-lg font-bold">{s.title} &rarr;</h2>
            <p className="mt-1 text-sm text-stone-600">{s.blurb}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
