/** Current page's `?room=` (so every call hits the same auction room as the page); "" when none. */
export function roomParam(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("room") ?? "";
}

/** Append the page's room to an API path. */
export function withRoomQuery(path: string): string {
  const room = roomParam();
  if (!room) return path;
  return `${path}${path.includes("?") ? "&" : "?"}room=${encodeURIComponent(room)}`;
}

/** POST JSON and return the parsed body; throws Error(message) on HTTP errors or `{ok:false,error}`. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withRoomQuery(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }
  const obj = (data ?? {}) as { ok?: boolean; error?: string };
  if (!res.ok || obj.ok === false) {
    throw new Error(obj.error || `Request failed (${res.status})`);
  }
  return data as T;
}
