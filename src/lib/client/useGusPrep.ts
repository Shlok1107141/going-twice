"use client";

import { useEffect } from "react";
import { FORMS } from "@/lib/ai/gusLines";
import { post } from "./api";
import type { State } from "./types";
import { prewarm } from "./useSpeech";

/**
 * Gets Gus ready ahead of time on any page that plays his voice:
 *  - asks the server (one model call) for a sentence per waiting lot that has none yet;
 *  - renders, before they are needed, the coming lots' titles and pitches and every bidder's name.
 */
export function useGusPrep(state: State | null): void {
  const needPitch = state?.lots.filter((l) => l.status === "pending" && !l.pitch).map((l) => l.id).join(",") ?? "";
  useEffect(() => {
    if (needPitch) post("/api/gus/prepare").catch(() => {});
  }, [needPitch]);

  const coming = state ? state.lots.filter((l) => l.status === "pending" || l.status === "open").slice(0, 3) : [];
  const warmKey = state ? [...coming.map((l) => `${l.title}|${l.pitch ?? ""}|${l.consignor ?? ""}`), ...state.paddles.map((p) => p.name)].join("~") : "";
  useEffect(() => {
    if (!state || !warmKey) return;
    const texts: string[] = [];
    for (const l of coming) {
      texts.push(FORMS.title(l.title));
      if (l.pitch) texts.push(l.pitch);
      if (l.consignor) texts.push(FORMS.from(l.consignor));
    }
    for (const p of state.paddles.slice(0, 12)) texts.push(FORMS.name(p.name), FORMS.thanks(p.name), FORMS.soldTo(p.name));
    prewarm(texts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- warmKey captures everything read from state here
  }, [warmKey]);
}
