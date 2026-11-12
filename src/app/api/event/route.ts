import { withRoom } from "@/lib/auction/room";
import { updateEvent } from "@/lib/auction/event";
import { fail, readJson } from "@/lib/auction/http";

async function handle(req: Request) {
  try {
    return Response.json({ event: updateEvent(await readJson(req)) });
  } catch (e) {
    return fail(e);
  }
}

export const PATCH = (req: Request) => withRoom(req, () => handle(req));
