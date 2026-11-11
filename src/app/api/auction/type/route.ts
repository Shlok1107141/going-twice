import { withRoom } from "@/lib/auction/room";
import { setAuctionType } from "@/lib/auction/engine";
import { fail, readJson } from "@/lib/auction/http";

// POST { type, settings?: { premiumPct?, commissionPct?, organizerEmail?, consignorEmails? } }
// Switches the room to that auction type and resets it with the type's sample lots.
async function handle(req: Request) {
  const body = await readJson(req);
  const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? (body.settings as Record<string, unknown>) : {};
  try {
    return Response.json(setAuctionType({ type: body.type, ...settings }));
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle(req));
