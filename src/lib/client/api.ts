/** POST JSON and return the parsed body; throws Error(message) on HTTP errors or `{ok:false,error}`. */
export async function post<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
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
