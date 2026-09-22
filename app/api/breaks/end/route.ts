import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { endBreak } from "@/services/breakService";

export const POST = route(async () => ok(await endBreak(await requirePermission("timer", "update"))));
