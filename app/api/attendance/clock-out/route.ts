import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { clockOut } from "@/services/attendanceService";

export const POST = route(async (req) => ok(await clockOut(await requirePermission("attendance", "create"), clientIp(req))));
