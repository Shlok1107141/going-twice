// Turns a caption into the exact sentences Gus speaks. Shared by the browser (to look up a pre-rendered
// Kokoro clip, or to synthesise one) and by scripts/gus-clips.mjs (to decide which clips to render), so
// the two always agree on the text. Pure: no imports.

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const rest = r < 20 ? (r ? ONES[r] : "") : TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : "");
  return [h ? `${ONES[h]} hundred` : "", rest].filter(Boolean).join(" ");
}

/** 0..999,999 in words: 140 -> "one hundred forty", 14250 -> "fourteen thousand two hundred fifty". */
export function words(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  if (n > 999_999) return String(n);
  const th = Math.floor(n / 1000);
  return [th ? `${under1000(th)} thousand` : "", under1000(n % 1000)].filter(Boolean).join(" ");
}

/** Caption text -> text to speak: money and numbers in words, titles expanded, emoji dropped. */
export function spoken(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}|️/gu, "")
    .replace(/\bDr\.(?=\s)/g, "Doctor")
    .replace(/\bMr\.(?=\s)/g, "Mister")
    .replace(/\bMrs\.(?=\s)/g, "Missus")
    .replace(/\bMs\.(?=\s)/g, "Miz")
    .replace(/\$\s?(\d[\d,]*)(?:\.(\d{2}))?/g, (_m, d: string, c?: string) => {
      const n = Number(d.replace(/,/g, ""));
      const cents = c ? Number(c) : 0;
      return cents ? `${words(n)} dollars and ${words(cents)} cents` : `${words(n)} dollars`;
    })
    .replace(/#(\d+)/g, (_m, d: string) => `number ${words(Number(d))}`)
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sentences of a caption, each one a separate clip. */
export function sentences(text: string): string[] {
  return spoken(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[a-z0-9]/i.test(s))
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .map((s) => s.slice(0, 240));
}
