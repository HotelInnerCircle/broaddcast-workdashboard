import { route, clientIp } from "@/lib/api/handler";
import { created, ok, parseBody } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { createTeamSchema } from "@/lib/validation/teams";
import { createTeam, listTeams } from "@/services/teamService";

export const GET = route(async () => {
  const ctx = await requirePermission("teams", "view");
  return ok(await listTeams(ctx));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("teams", "create");
  const input = await parseBody(req, createTeamSchema);
  return created(await createTeam(ctx, input, clientIp(req)));
});
