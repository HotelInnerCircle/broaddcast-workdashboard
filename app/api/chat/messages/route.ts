import { route } from "@/lib/api/handler";
import { created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { sendMessageSchema } from "@/lib/validation/chat";
import { sendMessage } from "@/services/chatService";

export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "create");
  return created(await sendMessage(ctx, await parseBody(req, sendMessageSchema)));
});
