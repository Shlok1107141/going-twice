import { placeBid } from "@/lib/auction/engine";
import { readJson, str } from "@/lib/auction/http";

// Rule rejections come back as 200 {ok:false, error}; malformed requests as 400.
export async function POST(req: Request) {
  const b = await readJson(req);
  const paddleId = str(b.paddleId, 64);
  const lotId = str(b.lotId, 64);
  const amount = typeof b.amount === "string" ? Number(b.amount) : b.amount;
  if (!paddleId || !lotId || typeof amount !== "number") {
    return Response.json({ ok: false, error: "paddleId, lotId and amount are required" }, { status: 400 });
  }
  try {
    return Response.json(placeBid(paddleId, lotId, amount, "human"));
  } catch (e) {
    console.error("[api/bid]", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, error: "Something went wrong" }, { status: 500 });
  }
}
