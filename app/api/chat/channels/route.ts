import { route } from "@/lib/api/handler";
import { created, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { channelSchema } from "@/lib/validation/chat";
import { createChannel } from "@/services/chatService";

/** Create a channel (A72). `chat:manage` is Team Lead and above, so employees cannot. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "manage");
  return created(await createChannel(ctx, await parseBody(req, channelSchema)));
});
