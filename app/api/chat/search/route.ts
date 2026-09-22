import { route } from "@/lib/api/handler";
import { ok, parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { searchQuerySchema } from "@/lib/validation/chat";
import { searchMessages } from "@/services/chatService";

export const GET = route(async (req) => {
  const ctx = await requirePermission("chat", "view");
  return ok(await searchMessages(ctx, parseQuery(req, searchQuerySchema).q));
});
