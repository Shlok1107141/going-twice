// Channel3 product search. With CHANNEL3_API_KEY: REST /v1/search. Without: Channel3's keyless
// MCP endpoint (JSON-RPC over HTTP: initialize -> tools/call search_products). Either way we
// normalize to the same matches. Server-only. Returns [] on failure.

export type ChannelMatch = {
  title: string;
  brand: string;
  price: number;
  currency: string;
  image?: string;
  retailer: string;
  url: string;
};

type RawProduct = {
  title?: string;
  brands?: Array<{ name?: string }>;
  images?: Array<{ url?: string; cleaned_url?: string | null; is_main_image?: boolean }>;
  offers?: Array<{ url?: string; domain?: string; price?: { price?: number; currency?: string } }>;
};

const MCP_URL = "https://mcp.trychannel3.com/";
const REST_URL = "https://api.trychannel3.com/v1/search";

function normalize(products: RawProduct[], limit: number): ChannelMatch[] {
  const out: ChannelMatch[] = [];
  for (const p of products) {
    const offers = (p.offers ?? []).filter((o) => typeof o.price?.price === "number" && o.price.price > 0);
    if (!p.title || offers.length === 0) continue;
    const best = offers.reduce((a, b) => ((b.price?.price ?? 0) < (a.price?.price ?? 0) ? b : a));
    const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
    out.push({
      title: p.title,
      brand: p.brands?.[0]?.name ?? "",
      price: best.price!.price!,
      currency: best.price!.currency ?? "USD",
      image: img?.cleaned_url ?? img?.url,
      retailer: best.domain ?? "retailer",
      url: best.url ?? "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function viaRest(query: string, key: string, limit: number): Promise<ChannelMatch[]> {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ query, limit: Math.max(limit, 8) }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`channel3 rest ${res.status}`);
  const body = (await res.json()) as { products?: RawProduct[] } | RawProduct[];
  return normalize(Array.isArray(body) ? body : (body.products ?? []), limit);
}

/** Streamable HTTP replies are JSON or an SSE stream; pull the JSON-RPC message out of either. */
async function rpcBody(res: Response): Promise<{ result?: Record<string, unknown> } | null> {
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  try {
    return JSON.parse(line ? line.slice(5) : text);
  } catch {
    return null;
  }
}

async function viaMcp(query: string, limit: number): Promise<ChannelMatch[]> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const post = (body: unknown, h: Record<string, string>) =>
    fetch(MCP_URL, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(20000), cache: "no-store" });

  const init = await post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "going-twice", version: "1.0" } },
    },
    headers,
  );
  if (!init.ok) throw new Error(`channel3 mcp init ${init.status}`);
  await init.text();
  const sid = init.headers.get("mcp-session-id");
  const h = sid ? { ...headers, "mcp-session-id": sid } : headers;
  await (await post({ jsonrpc: "2.0", method: "notifications/initialized" }, h)).text();
  const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_products", arguments: { query } } }, h);
  if (!res.ok) throw new Error(`channel3 mcp call ${res.status}`);
  const msg = await rpcBody(res);
  const products = (msg?.result?.structuredContent as { products?: RawProduct[] } | undefined)?.products ?? [];
  return normalize(products, limit);
}

export function channel3Mode(): "rest" | "mcp" {
  return process.env.CHANNEL3_API_KEY ? "rest" : "mcp";
}

export async function searchChannel3(query: string, limit = 3): Promise<ChannelMatch[]> {
  const key = process.env.CHANNEL3_API_KEY;
  if (key) {
    try {
      const r = await viaRest(query, key, limit);
      if (r.length) return r;
    } catch (e) {
      console.error("[channel3] rest failed, trying mcp:", (e as Error).message);
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await viaMcp(query, limit);
    } catch (e) {
      console.error("[channel3]", (e as Error).message);
    }
  }
  return [];
}
