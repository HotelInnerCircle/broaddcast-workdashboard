import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { shiftPatchSchema } from "@/lib/validation/scheduling";
import { updateShift, deleteShift } from "@/services/schedulingService";

export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("scheduling", "update");
  return ok(await updateShift(ctx, (await params).id, await parseBody(req, shiftPatchSchema), clientIp(req)));
});

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("scheduling", "archive");
  return ok(await deleteShift(ctx, (await params).id, clientIp(req)));
});
