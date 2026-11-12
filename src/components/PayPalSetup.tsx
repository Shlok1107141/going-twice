import Link from "next/link";
import { DemoRun } from "@/components/DemoRun";
import { panel } from "@/components/ui";

const steps: [string, string][] = [
  ["Join the auction", "Open Join auction and type the room code from the host, or scan the QR code on the auction screen."],
  ["Pick your limit", "Enter your name and choose a hold amount, for example $250. That amount is the most you can win in total tonight."],
  ["Approve the hold with PayPal", "Press Continue with PayPal. Log in to PayPal, or choose Debit or Credit Card to pay by card without an account. PayPal reserves the amount. Nothing is charged."],
  ["Bid with one tap", "Your paddle is live. Each bid is checked against your hold, so you can never be charged more than you approved."],
  ["When the auction closes", "If you won, PayPal charges exactly what you won and releases the rest of your hold. If you won nothing, the whole hold is released. Winners get a PayPal receipt by email."],
];

/** The PayPal page outside an auction room: how a bidder sets up PayPal or a card. */
export function PayPalSetup() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-10 px-4 pb-24 pt-10 sm:px-6">
      <header className="border-b border-line pb-6">
        <p className="eyebrow text-clay-ink">PayPal</p>
        <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">Set up PayPal or a card to bid</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-2">
          Going Twice never stores your card. When you pick up a paddle, PayPal places a hold for the amount you choose. You are charged only for what you win, at the end of the auction.
        </p>
      </header>

      <ol className="space-y-4">
        {steps.map(([title, text], i) => (
          <li key={title} className={`${panel} flex gap-5`}>
            <span className="num display text-3xl text-clay-ink">{i + 1}</span>
            <div>
              <h2 className="display text-2xl text-ink">{title}</h2>
              <p className="mt-1 leading-relaxed text-ink-2">{text}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className={panel} aria-labelledby="sandbox-h">
        <h2 id="sandbox-h" className="display text-2xl text-ink">
          Trying it in the sandbox
        </h2>
        <p className="mt-2 leading-relaxed text-ink-2">This app runs on the PayPal sandbox, so no real money moves. Three ways to place a hold:</p>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-ink-2">
          <li>
            <span className="font-medium text-ink">Fastest:</span> on the Bid page press <span className="font-medium">Use a sandbox test card</span>. No login, no card details.
          </li>
          <li>
            <span className="font-medium text-ink">Card:</span> press Continue with PayPal, choose Debit or Credit Card, and enter a test card from PayPal&apos;s{" "}
            <a className="underline underline-offset-4" href="https://developer.paypal.com/tools/sandbox/card-testing/" target="_blank" rel="noreferrer">
              card generator
            </a>
            .
          </li>
          <li>
            <span className="font-medium text-ink">PayPal account:</span> log in with a sandbox personal account from the PayPal Developer Dashboard. Your real PayPal login does not work in the sandbox.
          </li>
        </ul>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Link href="/join" className="inline-flex items-center gap-2 rounded-md bg-ink px-6 py-3.5 text-base font-medium text-canvas transition-colors hover:bg-ink-2">
          Join an auction <span aria-hidden>&rarr;</span>
        </Link>
        <DemoRun label="Or watch the demo first" />
      </div>
    </main>
  );
}
