import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { attendanceQuerySchema } from "@/lib/validation/time";
import { listBreaks } from "@/services/breakService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("timer", "view");
  const q = parseQuery(req, attendanceQuerySchema);
  return ok(await listBreaks(ctx, q.userId && ctx.role !== "EMPLOYEE" ? q.userId : ctx.userId, q.from, q.to));
});
