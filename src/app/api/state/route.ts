import { connection } from "next/server";
import { getState } from "@/lib/auction/store";

export async function GET() {
  await connection();
  return Response.json(getState(), { headers: { "Cache-Control": "no-store" } });
}
