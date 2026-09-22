import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission, type CompanyContext } from "@/lib/auth/context";
import { reportFilterSchema, type ReportFilter } from "@/lib/validation/reports";
import { exportTable, type ExportTable } from "@/lib/export";
import { audit } from "@/lib/audit";

/**
 * Shared shape for every /api/reports/* endpoint: same filters (spec 12.18), JSON by default,
 * `?format=csv|xlsx|pdf` streams a file built from the report's table view.
 */
export function reportRoute<T>(name: string, build: (ctx: CompanyContext, f: ReportFilter) => Promise<T>, table: (r: T, f: ReportFilter, tz: string) => ExportTable) {
  return route(async (req: NextRequest) => {
    const ctx = await requirePermission("reports", "view");
    const f = parseQuery(req, reportFilterSchema);
    const report = await build(ctx, f);
    if (f.format === "json") return ok(report);
    const file = await exportTable(table(report, f, ctx.company!.timezone), f.format);
    await audit({ ctx, companyId: ctx.companyId, entity: "report", entityId: null, action: "report.exported", summary: `${ctx.name} exported the ${name} report (${f.format})`, after: { name, format: f.format, from: f.from, to: f.to } });
    return new NextResponse(new Uint8Array(file.buffer), { headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" } });
  });
}
