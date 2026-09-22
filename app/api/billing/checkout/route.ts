import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { checkoutSchema } from "@/lib/validation/billing";
import { startCheckout } from "@/services/billingService";

/** Creates a provider order for the chosen plan (spec 3.6 / Phase 6). 503 when no gateway is configured. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("billing", "manage");
  return ok(await startCheckout(ctx, await parseBody(req, checkoutSchema), clientIp(req)));
});
