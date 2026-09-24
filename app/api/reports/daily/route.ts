import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { dailyReportQuerySchema } from "@/lib/validation/reports";
import { dailyReportsForRange } from "@/services/reportService";
import { companyClock } from "@/lib/time/company-clock";

/**
 * Manager daily-report view (spec 12.17): reports beside tracked hours and per-client split,
 * over a date range (A79). `?date=` still works as a single day, which is what the
 * "X submitted their daily report" notification links to.
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "view");
  const q = parseQuery(req, dailyReportQuerySchema);
  const today = (await companyClock(ctx.companyId)).dayOf(new Date());
  const asked = { from: q.from ?? q.date ?? today, to: q.to ?? q.date ?? today };
  // Swap a back-to-front range rather than returning an empty page for it.
  const [from, to] = asked.from > asked.to ? [asked.to, asked.from] : [asked.from, asked.to];
  // An employee can only ever be shown their own row, whatever they ask for.
  return ok(await dailyReportsForRange(ctx, from, to, { userId: ctx.role === "EMPLOYEE" ? ctx.userId : q.userId, teamId: q.teamId, status: q.status }));
});
