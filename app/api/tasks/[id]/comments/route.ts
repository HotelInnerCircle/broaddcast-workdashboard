import { route, clientIp } from "@/lib/api/handler";
import { created, ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { commentSchema } from "@/lib/validation/chat";
import { addComment, listComments } from "@/services/commentService";

export const GET = route(async (_req, { params }) => ok(await listComments(await requirePermission("tasks", "view"), (await params).id)));
export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("tasks", "view");
  return created(await addComment(ctx, (await params).id, await parseBody(req, commentSchema), clientIp(req)));
});
