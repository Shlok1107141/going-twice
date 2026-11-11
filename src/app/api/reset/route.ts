import { reset } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

export async function POST() {
  try {
    return Response.json(reset());
  } catch (e) {
    return fail(e);
  }
}
