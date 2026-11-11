import { autopilotStatus, startAutopilot, stopAutopilot } from "@/lib/ai/autopilot";
import { bad, fail, readJson } from "@/lib/auction/http";
import { currentRoom, withRoom } from "@/lib/auction/room";

export const maxDuration = 120;

export const GET = (req: Request) => withRoom(req, async () => Response.json(autopilotStatus(currentRoom())));

async function handle(req: Request) {
  const b = await readJson(req);
  const roomKey = currentRoom();
  try {
    if (b.action === "start") return Response.json(await startAutopilot({ autoClose: b.autoClose === true, roomKey }));
    if (b.action === "stop") return Response.json(stopAutopilot(roomKey));
    return bad('action must be "start" or "stop"');
  } catch (e) {
    return fail(e);
  }
}

export const POST = (req: Request) => withRoom(req, () => handle(req));
