import { route } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { startBreak } from "@/services/breakService";

export const POST = route(async () => created(await startBreak(await requirePermission("timer", "create"))));
