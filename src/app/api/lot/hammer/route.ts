import { hammer } from "@/lib/auction/engine";
import { bad, fail, readJson, str } from "@/lib/auction/http";

export async function POST(req: Request) {
  const lotId = str((await readJson(req)).lotId, 64);
  if (!lotId) return bad("lotId is required");
  try {
    return Response.json(hammer(lotId));
  } catch (e) {
    return fail(e);
  }
}
