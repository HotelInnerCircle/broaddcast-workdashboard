import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { requireVisibleEmployee } from "@/services/scope";
import { leaveBalance } from "@/services/leaveService";

/**
 * Your own balance by default; someone else's only if they are within your people scope.
 *
 * The check is the scope, not the role name. `role !== "EMPLOYEE"` used to stand in for it, which
 * let a team lead read the balance of anybody in the company rather than of their own team.
 */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const url = new URL(req.url);
  const asked = url.searchParams.get("userId");
  const year = url.searchParams.get("year");
  const userId = asked && asked !== ctx.userId ? String(await requireVisibleEmployee(ctx, asked)) : ctx.userId;
  return ok(await leaveBalance(ctx, userId, year ? Number(year) : undefined));
});
