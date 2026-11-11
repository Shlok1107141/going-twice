import { withRoom } from "@/lib/auction/room";
import { connection } from "next/server";
import { getState, isDemoMode } from "@/lib/auction/store";

async function handle() {
  await connection();
  return Response.json({ ok: true, demoMode: isDemoMode(), status: getState().status, ts: Date.now() });
}

export const GET = (req: Request) => withRoom(req, () => handle());
