import { withRoom } from "@/lib/auction/room";
import { connection } from "next/server";
import { getState } from "@/lib/auction/store";

async function handle() {
  await connection();
  return Response.json(getState(), { headers: { "Cache-Control": "no-store" } });
}

export const GET = (req: Request) => withRoom(req, () => handle());
