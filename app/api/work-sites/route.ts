import { route, clientIp } from "@/lib/api/handler";
import { ok, created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { workSiteSchema } from "@/lib/validation/swipes";
import { listWorkSites, createWorkSite } from "@/services/workSiteService";

/** The places attendance may be swiped from (A83). Anyone who can swipe needs to see them. */
export const GET = route(async () => {
  const ctx = await requirePermission("attendance", "create");
  return ok(await listWorkSites(ctx));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("workSites", "create");
  return created(await createWorkSite(ctx, await parseBody(req, workSiteSchema), clientIp(req)));
});
