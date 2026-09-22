import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { stopTimerSchema } from "@/lib/validation/time";
import { stopTimer } from "@/services/timerService";

export const POST = route(async (req) => {
  const ctx = await requirePermission("timer", "update");
  return ok(await stopTimer(ctx, await parseBody(req, stopTimerSchema), clientIp(req)));
});
