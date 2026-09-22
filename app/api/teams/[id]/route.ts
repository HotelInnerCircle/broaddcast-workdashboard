import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { scoped, pop } from "@/lib/db/scoped";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import { updateTeamSchema } from "@/lib/validation/teams";
import { updateTeam } from "@/services/teamService";
import { serializeEmployee } from "@/services/employeeService";

export const GET = route(async (_req, { params }) => {
  const ctx = await requirePermission("teams", "view");
  const { id } = await params;
  const team = await scoped(Team, ctx).findById(id).populate(pop("leadId", "name avatarUrl")).populate(pop("managerId", "name avatarUrl")).lean();
  if (!team || team.archivedAt) throw Errors.notFound("Team");
  const members = await scoped(User, ctx).find({ teamId: team._id, archivedAt: null, status: { $ne: "deactivated" } }).sort({ name: 1 }).populate(pop("managerId", "name")).lean();
  return ok({ id: String(team._id), name: team.name, description: team.description ?? null, lead: team.leadId, manager: team.managerId, members: members.map((m) => serializeEmployee(m as Record<string, unknown>)) });
});

export const PATCH = route(async (req, { params }) => {
  const ctx = await requirePermission("teams", "update");
  const { id } = await params;
  const input = await parseBody(req, updateTeamSchema);
  return ok(await updateTeam(ctx, id, input, clientIp(req)));
});
