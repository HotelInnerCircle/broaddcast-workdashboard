import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { getSubscription } from "@/services/billingService";

export const GET = route(async () => ok(await getSubscription(await requirePermission("billing", "view"))));
