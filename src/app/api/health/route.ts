import { connection } from "next/server";
import { getState, isDemoMode } from "@/lib/auction/store";

export async function GET() {
  await connection();
  return Response.json({ ok: true, demoMode: isDemoMode(), status: getState().status, ts: Date.now() });
}
