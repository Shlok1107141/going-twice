"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Client-side QR code (no network). Renders as an <img> of a data URL. */
export function QrCode({ value, label, className = "" }: { value: string; label: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#141413", light: "#faf9f5" } })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) return <div className={`animate-pulse rounded-md bg-sunken ${className}`} aria-hidden />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label} className={`rounded-md bg-canvas ${className}`} />;
}
