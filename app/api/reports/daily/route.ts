import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { dailyReportQuerySchema } from "@/lib/validation/reports";
import { dailyReportsForDay } from "@/services/reportService";
import { companyClock } from "@/lib/time/company-clock";

/** Manager daily-report view (spec 12.17): reports beside tracked hours and per-client split. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "view");
  const q = parseQuery(req, dailyReportQuerySchema);
  const date = q.date ?? (await companyClock(ctx.companyId)).dayOf(new Date());
  return ok(await dailyReportsForDay(ctx, date, { userId: ctx.role === "EMPLOYEE" ? ctx.userId : q.userId, teamId: q.teamId }));
});
