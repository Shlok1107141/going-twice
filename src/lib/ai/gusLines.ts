// Gus's line bank. Every line is built from SHORT sentences, because each sentence is one audio clip:
// fixed sentences and the common money amounts are pre-rendered with Kokoro (scripts/gus-clips.mjs), so
// a bid is answered instantly; anything else (a custom name or lot) is voiced by the same Kokoro voice
// in the browser. Pure data: no imports, so the clip generator can read it too.

/** Sentences with no placeholders. All of them are pre-rendered. */
export const FIXED = {
  bidLead: ["A new high bid.", "Thank you.", "The bid is up.", "Now we're moving."],
  stall: [
    "Any advance?",
    "Who'll give me one more?",
    "I'm in no hurry. Take your time.",
    "Still time to get in.",
    "One more bid could take it.",
    "Are we all done?",
    "Don't let it slip away.",
    "It's a fair price, and it's not sold yet.",
  ],
  goingOnce: ["Going once."],
  goingTwice: ["Going twice.", "Going twice. Fair warning.", "Going twice. Last chance."],
  sold: ["Sold!"],
  unsold: ["No bids. We'll pass this lot.", "No takers. This one goes back."],
  premium: ["Plus buyer's premium."],
  welcome: ["Raise a paddle to join."],
  close: [
    "That's the auction. Thank you all.",
    "Winners are charged exactly what they won.",
    "Every other hold is released.",
    "The proceeds are on their way.",
  ],
  ready: ["Gus here. Sound is on."],
} as const;

/** Sentences with one placeholder; the generator fills them for the names and amounts it knows. */
export const FORMS = {
  amount: (money: string) => `${money}!`,
  ask: (money: string) => `Do I hear ${money}?`,
  opening: (money: string) => `Opening at ${money}.`,
  name: (name: string) => `${name}.`,
  thanks: (name: string) => `Thank you, ${name}.`,
  soldTo: (name: string) => `Sold, to ${name}!`,
  agent: (name: string) => `From the AI agent bidding for ${name}.`,
  lotNo: (n: number) => `Lot ${n}.`,
  title: (title: string) => `${title.replace(/[.!?]+$/, "")}.`,
  from: (consignor: string) => `From ${consignor}.`,
  welcome: (event: string) => `Welcome to ${event}.`,
  perHead: (money: string) => `That's ${money} a head.`,
} as const;

export function money(n: number | undefined): string {
  if (n === undefined) return "";
  return Number.isInteger(n) ? `$${n.toLocaleString("en-US")}` : `$${n.toFixed(2)}`;
}
