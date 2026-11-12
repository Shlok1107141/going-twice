import { withRoom } from "@/lib/auction/room";
import { retryPayout } from "@/lib/auction/engine";
import { fail } from "@/lib/auction/http";

export const maxDuration = 60;

// POST: re-send ONLY the payout of a closed auction whose payout is pending (state.payoutStatus.state
// === "retry"). Idempotent: once paid, returns {ok:true, retried:false} and moves no money.
async function handle() {
  try {
    const r = await retryPayout();
    return Response.json({ ok: r.ok, retried: r.retried, payoutStatus: r.state.payoutStatus ?? null, totals: r.state.totals, state: r.state }, { status: r.ok ? 200 : 502 });
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle());
