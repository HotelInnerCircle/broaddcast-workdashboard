import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { attendanceQuerySchema } from "@/lib/validation/time";
import { listAttendance } from "@/services/attendanceService";

/** Attendance table (spec 12.13). Scope: employee own, team lead team, manager scope, admin all. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const q = parseQuery(req, attendanceQuerySchema);
  return ok(await listAttendance(ctx, { from: q.from, to: q.to, userId: q.userId, flagged: q.flagged === "true" }));
});
