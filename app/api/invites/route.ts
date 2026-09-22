import { route, clientIp } from "@/lib/api/handler";
import { created, ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { createInviteSchema } from "@/lib/validation/employees";
import { createInvite, listPendingInvites } from "@/services/inviteService";

export const GET = route(async () => {
  const ctx = await requirePermission("employees", "invite");
  return ok(await listPendingInvites(ctx));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("employees", "invite");
  const input = await parseBody(req, createInviteSchema);
  return created(await createInvite(ctx, input, clientIp(req)));
});
