import { Types, type QueryFilter } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Team } from "@/models/Team";
import type { UserDoc } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";

/**
 * Visibility scope for people-related data (spec section 5 cardinality):
 *  - COMPANY_ADMIN: whole company
 *  - MANAGER: direct reports + members of teams they manage (+ themselves)
 *  - TEAM_LEAD: their own team
 *  - EMPLOYEE: themselves only
 * Always combined with the tenant filter by scoped(); never used alone.
 */
export async function employeeScopeFilter(ctx: CompanyContext): Promise<QueryFilter<UserDoc>> {
  const me = new Types.ObjectId(ctx.userId);
  switch (ctx.role) {
    case "COMPANY_ADMIN":
      return {};
    case "MANAGER": {
      const teams = await scoped(Team, ctx).find({ managerId: me, archivedAt: null }).select("_id").lean();
      const teamIds = teams.map((t) => t._id);
      return { $or: [{ managerId: me }, { teamId: { $in: teamIds } }, { _id: me }] };
    }
    case "TEAM_LEAD":
      return ctx.teamId ? { teamId: new Types.ObjectId(ctx.teamId) } : { _id: me };
    default:
      return { _id: me };
  }
}

/** Team ids a manager may invite into / assign. Admins may use any team. */
export async function manageableTeamIds(ctx: CompanyContext): Promise<Types.ObjectId[] | "all"> {
  if (ctx.role === "COMPANY_ADMIN") return "all";
  if (ctx.role === "MANAGER") {
    const teams = await scoped(Team, ctx).find({ managerId: new Types.ObjectId(ctx.userId), archivedAt: null }).select("_id").lean();
    return teams.map((t) => t._id);
  }
  return ctx.teamId ? [new Types.ObjectId(ctx.teamId)] : [];
}

/** Ids of the caller's own team members (including the caller). Empty for people without a team. */
export async function teamMemberIds(ctx: CompanyContext): Promise<Types.ObjectId[]> {
  const me = new Types.ObjectId(ctx.userId);
  if (!ctx.teamId) return [me];
  const { User } = await import("@/models/User");
  const rows = await scoped(User, ctx).find({ teamId: new Types.ObjectId(ctx.teamId), archivedAt: null }).select("_id").lean();
  const ids = rows.map((r) => r._id as Types.ObjectId);
  return ids.some((i) => i.equals(me)) ? ids : [...ids, me];
}

/**
 * Project visibility (spec section 5): admin/manager see all; a team lead sees projects
 * that involve their team (managed by them or with a team member); an employee sees
 * projects they are a member of.
 */
export async function projectScopeFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  const me = new Types.ObjectId(ctx.userId);
  if (ctx.role === "COMPANY_ADMIN" || ctx.role === "MANAGER") return {};
  if (ctx.role === "TEAM_LEAD") return { $or: [{ managerId: me }, { memberIds: { $in: await teamMemberIds(ctx) } }] };
  return { memberIds: me };
}

/** Task visibility: admin/manager all; team lead tasks of team members or created by them; employee own tasks. */
export async function taskScopeFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  const me = new Types.ObjectId(ctx.userId);
  if (ctx.role === "COMPANY_ADMIN" || ctx.role === "MANAGER") return {};
  if (ctx.role === "TEAM_LEAD") return { $or: [{ assignedTo: { $in: await teamMemberIds(ctx) } }, { createdBy: me }] };
  return { assignedTo: me };
}

/** Client visibility: everyone with clients.view sees all except employees, who see clients of their projects. */
export async function clientScopeFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  if (ctx.role !== "EMPLOYEE") return {};
  const { Project } = await import("@/models/Project");
  const projects = await scoped(Project, ctx).find({ memberIds: new Types.ObjectId(ctx.userId), archivedAt: null }).select("clientId").lean();
  return { _id: { $in: projects.map((p) => p.clientId) } };
}
