import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { invalidateUserSessions } from "@/lib/auth/session-service";
import { paginationSchema, toSort, skipFor, meta as pageMeta } from "@/lib/api/pagination";
import { ROLE_LABEL } from "@/types";
import type { z } from "zod";
import type { CompanyContext } from "@/lib/auth/context";
import type { UpdateEmployeeInput, listEmployeesSchema } from "@/lib/validation/employees";
import { employeeScopeFilter, manageableTeamIds } from "./scope";

const oid = (v: string | null | undefined) => (v ? new Types.ObjectId(v) : null);
const ref = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name } : null);

export function serializeEmployee(u: Record<string, unknown>) {
  return {
    id: String(u._id), name: u.name as string, email: u.email as string, role: u.role as string, roleLabel: ROLE_LABEL[u.role as keyof typeof ROLE_LABEL],
    status: u.status as string, avatarUrl: (u.avatarUrl as string | null) ?? null, phone: (u.phone as string | null) ?? null,
    department: (u.department as string | null) ?? null, designation: (u.designation as string | null) ?? null, joiningDate: (u.joiningDate as Date | null) ?? null,
    lastActiveAt: (u.lastActiveAt as Date | null) ?? null, team: ref(u.teamId), manager: ref(u.managerId), createdAt: u.createdAt as Date,
  };
}

export async function listEmployees(ctx: CompanyContext, query: z.infer<typeof listEmployeesSchema> & z.infer<typeof paginationSchema>) {
  const scope = await employeeScopeFilter(ctx);
  const filter: Record<string, unknown> = { ...scope, archivedAt: null };
  if (query.q) filter.$and = [...((filter.$and as unknown[]) ?? []), { $or: [{ name: { $regex: query.q, $options: "i" } }, { email: { $regex: query.q, $options: "i" } }] }];
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  else filter.status = { $ne: "deactivated" };
  if (query.teamId) filter.teamId = new Types.ObjectId(query.teamId);
  const dal = scoped(User, ctx);
  const [total, rows] = await Promise.all([
    dal.countDocuments(filter),
    dal.find(filter).sort(toSort(query.sort, "name")).skip(skipFor(query)).limit(query.limit).populate(pop("teamId", "name")).populate(pop("managerId", "name")).lean(),
  ]);
  return { data: rows.map((r) => serializeEmployee(r as Record<string, unknown>)), meta: pageMeta(query, total) };
}

export async function getEmployee(ctx: CompanyContext, id: string) {
  const scope = await employeeScopeFilter(ctx);
  const user = await scoped(User, ctx).findOne({ ...scope, _id: oid(id) ?? new Types.ObjectId() }).populate(pop("teamId", "name")).populate(pop("managerId", "name")).lean();
  if (!user) throw Errors.notFound("Employee");
  return serializeEmployee(user as Record<string, unknown>);
}

/** Edit / role change / deactivate (spec section 5). Role change and deactivation kill sessions (spec 3.2). */
export async function updateEmployee(ctx: CompanyContext, id: string, input: UpdateEmployeeInput, ip: string | null) {
  const scope = await employeeScopeFilter(ctx);
  const user = await scoped(User, ctx).findOne({ ...scope, _id: oid(id) ?? new Types.ObjectId(), archivedAt: null });
  if (!user) throw Errors.notFound("Employee");
  if (String(user._id) === ctx.userId && (input.role || input.status)) throw Errors.bad("SELF_EDIT", "You cannot change your own role or status");
  if (ctx.role === "MANAGER") {
    if (input.role && !["TEAM_LEAD", "EMPLOYEE"].includes(input.role)) throw Errors.forbidden("Managers can only assign team lead or employee roles");
    if (input.status) throw Errors.forbidden("Only a company admin can deactivate employees");
    if (input.managerId !== undefined) throw Errors.forbidden("Only a company admin can reassign managers");
    if (input.teamId) {
      const allowed = await manageableTeamIds(ctx);
      if (allowed !== "all" && !allowed.some((t) => String(t) === input.teamId)) throw Errors.forbidden("You can only move people into teams you manage");
    }
  }
  if (input.teamId && !(await scoped(Team, ctx).exists({ _id: input.teamId, archivedAt: null }))) throw Errors.notFound("Team");
  if (input.managerId && !(await scoped(User, ctx).exists({ _id: input.managerId, role: { $in: ["MANAGER", "COMPANY_ADMIN"] }, status: "active" }))) throw Errors.notFound("Manager");

  const before = { name: user.name, role: user.role, status: user.status, teamId: user.teamId, managerId: user.managerId };
  const roleChanged = Boolean(input.role && input.role !== user.role);
  const deactivated = input.status === "deactivated" && user.status !== "deactivated";
  const reactivated = input.status === "active" && user.status === "deactivated";

  if (input.name !== undefined) user.name = input.name;
  if (input.role !== undefined) user.role = input.role;
  if (input.teamId !== undefined) user.teamId = oid(input.teamId);
  if (input.managerId !== undefined) user.managerId = oid(input.managerId);
  if (input.phone !== undefined) user.phone = input.phone ?? null;
  if (input.department !== undefined) user.department = input.department ?? null;
  if (input.designation !== undefined) user.designation = input.designation ?? null;
  if (input.joiningDate !== undefined) user.joiningDate = input.joiningDate ?? null;
  if (input.status !== undefined) user.status = input.status;
  await user.save();

  if (roleChanged || deactivated) await invalidateUserSessions(user._id);
  const after = { name: user.name, role: user.role, status: user.status, teamId: user.teamId, managerId: user.managerId };
  const action = deactivated ? "user.deactivated" : reactivated ? "user.reactivated" : roleChanged ? "user.role_changed" : "user.updated";
  const summary = deactivated ? `${user.name} deactivated` : reactivated ? `${user.name} reactivated` : roleChanged ? `${user.name} role changed to ${ROLE_LABEL[user.role as keyof typeof ROLE_LABEL]}` : `${user.name} updated`;
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: user._id, action, summary, before, after, ip });
  return serializeEmployee(user.toObject() as Record<string, unknown>);
}

