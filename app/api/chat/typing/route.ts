import { z } from "zod";
import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { objectId } from "@/lib/validation/common";
import { notifyTyping } from "@/services/chatService";

/**
 * "X is typing" (A76). It used to be a socket-to-socket relay, which only existed on a host
 * running the custom server. Going through the API means one delivery path for both transports,
 * and the membership check happens server-side. The browser sends this at most once every 2s.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("chat", "create");
  const { conversationId } = await parseBody(req, z.object({ conversationId: objectId }));
  return ok(await notifyTyping(ctx, conversationId));
});
