"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

/*
 * Voice policy (measured: Gemini TTS ~2.4 s total per short line, ~1 s to first byte; 429s possible on free tier):
 *  - Template lines without placeholders are prefetched when sound starts (server LRU + client blob cache) -> instant.
 *  - Every new caption is requested from /api/tts immediately on arrival, in parallel, and played strictly in order
 *    through ONE HTMLAudioElement. If more than 2 lines are waiting, the oldest are dropped so Gus stays in sync.
 *  - Any TTS failure (503/timeout/blocked play) falls back to browser speechSynthesis for that line only.
 */
const PREFETCH = [
  "Sound is on. Gus is ready.",
  "Going once... going twice... thumbs, people, thumbs...",
  "I can wait. I've waited out longer silences than this. I can absolutely wait.",
  "Somebody out there is doing math. Stop doing math. It's for a good cause.",
];
const MAX_QUEUED = 2;

function clean(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const preferred = [/Google US English/i, /Natural.*(Guy|Davis|Andrew|Brian)/i, /Daniel|Alex|David|Guy|Fred|Aaron/i, /en[-_]US/i];
  for (const re of preferred) {
    const hit = en.find((v) => re.test(v.name) || re.test(v.lang));
    if (hit) return hit;
  }
  return en[0];
}

/** Speaks each new caption (by `ts`) once sound has been started by a user gesture. */
export function useSpeech(caption: { text: string; ts: number } | undefined) {
  const supported = useSyncExternalStore(
    noop,
    () => "speechSynthesis" in window || typeof Audio !== "undefined",
    () => true,
  );
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const lastTs = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobs = useRef(new Map<string, Promise<string | null>>());
  const queue = useRef<{ text: string; url: Promise<string | null> }[]>([]);
  const playing = useRef(false);
  const pumpRef = useRef<() => void>(() => {});
  const epoch = useRef(0); // bumped on mute to invalidate in-flight playback
  const captionTs = caption?.ts;
  const captionText = caption?.text;

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      voiceRef.current = pickVoice();
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, []);

  /** Fetch (once) the Gemini audio for a line; resolves null on any failure. */
  const fetchAudio = useCallback((text: string): Promise<string | null> => {
    const hit = blobs.current.get(text);
    if (hit) return hit;
    const room = new URLSearchParams(window.location.search).get("room");
    const qs = new URLSearchParams({ text });
    if (room) qs.set("room", room);
    const p = fetch(`/api/tts?${qs}`)
      .then(async (r) => (r.ok ? URL.createObjectURL(await r.blob()) : null))
      .catch(() => null);
    blobs.current.set(text, p);
    void p.then((u) => {
      if (!u) blobs.current.delete(text); // allow retry later
    });
    return p;
  }, []);

  const browserSpeak = useCallback((text: string, done: () => void) => {
    if (!("speechSynthesis" in window)) return done();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1.05;
    if (voiceRef.current) u.voice = voiceRef.current;
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    const item = queue.current.shift();
    if (!item) return;
    playing.current = true;
    const my = epoch.current;
    setSpeaking(true);
    const finish = () => {
      playing.current = false;
      if (my !== epoch.current) return;
      if (queue.current.length === 0) setSpeaking(false);
      pumpRef.current();
    };
    const url = await item.url;
    if (my !== epoch.current) return void (playing.current = false);
    const audio = audioRef.current;
    if (url && audio) {
      audio.onended = finish;
      audio.onerror = () => browserSpeak(item.text, finish);
      audio.src = url;
      audio.play().catch(() => browserSpeak(item.text, finish));
    } else {
      browserSpeak(item.text, finish);
    }
  }, [browserSpeak]);

  useEffect(() => {
    pumpRef.current = () => void pump();
  }, [pump]);

  const speak = useCallback(
    (raw: string) => {
      const text = clean(raw);
      if (!text) return;
      queue.current.push({ text, url: fetchAudio(text) });
      while (queue.current.length > MAX_QUEUED) queue.current.shift(); // drop stale lines
      void pump();
    },
    [fetchAudio, pump],
  );

  useEffect(() => {
    if (!enabled || muted || !captionText || captionTs === undefined) return;
    if (captionTs === lastTs.current) return;
    lastTs.current = captionTs;
    speak(captionText);
  }, [enabled, muted, captionTs, captionText, speak]);

  /** Must be called from a click handler to unlock audio. */
  const start = useCallback(() => {
    if (!supported) return;
    if (!audioRef.current) audioRef.current = new Audio();
    lastTs.current = captionTs ?? 0; // do not replay a stale line
    setEnabled(true);
    setMuted(false);
    speak("Sound is on. Gus is ready.");
    // Warm the server cache for placeholder-free template lines, one at a time to stay under rate limits.
    void (async () => {
      for (const line of PREFETCH.slice(1)) await fetchAudio(line);
    })();
  }, [supported, captionTs, speak, fetchAudio]);

  const toggleMute = useCallback(() => {
    if (!muted) {
      epoch.current++;
      queue.current = [];
      playing.current = false;
      audioRef.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setSpeaking(false);
      lastTs.current = captionTs ?? lastTs.current;
    }
    setMuted(!muted);
  }, [muted, captionTs]);

  return { supported, enabled, muted, speaking, start, toggleMute };
}
