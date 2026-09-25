import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { leavePolicySchema } from "@/lib/validation/leave";
import { listPolicies, setPolicy } from "@/services/leaveService";

/** Everyone may read the entitlements; only HR and the admin set them. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const year = new URL(req.url).searchParams.get("year");
  return ok(await listPolicies(ctx, year ? Number(year) : undefined));
});

export const PUT = route(async (req) => {
  const ctx = await requirePermission("scheduling", "manage");
  return ok(await setPolicy(ctx, await parseBody(req, leavePolicySchema), clientIp(req)));
});
