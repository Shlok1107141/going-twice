import { connection } from "next/server";
import { MAX_TTS_CHARS, synthesize } from "@/lib/ai/tts";

async function speak(raw: unknown, gemini = false): Promise<Response> {
  await connection();
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > MAX_TTS_CHARS) return new Response("bad text", { status: 400 });
  try {
    const { body, type } = await synthesize(text, { gemini });
    return new Response(new Uint8Array(body), {
      headers: { "content-type": type, "cache-control": "public, max-age=86400, immutable" },
    });
  } catch {
    return new Response("tts unavailable", { status: 503 });
  }
}

// ?engine=gemini forces Gemini (used for comparison samples); default is edge neural -> Gemini.
export async function GET(req: Request) {
  const u = new URL(req.url);
  return speak(u.searchParams.get("text"), u.searchParams.get("engine") === "gemini");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  return speak(body.text);
}
