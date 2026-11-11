import { autopilotStatus, startAutopilot, stopAutopilot } from "@/lib/ai/autopilot";
import { bad, fail, readJson } from "@/lib/auction/http";

export const maxDuration = 120;

export async function GET() {
  return Response.json(autopilotStatus());
}

export async function POST(req: Request) {
  const b = await readJson(req);
  try {
    if (b.action === "start") return Response.json(await startAutopilot({ autoClose: b.autoClose === true }));
    if (b.action === "stop") return Response.json(stopAutopilot());
    return bad('action must be "start" or "stop"');
  } catch (e) {
    return fail(e);
  }
}
