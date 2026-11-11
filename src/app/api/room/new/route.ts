import { connection } from "next/server";
import { newRoomCode } from "@/lib/auction/room";

export async function GET() {
  await connection();
  return Response.json({ room: newRoomCode() }, { headers: { "Cache-Control": "no-store" } });
}
