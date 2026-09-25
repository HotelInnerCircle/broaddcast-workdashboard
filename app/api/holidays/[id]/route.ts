import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { deleteHoliday } from "@/services/schedulingService";

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("scheduling", "archive");
  await deleteHoliday(ctx, (await params).id, clientIp(req));
  return ok({ deleted: true });
});
