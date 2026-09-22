import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { getInviteByToken } from "@/services/inviteService";

/** Public: validates an invite token for the /invite/[token] page. */
export const GET = route(async (_req, { params }) => {
  const { token } = await params;
  const invite = await getInviteByToken(token);
  if (!invite) throw Errors.bad("INVALID_INVITE", "This invitation is invalid, expired or has been revoked");
  return ok(invite);
});
