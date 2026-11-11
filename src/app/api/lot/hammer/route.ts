import { withRoom } from "@/lib/auction/room";
import { hammer } from "@/lib/auction/engine";
import { bad, fail, readJson, str } from "@/lib/auction/http";

async function handle(req: Request) {
  const lotId = str((await readJson(req)).lotId, 64);
  if (!lotId) return bad("lotId is required");
  try {
    return Response.json(hammer(lotId));
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle(req));
