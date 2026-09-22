import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { activityFeed } from "@/services/searchService";

export const GET = route(async () => ok(await activityFeed(await requirePermission("liveStatus", "view"))));
