import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireCompanySession } from "@/lib/auth/context";
import { notificationReadSchema } from "@/lib/validation/chat";
import { markRead } from "@/services/notificationService";

/** Mark one, several, or all as read (spec 12.16). */
export const POST = route(async (req) => {
  const ctx = await requireCompanySession();
  return ok(await markRead(ctx, (await parseBody(req, notificationReadSchema)).ids));
});
