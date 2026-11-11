import { withRoom } from "@/lib/auction/room";
import { tick } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

async function handle() {
  try {
    tick();
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
