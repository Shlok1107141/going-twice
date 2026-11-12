"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { sentences } from "@/lib/speech/spoken";

/*
 * Gus has ONE voice: Kokoro-82M (open source, Apache-2.0). There is no second engine and no fallback voice.
 *  - Every caption is split into short sentences. Sentences known in advance (fixed lines, money amounts,
 *    the sample catalogues, the demo bidders) were rendered with Kokoro ahead of time and are static files
 *    under /gus/clips, so they play at once.
 *  - Any other sentence (a custom lot or name, the one sentence the model writes) is rendered by the same
 *    Kokoro voice in a web worker (/gus/worker.js). If that is not ready in time the sentence is skipped
 *    and stays on screen as a caption.
 *  - A new bid cuts Gus off: whatever he was saying stops and he answers the bid.
 */

export type VoiceStatus = { state: "idle" | "loading" | "ready" | "error"; pct: number };
type Caption = { text: string; ts: number; kind?: string };

const VOICE = "am_michael";
/** Moments that cut Gus off mid-sentence. A pitch, a nudge or a welcome waits its turn instead. */
const URGENT = new Set(["open", "bid", "agent-bid", "going-once", "going-twice", "sold", "unsold", "close"]);
const MAX_QUEUED = 6;
const WAIT_MS = 7000;

// ---------------------------------------------------------------- voice engine (one per tab)

let worker: Worker | null = null;
let status: VoiceStatus = { state: "idle", pct: 0 };
const listeners = new Set<() => void>();
const pending = new Map<number, (url: string | null) => void>();
const made = new Map<string, Promise<string | null>>();
/** Sentences the worker has been asked for but has not delivered yet -> their request id. */
const rendering = new Map<string, number>();
let clipMap: Promise<Record<string, string>> | null = null;
let seq = 0;

function setStatus(next: VoiceStatus) {
  status = next;
  listeners.forEach((l) => l());
}

function failAll() {
  for (const resolve of pending.values()) resolve(null);
  pending.clear();
}

/** Start loading the in-browser Kokoro model (idempotent). */
export function warmVoice(): void {
  if (worker || typeof Worker === "undefined") return;
  try {
    worker = new Worker("/gus/worker.js", { type: "module" });
  } catch {
    setStatus({ state: "error", pct: 0 });
    return;
  }
  setStatus({ state: "loading", pct: 0 });
  worker.onmessage = (e: MessageEvent) => {
    const d = e.data as { type: string; pct?: number; id?: number; blob?: Blob };
    if (d.type === "progress") setStatus({ state: "loading", pct: d.pct ?? 0 });
    else if (d.type === "ready") setStatus({ state: "ready", pct: 100 });
    else if (d.type === "error") {
      setStatus({ state: "error", pct: 0 });
      failAll();
    } else if (d.type === "audio" && d.id !== undefined) {
      pending.get(d.id)?.(d.blob ? URL.createObjectURL(d.blob) : null);
      pending.delete(d.id);
    }
  };
  worker.onerror = () => {
    setStatus({ state: "error", pct: 0 });
    failAll();
  };
}

function clips(): Promise<Record<string, string>> {
  return (clipMap ??= fetch("/gus/clips.json")
    .then((r) => (r.ok ? (r.json() as Promise<{ clips?: Record<string, string> }>) : { clips: {} }))
    .then((j) => j.clips ?? {})
    .catch(() => ({})));
}

/** Audio for one sentence: its pre-rendered clip, else rendered in the browser; null when neither works. */
function audioFor(sentence: string, now: boolean): Promise<string | null> {
  const hit = made.get(sentence);
  if (hit) {
    const id = rendering.get(sentence);
    if (now && id !== undefined) worker?.postMessage({ type: "bump", id }); // was being prepared; needed now
    return hit;
  }
  const p = clips().then((map) => {
    if (map[sentence]) return `/gus/clips/${map[sentence]}`;
    warmVoice();
    if (!worker || status.state === "error") return null;
    return new Promise<string | null>((resolve) => {
      const id = ++seq;
      rendering.set(sentence, id);
      pending.set(id, (url) => {
        rendering.delete(sentence);
        resolve(url);
      });
      worker?.postMessage({ id, text: sentence, voice: VOICE, speed: 1, now });
    });
  });
  made.set(sentence, p);
  void p.then((url) => {
    if (!url) made.delete(sentence); // allow another try later
  });
  return p;
}

