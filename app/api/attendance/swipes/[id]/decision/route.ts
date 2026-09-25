import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { swipeDecisionSchema } from "@/lib/validation/swipes";
import { decideSwipe } from "@/services/swipeService";

/**
 * One step of the approval chain decides (A83). Who may act is enforced in the service, not here -
 * it depends on which step the swipe is sitting at, not on a single permission.
 */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("attendance", "view");
  return ok(await decideSwipe(ctx, (await params).id, await parseBody(req, swipeDecisionSchema), clientIp(req)));
});
