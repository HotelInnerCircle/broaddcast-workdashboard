import { route, clientIp } from "@/lib/api/handler";
import { ok, created, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { holidaySchema, holidayQuerySchema } from "@/lib/validation/scheduling";
import { listHolidays, createHoliday } from "@/services/schedulingService";

/** Holidays (A90). Everyone may read them - a holiday changes what the calendar means for all. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  return ok(await listHolidays(ctx, parseQuery(req, holidayQuerySchema)));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("scheduling", "create");
  return created(await createHoliday(ctx, await parseBody(req, holidaySchema), clientIp(req)));
});
