import { close } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

export const maxDuration = 120;

export async function POST() {
  try {
    return Response.json(await close());
  } catch (e) {
    return fail(e);
  }
}
