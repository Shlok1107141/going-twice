"use client";

import { useRef, useState } from "react";
import { post } from "@/lib/client/api";
import { money } from "@/lib/client/format";
import { btn, panel } from "@/components/ui";

type Match = { title: string; brand: string; price: number; currency: string; image?: string; retailer: string; url: string };
type Snap = {
  item: { title: string; brand?: string; model?: string; category: string; condition: string; description: string; searchQuery: string };
  matches: Match[];
  listingCount: number;
  pricing: { fmv: number; startPrice: number; increment: number } | null;
  channel3: "rest" | "mcp";
  draft: { sources: { retailer: string; price: number; url: string }[] };
};

const field = "w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-ink focus:border-ink focus:outline-none";
const label = "mb-2 block text-sm font-medium text-ink-2";

/** Downscale a photo in the browser: a 1024px copy for recognition, a 360px thumb for the stage. */
async function shrink(file: File, max: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export function SnapLot() {
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string>();
  const [thumb, setThumb] = useState<string>();
  const [busy, setBusy] = useState<"" | "read" | "add">("");
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");
  const [snap, setSnap] = useState<Snap>();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fmv, setFmv] = useState("");
  const [start, setStart] = useState("");
  const [inc, setInc] = useState("");

  async function onFile(f?: File) {
    if (!f) return;
    setError("");
    setAdded("");
    setSnap(undefined);
    setBusy("read");
    try {
      const big = await shrink(f, 1024, 0.85);
      setPhoto(big);
      setThumb(await shrink(f, 360, 0.7));
      const s = await post<Snap>(`/api/lot/snap${window.location.search}`, { image: big, mimeType: "image/jpeg" });
      setSnap(s);
      setTitle(s.item.title);
      setDescription(s.item.description);
      setFmv(String(s.pricing?.fmv ?? 0));
      setStart(String(s.pricing?.startPrice ?? 10));
      setInc(String(s.pricing?.increment ?? 5));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  }

  async function add() {
    if (!snap) return;
    setBusy("add");
    setError("");
    try {
      await post(`/api/lot/add${window.location.search}`, {
        title,
        description,
        fmv: Number(fmv),
        startPrice: Number(start),
        increment: Number(inc),
        image: thumb,
        sources: snap.draft.sources,
      });
      setAdded(title);
      setSnap(undefined);
      setPhoto(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={panel} aria-labelledby="snap-h">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="snap-h" className="display text-2xl text-ink">Snap-a-lot</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">Photograph a donated item. Gus finds the retail price and drafts the lot.</p>
        </div>
        <button
          type="button"
          disabled={busy !== ""}
          onClick={() => input.current?.click()}
          className={btn.secondary}
        >
          {busy === "read" ? "Reading photo…" : "Take or upload photo"}
        </button>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of donated item" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {error && <p role="alert" className="mb-4 rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{error}</p>}
      {added && <p role="status" className="mb-4 rounded-md bg-sage-soft px-4 py-3 text-sm font-medium text-sage">Added “{added}” to the auction. Gus has announced it.</p>}

      {busy === "read" && <p role="status" className="anim-breathe text-sm text-clay-ink">Gus is squinting at the photo, then asking Channel3 what it sells for…</p>}

      {snap && (
        <div className="grid gap-8 md:grid-cols-[220px_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo} alt={`Photo of ${snap.item.title}`} className="aspect-square w-full rounded-lg border border-line object-cover" />}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              <span className="eyebrow text-clay-ink">Recognized</span>
              <br />
              {snap.item.brand ? `${snap.item.brand} · ` : ""}{snap.item.model ? `${snap.item.model} · ` : ""}{snap.item.category} · {snap.item.condition}
            </p>
          </div>

          <div className="space-y-6">
            <div>
              <h3 className="eyebrow mb-3 text-muted">
                Channel3 retail matches {snap.listingCount > 0 && <span className="font-normal normal-case tracking-normal text-muted">({snap.listingCount} listings, {snap.channel3 === "rest" ? "API" : "MCP"})</span>}
              </h3>
              {snap.matches.length === 0 ? (
                <p className="text-sm text-muted">No retail matches found. Enter the value yourself below.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {snap.matches.map((m) => (
                    <li key={m.url || m.title} className="flex gap-3 rounded-lg border border-line bg-canvas p-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.image && <img src={m.image} alt="" className="h-14 w-14 shrink-0 rounded-md bg-white object-contain" />}
                      <div className="min-w-0 text-xs">
                        <p className="line-clamp-2 font-medium text-ink">{m.title}</p>
                        <p className="mt-0.5 text-muted">{m.retailer}</p>
                        <p className="num mt-0.5 font-medium text-clay-ink">{m.currency === "USD" ? money(m.price) : `${m.price} ${m.currency}`}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="snap-title">Title</label>
                <input id="snap-title" className={field} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="snap-desc">Description</label>
                <textarea id="snap-desc" className={field} rows={2} value={description} maxLength={600} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="snap-fmv">Est. value (FMV)</label>
                <input id="snap-fmv" className={field} inputMode="decimal" value={fmv} onChange={(e) => setFmv(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={label} htmlFor="snap-start">Opening bid</label>
                  <input id="snap-start" className={field} inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div>
                  <label className={label} htmlFor="snap-inc">Increment</label>
                  <input id="snap-inc" className={field} inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} />
                </div>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted">
              {snap.pricing
                ? `Value is the median of ${snap.listingCount} new retail prices times a “${snap.item.condition}” condition factor. Opening bid is 40% of that, rounded down to $5. Numbers come from code, not the AI.`
                : "No price data, so the numbers are placeholders."}
            </p>

            <button
              type="button"
              disabled={busy !== "" || !title.trim() || !(Number(start) > 0) || !(Number(inc) > 0)}
              onClick={add}
              className={btn.primary}
            >
              {busy === "add" ? "Adding…" : "Add to auction"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
