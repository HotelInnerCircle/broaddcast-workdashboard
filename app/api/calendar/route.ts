import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { calendarQuerySchema } from "@/lib/validation/tasks";
import { calendarEvents } from "@/services/taskService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("tasks", "view");
  const { from, to } = parseQuery(req, calendarQuerySchema);
  if (to.getTime() - from.getTime() > 100 * 86_400_000) throw Errors.bad("RANGE_TOO_LARGE", "Calendar range must be at most 100 days");
  return ok(await calendarEvents(ctx, from, to));
});
