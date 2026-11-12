import { geminiFetch, geminiKey } from "./geminiKeys";
// Minimal Anthropic Messages API client (fetch, no SDK). Returns null on any failure so
// callers always fall back to templates. Server-only.

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || geminiKey());
}

// Free-tier fallback when no Anthropic key is configured (Google AI Studio key, no card).
const rl = globalThis as unknown as { __gtGeminiCalls?: number[] };

/** Tiny global limiter: at most MAX_CALLS_PER_MIN Gemini calls per rolling minute, else callers fall back. */
const MAX_CALLS_PER_MIN = 12;
function takeGeminiSlot(): boolean {
  const now = Date.now();
  const calls = (rl.__gtGeminiCalls = (rl.__gtGeminiCalls ?? []).filter((t) => now - t < 60_000));
  if (calls.length >= MAX_CALLS_PER_MIN) return false;
  calls.push(now);
  return true;
}

/** Models that answered 404 for this deployment's key(s); skipped for the life of the process. */
const deadModels: Set<string> = ((globalThis as unknown as { __gtDeadModels?: Set<string> }).__gtDeadModels ??= new Set());

async function callGemini(
  key: string,
  args: { system: string; user: string; maxTokens?: number; timeoutMs?: number; fast?: boolean },
): Promise<string | null> {
  // Free-tier availability differs per key and model, and quotas are per model: walk a chain and move on
  // immediately on 404 (model not available to this key, remembered) or 429 (quota spent).
  const chain = [
    ...(args.fast ? [process.env.GEMINI_FAST_MODEL] : [process.env.GEMINI_MODEL]),
    ...(args.fast
      ? ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash"]
      : ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]),
  ].filter((m, i, a): m is string => !!m && a.indexOf(m) === i && !deadModels.has(m));
  if (!takeGeminiSlot()) {
    console.warn("[gemini] local rate limit reached; using fallback");
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(args.timeoutMs ?? 4000, 6000));
  let model = chain[0] ?? "gemini-2.5-flash";
  try {
    // The first-choice model must not use up the whole budget when it hangs: it gets 3.5 s, then the next one is tried.
    const send = async (first: boolean): Promise<Response> => {
      const slow = first ? AbortSignal.timeout(3500) : null;
      const signal = slow ? AbortSignal.any([ctrl.signal, slow]) : ctrl.signal;
      try {
        const res = await sendOnce(signal, true);
        // Some models reject thinkingBudget 0: ask again with their default.
        return res.status === 400 ? await sendOnce(signal, false) : res;
      } catch (e) {
        if (slow?.aborted && !ctrl.signal.aborted) return Response.json({ error: { message: "attempt timed out" } }, { status: 503 });
        throw e;
      }
    };
    const sendOnce = (signal: AbortSignal, noThinking: boolean) =>
      geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: [{ role: "user", parts: [{ text: args.user }] }],
          generationConfig: {
            // A model that thinks by default spends output tokens on it, so leave room when thinking stays on.
            maxOutputTokens: Math.max(args.maxTokens ?? 80, 120) + (noThinking ? 0 : 600),
            ...(noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal,
        cache: "no-store",
      });
    let res = await send(chain.length > 1);
    for (let k = 1; (res.status === 404 || res.status === 429 || res.status === 503) && k < chain.length; k++) {
      if (res.status === 404) deadModels.add(model);
      model = chain[k];
      res = await send(false);
    }
    if (res.status === 404) deadModels.add(model);
    if (!res.ok) {
      console.error("[gemini] HTTP", res.status);
      return null;
    }
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return null;
    console.log(`[ai] provider=gemini model=${model} ok`);
    if (text.includes("{")) return text; // JSON reply: leave as is
    // Plain text: drop markdown emphasis/headings. Callers that need one line (Gus) take the
    // first non-empty line themselves; receipts keep every line.
    const clean = text
      .split("\n")
      .map((l) => l.replace(/[*_`]/g, "").replace(/^#+\s*/, "").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^["“]|["”]$/g, "")
      .trim();
    return clean || null;
  } catch (e) {
    console.error("[gemini]", (e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || process.env.AUCTIONEER_MODEL || "claude-sonnet-5-5";
}

export async function callClaude(args: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Short auctioneer lines: use GEMINI_FAST_MODEL (default gemini-2.5-flash-lite) on the Gemini path. */
  fast?: boolean;
}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    const gKey = geminiKey();
    return gKey ? callGemini(gKey, args) : null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 4000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: claudeModel(),
        max_tokens: args.maxTokens ?? 80,
        system: args.system,
        messages: [{ role: "user", content: args.user }],
      }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[claude] HTTP", res.status);
      return null;
    }
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (text) console.log(`[ai] provider=anthropic model=${claudeModel()} ok`);
    return text || null;
  } catch (e) {
    console.error("[claude]", (e as Error).name === "AbortError" ? "timeout" : (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the first {...} JSON object out of a model reply. */
export function extractJson<T>(text: string | null): T | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}
