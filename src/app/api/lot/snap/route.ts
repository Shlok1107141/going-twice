// Snap-a-lot: photo -> Gemini vision -> Channel3 retail matches -> code-computed FMV -> draft lot.
import { bad, fail } from "@/lib/auction/http";
import { computePricing } from "@/lib/ai/fmv";
import { recognizeItem, visionEnabled } from "@/lib/ai/vision";
import { channel3Mode, searchChannel3 } from "@/lib/sponsors/channel3";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MIME = /^image\/(jpeg|png|webp|heic|heif)$/;

async function readImage(req: Request): Promise<{ base64: string; mime: string } | string> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const f = (await req.formData()).get("image");
    if (!(f instanceof File)) return "Attach an image file in the 'image' field";
    if (!MIME.test(f.type)) return "Use a JPEG, PNG or WebP photo";
    if (f.size > MAX_BYTES) return "Image is over 4 MB";
    return { base64: Buffer.from(await f.arrayBuffer()).toString("base64"), mime: f.type };
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
  return { base64: data, mime };
}

export async function POST(req: Request) {
  try {
    if (!visionEnabled()) return bad("Photo recognition needs GEMINI_API_KEY", 503);
    const img = await readImage(req);
    if (typeof img === "string") return bad(img);

    const item = await recognizeItem(img.base64, img.mime);
    if (!item) return bad("Could not recognize the item. Try a clearer photo.", 422);

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
