"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const noop = () => () => {};

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
    () => "speechSynthesis" in window,
    () => true,
  );
  const [enabled, setEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const lastTs = useRef(0);
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
  const captionTs = caption?.ts;
  const captionText = caption?.text;

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const refresh = () => {
      voiceRef.current = pickVoice();
    };
    refresh();
    synth.addEventListener("voiceschanged", refresh);
    return () => synth.removeEventListener("voiceschanged", refresh);
  }, [supported]);

  const speak = useCallback((text: string) => {
    const clean = text.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const synth = window.speechSynthesis;
    if (synth.pending) synth.cancel(); // drop stale queued lines, keep the latest
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "en-US";
    u.rate = 1.05;
    if (voiceRef.current) u.voice = voiceRef.current;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.speak(u);
  }, []);

  useEffect(() => {
    if (!enabled || muted || !captionText || captionTs === undefined) return;
    if (captionTs === lastTs.current) return;
    lastTs.current = captionTs;
    speak(captionText);
  }, [enabled, muted, captionTs, captionText, speak]);

  /** Must be called from a click handler to unlock audio. */
  const start = useCallback(() => {
    if (!supported) return;
    lastTs.current = captionTs ?? 0; // do not replay a stale line
    setEnabled(true);
    setMuted(false);
    speak("Sound is on. Gus is ready.");
  }, [supported, captionTs, speak]);

  const toggleMute = useCallback(() => {
    if (!muted) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      lastTs.current = captionTs ?? lastTs.current;
    }
    setMuted(!muted);
  }, [muted, captionTs]);

  return { supported, enabled, muted, speaking, start, toggleMute };
}
