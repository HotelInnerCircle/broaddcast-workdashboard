import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { rateLimit } from "@/lib/rate-limit";
import { generatePayslip, generateAll } from "@/services/payrollService";
import { generateSchema } from "@/lib/validation/payroll";
import { parseBody } from "@/lib/api/response";

/**
 * Work out a payslip and store the PDF (A103).
 *
 * With a `userId`, one person. Without, everybody who has a salary set - the
 * monthly run. Both are safe to repeat: a payslip is replaced, never duplicated,
 * and what HR typed in (TDS, an advance) is carried over.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("payslips", "create");
  rateLimit(`payroll:${ctx.companyId}`, 20, 60_000);
  const input = await parseBody(req, generateSchema);
  const ip = clientIp(req);
  if (input.userId) return ok(await generatePayslip(ctx, input as { userId: string }, ip));
  return ok(await generateAll(ctx, input.month, ip));
});
