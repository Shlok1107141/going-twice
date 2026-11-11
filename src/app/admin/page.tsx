import { auction, currency, lots, moneyBoard, paddles } from "@/lib/mock";

const badge: Record<string, string> = {
  live: "bg-amber-100 text-amber-900",
  sold: "bg-emerald-100 text-emerald-900",
  upcoming: "bg-stone-200 text-stone-700",
  active: "bg-sky-100 text-sky-900",
  captured: "bg-emerald-100 text-emerald-900",
  voided: "bg-rose-100 text-rose-900",
};

export default function AdminPage() {
  const board = [
    ["Held", moneyBoard.held],
    ["Captured", moneyBoard.captured],
    ["Voided", moneyBoard.voided],
    ["Paid out", moneyBoard.paidOut],
  ] as const;
  return (
    <main className="mx-auto max-w-5xl bg-stone-50 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-3xl font-bold">{auction.name} &middot; Admin</h1>
        <div className="flex gap-3">
          <button className="rounded-lg bg-amber-600 px-5 py-2 font-bold text-white hover:bg-amber-700">Hammer lot</button>
          <button className="rounded-lg bg-stone-900 px-5 py-2 font-bold text-white hover:bg-stone-700">Close auction</button>
        </div>
      </header>

      <section className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {board.map(([label, v]) => (
          <div key={label} className="rounded-xl border border-stone-300 bg-white p-4">
            <p className="text-xs uppercase tracking-widest text-stone-500">{label}</p>
            <p className="text-3xl font-bold tabular-nums">{currency(v)}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 className="mb-3 font-bold">Lots</h2>
          <ul className="divide-y divide-stone-200">
            {lots.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-semibold">{l.id}. {l.title}</span>
                  <span className="block text-sm text-stone-500">
                    {currency(l.currentBid)}
                    {l.winnerPaddle ? ` · paddle ${l.winnerPaddle}` : ""}
                  </span>
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge[l.status]}`}>{l.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-stone-300 bg-white p-4">
          <h2 className="mb-3 font-bold">Paddles</h2>
          <ul className="divide-y divide-stone-200">
            {paddles.map((p) => (
              <li key={p.number} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-semibold">#{p.number} {p.name}</span>
                  <span className="block text-sm text-stone-500">Hold {currency(p.holdAmount)}</span>
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badge[p.status]}`}>{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
