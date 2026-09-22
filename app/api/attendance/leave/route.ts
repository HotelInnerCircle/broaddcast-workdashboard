import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { setLeaveSchema } from "@/lib/validation/time";
import { setLeave } from "@/services/attendanceService";

/** Leave is set manually by an admin or manager (spec 7.5). */
export const POST = route(async (req) => {
  const ctx = await requirePermission("attendance", "update");
  return ok(await setLeave(ctx, await parseBody(req, setLeaveSchema), clientIp(req)));
});
