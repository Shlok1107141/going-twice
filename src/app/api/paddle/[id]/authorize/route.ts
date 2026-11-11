import { authorizePaddle } from "@/lib/auction/engine";
import { fail, readJson, str } from "@/lib/auction/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await readJson(req);
  const orderId = str(b.orderId, 64) ?? "";
  try {
    const paddle = await authorizePaddle(id, orderId);
    return Response.json({ paddle });
  } catch (e) {
    return fail(e);
  }
}