/** Employee details (spec 12.4): profile, hours, task/project/client stats, current timer, activity timeline. */
export async function employeeDetail(ctx: CompanyContext, id: string) {
  const profile = await getEmployee(ctx, id);
  const [{ hoursSummary }, { Task }, { Project }, { TimeEntry }, { Break }, { AuditLog }, { elapsedSeconds, TIMER_POPULATE }, { Attendance }] = await Promise.all([
    import("./timesheetService"), import("@/models/Task"), import("@/models/Project"), import("@/models/TimeEntry"), import("@/models/Break"), import("@/models/AuditLog"), import("./timerService"), import("@/models/Attendance"),
  ]);
  const uid = new Types.ObjectId(profile.id);
  const [hours, taskAgg, projects, active, openBreak, activity, attendance] = await Promise.all([
    hoursSummary(ctx, profile.id),
    scoped(Task, ctx).aggregate<{ _id: string; n: number }>([{ $match: { assignedTo: uid, archivedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    scoped(Project, ctx).find({ memberIds: uid, archivedAt: null }).select("name clientId status").populate(pop("clientId", "name")).lean(),
    scoped(TimeEntry, ctx).findOne({ userId: uid, status: { $in: ["RUNNING", "PAUSED"] } }).populate(TIMER_POPULATE).lean(),
    scoped(Break, ctx).findOne({ userId: uid, end: null }).lean(),
    AuditLog.find({ companyId: new Types.ObjectId(ctx.companyId), $or: [{ actorId: uid }, { entity: "user", entityId: profile.id }] }).sort({ createdAt: -1 }).limit(30).lean(),
    scoped(Attendance, ctx).find({ userId: uid }).sort({ date: -1 }).limit(7).lean(),
  ]);
  const byStatus = Object.fromEntries(taskAgg.map((t) => [t._id, t.n]));
  const completed = byStatus.Completed ?? 0;
  const total = taskAgg.reduce((s, t) => s + t.n, 0);
  const name = (v: unknown) => (v && typeof v === "object" && ("name" in v || "title" in v) ? ((v as { name?: string; title?: string }).name ?? (v as { title?: string }).title ?? null) : null);
  const clients = new Set(projects.map((p) => name(p.clientId)).filter(Boolean));
  const now = new Date();
  return {
    profile,
    hours,
    stats: { tasksCompleted: completed, tasksPending: total - completed - (byStatus.Cancelled ?? 0), projects: projects.length, clients: clients.size },
    projects: projects.map((p) => ({ id: String(p._id), name: p.name, client: name(p.clientId), status: p.status })),
    current: active ? { entryId: String(active._id), status: active.status, client: name(active.clientId), project: name(active.projectId), task: name(active.taskId), taskId: active.taskId && typeof active.taskId === "object" ? String((active.taskId as { _id: unknown })._id) : null, elapsedSeconds: elapsedSeconds(active.segments as never, now), since: (active.segments as { start: Date }[])[0]?.start ?? null } : null,
    onBreakSince: openBreak?.start ?? null,
    activity: activity.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, createdAt: a.createdAt })),
    attendance: attendance.map((a) => ({ id: String(a._id), date: a.date, status: a.status, clockIn: a.clockIn ?? null, clockOut: a.clockOut ?? null, workSeconds: a.workSeconds, autoClosed: Boolean(a.flags?.autoClosed) })),
  };
}
