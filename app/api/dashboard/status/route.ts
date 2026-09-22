import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { teamStatusRows } from "@/services/dashboardService";

/** Live status rows; the dashboard refetches this on presence/timer events (spec 12.2). */
export const GET = route(async () => ok(await teamStatusRows(await requirePermission("liveStatus", "view"))));
