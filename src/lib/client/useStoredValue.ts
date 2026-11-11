"use client";

import { roomParam } from "./api";
import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** localStorage-backed string. `value` is null on the server and when unset; `ready` is false until hydrated. */
export function useStoredValue(baseKey: string) {
  // Scoped per room so a paddle id from one room never resolves to another room's paddle.
  const room = roomParam();
  const key = room ? `${baseKey}:${room.toUpperCase()}` : baseKey;
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const set = useCallback(
    (next: string | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, next);
      } catch {
        // storage blocked: ignore
      }
      listeners.forEach((l) => l());
    },
    [key],
  );
  return { value, set, ready };
}
