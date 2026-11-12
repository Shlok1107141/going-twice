import { geminiFetch } from "./geminiKeys";
// Gemini vision: photo of a donated item -> structured guess. Server-only. Returns null on any
// failure; the caller decides what to do. The AI only describes; code prices (see fmv.ts).

export type Condition = "new" | "like-new" | "good" | "fair";

export type Recognized = {
  title: string;
  brand?: string;
  model?: string;
  category: string;
  condition: Condition;
  description: string;
  searchQuery: string;
};

const PROMPT =
  "You help a school PTA catalog items donated to a charity auction. Look at the photo and identify the single main item. " +
  'Reply with JSON only: {"title": short product name, "brand": string or null, "model": string or null, ' +
  '"category": one or two words, "condition": one of "new"|"like-new"|"good"|"fair" judged from the photo, ' +
  '"description": warm school-auction tone, at most 40 words, no prices, ' +
  '"searchQuery": the best retail search query to find this exact product new (brand + model + product type)}.';

const CONDITIONS: Condition[] = ["new", "like-new", "good", "fair"];

export function visionEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function clampWords(s: string, n: number): string {
  const w = s.trim().split(/\s+/);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ") + "…";
}

function parse(text: string): Recognized | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
    const title = s(o.title, 120);
    if (!title) return null;
    const condition = CONDITIONS.includes(o.condition as Condition) ? (o.condition as Condition) : "good";
    return {
      title,
      brand: s(o.brand, 60),
      model: s(o.model, 80),
      category: s(o.category, 40) ?? "item",
      condition,
      description: clampWords(s(o.description, 400) ?? title, 40),
      searchQuery: s(o.searchQuery, 160) ?? title,
    };
  } catch {
    return null;
  }
}

async function callModel(key: string, model: string, base64: string, mimeType: string): Promise<{ text?: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType, data: base64 } }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 1200,
          ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) return { status: res.status };
    const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return { status: 200, text: (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("") };
  } catch (e) {
    console.error("[vision]", (e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** gemini-2.5-flash first; free-tier quotas are per model, so fall through to newer flash models on 429/404. */
export async function recognizeItem(base64: string, mimeType: string): Promise<Recognized | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const primary = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";
  for (const model of [primary, "gemini-3.5-flash", "gemini-3.1-flash-lite"]) {
    const r = await callModel(key, model, base64, mimeType);
    if (r.text) {
      const out = parse(r.text);
      if (out) return out;
    } else console.error("[vision] HTTP", r.status, model);
  }
  return null;
}
