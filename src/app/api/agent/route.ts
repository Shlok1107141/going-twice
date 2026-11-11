import { createPaddle, parseMoney } from "@/lib/auction/engine";
import { bad, fail, readJson, str } from "@/lib/auction/http";
import { getState } from "@/lib/auction/store";

export async function POST(req: Request) {
  const b = await readJson(req);
  const name = str(b.name, 40);
  const holdAmount = parseMoney(b.holdAmount, 10_000);
  const instruction = str(b.instruction, 300);
  const maxBid = parseMoney(b.maxBid, 10_000);
  const lotId = b.lotId === undefined || b.lotId === null || b.lotId === "" ? undefined : str(b.lotId, 64);
  if (!name) return bad("name is required (max 40 chars)");
  if (holdAmount === null) return bad("holdAmount must be a positive dollar amount up to 10,000");
  if (!instruction) return bad("instruction is required (max 300 chars)");
  if (maxBid === null) return bad("maxBid must be a positive dollar amount");
  if (maxBid > holdAmount) return bad("maxBid can't be more than holdAmount");
  if (lotId === null || (lotId && !getState().lots.some((l) => l.id === lotId))) return bad("Unknown lotId");
  try {
    const { paddle, orderId } = await createPaddle({
      name,
      holdAmount,
      agent: { instruction, maxBid, ...(lotId ? { lotId } : {}) },
    });
    return Response.json(orderId ? { paddleId: paddle.id, orderId } : { paddleId: paddle.id });
  } catch (e) {
    return fail(e);
  }
}
