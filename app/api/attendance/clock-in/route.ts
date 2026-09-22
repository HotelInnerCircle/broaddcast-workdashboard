import { route, clientIp } from "@/lib/api/handler";
import { created } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { clockIn } from "@/services/attendanceService";

export const POST = route(async (req) => created(await clockIn(await requirePermission("attendance", "create"), clientIp(req))));
