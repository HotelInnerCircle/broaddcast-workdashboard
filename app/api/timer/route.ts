import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { getActiveTimer, daySummary } from "@/services/timerService";

/** Active timer + break + today's summary; called on app load to restore the widget (spec 7.1). */
export const GET = route(async () => {
  const ctx = await requirePermission("timer", "view");
  const [active, summary] = await Promise.all([getActiveTimer(ctx), daySummary(ctx, ctx.userId)]);
  return ok({ ...active, summary });
});
