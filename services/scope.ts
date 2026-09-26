import { Types, type QueryFilter } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import type { UserDoc } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";

/**
 * Visibility scope for people-related data (spec section 5 cardinality):
 *  - COMPANY_ADMIN / HR: whole company
 *  - MANAGER: direct reports + members of teams they manage (+ themselves)
 *  - TEAM_LEAD: their own team
 *  - EMPLOYEE: themselves only
 * Always combined with the tenant filter by scoped(); never used alone.
 *
 * **Every restriction is returned inside `$and`, and that is load-bearing.**
 *
 * Callers routinely write `{ ...(await employeeScopeFilter(ctx)), _id: asked }`.
 * When the scope was a bare `{ _id: me }` - which it is for an employee, and for
 * a team lead who has not been given a team yet - that spread silently *erased*
 * the restriction, and the query stopped meaning "this person, if you may see
 * them" and started meaning "this person". An employee could read any
 * colleague's attendance by passing `?userId=`.
 *
 * Under `$and` the same spread is harmless: the extra `_id` is an additional
 * condition rather than a replacement, so a mismatched id matches nothing. The
 * pattern is a landmine and this is the one place it can be defused for every
 * caller, present and future. Prefer `requireVisibleEmployee` below when the id
 * came from the caller, so they get a 403 instead of a silently empty list.
 */
export async function employeeScopeFilter(ctx: CompanyContext): Promise<QueryFilter<UserDoc>> {
  const me = new Types.ObjectId(ctx.userId);
  switch (ctx.role) {
    case "COMPANY_ADMIN":
    case "HR":
      return {};
    case "MANAGER": {
      const teams = await scoped(Team, ctx).find({ managerId: me, archivedAt: null }).select("_id").lean();
      const teamIds = teams.map((t) => t._id);
      return { $and: [{ $or: [{ managerId: me }, { teamId: { $in: teamIds } }, { _id: me }] }] };
    }
    case "TEAM_LEAD":
      return { $and: [ctx.teamId ? { teamId: new Types.ObjectId(ctx.teamId) } : { _id: me }] };
    default:
      return { $and: [{ _id: me }] };
  }
}

/**
 * Confirms the caller is allowed to see this person, and returns their id.
 *
 * Any route that takes a `userId` from the caller - a report, a ledger, an
 * attendance filter - should come through here rather than dropping the id into
 * a filter next to the scope. It answers 403 for somebody out of reach, which is
 * both honest and easier to debug than a page that renders empty.
 */
export async function requireVisibleEmployee(ctx: CompanyContext, userId: string): Promise<Types.ObjectId> {
  if (!Types.ObjectId.isValid(userId)) throw Errors.forbidden("You cannot view that employee");
  const id = new Types.ObjectId(userId);
  const scope = await employeeScopeFilter(ctx);
  const visible = await scoped(User, ctx).exists({ $and: [scope, { _id: id }] } as never);
  if (!visible) throw Errors.forbidden("You cannot view that employee");
  return id;
}

/** Team ids a manager may invite into / assign. Admins may use any team. */
export async function manageableTeamIds(ctx: CompanyContext): Promise<Types.ObjectId[] | "all"> {
  if (ctx.role === "COMPANY_ADMIN" || ctx.role === "HR") return "all";
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

/**
 * Client visibility (A61, amended by A70): a client belongs to the Manager who created it
 * (`createdBy`); one created by a Company Admin is `sharedWithCompany` and everyone sees it.
 *  - Company Admin: all clients.
 *  - Manager: clients they created, company-shared ones, plus legacy clients with no creator.
 *  - Team Lead / Employee: clients created by their manager (direct manager or their team's manager),
 *    company-shared ones, clients of projects they are a member of, plus legacy clients.
 */
export async function clientScopeFilter(ctx: CompanyContext): Promise<Record<string, unknown>> {
  if (ctx.role === "COMPANY_ADMIN") return {};
  const me = new Types.ObjectId(ctx.userId);
  if (ctx.role === "MANAGER") return { $or: [{ createdBy: me }, { sharedWithCompany: true }, { createdBy: null }] };
  const { Project } = await import("@/models/Project");
  const { Team } = await import("@/models/Team");
  const [projects, team] = await Promise.all([
    scoped(Project, ctx).find({ memberIds: me, archivedAt: null }).select("clientId").lean(),
    ctx.teamId ? scoped(Team, ctx).findById(ctx.teamId).select("managerId").lean() : null,
  ]);
  const managers = [ctx.managerId, team?.managerId ? String(team.managerId) : null].filter((x): x is string => Boolean(x)).map((x) => new Types.ObjectId(x));
  return { $or: [{ createdBy: { $in: managers } }, { sharedWithCompany: true }, { _id: { $in: projects.map((p) => p.clientId) } }, { createdBy: null }] };
}
