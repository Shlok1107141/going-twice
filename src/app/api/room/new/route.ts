import { connection } from "next/server";
import { newRoomCode, runInRoom } from "@/lib/auction/room";
import { getState, save } from "@/lib/auction/store";

// A new auction room. It is created here, so its code can be joined straight away.
export async function GET() {
  await connection();
  const room = newRoomCode();
  runInRoom(room, () => {
    getState();
    save();
  });
  return Response.json({ room }, { headers: { "Cache-Control": "no-store" } });
}
