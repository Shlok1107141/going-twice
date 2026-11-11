// Dev-only stand-in for `render workflows dev` (the Render CLI task server, port 8120) so the web app's
// Render SDK path can be exercised without the CLI: POST /v1/task-runs runs the task in this process
// (ctx.run just calls the child task), GET /v1/task-runs/events streams the terminal SSE event.
// Usage: npx tsx workflows/mock-server.ts   then run Next with RENDER_USE_LOCAL_DEV=true RENDER_WORKFLOWS=1
//        RENDER_WORKFLOW_SLUG=going-twice-settlement. Not used on Render.
import { createServer } from "node:http";
import * as tasks from "./tasks";

type Def = { name: string; func: (ctx: unknown, ...a: unknown[]) => unknown };
const defs = new Map<string, Def>(Object.values(tasks).map((d) => [(d as Def).name, d as Def]));
const ctx = { run: (d: Def, ...a: unknown[]) => Promise.resolve(d.func(ctx, ...a)) };
const runs = new Map<string, Record<string, unknown>>();
const byKey = new Map<string, string>();
let n = 0;

const json = (res: import("node:http").ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "POST" && url.pathname === "/v1/task-runs") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const { task, input, idempotencyKey } = JSON.parse(raw) as { task: string; input: unknown[]; idempotencyKey?: string };
      if (idempotencyKey && byKey.has(idempotencyKey)) return json(res, 200, { id: byKey.get(idempotencyKey) });
      const id = `trn-mock${++n}`;
      if (idempotencyKey) byKey.set(idempotencyKey, id);
      const def = defs.get(task.split("/").pop() ?? "");
      const base = { id, taskId: task, input, status: "running", results: [], retries: 0, attempts: [] };
      runs.set(id, base);
      (async () => {
        try {
          if (!def) throw new Error(`unknown task ${task}`);
          runs.set(id, { ...base, status: "succeeded", results: [await def.func(ctx, ...input)] });
        } catch (e) {
          runs.set(id, { ...base, status: "failed", error: String(e) });
        }
        console.log(`[mock] ${id} ${task} ${runs.get(id)?.status}`);
      })();
      json(res, 200, { id });
    });
  } else if (url.pathname === "/v1/task-runs/events") {
    const id = (url.searchParams.get("taskRunIds") ?? "").split(",")[0];
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const t = setInterval(() => {
      const r = runs.get(id);
      if (r && r.status !== "running") {
        res.write(`event: task.completed\ndata: ${JSON.stringify(r)}\n\n`);
        clearInterval(t);
        res.end();
      }
    }, 100);
    req.on("close", () => clearInterval(t));
  } else json(res, 404, { message: "not found" });
}).listen(Number(process.env.PORT ?? 8120), () => console.log("[mock] task server on", process.env.PORT ?? 8120));
