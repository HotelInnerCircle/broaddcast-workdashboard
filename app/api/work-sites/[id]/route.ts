import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { workSitePatchSchema } from "@/lib/validation/swipes";
import { updateWorkSite, deleteWorkSite } from "@/services/workSiteService";

export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("workSites", "update");
  return ok(await updateWorkSite(ctx, (await params).id, await parseBody(req, workSitePatchSchema), clientIp(req)));
});

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("workSites", "archive");
  await deleteWorkSite(ctx, (await params).id, clientIp(req));
  return ok({ deleted: true });
});
