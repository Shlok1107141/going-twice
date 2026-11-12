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

// C0/C1 controls, zero-width and bidi-override characters (a name like "‮evil" can flip the stage text).
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** Display text from users (names, titles): invisible/control characters removed, whitespace collapsed.
 *  HTML is NOT escaped here: it is stored as plain text and the UI renders it as text (React escapes). */
export function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  return str(v.replace(INVISIBLE, "").replace(/\s+/g, " "), max);
}
