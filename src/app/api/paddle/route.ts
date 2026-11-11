import { withRoom } from "@/lib/auction/room";
import { createPaddle, parseMoney } from "@/lib/auction/engine";
import { bad, fail, readJson, str } from "@/lib/auction/http";

async function handle(req: Request) {
  const b = await readJson(req);
  const name = str(b.name, 40);
  const holdAmount = parseMoney(b.holdAmount, 10_000);
  const testCard = b.testCard === true;
  const email = b.email === undefined || b.email === "" ? undefined : str(b.email, 254);
  if (!name) return bad("name is required (max 40 chars)");
  if (email === null || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return bad("email must be a valid address");
  if (holdAmount === null) return bad("holdAmount must be a positive dollar amount up to 10,000");
  try {
    const { paddle, orderId } = await createPaddle({ name, holdAmount, testCard, email });
    return Response.json(orderId ? { paddleId: paddle.id, orderId } : { paddleId: paddle.id, held: true });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle(req));
