// Snap-a-lot: photo -> Gemini vision -> Channel3 retail matches -> code-computed FMV -> draft lot.
import { bad, fail } from "@/lib/auction/http";
import { computePricing } from "@/lib/ai/fmv";
import { recognizeItem, visionEnabled } from "@/lib/ai/vision";
import { channel3Mode, searchChannel3 } from "@/lib/sponsors/channel3";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MIME = /^image\/(jpeg|png|webp|heic|heif)$/;

// Base64 inflates 4/3, plus multipart/JSON overhead: refuse obviously oversized bodies before reading them.
const MAX_BODY = Math.ceil((MAX_BYTES * 4) / 3) + 64 * 1024;

/** Magic bytes, so a renamed PDF or text file never costs a Gemini call. */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true; // PNG
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return true;
  return buf.toString("latin1", 4, 8) === "ftyp"; // HEIC/HEIF
}

async function readImage(req: Request): Promise<{ base64: string; mime: string } | string> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return "Image is over 4 MB";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const f = (await req.formData()).get("image");
    if (!(f instanceof File)) return "Attach an image file in the 'image' field";
    if (!MIME.test(f.type)) return "Use a JPEG, PNG or WebP photo";
    if (f.size > MAX_BYTES) return "Image is over 4 MB";
    const buf = Buffer.from(await f.arrayBuffer());
    if (!looksLikeImage(buf)) return "That file isn't a JPEG, PNG or WebP photo";
    return { base64: buf.toString("base64"), mime: f.type };
  }
  let body: { image?: unknown; mimeType?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return "Send multipart or JSON {image: base64}";
  }
  if (typeof body.image !== "string" || !body.image) return "image (base64) is required";
  let data = body.image;
  let mime = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";
  const m = data.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (m) {
    mime = m[1];
    data = m[2];
  }
  if (!MIME.test(mime)) return "Use a JPEG, PNG or WebP photo";
  if (Math.floor((data.length * 3) / 4) > MAX_BYTES) return "Image is over 4 MB";
  if (!/^[A-Za-z0-9+/=\s]+$/.test(data) || !looksLikeImage(Buffer.from(data.slice(0, 64), "base64"))) return "That file isn't a JPEG, PNG or WebP photo";
  return { base64: data, mime };
}

export async function POST(req: Request) {
  try {
    if (!visionEnabled()) return bad("Photo recognition needs GEMINI_API_KEY", 503);
    const img = await readImage(req);
    if (typeof img === "string") return bad(img, img.includes("4 MB") ? 413 : 400);

    const r = await recognizeItem(img.base64, img.mime);
    if ("error" in r) {
      if (r.error === "rate-limited") {
        return Response.json({ error: "Gemini is rate-limited right now. Wait a minute and try again, or add the lot by hand." }, { status: 429, headers: { "Retry-After": "60" } });
      }
      if (r.error === "unavailable") return bad("Photo recognition is unavailable right now. Add the lot by hand.", 503);
      return bad("Could not recognize the item. Try a clearer photo.", 422);
    }
    const item = r.item;

    const found = await searchChannel3(item.searchQuery, 8);
    const pricing = computePricing(found.map((m) => m.price), item.condition);

    return Response.json({
      item,
      matches: found.slice(0, 3),
      listingCount: found.length,
      pricing, // null when Channel3 found nothing: the admin types the numbers
      channel3: channel3Mode(),
      draft: {
        title: item.title,
        description: item.description,
        startPrice: pricing?.startPrice ?? 10,
        increment: pricing?.increment ?? 5,
        fmv: pricing?.fmv ?? 0,
        sources: found.map((m) => ({ retailer: m.retailer, price: m.price, url: m.url })),
      },
    });
  } catch (e) {
    return fail(e);
  }
}
