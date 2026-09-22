import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { updateProjectSchema } from "@/lib/validation/projects";
import { getProject, updateProject } from "@/services/projectService";

export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("projects", "view");
  return ok(await getProject(ctx, (await params).id));
});

export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("projects", "update");
  return ok(await updateProject(ctx, (await params).id, await parseBody(req, updateProjectSchema), clientIp(req)));
});
