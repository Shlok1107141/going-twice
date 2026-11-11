import { withRoom } from "@/lib/auction/room";
import { close } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

export const maxDuration = 120;

async function handle() {
  try {
    return Response.json(await close());
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
