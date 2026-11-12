import { withRoom } from "@/lib/auction/room";
import { connection } from "next/server";
import { isDemoMode, peekState, roomCount } from "@/lib/auction/store";

// Render's health check and cold-start probe: no PayPal/AI calls, no disk writes, never creates a room.
async function handle() {
  await connection();
  return Response.json(
    { ok: true, demoMode: isDemoMode(), status: peekState().status, rooms: roomCount(), uptimeS: Math.round(process.uptime()), ts: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = (req: Request) => withRoom(req, () => handle());
