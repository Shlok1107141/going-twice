import { withRoom } from "@/lib/auction/room";
import { retryPayout } from "@/lib/auction/engine";
import { bad, fail, readJson } from "@/lib/auction/http";
import { getInternal, peekState } from "@/lib/auction/store";
import { connection } from "next/server";

export const maxDuration = 60;

// GET: feature probe for the admin page. {available:true, pending} where pending = the room is closed
// and its payout still has to be sent (state.payoutStatus.state === "retry").
async function probe() {
  await connection();
  const s = peekState();
  const pending = s.status === "closed" && s.payoutStatus?.state === "retry";
  return Response.json({ available: true, pending, payoutStatus: s.payoutStatus ?? null }, { headers: { "Cache-Control": "no-store" } });
}

// POST { ledgerId? }: re-send ONLY the payout of a closed auction whose payout is pending. ledgerId (the
// pending/failed payout row the admin clicked) is optional and only sanity-checked: the server always
// retries the room's one payout. Idempotent: once paid, returns {ok:true, retried:false}, no money moves.
async function handle(req: Request) {
  const b = await readJson(req);
  if (b.ledgerId !== undefined && b.ledgerId !== null) {
    const row = typeof b.ledgerId === "string" ? peekState().ledger.find((r) => r.id === b.ledgerId) : undefined;
    if (!row || row.kind !== "payout") return bad("ledgerId is not a payout row in this room");
  }
  try {
    const r = await retryPayout();
    return Response.json(
      { ok: r.ok, ...(r.ok ? {} : { error: `Payout still pending: ${r.state.payoutStatus?.error ?? "PayPal refused it"}` }), retried: r.retried, alreadyPaid: getInternal().payoutDone && !r.retried, payoutStatus: r.state.payoutStatus ?? null, totals: r.state.totals, state: r.state },
      { status: r.ok ? 200 : 502 },
    );
  } catch (e) {
    return fail(e);
  }
}

export const GET = (req: Request) => withRoom(req, () => probe());
export const POST = (req: Request) => withRoom(req, () => handle(req));
