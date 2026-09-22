import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { removeAttachment } from "@/services/taskService";

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("tasks", "update");
  const { id, attachmentId } = await params;
  await removeAttachment(ctx, id, attachmentId, clientIp(req));
  return ok({ removed: true });
});
