import { preparePitches } from "@/lib/ai/auctioneer";
import { fail } from "@/lib/auction/http";
import { withRoom } from "@/lib/auction/room";

// The stage calls this when it sees lots without a pitch: one model call writes one sentence per lot.
async function handle() {
  try {
    await preparePitches();
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
