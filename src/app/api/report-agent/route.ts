// Server side of the Gala Report agent: a thin, key-holding proxy from the Studio Agent Framework's
// adapter (src/components/report/gemini-adapter.ts) to Google Gemini generateContent.
// The browser sends the Gemini request body; this route adds the key and pins the model.

import { connection } from "next/server";

const MODEL = () => process.env.GEMINI_REPORT_MODEL || "gemini-2.5-flash";
// The free tier has a small per-model daily quota, so a 429 falls through to the next model.
const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite"];
const err = (status: number, message: string) => Response.json({ error: { message } }, { status });

/** The page asks whether the agent is configured so it can explain itself instead of failing. */
export async function GET() {
  await connection();
  return Response.json({ configured: !!process.env.GEMINI_API_KEY, model: MODEL() });
}

export async function POST(req: Request) {
  await connection();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return err(503, "The report agent needs GEMINI_API_KEY on the server.");

  let body: unknown;
  try {
    body = ((await req.json()) as { body?: unknown }).body;
  } catch {
    return err(400, "Invalid JSON.");
  }
  if (!body || typeof body !== "object") return err(400, "Missing request body.");

  const models = [MODEL(), ...FALLBACK_MODELS.filter((m) => m !== MODEL())];
  let last = "Gemini request failed.";
  let status = 502;
  for (const model of models) {
    const payload = structuredClone(body) as { generationConfig?: Record<string, unknown> };
    // thinkingBudget is the Gemini 2.5 knob; later models use their own defaults.
    if (!model.includes("2.5") && payload.generationConfig) delete payload.generationConfig.thinkingConfig;
    // thoughtSignature is for Gemini 3 function calling; 2.5 does not use it.
    if (model.includes("2.5")) {
      for (const c of (payload as { contents?: { parts?: Record<string, unknown>[] }[] }).contents ?? [])
        for (const part of c.parts ?? []) delete part.thoughtSignature;
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(50_000),
        });
        const text = await res.text();
        if (res.ok) return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
        let message = `Gemini returned HTTP ${res.status}.`;
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* keep default */
        }
        last = message;
        status = res.status === 400 ? 400 : 502;
        console.error("[report-agent]", model, "HTTP", res.status, message.slice(0, 200));
        if (res.status === 429 || res.status === 404) break; // next model
        if (res.status < 500) return err(status, message);
      } catch (e) {
        last = (e as Error).name === "TimeoutError" ? "Gemini timed out." : (e as Error).message;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return err(status, last);
}
