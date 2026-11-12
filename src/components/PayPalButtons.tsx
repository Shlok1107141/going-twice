"use client";

import { useEffect, useRef, useState } from "react";
import { post } from "@/lib/client/api";

type PayPalNamespace = {
  Buttons: (config: {
    createOrder: () => string | Promise<string>;
    onApprove: (data: { orderID: string }) => void | Promise<void>;
    onError?: (err: unknown) => void;
    onCancel?: () => void;
    style?: Record<string, unknown>;
  }) => { render: (el: HTMLElement) => Promise<void>; close: () => Promise<void> };
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
let sdkPromise: Promise<PayPalNamespace> | null = null;

function loadSdk(): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CLIENT_ID ?? "")}&intent=authorize&currency=USD&components=buttons`;
      s.async = true;
      s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK did not initialise")));
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error("Could not load the PayPal SDK"));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

/**
 * PayPal Buttons for an order the SERVER already created (intent=authorize).
 * onApprove calls POST /api/paddle/{paddleId}/authorize with { orderId }.
 */
export function PayPalButtons({
  paddleId,
  orderId,
  onAuthorized,
}: {
  paddleId: string;
  orderId: string;
  onAuthorized: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cb = useRef(onAuthorized);
  const [error, setError] = useState<string | null>(CLIENT_ID ? null : "NEXT_PUBLIC_PAYPAL_CLIENT_ID is not set, so PayPal buttons cannot load.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    cb.current = onAuthorized;
  }, [onAuthorized]);

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;
    let instance: { close: () => Promise<void> } | null = null;
    loadSdk()
      .then(async (paypal) => {
        if (cancelled || !container.current) return;
        const buttons = paypal.Buttons({
          style: { layout: "vertical", shape: "pill", label: "pay", color: "gold" },
          createOrder: () => orderId,
          onApprove: async (data) => {
            setBusy(true);
            try {
              await post(`/api/paddle/${paddleId}/authorize`, { orderId: data.orderID || orderId });
              cb.current();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Authorization failed");
            } finally {
              setBusy(false);
            }
          },
          onError: () => setError("PayPal reported a problem. Please try again."),
        });
        instance = buttons;
        await buttons.render(container.current);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "PayPal failed to load");
      });
    return () => {
      cancelled = true;
      instance?.close().catch(() => {});
    };
  }, [orderId, paddleId]);

  return (
    <div>
      <div ref={container} className="min-h-[120px]" aria-busy={busy} />
      {busy && <p className="mt-2 text-center text-sm text-muted anim-breathe">Confirming your hold&hellip;</p>}
      {error && (
        <p role="alert" className="mt-2 rounded-md bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
