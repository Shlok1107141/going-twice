import Link from "next/link";
import { JoinRoom } from "@/components/JoinRoom";
import { StartRoom } from "@/components/StartRoom";

export const metadata = { title: "Join an auction | Going Twice" };

export default function JoinPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-16 pt-12 sm:px-6">
      <p className="eyebrow text-clay-ink">Join auction</p>
      <h1 className="display mt-2 text-4xl text-ink">Join an auction</h1>
      <p className="mt-3 leading-relaxed text-ink-2">Type the room code from the host, or scan the QR code on the auction screen.</p>
      <div className="mt-8 rounded-xl border border-line bg-surface p-6 shadow-soft">
        <JoinRoom />
      </div>
      <p className="mt-6 text-sm text-ink-2">
        New to bidding with PayPal?{" "}
        <Link className="underline underline-offset-4" href="/paypal">
          How to set up PayPal or a card
        </Link>
      </p>
      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-4 text-sm text-muted">Running the auction yourself?</p>
        <StartRoom />
      </div>
    </main>
  );
}
