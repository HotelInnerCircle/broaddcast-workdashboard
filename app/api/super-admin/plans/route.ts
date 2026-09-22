import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireRole } from "@/lib/auth/context";
import { listPlans } from "@/services/billingService";

export const GET = route(async () => { await requireRole("SUPER_ADMIN"); return ok(await listPlans()); });
