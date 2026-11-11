import { createHash } from "node:crypto";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/**
 * TTS for Gus. Order: Edge neural voice (free, unlimited, mp3) -> Gemini TTS (WAV, tiny free quota) -> throw.
 * Throwing makes the route answer 503 so the client falls back to browser speechSynthesis.
 */
export type Audio = { body: Buffer; type: string };

const EDGE_VOICE = process.env.GUS_VOICE || "en-US-AndrewMultilingualNeural";
const EDGE_RATE = process.env.GUS_RATE || "+12%";
const EDGE_PITCH = process.env.GUS_PITCH || "+4%";
// Gemini free tier is tiny (flash-tts: 10 requests/day). On 429 a model is benched for 10 min and the next is tried.
const MODELS = [process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];
const benchedUntil = new Map<string, number>();
const VOICE = process.env.GEMINI_TTS_VOICE || "Fenrir";
const STYLE = "Say this as a fast, warm, charismatic charity auctioneer with big energy and a smile: ";
const TIMEOUT_MS = 5000;
const CACHE_MAX = 200;
export const MAX_TTS_CHARS = 300;

const cache = new Map<string, Audio>();

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

async function edgeOnce(text: string, ms: number): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const run = (async () => {
      await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text, { rate: EDGE_RATE, pitch: EDGE_PITCH });
      const chunks: Buffer[] = [];
      for await (const c of audioStream) chunks.push(c as Buffer);
      const buf = Buffer.concat(chunks);
      if (!buf.length) throw new Error("edge tts: no audio");
      return buf;
    })();
    run.catch(() => {});
    return await Promise.race([run, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("edge tts timeout")), ms)))]);
  } finally {
    clearTimeout(timer);
    tts.close();
  }
}

// The Edge endpoint answers in ~0.6 s when healthy but connections stall or truncate now and then (measured ~40% from
// one network). So hedge: start a second attempt after 1.2 s and a third after 2.4 s; the first full result wins.
async function edgeTts(text: string): Promise<Buffer> {
  let won = false;
  const attempts = [0, 1200, 2400].map(
    (delay) =>
      new Promise<Buffer>((res, rej) =>
        setTimeout(() => {
          if (won) return rej(new Error("skipped"));
          edgeOnce(text, 3500).then((b) => ((won = true), res(b)), rej);
        }, delay),
      ),
  );
  return Promise.any(attempts);
}

async function geminiTts(text: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("no GEMINI_API_KEY");
  // The SSE streaming endpoint is ~2x faster end-to-end than plain generateContent (~2.4 s vs 4-6 s).
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
  return pcmToWav(Buffer.concat(chunks));
}

export async function synthesize(text: string, opts: { gemini?: boolean } = {}): Promise<Audio> {
  const hash = createHash("sha1").update(`${opts.gemini ? "g" : "e"}|${text}`).digest("hex");
  const hit = cache.get(hash);
  if (hit) {
    cache.delete(hash);
    cache.set(hash, hit); // refresh LRU position
    return hit;
  }
  let out: Audio;
  if (opts.gemini) {
    out = { body: await geminiTts(text), type: "audio/wav" };
  } else {
    try {
      out = { body: await edgeTts(text), type: "audio/mpeg" };
    } catch {
      out = { body: await geminiTts(text), type: "audio/wav" };
    }
  }
  cache.set(hash, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return out;
}
