// Gus's voice for anything that was not pre-rendered (a custom lot, a bidder's name, the one sentence the
// model writes): Kokoro-82M (Apache-2.0, github.com/hexgrad/kokoro) running in the browser via kokoro-js.
// No server TTS and no API key. The model (~90 MB) is downloaded once and cached by the browser.
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts = null;
const files = new Map();
const queue = [];
let busy = false;

async function load() {
  try {
    tts = await KokoroTTS.from_pretrained(MODEL, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        files.set(p.file, [p.loaded, p.total]);
        let loaded = 0;
        let total = 0;
        for (const [l, t] of files.values()) {
          loaded += l;
          total += t;
        }
        self.postMessage({ type: "progress", pct: Math.min(99, Math.round((loaded / total) * 100)) });
      },
    });
    self.postMessage({ type: "ready", threads: self.crossOriginIsolated ? "multi" : "single" });
  } catch (e) {
    self.postMessage({ type: "error", message: String((e && e.message) || e) });
  }
}
const ready = load();

async function drain() {
  if (busy) return;
  busy = true;
  await ready;
  while (queue.length) {
    const job = queue.shift();
    if (!tts) {
      self.postMessage({ type: "audio", id: job.id, error: "voice not loaded" });
      continue;
    }
    try {
      const t0 = performance.now();
      const out = await tts.generate(job.text, { voice: job.voice || "am_michael", speed: job.speed || 1 });
      self.postMessage({ type: "audio", id: job.id, blob: out.toBlob(), ms: Math.round(performance.now() - t0), seconds: out.audio.length / out.sampling_rate });
    } catch (e) {
      self.postMessage({ type: "audio", id: job.id, error: String((e && e.message) || e) });
    }
  }
  busy = false;
}

self.onmessage = (ev) => {
  const d = ev.data;
  // Lines Gus is saying right now go first (in the order asked); sentences prepared ahead of time wait behind them.
  const front = (job) => {
    job.now = true;
    let i = 0;
    while (i < queue.length && queue[i].now) i++;
    queue.splice(i, 0, job);
  };
  if (d.type === "bump") {
    // A sentence that was being prepared ahead of time is needed now.
    const i = queue.findIndex((j) => j.id === d.id);
    if (i >= 0 && !queue[i].now) front(queue.splice(i, 1)[0]);
    return;
  }
  if (d.now) front(d);
  else queue.push(d);
  void drain();
};
