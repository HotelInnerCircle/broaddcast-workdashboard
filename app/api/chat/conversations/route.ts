import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { openConversationSchema } from "@/lib/validation/chat";
import { listConversations, openDm } from "@/services/chatService";

export const GET = route(async () => ok(await listConversations(await requirePermission("chat", "view"))));
/** Opens (or finds) a direct message with another person in the company. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "create");
  return ok(await openDm(ctx, (await parseBody(req, openConversationSchema)).userId));
});
