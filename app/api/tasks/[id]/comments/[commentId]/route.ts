import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { deleteComment } from "@/services/commentService";

export const DELETE = route(async (_req, { params }) => {
  const ctx = await requirePermission("tasks", "view");
  const { id, commentId } = await params;
  return ok(await deleteComment(ctx, id, commentId));
});
