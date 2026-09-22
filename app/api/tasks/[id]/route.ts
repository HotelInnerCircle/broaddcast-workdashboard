import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { updateTaskSchema } from "@/lib/validation/tasks";
import { getTask, updateTask } from "@/services/taskService";

export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("tasks", "view");
  return ok(await getTask(ctx, (await params).id));
});

/** Field edits, assignment, status changes (Kanban drops call this) and archive/restore. */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("tasks", "update");
  return ok(await updateTask(ctx, (await params).id, await parseBody(req, updateTaskSchema), clientIp(req)));
});
