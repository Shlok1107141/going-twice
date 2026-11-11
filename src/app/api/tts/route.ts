import { connection } from "next/server";
import { MAX_TTS_CHARS, synthesize } from "@/lib/ai/tts";

async function speak(raw: unknown): Promise<Response> {
  await connection();
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text || text.length > MAX_TTS_CHARS) return new Response("bad text", { status: 400 });
  try {
    const wav = await synthesize(text);
    return new Response(new Uint8Array(wav), {
      headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400, immutable" },
    });
  } catch {
    return new Response("tts unavailable", { status: 503 });
  }
}

export async function GET(req: Request) {
  return speak(new URL(req.url).searchParams.get("text"));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { text?: unknown };
  return speak(body.text);
}
