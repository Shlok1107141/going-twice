import { createHash } from "node:crypto";

/**
 * Gemini TTS for Gus. Returns a WAV buffer (PCM L16 24 kHz mono wrapped in a RIFF header).
 * Throws on any failure/timeout so the route can answer 503 and the client falls back to speechSynthesis.
 */
// Free tier is tiny (flash-tts: 10 requests/day). On 429 a model is benched for 10 min and the next one is tried.
const MODELS = [process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const benchedUntil = new Map<string, number>();
const VOICE = process.env.GEMINI_TTS_VOICE || "Fenrir";
const STYLE = "Say this as a fast, warm, charismatic charity auctioneer with big energy and a smile: ";
const TIMEOUT_MS = 5000;
const CACHE_MAX = 200;
export const MAX_TTS_CHARS = 300;

const cache = new Map<string, Buffer>();

export function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export async function synthesize(text: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no GEMINI_API_KEY");
  const hash = createHash("sha1").update(`${MODELS[0]}|${VOICE}|${text}`).digest("hex");
  const hit = cache.get(hash);
  if (hit) {
    cache.delete(hash);
    cache.set(hash, hit); // refresh LRU position
    return hit;
  }
  // The SSE streaming endpoint is ~2x faster end-to-end than plain generateContent (measured ~2.4 s vs 4-6 s),
  // so we use it and buffer the chunks server-side.
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  const chunks: Buffer[] = [];
  let lastStatus = 0;
  for (const model of MODELS) {
    if ((benchedUntil.get(model) ?? 0) > Date.now()) continue;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: STYLE + text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
      signal: deadline,
    });
    lastStatus = res.status;
    if (res.status === 429) {
      benchedUntil.set(model, Date.now() + 10 * 60_000);
      continue;
    }
    if (!res.ok) throw new Error(`gemini tts ${res.status}`);
    for (const line of (await res.text()).split(String.fromCharCode(10))) {
      if (!line.startsWith("data:")) continue;
      const j = JSON.parse(line.slice(5)) as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };
      for (const p of j.candidates?.[0]?.content?.parts ?? []) if (p.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, "base64"));
    }
    break;
  }
  if (!chunks.length) throw new Error(`gemini tts: no audio (${lastStatus})`);
  const wav = pcmToWav(Buffer.concat(chunks));
  cache.set(hash, wav);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return wav;
}
