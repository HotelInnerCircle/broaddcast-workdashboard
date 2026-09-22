import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { messagesQuerySchema } from "@/lib/validation/chat";
import { listMessages } from "@/services/chatService";

export const GET = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "view");
  return ok(await listMessages(ctx, (await params).id, parseQuery(req, messagesQuerySchema)));
});
