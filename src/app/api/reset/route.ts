import { withRoom } from "@/lib/auction/room";
import { reset } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

async function handle() {
  try {
    return Response.json(reset());
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
