import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { resumeTimer } from "@/services/timerService";

export const POST = route(async () => {
  const ctx = await requirePermission("timer", "update");
  return ok(await resumeTimer(ctx));
});
