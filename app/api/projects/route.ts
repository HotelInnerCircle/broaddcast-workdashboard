import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseBody, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { paginationSchema } from "@/lib/api/pagination";
import { createProjectSchema, listProjectsSchema } from "@/lib/validation/projects";
import { createProject, listProjects } from "@/services/projectService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("projects", "view");
  const r = await listProjects(ctx, parseQuery(req, listProjectsSchema.merge(paginationSchema)));
  return paged(r.data, r.meta);
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("projects", "create");
  return created(await createProject(ctx, await parseBody(req, createProjectSchema), clientIp(req)));
});
