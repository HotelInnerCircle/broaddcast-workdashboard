import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { attendanceQuerySchema } from "@/lib/validation/time";
import { requireVisibleEmployee } from "@/services/scope";
import { listBreaks } from "@/services/breakService";

/**
 * Somebody's breaks for a day range. `listBreaks` filters by user id and the tenant only, so who
 * may be asked about is decided here - by the people scope rather than by the caller's role name,
 * which let a team lead read the breaks of anyone in the company.
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("timer", "view");
  const q = parseQuery(req, attendanceQuerySchema);
  const userId = q.userId && q.userId !== ctx.userId ? String(await requireVisibleEmployee(ctx, q.userId)) : ctx.userId;
  return ok(await listBreaks(ctx, userId, q.from, q.to));
});
