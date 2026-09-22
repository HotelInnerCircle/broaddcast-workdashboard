import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { paginationSchema } from "@/lib/api/pagination";
import { createTaskSchema, listTasksSchema } from "@/lib/validation/tasks";
import { createTask, listTasks } from "@/services/taskService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("tasks", "view");
  const r = await listTasks(ctx, parseQuery(req, listTasksSchema.merge(paginationSchema)));
  return paged(r.data, r.meta);
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("tasks", "create");
  return created(await createTask(ctx, await parseBody(req, createTaskSchema), clientIp(req)));
});
