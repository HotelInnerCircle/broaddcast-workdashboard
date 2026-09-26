import { route, clientIp } from "@/lib/api/handler";
import { ok, created } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { salaryRegister, salaryHistory, setSalary } from "@/services/payrollService";
import { salarySchema } from "@/lib/validation/payroll";
import { parseBody } from "@/lib/api/response";

/** Everybody and what they are paid, or one person's history with `?userId=`. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("payslips", "view");
  const userId = new URL(req.url).searchParams.get("userId");
  return ok(userId ? await salaryHistory(ctx, userId) : await salaryRegister(ctx));
});

/** Set a salary from a date. A raise is a new row, never an edit to the old one. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("payslips", "manage");
  const input = await parseBody(req, salarySchema);
  return created(await setSalary(ctx, input, clientIp(req)));
});
