import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { acceptInviteSchema } from "@/lib/validation/auth";
import { acceptInvite } from "@/services/inviteService";

export const POST = route(async (req, { params }) => {
  rateLimit(`invite-accept:${clientIp(req)}`, 10, 60_000);
  const { token } = await params;
  const input = await parseBody(req, acceptInviteSchema);
  return ok(await acceptInvite(token, input.name, input.password, clientIp(req)));
});
