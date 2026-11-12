"use client";

import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<unknown> };

/** Small "Install app" hint for phones: native prompt where available, otherwise the iOS Share steps. */
export function InstallHint() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<"hidden" | "ios" | "other">("hidden");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    const mobile = /iphone|ipad|ipod|android/i.test(navigator.userAgent);
    if (standalone || !mobile) return;
    try {
      if (localStorage.getItem("gt.installDismissed") === "1") return;
    } catch {
      // storage blocked: still show
    }
    queueMicrotask(() => setMode(/iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "other"));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (mode === "hidden" || dismissed) return null;
  if (mode === "other" && !deferred) return null;

  function hide() {
    setDismissed(true);
    try {
      localStorage.setItem("gt.installDismissed", "1");
    } catch {
      // ignore
    }
  }

  return (
    <aside aria-label="Install app" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2">
      <span>
        {mode === "ios" ? (
          <>Install this app: tap Share, then &ldquo;Add to Home Screen&rdquo;.</>
        ) : (
          <>Install Going Twice on your home screen for one-tap bidding.</>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {deferred && (
          <button type="button" onClick={() => void deferred.prompt()} className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-canvas">
            Install app
          </button>
        )}
        <button type="button" onClick={hide} className="text-muted hover:text-ink" aria-label="Dismiss install hint">
          &times;
        </button>
      </span>
    </aside>
  );
}
