import { auction, currency, lots, paddles } from "@/lib/mock";

export default function PaddlePage() {
  const paddle = paddles[0];
  const lot = lots.find((l) => l.status === "live")!;
  const next = lot.currentBid + auction.increment;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-5 bg-stone-50 p-5">
      <header className="text-center">
        <p className="text-xs uppercase tracking-widest text-stone-500">Your paddle</p>
        <p className="font-serif text-8xl font-black">{paddle.number}</p>
        <p className="text-stone-600">{paddle.name}</p>
      </header>

      <section className="rounded-xl border border-stone-300 bg-white p-4 text-center">
        <p className="text-xs uppercase tracking-widest text-stone-500">PayPal hold</p>
        <p className="text-3xl font-bold">{currency(paddle.holdAmount)}</p>
        <p className="text-sm text-stone-500">Authorized, not charged unless you win</p>
      </section>

      <section className="rounded-xl border border-stone-300 bg-white p-4">
        <p className="text-xs uppercase tracking-widest text-amber-700">Lot {lot.id}</p>
        <p className="text-xl font-bold">{lot.title}</p>
        <p className="text-stone-600">Current bid {currency(lot.currentBid)}</p>
      </section>

      <button className="rounded-2xl bg-amber-600 py-8 text-3xl font-black uppercase text-white shadow-lg active:bg-amber-700">
        Bid {currency(next)}
      </button>

      <p className="rounded-lg bg-rose-100 p-3 text-center font-semibold text-rose-900">
        Outbid. Paddle 23 leads at {currency(lot.currentBid)}.
      </p>
    </main>
  );
}
