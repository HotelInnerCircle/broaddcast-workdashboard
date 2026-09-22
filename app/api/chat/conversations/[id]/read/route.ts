import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { markConversationRead } from "@/services/chatService";

export const POST = route(async (_req, { params }) => ok(await markConversationRead(await requirePermission("chat", "view"), (await params).id)));
