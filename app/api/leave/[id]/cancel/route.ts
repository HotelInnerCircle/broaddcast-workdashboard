import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { cancelLeave } from "@/services/leaveService";

export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("attendance", "create");
  return ok(await cancelLeave(ctx, (await params).id, clientIp(req)));
});
