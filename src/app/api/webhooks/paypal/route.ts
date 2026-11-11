import { applyWebhook } from "@/lib/auction/engine";
import { isDemoMode } from "@/lib/auction/store";
import { verifyWebhookSignature } from "@/lib/paypal";

// Always 200 (PayPal retries non-2xx for days); unverified events are logged and ignored.
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const allowUnverified = isDemoMode() || process.env.PAYPAL_WEBHOOK_ALLOW_UNVERIFIED === "1";
    let verified = false;
    if (!isDemoMode() && process.env.PAYPAL_WEBHOOK_ID) {
      verified = await verifyWebhookSignature({ headers: req.headers, rawBody }).catch((e) => {
        console.error("[webhook] verify failed:", (e as Error).message);
        return false;
      });
    }
    if (!verified && !allowUnverified) {
      console.warn("[webhook] signature not verified; ignored");
      return Response.json({ ok: true, ignored: true });
    }
    applyWebhook(JSON.parse(rawBody));
    return Response.json({ ok: true, verified });
  } catch (e) {
    console.error("[webhook]", e instanceof Error ? e.message : e);
    return Response.json({ ok: true });
  }
}
