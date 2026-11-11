import { applyWebhook } from "@/lib/auction/engine";
import { runInRoom } from "@/lib/auction/room";
import { isDemoMode, roomForPaypalId } from "@/lib/auction/store";
import { verifyWebhookSignature } from "@/lib/paypal";

// Always 200 (PayPal retries non-2xx for days); unverified events are logged and ignored.
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const allowUnverified = isDemoMode() || process.env.PAYPAL_WEBHOOK_ALLOW_UNVERIFIED === "1";
    let verified = false;
    if (!isDemoMode() && !process.env.PAYPAL_WEBHOOK_ID) {
      console.warn("[webhook] PAYPAL_WEBHOOK_ID is not set; signature verification skipped");
    } else if (!isDemoMode()) {
      verified = await verifyWebhookSignature({ headers: req.headers, rawBody }).catch((e) => {
        console.error("[webhook] verify failed:", (e as Error).message);
        return false;
      });
    }
    if (!verified && !allowUnverified) {
      console.warn("[webhook] signature not verified; ignored");
      return Response.json({ ok: true, ignored: true });
    }
    const ev = JSON.parse(rawBody) as { resource?: Record<string, unknown> };
    // The webhook carries no room: find the room that holds the referenced PayPal id.
    const r = (ev.resource ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const room = roomForPaypalId(
      r.id,
      r.invoice?.id,
      r.batch_header?.payout_batch_id,
      r.payout_batch_id,
      r.supplementary_data?.related_ids?.authorization_id,
    );
    if (!room) {
      console.warn("[webhook] no room holds this PayPal id; ignored");
      return Response.json({ ok: true, verified, ignored: true });
    }
    runInRoom(room, () => applyWebhook(ev as Parameters<typeof applyWebhook>[0]));
    return Response.json({ ok: true, verified });
  } catch (e) {
    console.error("[webhook]", e instanceof Error ? e.message : e);
    return Response.json({ ok: true });
  }
}
