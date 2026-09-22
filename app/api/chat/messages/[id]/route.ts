import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { editMessageSchema } from "@/lib/validation/chat";
import { deleteMessage, editMessage } from "@/services/chatService";

/** Edit / delete own messages only (spec 12.15). */
export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("chat", "create");
  return ok(await editMessage(ctx, (await params).id, (await parseBody(req, editMessageSchema)).body));
});
export const DELETE = route(async (_req, { params }) => ok(await deleteMessage(await requirePermission("chat", "create"), (await params).id)));
