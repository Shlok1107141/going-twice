"use client";

import { useRef, useState } from "react";
import { post } from "@/lib/client/api";
import { money } from "@/lib/client/format";

type Match = { title: string; brand: string; price: number; currency: string; image?: string; retailer: string; url: string };
type Snap = {
  item: { title: string; brand?: string; model?: string; category: string; condition: string; description: string; searchQuery: string };
  matches: Match[];
  listingCount: number;
  pricing: { fmv: number; startPrice: number; increment: number } | null;
  channel3: "rest" | "mcp";
  draft: { sources: { retailer: string; price: number; url: string }[] };
};

const panel = "rounded-2xl border border-stone-300 bg-white p-4 shadow-sm";
const field = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-200";
const label = "mb-1 block text-xs font-bold uppercase tracking-wider text-stone-600";

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="snap-h" className="font-serif text-xl font-black text-stone-900">Snap-a-lot</h2>
          <p className="text-sm text-stone-600">Photograph a donated item. Gus finds the retail price and drafts the lot.</p>
        </div>
        <button
          type="button"
          disabled={busy !== ""}
          onClick={() => input.current?.click()}
          className="rounded-xl bg-amber-500 px-4 py-2 font-bold text-stone-900 shadow-sm hover:bg-amber-400 disabled:opacity-50"
        >
          {busy === "read" ? "Reading photo…" : "Take or upload photo"}
        </button>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Photo of donated item" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>

      {error && <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">{error}</p>}
      {added && <p role="status" className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">Added “{added}” to the auction. Gus has announced it.</p>}

      {busy === "read" && <p role="status" className="animate-pulse text-sm font-semibold text-amber-800">Gus is squinting at the photo, then asking Channel3 what it sells for…</p>}

      {snap && (
        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {photo && <img src={photo} alt={`Photo of ${snap.item.title}`} className="aspect-square w-full rounded-xl border border-stone-300 object-cover" />}
            <p className="mt-2 text-xs text-stone-600">
              <span className="font-bold uppercase tracking-wider text-amber-800">Recognized</span>
              <br />
              {snap.item.brand ? `${snap.item.brand} · ` : ""}{snap.item.model ? `${snap.item.model} · ` : ""}{snap.item.category} · {snap.item.condition}
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-stone-600">
                Channel3 retail matches {snap.listingCount > 0 && <span className="font-normal normal-case text-stone-500">({snap.listingCount} listings, {snap.channel3 === "rest" ? "API" : "MCP"})</span>}
              </h3>
              {snap.matches.length === 0 ? (
                <p className="text-sm text-stone-600">No retail matches found. Enter the value yourself below.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {snap.matches.map((m) => (
                    <li key={m.url || m.title} className="flex gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.image && <img src={m.image} alt="" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" />}
                      <div className="min-w-0 text-xs">
                        <p className="line-clamp-2 font-semibold text-stone-900">{m.title}</p>
                        <p className="mt-0.5 text-stone-600">{m.retailer}</p>
                        <p className="font-bold tabular-nums text-amber-900">{m.currency === "USD" ? money(m.price) : `${m.price} ${m.currency}`}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="grid grid-cols-2 gap-3">
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

            <p className="text-xs text-stone-600">
              {snap.pricing
                ? `Value is the median of ${snap.listingCount} new retail prices times a “${snap.item.condition}” condition factor. Opening bid is 40% of that, rounded down to $5. Numbers come from code, not the AI.`
                : "No price data, so the numbers are placeholders."}
            </p>

            <button
              type="button"
              disabled={busy !== "" || !title.trim() || !(Number(start) > 0) || !(Number(inc) > 0)}
              onClick={add}
              className="rounded-xl bg-stone-900 px-5 py-2.5 font-bold text-amber-100 shadow-sm hover:bg-stone-800 disabled:opacity-50"
            >
              {busy === "add" ? "Adding…" : "Add to auction"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
