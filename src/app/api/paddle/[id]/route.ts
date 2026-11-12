import { removePendingPaddle } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";
import { withRoom } from "@/lib/auction/room";

// A bidder backed out before approving the PayPal hold: forget the paddle. Nothing was authorized.
async function handle(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    removePendingPaddle(id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export const DELETE = (req: Request, ctx: { params: Promise<{ id: string }> }) => withRoom(req, () => handle(ctx));
