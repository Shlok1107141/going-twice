// Minimal Anthropic Messages API client (fetch, no SDK). Returns null on any failure so
// callers always fall back to templates. Server-only.

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel(): string {
  return process.env.ANTHROPIC_MODEL || process.env.AUCTIONEER_MODEL || "claude-sonnet-5-5";
}

export async function callClaude(args: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
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
