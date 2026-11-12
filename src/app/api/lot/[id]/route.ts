import { withRoom } from "@/lib/auction/room";
import { patchLot, removeLot } from "@/lib/auction/event";
import { fail, readJson } from "@/lib/auction/http";

type Ctx = { params: Promise<{ id: string }> };

async function patch(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return Response.json({ lot: patchLot(id, await readJson(req)) });
  } catch (e) {
    return fail(e);
  }
}

async function del(ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    removeLot(id);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}

export const PATCH = (req: Request, ctx: Ctx) => withRoom(req, () => patch(req, ctx));
export const DELETE = (req: Request, ctx: Ctx) => withRoom(req, () => del(ctx));
