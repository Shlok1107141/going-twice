// Fault injection for scripts/break-tests.mjs. 404 unless the server runs with GT_TEST_HOOKS=1
// (and never with PAYPAL_ENV=live). Simulated failures happen before any PayPal call.
import { currentRoom, withRoom } from "@/lib/auction/room";
import { bad, readJson } from "@/lib/auction/http";
import { getHooks, setGeminiHook, setHooks, testHooksEnabled, type Hooks } from "@/lib/auction/testHooks";

const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);

async function handle(req: Request) {
  if (!testHooksEnabled()) return bad("Not found", 404);
  const b = await readJson(req);
  const h: Hooks = {};
  if (b.failPayout !== undefined) {
    const issue = typeof b.failPayout === "string" && /^[A-Z_]{3,40}$/.test(b.failPayout) ? b.failPayout : null;
    const times = count(b.times ?? 1);
    if (!issue || times === null) return bad("failPayout must be a PayPal issue like INSUFFICIENT_FUNDS; times 0-100");
    h.failPayout = { issue, times };
  }
  if (b.failCapture !== undefined) {
    const times = count(b.failCapture);
    if (times === null) return bad("failCapture must be a count 0-100");
    h.failCapture = { times };
  }
  if (b.gemini429 !== undefined) {
    const times = count(b.gemini429);
    if (times === null) return bad("gemini429 must be a count 0-100");
    setGeminiHook(429, times);
  }
  setHooks(currentRoom(), h);
  return Response.json({ ok: true, room: currentRoom(), hooks: getHooks(currentRoom()) });
}

export const POST = (req: Request) => withRoom(req, () => handle(req));
