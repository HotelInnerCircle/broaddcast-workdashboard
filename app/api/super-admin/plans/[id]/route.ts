import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/context";
import { updatePlanSchema } from "@/lib/validation/billing";
import { updatePlan } from "@/services/billingService";

/** Plans and their limits are editable by the Super Admin only (spec section 15). */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requireRole("SUPER_ADMIN");
  return ok(await updatePlan(ctx, (await params).id, await parseBody(req, updatePlanSchema), clientIp(req)));
});
