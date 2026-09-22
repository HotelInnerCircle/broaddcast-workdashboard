import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { revokeInvite } from "@/services/inviteService";

export const DELETE = route(async (req, { params }) => {
  const ctx = await requirePermission("employees", "invite");
  const { id } = await params;
  await revokeInvite(ctx, id, clientIp(req));
  return ok({ revoked: true });
});
