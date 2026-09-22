import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { confirmSchema } from "@/lib/validation/billing";
import { confirmCheckout } from "@/services/billingService";

export const POST = route(async (req) => {
  const ctx = await requirePermission("billing", "manage");
  return ok(await confirmCheckout(ctx, await parseBody(req, confirmSchema), clientIp(req)));
});
