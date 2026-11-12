import { withRoom } from "@/lib/auction/room";
import { addLot } from "@/lib/auction/engine";
import { bad, fail, readJson, text } from "@/lib/auction/http";

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 100) / 100 : null;

export const POST = (req: Request) => withRoom(req, () => handle(req));

async function handle(req: Request) {
  const b = await readJson(req);
  const title = text(b.title, 120);
  const description = text(b.description, 600) ?? "";
  const startPrice = num(b.startPrice, 1, 100_000);
  const increment = num(b.increment, 1, 10_000);
  const fmv = num(b.fmv, 0, 1_000_000);
  if (!title) return bad("title is required");
  if (startPrice === null || increment === null || fmv === null) return bad("startPrice, increment and fmv must be numbers");

  // Small thumbnail only (state is polled every second): data URL up to ~150 KB, or an https URL.
  let image: string | undefined;
  if (typeof b.image === "string" && b.image.length <= 200_000 && /^(data:image\/(jpeg|png|webp);base64,|https:\/\/)/.test(b.image)) {
    image = b.image;
  }
  const sources = Array.isArray(b.sources)
    ? b.sources
        .slice(0, 8)
        .map((s) => s as { retailer?: unknown; price?: unknown; url?: unknown })
        .filter((s) => typeof s.retailer === "string" && typeof s.price === "number" && typeof s.url === "string")
        .map((s) => ({ retailer: String(s.retailer).slice(0, 60), price: s.price as number, url: String(s.url).slice(0, 500) }))
    : undefined;

  try {
    return Response.json({ lot: addLot({ title, description, startPrice, increment, fmv, image, sources }) });
  } catch (e) {
    return fail(e);
  }
}
