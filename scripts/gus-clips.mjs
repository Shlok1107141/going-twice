// Lists every sentence Gus can say that is known in advance (fixed lines, the sample catalogues, the demo
// bidders, and a grid of money amounts). scripts/gus-clips.py then renders each one with Kokoro-82M
// (Apache-2.0) into public/gus/clips/, so the stage plays them instantly.
//
//   node scripts/gus-clips.mjs            -> scripts/out/gus-sentences.json
//   python scripts/gus-clips.py           -> public/gus/clips/*.mp3 + public/gus/clips.json
import { mkdirSync, writeFileSync } from "node:fs";
import { FIXED, FORMS, money } from "../src/lib/ai/gusLines.ts";
import { sentences } from "../src/lib/speech/spoken.ts";
import { AUCTION_TYPE_LIST, EVENT_DEFAULTS } from "../src/lib/auction/auctionTypes.ts";

const out = new Set();
const add = (text) => sentences(text).forEach((s) => out.add(s));

for (const list of Object.values(FIXED)) list.forEach(add);

// Money: every amount a sample catalogue can reach, plus a general grid.
const amounts = new Set();
for (let a = 5; a <= 1000; a += 5) amounts.add(a);
for (let a = 1025; a <= 5000; a += 25) amounts.add(a);
for (let a = 5050; a <= 10000; a += 50) amounts.add(a);
for (let a = 10250; a <= 25000; a += 250) amounts.add(a);
const openings = new Set();
for (let a = 5; a <= 500; a += 5) openings.add(a);
for (let a = 525; a <= 2000; a += 25) openings.add(a);

for (const cfg of AUCTION_TYPE_LIST) {
  cfg.lots.forEach((lot, i) => {
    add(FORMS.lotNo(i + 1));
    add(FORMS.title(lot.title));
    add(lot.description.split(/(?<=[.!?])\s+/)[0]);
    if (lot.consignor) add(FORMS.from(lot.consignor));
    openings.add(lot.startPrice);
    for (let k = 0; k <= 60; k++) amounts.add(lot.startPrice + k * lot.increment);
    if (lot.unit === "head" && lot.quantity > 1) for (let k = 0; k <= 30; k++) add(FORMS.perHead(money(Math.round((lot.startPrice + k * lot.increment) / lot.quantity))));
  });
}
for (let n = 1; n <= 12; n++) add(FORMS.lotNo(n));
for (const ev of Object.values(EVENT_DEFAULTS)) add(FORMS.welcome(ev.name));

for (const a of amounts) {
  add(FORMS.amount(money(a)));
  add(FORMS.ask(money(a)));
}
for (const a of openings) add(FORMS.opening(money(a)));

// The demo bidders (src/lib/ai/autopilot.ts DEFAULT_PERSONAS).
for (const name of ["Coach Mike", "Grandma Jo", "Dr. Patel"]) {
  add(FORMS.name(name));
  add(FORMS.thanks(name));
  add(FORMS.soldTo(name));
  add(FORMS.agent(name));
}

mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
writeFileSync(new URL("./out/gus-sentences.json", import.meta.url), JSON.stringify([...out], null, 0));
console.log(`${out.size} sentences`);
