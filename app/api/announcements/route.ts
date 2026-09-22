import { route, clientIp } from "@/lib/api/handler";
import { created, ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { announcementSchema } from "@/lib/validation/chat";
import { createAnnouncement, listAnnouncements } from "@/services/announcementService";

export const GET = route(async () => ok(await listAnnouncements(await requirePermission("announcements", "view"))));
export const POST = route(async (req) => {
  const ctx = await requirePermission("announcements", "create");
  return created(await createAnnouncement(ctx, await parseBody(req, announcementSchema), clientIp(req)));
});
