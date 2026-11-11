import { withRoom } from "@/lib/auction/room";
import { authorizePaddle } from "@/lib/auction/engine";
import { fail, readJson, str } from "@/lib/auction/http";

async function handle(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const orderId = str(b.orderId, 64) ?? "";
  try {
    const paddle = await authorizePaddle(id, orderId);
    return Response.json({ paddle });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) => withRoom(req, () => handle(req, ctx));
