// Small helpers for route handlers: JSON body parsing and safe error responses (no stack traces).
import { EngineError } from "./engine";

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
}

/** Map thrown errors to JSON. EngineError messages are safe to show; anything else is generic. */
export function fail(e: unknown): Response {
  if (e instanceof EngineError) return bad(e.message, e.status);
  const name = (e as { name?: string })?.name;
  console.error("[api]", e instanceof Error ? e.message : e);
  if (name === "PayPalError") {
    const issue = (e as { issue?: string; paypalName?: string }).issue ?? (e as { paypalName?: string }).paypalName;
    return bad(`PayPal error${issue ? `: ${issue}` : ""}`, 502);
  }
  return bad("Something went wrong", 500);
}
