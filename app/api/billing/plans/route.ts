import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/context";
import { listPlans } from "@/services/billingService";

export const GET = route(async () => { await requireSession(); return ok(await listPlans()); });
