import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { deliveredSchema } from "@/lib/validation/chat";
import { markDelivered } from "@/services/chatService";

/** The recipient's browser confirms it has the messages - this is what turns one tick into two (A72). */
export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "view");
  return ok(await markDelivered(ctx, (await parseBody(req, deliveredSchema)).messageIds));
});
