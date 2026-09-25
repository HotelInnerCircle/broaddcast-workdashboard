import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { leaveBalance } from "@/services/leaveService";

/** Your own balance by default; HR and managers may ask for someone else's. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const url = new URL(req.url);
  const asked = url.searchParams.get("userId");
  const year = url.searchParams.get("year");
  const userId = asked && asked !== ctx.userId && ctx.role !== "EMPLOYEE" ? asked : ctx.userId;
  return ok(await leaveBalance(ctx, userId, year ? Number(year) : undefined));
});