/** Render ahead of time what Gus is about to need (a lot's title and pitch, a bidder's name), so it plays at once. */
export function prewarm(texts: string[]): void {
  for (const text of texts) for (const s of sentences(text)) void audioFor(s, false);
}

function silence(): string {
  const n = 1200;
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  b.setUint32(4, 36 + n * 2, true);
  w(8, "WAVEfmt ");
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, 24000, true);
  b.setUint32(28, 48000, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  w(36, "data");
  b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
}

export function useVoiceStatus(): VoiceStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
    () => status,
  );
}

// ---------------------------------------------------------------- the hook

const noop = () => () => {};

/** Speaks each new caption (by `ts`) once sound has been started by a user gesture. */
export function useSpeech(caption: Caption | undefined) {
  const supported = useSyncExternalStore(
    noop,
    () => typeof Audio !== "undefined",
    () => true,
  );
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voice = useVoiceStatus();
  const lastTs = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queue = useRef<Promise<string | null>[]>([]);
  const playing = useRef(false);
  const epoch = useRef(0); // bumped whenever Gus is cut off
  const pumpRef = useRef<() => void>(() => {});
  const captionTs = caption?.ts;
  const captionText = caption?.text;
  const captionKind = caption?.kind;

  const pump = useCallback(async () => {
    if (playing.current) return;
    const item = queue.current.shift();
    if (!item) return setSpeaking(false);
    playing.current = true;
    setSpeaking(true);
    const my = epoch.current;
    const url = await Promise.race([item, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
    if (my !== epoch.current) return; // cut off while waiting; stop() already restarted the queue
    const next = () => {
      if (my !== epoch.current) return;
      playing.current = false;
      pumpRef.current();
    };
    const audio = audioRef.current;
    if (!url || !audio) return next();
    audio.onended = next;
    audio.onerror = next;
    audio.src = url;
    audio.play().catch(next);
  }, []);

  useEffect(() => {
    pumpRef.current = () => void pump();
  }, [pump]);

  /** Cut Gus off: stop the audio, drop what was queued. */
  const stop = useCallback(() => {
    epoch.current++;
    queue.current = [];
    playing.current = false;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
  }, []);

  const speak = useCallback(
    (text: string, urgent: boolean) => {
      const parts = sentences(text);
      if (parts.length === 0) return;
      if (urgent) stop();
      for (const s of parts) queue.current.push(audioFor(s, true));
      while (queue.current.length > MAX_QUEUED) queue.current.shift();
      void pump();
    },
    [pump, stop],
  );

  useEffect(() => {
    if (!enabled || muted || !captionText || captionTs === undefined) return;
    if (captionTs === lastTs.current) return;
    lastTs.current = captionTs;
    speak(captionText, URGENT.has(captionKind ?? ""));
  }, [enabled, muted, captionTs, captionText, captionKind, speak]);

  /** Must be called from a click handler to unlock audio. */
  const start = useCallback(() => {
    if (!supported) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = silence(); // unlock playback inside the gesture; real lines follow asynchronously
    audio.play().catch(() => {});
    lastTs.current = captionTs ?? 0; // do not replay a stale line
    setEnabled(true);
    setMuted(false);
    speak("Gus here. Sound is on.", false);
    void clips();
    setTimeout(warmVoice, 2500); // custom names and lots need the in-browser model; load it behind the first lines
  }, [supported, captionTs, speak]);

  const toggleMute = useCallback(() => {
    if (!muted) {
      stop();
      setSpeaking(false);
      lastTs.current = captionTs ?? lastTs.current;
    }
    setMuted(!muted);
  }, [muted, captionTs, stop]);

  return { supported, enabled, muted, speaking, voice, start, toggleMute };
}
