import { createPaddle, parseMoney } from "@/lib/auction/engine";
import { bad, fail, readJson, str } from "@/lib/auction/http";

export async function POST(req: Request) {
  const b = await readJson(req);
  const name = str(b.name, 40);
  const holdAmount = parseMoney(b.holdAmount, 10_000);
  if (!name) return bad("name is required (max 40 chars)");
  if (holdAmount === null) return bad("holdAmount must be a positive dollar amount up to 10,000");
  try {
    const { paddle, orderId } = await createPaddle({ name, holdAmount });
    return Response.json(orderId ? { paddleId: paddle.id, orderId } : { paddleId: paddle.id, held: true });
  } catch (e) {
    return fail(e);
  }
}
