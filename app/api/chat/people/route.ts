import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { listChatPeople } from "@/services/chatService";

/** Colleagues you can start a direct message with (A62): everyone active in the company, for any role with chat access. */
export const GET = route(async () => {
  const ctx = await requirePermission("chat", "view");
  return ok(await listChatPeople(ctx));
});
