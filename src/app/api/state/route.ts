import { withRoom } from "@/lib/auction/room";
import { connection } from "next/server";
import { peekState } from "@/lib/auction/store";

// Polled every second by every page: read-only (an unused room code returns a shared pristine lobby
// without allocating or persisting anything), no PayPal/AI work.
async function handle() {
  await connection();
  return Response.json(peekState(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = (req: Request) => withRoom(req, () => handle());
