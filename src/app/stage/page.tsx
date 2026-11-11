import { auction, bidTicker, currency, lots } from "@/lib/mock";

export default function StagePage() {
  const lot = lots.find((l) => l.status === "live")!;
  return (
    <main className="min-h-screen bg-stone-50 p-10">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl font-bold">{auction.name}</h1>
        <span className="text-sm uppercase tracking-widest text-stone-500">Lot {lot.id} of {lots.length}</span>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <section className="rounded-2xl border border-stone-300 bg-white p-10 shadow lg:col-span-2">
          <p className="text-sm uppercase tracking-widest text-amber-700">Now bidding</p>
          <h2 className="mt-2 font-serif text-6xl font-bold">{lot.title}</h2>
          <p className="mt-2 text-xl text-stone-600">Donated by {lot.donor}</p>
          <p className="mt-10 text-sm uppercase tracking-widest text-stone-500">Current bid</p>
          <p className="text-9xl font-black tabular-nums">{currency(lot.currentBid)}</p>
          <div className="mt-8 rounded-xl bg-amber-100 px-6 py-5 text-center text-4xl font-black uppercase tracking-wide text-amber-900">
            Going once&hellip;
          </div>
          <p className="mt-6 rounded-xl bg-stone-900 p-5 text-2xl italic text-stone-100">
            &ldquo;Three-fifty to paddle 23! Do I hear three seventy-five?&rdquo;
          </p>
        </section>

        <aside className="rounded-2xl border border-stone-300 bg-white p-6 shadow">
          <h3 className="text-sm font-semibold uppercase tracking-widest text-stone-500">Bidder ticker</h3>
          <ul className="mt-4 divide-y divide-stone-200">
            {bidTicker.map((b, i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <span className="text-lg font-semibold">Paddle {b.paddle}</span>
                <span className="text-right">
                  <span className="block text-xl font-bold tabular-nums">{currency(b.amount)}</span>
                  <span className="text-xs text-stone-500">{b.ago}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
