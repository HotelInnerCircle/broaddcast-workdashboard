import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { channelMembersSchema } from "@/lib/validation/chat";
import { setChannelMembers } from "@/services/chatService";

/** Add or remove channel members without touching the rest of the channel (A72). */
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "manage");
  return ok(await setChannelMembers(ctx, (await params).id, await parseBody(req, channelMembersSchema)));
});
