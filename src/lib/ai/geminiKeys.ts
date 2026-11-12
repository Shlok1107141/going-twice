// Gemini free-tier quotas are tiny and per project + per model. Spreading calls across several free
// keys (each created in its own Google project) multiplies the quota. `geminiFetch` is a drop-in for
// fetch on generativelanguage.googleapis.com URLs: it sets the key header itself, rotates keys, and
// benches a key for a given model for 10 minutes after a 429. Server-only.

import { takeGeminiFailure } from "@/lib/auction/testHooks";

const BENCH_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __gtGemini?: { next: number; benched: Map<string, number> } };
const st = (g.__gtGemini ??= { next: 0, benched: new Map() });

/** Primary GEMINI_API_KEY plus optional comma-separated GEMINI_API_KEYS, de-duplicated. */
export function geminiKeys(): string[] {
  const all = [process.env.GEMINI_API_KEY ?? "", ...(process.env.GEMINI_API_KEYS ?? "").split(",")]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

/** First configured key (GEMINI_API_KEY, else the first of GEMINI_API_KEYS); "" when none. */
export function geminiKey(): string {
  return geminiKeys()[0] ?? "";
}

function modelOf(url: string): string {
  return /\/models\/([^:/?]+)/.exec(url)?.[1] ?? "?";
}

export async function geminiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const simulated = takeGeminiFailure(); // break tests: pretend every key is rate-limited
  if (simulated) return Response.json({ error: { code: simulated, message: "Resource exhausted (simulated by test hook)" } }, { status: simulated });
  const keys = geminiKeys();
  if (keys.length === 0) return fetch(url, init);
  const model = modelOf(url);
  const now = Date.now();
  const order = keys.map((_, i) => keys[(st.next + i) % keys.length]);
  st.next = (st.next + 1) % keys.length;
  const ready = order.filter((k) => (st.benched.get(`${k}|${model}`) ?? 0) <= now);
  // Every key is out of quota for this model: answer 429 at once so the caller moves on to its next model.
  if (!ready.length) return Response.json({ error: { code: 429, message: "All keys are rate-limited for this model" } }, { status: 429 });
  const tryKeys = ready;
  let last: Response | null = null;
  for (const key of tryKeys) {
    const headers = new Headers(init.headers);
    headers.set("x-goog-api-key", key);
    last = await fetch(url, { ...init, headers });
    if (last.status !== 429) return last;
    st.benched.set(`${key}|${model}`, Date.now() + BENCH_MS);
    console.warn(`[gemini] 429 on ${model} for key #${keys.indexOf(key) + 1}/${keys.length}; rotating`);
  }
  return last as Response;
}
