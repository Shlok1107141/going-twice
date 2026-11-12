import { withRoom } from "@/lib/auction/room";
import { createBlankLot } from "@/lib/auction/event";
import { fail } from "@/lib/auction/http";

async function handle() {
  try {
    return Response.json({ lot: createBlankLot() });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
