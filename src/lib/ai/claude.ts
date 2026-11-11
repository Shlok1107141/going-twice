// Minimal Anthropic Messages API client (fetch, no SDK). Returns null on any failure so
// callers always fall back to templates. Server-only.

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callGemini(
  key: string,
  args: { system: string; user: string; maxTokens?: number; timeoutMs?: number; fast?: boolean },
): Promise<string | null> {
  const model = args.fast
    ? process.env.GEMINI_FAST_MODEL || "gemini-2.5-flash-lite"
    : process.env.GEMINI_MODEL || "gemini-2.5-flash";
  if (!takeGeminiSlot()) {
    console.warn("[gemini] local rate limit reached; using fallback");
    return null;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(args.timeoutMs ?? 4000, 6000));
  try {
    const send = () =>
      fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: [{ role: "user", parts: [{ text: args.user }] }],
          generationConfig: {
            maxOutputTokens: Math.max(args.maxTokens ?? 80, 120),
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: ctrl.signal,
        cache: "no-store",
      });
    let res = await send();
    if (res.status === 429) {
      console.warn("[gemini] 429, retrying once");
      await sleep(1200);
      if (takeGeminiSlot()) res = await send();
    }
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
    const gKey = process.env.GEMINI_API_KEY;
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
