import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { channelPatchSchema } from "@/lib/validation/chat";
import { channelDetail, deleteChannel, updateChannel } from "@/services/chatService";

/** Detail for the manage dialog: members plus everyone who could be added. Any member may read it. */
export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("chat", "view");
  return ok(await channelDetail(ctx, (await params).id));
});

/** Rename, re-describe, replace the member list, or archive/restore (owner or company admin). */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "manage");
  return ok(await updateChannel(ctx, (await params).id, await parseBody(req, channelPatchSchema)));
});

/** Irreversible: the channel, its messages and their stored files all go. */
export const DELETE = route(async (_req, { params }) => {
  const ctx = await requirePermission("chat", "manage");
  return ok(await deleteChannel(ctx, (await params).id));
});
