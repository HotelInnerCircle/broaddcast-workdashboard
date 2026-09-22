import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { markReviewed } from "@/services/attendanceService";

export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("attendance", "update");
  return ok(await markReviewed(ctx, (await params).id, clientIp(req)));
});
