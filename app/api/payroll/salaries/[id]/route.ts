import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { deleteSalary } from "@/services/payrollService";

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("payslips", "manage");
  return ok(await deleteSalary(ctx, (await params).id, clientIp(req)));
});
