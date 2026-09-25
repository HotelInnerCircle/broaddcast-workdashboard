import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { leaveDecisionSchema } from "@/lib/validation/leave";
import { decideLeave } from "@/services/leaveService";

/** Who may act depends on which step the plan is sitting at, so the service enforces it. */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("attendance", "view");
  return ok(await decideLeave(ctx, (await params).id, await parseBody(req, leaveDecisionSchema), clientIp(req)));
});
