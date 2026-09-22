import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { dailyReportQuerySchema, dailyReportSchema } from "@/lib/validation/reports";
import { listDailyReports, submitDailyReport } from "@/services/dailyReportService";
import { companyClock } from "@/lib/time/company-clock";

export const GET = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "view");
  const q = parseQuery(req, dailyReportQuerySchema);
  const today = (await companyClock(ctx.companyId)).dayOf(new Date());
  const from = q.from ?? q.date ?? today, to = q.to ?? q.date ?? today;
  return ok(await listDailyReports(ctx, { from, to, userId: ctx.role === "EMPLOYEE" ? ctx.userId : q.userId, teamId: q.teamId }));
});

/** Submit or update the caller's own report (spec 12.17). */
export const POST = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "create");
  return ok(await submitDailyReport(ctx, await parseBody(req, dailyReportSchema), clientIp(req)));
});
