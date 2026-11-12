import { connection } from "next/server";
import { currentRoom, withRoom } from "@/lib/auction/room";
import { roomExists } from "@/lib/auction/store";

// "Join with a room code": does this room exist yet? (A room exists once its host has opened it.)
export async function GET(req: Request) {
  await connection();
  return withRoom(req, () => Response.json({ room: currentRoom(), exists: roomExists() }, { headers: { "Cache-Control": "no-store" } }));
}
