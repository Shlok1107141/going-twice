"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** window.location.origin ("" during SSR). */
export function useOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "",
  );
}
