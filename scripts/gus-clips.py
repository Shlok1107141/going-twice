# Renders Gus's known sentences with Kokoro-82M (Apache-2.0, https://github.com/hexgrad/kokoro) via
# kokoro-onnx, one mp3 per sentence. Run scripts/gus-clips.mjs first.
#
#   python scripts/gus-clips.py <kokoro-v1.0.onnx> <voices-v1.0.bin>
#
# Output: public/gus/clips/<sha1-16>.mp3 and public/gus/clips.json {sentence: file}. Needs ffmpeg on PATH.
import hashlib, json, os, subprocess, sys, time
import numpy as np
from kokoro_onnx import Kokoro

VOICE = os.environ.get("GUS_VOICE", "am_michael")
SPEED = float(os.environ.get("GUS_SPEED", "1.0"))
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_dir = os.path.join(root, "public", "gus", "clips")
os.makedirs(out_dir, exist_ok=True)
lines = json.load(open(os.path.join(root, "scripts", "out", "gus-sentences.json"), encoding="utf8"))
K = Kokoro(sys.argv[1], sys.argv[2])


def trim(x, sr, th=0.01):
    idx = np.where(np.abs(x) > th)[0]
    return x[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.09 * sr)] if len(idx) else x


manifest, t0, made = {}, time.time(), 0
for n, text in enumerate(lines):
    name = hashlib.sha1(text.encode("utf8")).hexdigest()[:16] + ".mp3"
    manifest[text] = name
    path = os.path.join(out_dir, name)
    if os.path.exists(path) and os.path.getsize(path) > 500:
        continue
    x, sr = K.create(text, voice=VOICE, speed=SPEED, lang="en-us")
    x = trim(np.asarray(x, dtype=np.float32), sr)
    x = x / max(1e-6, float(np.abs(x).max())) * 0.89
    pcm = (x * 32767).astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", "-codec:a", "libmp3lame", "-b:a", "40k", path],
        input=pcm, check=True,
    )
    made += 1
    if made % 50 == 0:
        print(f"{n + 1}/{len(lines)}  {time.time() - t0:.0f}s", flush=True)

json.dump({"voice": VOICE, "clips": manifest}, open(os.path.join(root, "public", "gus", "clips.json"), "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
print(f"done: {len(manifest)} sentences, {made} rendered, {time.time() - t0:.0f}s")
