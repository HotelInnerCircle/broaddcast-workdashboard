import { NextResponse } from "next/server";
import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { dailyReportQuerySchema } from "@/lib/validation/reports";
import { dailyReportsForRange, dailyReportsTable } from "@/services/reportService";
import { companyClock } from "@/lib/time/company-clock";
import { exportTable } from "@/lib/export";
import { audit } from "@/lib/audit";

/**
 * Manager daily-report view (spec 12.17): reports beside tracked hours and per-client split,
 * over a date range (A79). `?date=` still works as a single day, which is what the
 * "X submitted their daily report" notification links to.
 *
 * `?format=csv|xlsx|pdf` downloads the same rows the screen is showing, filters and all (A98).
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("dailyReports", "view");
  const q = parseQuery(req, dailyReportQuerySchema);
  const today = (await companyClock(ctx.companyId)).dayOf(new Date());
  const asked = { from: q.from ?? q.date ?? today, to: q.to ?? q.date ?? today };
  // Swap a back-to-front range rather than returning an empty page for it.
  const [from, to] = asked.from > asked.to ? [asked.to, asked.from] : [asked.from, asked.to];
  // An employee can only ever be shown their own row, whatever they ask for.
  const data = await dailyReportsForRange(ctx, from, to, { userId: ctx.role === "EMPLOYEE" ? ctx.userId : q.userId, teamId: q.teamId, status: q.status });

  if (q.format === "json") return ok(data);

  const file = await exportTable(dailyReportsTable(data, ctx.company!.timezone), q.format);
  // Exports leave the building, so they are recorded like the other reports are.
  await audit({
    ctx, companyId: ctx.companyId, entity: "report", entityId: null, action: "report.exported",
    summary: `${ctx.name} exported the daily reports (${q.format})`,
    after: { name: "daily", format: q.format, from, to },
  });
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
