import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireCompanySession, requirePermission } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { payslipFileUrl, deletePayslip } from "@/services/payslipService";

/** A short-lived link to the file: your own always, anyone else's only with the grant. */
export const GET = route(async (_req, { params }) => {
  const ctx = await requireCompanySession();
  return ok(await payslipFileUrl(ctx, (await params).id, can(ctx.role, "payslips", "view")));
});

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("payslips", "manage");
  return ok(await deletePayslip(ctx, (await params).id, clientIp(req)));
});
