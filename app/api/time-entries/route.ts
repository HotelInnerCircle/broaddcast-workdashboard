import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { timesheetQuerySchema } from "@/lib/validation/time";
import { listTimeEntries } from "@/services/timesheetService";

/** Timesheets (spec 12.14). Employees only ever receive their own entries. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("timer", "view");
  const q = parseQuery(req, timesheetQuerySchema);
  return ok(await listTimeEntries(ctx, ctx.role === "EMPLOYEE" ? { ...q, userId: ctx.userId } : q));
});
