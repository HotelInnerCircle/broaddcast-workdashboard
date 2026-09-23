import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { forwardSchema } from "@/lib/validation/chat";
import { forwardMessage } from "@/services/chatService";

/** Forward one message into other conversations (A73). Attachments are copied, not re-pointed. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "create");
  const { messageId, conversationIds } = await parseBody(req, forwardSchema);
  return ok(await forwardMessage(ctx, messageId, conversationIds));
});
