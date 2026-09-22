import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { resendInvite } from "@/services/inviteService";

export const POST = route(async (req, { params }) => {
  const ctx = await requirePermission("employees", "invite");
  const { id } = await params;
  await resendInvite(ctx, id, clientIp(req));
  return ok({ resent: true });
});
