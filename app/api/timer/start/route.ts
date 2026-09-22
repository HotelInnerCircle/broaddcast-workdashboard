import { route, clientIp } from "@/lib/api/handler";
import { created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { startTimerSchema } from "@/lib/validation/time";
import { startTimer } from "@/services/timerService";

export const POST = route(async (req) => {
  const ctx = await requirePermission("timer", "create");
  return created(await startTimer(ctx, await parseBody(req, startTimerSchema), clientIp(req)));
});
