// Per-request auction room via AsyncLocalStorage, so engine/store signatures stay unchanged.
// Room = `?room=CODE` query param or `x-gt-room` header (alphanumeric, <=12 chars). Default "MAIN".
// Codes are case-insensitive and canonicalised to upper case.
import { AsyncLocalStorage } from "node:async_hooks";

export const DEFAULT_ROOM = "MAIN";

const gl = globalThis as unknown as { __gtRoomAls?: AsyncLocalStorage<string> };
const als = (gl.__gtRoomAls ??= new AsyncLocalStorage<string>());

export function normalizeRoom(raw: string | null | undefined): string {
  const t = (raw ?? "").trim();
  return /^[A-Za-z0-9]{1,12}$/.test(t) ? t.toUpperCase() : DEFAULT_ROOM;
}

export function roomFromRequest(req: Request): string {
  let q: string | null = null;
  try {
    q = new URL(req.url).searchParams.get("room");
  } catch {
    // invalid URL: ignore
  }
  return normalizeRoom(q ?? req.headers.get("x-gt-room"));
}

/** Run `fn` (sync or async) with the request's room as the current room. */
export function withRoom<T>(req: Request, fn: () => T): T {
  return als.run(roomFromRequest(req), fn);
}

/** Run `fn` in a named room (e.g. webhooks that resolved the room from a PayPal id). */
export function runInRoom<T>(room: string, fn: () => T): T {
  return als.run(normalizeRoom(room), fn);
}

export function currentRoom(): string {
  return als.getStore() ?? DEFAULT_ROOM;
}

/** Fresh random room code (6 chars, no look-alikes). */
export function newRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let k = 0; k < 6; k++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
