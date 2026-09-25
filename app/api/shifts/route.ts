import { route, clientIp } from "@/lib/api/handler";
import { ok, created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { shiftSchema } from "@/lib/validation/scheduling";
import { listShifts, createShift } from "@/services/schedulingService";

/** Shifts (A90). Anyone who can see people needs to read them; only HR and the admin change them. */
export const GET = route(async () => ok(await listShifts(await requirePermission("employees", "view"))));

export const POST = route(async (req) => {
  const ctx = await requirePermission("scheduling", "create");
  return created(await createShift(ctx, await parseBody(req, shiftSchema), clientIp(req)));
});
