import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import type { CompanyContext } from "@/lib/auth/context";
import type { CreateTeamInput, UpdateTeamInput } from "@/lib/validation/teams";

const oid = (v: string | null | undefined) => (v ? new Types.ObjectId(v) : null);

export async function listTeams(ctx: CompanyContext) {
  const filter: Record<string, unknown> = { archivedAt: null };
  if (ctx.role === "TEAM_LEAD") filter._id = oid(ctx.teamId) ?? new Types.ObjectId();
  if (ctx.role === "EMPLOYEE") filter._id = oid(ctx.teamId) ?? new Types.ObjectId();
  const teams = await scoped(Team, ctx).find(filter).sort({ name: 1 }).populate(pop("leadId", "name avatarUrl")).populate(pop("managerId", "name avatarUrl")).lean();
  const counts = await scoped(User, ctx).aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { status: { $ne: "deactivated" }, archivedAt: null, teamId: { $ne: null } } },
    { $group: { _id: "$teamId", n: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((c) => [String(c._id), c.n]));
  const person = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);
  return teams.map((t) => ({
    id: String(t._id), name: t.name, description: t.description ?? null,
    lead: person(t.leadId), manager: person(t.managerId), memberCount: countMap.get(String(t._id)) ?? 0, createdAt: t.createdAt,
  }));
}

export async function createTeam(ctx: CompanyContext, input: CreateTeamInput, ip: string | null) {
  if (await scoped(Team, ctx).exists({ name: input.name, archivedAt: null })) throw Errors.conflict("TEAM_EXISTS", "A team with this name already exists");
  const managerId = ctx.role === "MANAGER" ? new Types.ObjectId(ctx.userId) : oid(input.managerId);
  const team = await scoped(Team, ctx).create({ name: input.name, description: input.description ?? null, leadId: oid(input.leadId), managerId });
  if (team.leadId) await scoped(User, ctx).updateOne({ _id: team.leadId }, { $set: { teamId: team._id } });
  await audit({ ctx, companyId: ctx.companyId, entity: "team", entityId: team._id, action: "team.created", summary: `Team "${team.name}" created`, after: { name: team.name }, ip });
  return { id: String(team._id) };
}

export async function updateTeam(ctx: CompanyContext, teamId: string, input: UpdateTeamInput, ip: string | null) {
  const team = await scoped(Team, ctx).findById(teamId);
  if (!team || team.archivedAt) throw Errors.notFound("Team");
  if (ctx.role === "MANAGER" && String(team.managerId) !== ctx.userId) throw Errors.notFound("Team");
  if (ctx.role === "TEAM_LEAD" && String(team._id) !== ctx.teamId) throw Errors.notFound("Team");
  const before = { name: team.name, leadId: team.leadId, managerId: team.managerId };
  if (input.name !== undefined) team.name = input.name;
  if (input.description !== undefined) team.description = input.description ?? null;
  if (input.leadId !== undefined && ctx.role !== "TEAM_LEAD") team.leadId = oid(input.leadId);
  if (input.managerId !== undefined && ctx.role === "COMPANY_ADMIN") team.managerId = oid(input.managerId);
  if (input.archived && ctx.role === "COMPANY_ADMIN") team.archivedAt = new Date();
  await team.save();
  if (team.leadId) await scoped(User, ctx).updateOne({ _id: team.leadId }, { $set: { teamId: team._id } });
  await audit({ ctx, companyId: ctx.companyId, entity: "team", entityId: team._id, action: input.archived ? "team.archived" : "team.updated", summary: `Team "${team.name}" ${input.archived ? "archived" : "updated"}`, before, after: { name: team.name, leadId: team.leadId, managerId: team.managerId }, ip });
  return { id: String(team._id) };
}
