import { tick } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

export async function POST() {
  try {
    tick();
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
