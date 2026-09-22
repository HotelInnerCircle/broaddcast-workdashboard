import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Client } from "@/models/Client";
import { Project } from "@/models/Project";
import { Task } from "@/models/Task";
import { User } from "@/models/User";
import { AuditLog } from "@/models/AuditLog";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { checkLimit } from "@/lib/limits";
import { paginationSchema, toSort, skipFor, meta as pageMeta } from "@/lib/api/pagination";
import { dayKey, parseDateInput } from "@/lib/utils/dates";
import { realtime } from "@/lib/realtime";
import { notifyMany } from "./notificationService";
import type { z } from "zod";
import type { CompanyContext } from "@/lib/auth/context";
import type { CreateProjectInput, UpdateProjectInput, listProjectsSchema } from "@/lib/validation/projects";
import { projectScopeFilter } from "./scope";
import { serializeTask } from "./taskService";
import { serializeEmployee } from "./employeeService";

export interface ProjectProgress { total: number; completed: number; cancelled: number; overdue: number; open: number; progress: number; estimatedMinutes: number; actualMinutes: number }

const person = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);
const ref = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name } : v ? { id: String(v), name: null } : null);

export function serializeProject(p: Record<string, unknown>, progress?: ProjectProgress, tz = "UTC") {
  const deadline = (p.deadline as Date | null) ?? null;
  const startDate = (p.startDate as Date | null) ?? null;
  const daysRemaining = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86_400_000) : null;
  return {
    id: String(p._id), name: p.name as string, description: (p.description as string | null) ?? null, client: ref(p.clientId), manager: person(p.managerId),
    memberIds: ((p.memberIds as unknown[]) ?? []).map((m) => (m && typeof m === "object" && "name" in (m as object) ? String((m as { _id: unknown })._id) : String(m))),
    members: ((p.memberIds as unknown[]) ?? []).map(person).filter(Boolean),
    startDate, startKey: startDate ? dayKey(startDate, tz) : null, deadline, deadlineKey: deadline ? dayKey(deadline, tz) : null, daysRemaining, status: p.status as string, priority: p.priority as string,
    budget: (p.budget as number | null) ?? null, estimatedHours: (p.estimatedHours as number | null) ?? null,
    archivedAt: (p.archivedAt as Date | null) ?? null, createdAt: p.createdAt as Date, updatedAt: p.updatedAt as Date,
    progress: progress ?? { total: 0, completed: 0, cancelled: 0, overdue: 0, open: 0, progress: 0, estimatedMinutes: 0, actualMinutes: 0 },
  };
}

/** progress % = completed / (total - cancelled) * 100 (spec 12.11); overdue per spec 7.7. */
export async function projectProgressMap(ctx: CompanyContext, projectIds: Types.ObjectId[]): Promise<Map<string, ProjectProgress>> {
  if (projectIds.length === 0) return new Map();
  const today = dayKey(new Date(), ctx.company!.timezone);
  const rows = await scoped(Task, ctx).aggregate<{ _id: Types.ObjectId; total: number; completed: number; cancelled: number; overdue: number; estimatedMinutes: number; actualMinutes: number }>([
    { $match: { projectId: { $in: projectIds }, archivedAt: null } },
    { $addFields: { dueKey: { $cond: [{ $ifNull: ["$dueDate", false] }, { $dateToString: { format: "%Y-%m-%d", date: "$dueDate", timezone: ctx.company!.timezone } }, null] } } },
    { $group: {
      _id: "$projectId", total: { $sum: 1 },
      completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
      cancelled: { $sum: { $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0] } },
      overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueKey", null] }, { $lt: ["$dueKey", today] }, { $not: [{ $in: ["$status", ["Completed", "Cancelled"]] }] }] }, 1, 0] } },
      estimatedMinutes: { $sum: { $ifNull: ["$estimatedMinutes", 0] } }, actualMinutes: { $sum: { $ifNull: ["$actualMinutes", 0] } },
    } },
  ]);
  return new Map(rows.map((r) => {
    const denom = r.total - r.cancelled;
    return [String(r._id), { total: r.total, completed: r.completed, cancelled: r.cancelled, overdue: r.overdue, open: denom - r.completed, progress: denom > 0 ? Math.round((r.completed / denom) * 100) : 0, estimatedMinutes: r.estimatedMinutes, actualMinutes: r.actualMinutes }];
  }));
}

export async function listProjects(ctx: CompanyContext, query: z.infer<typeof listProjectsSchema> & z.infer<typeof paginationSchema>) {
  const scope = await projectScopeFilter(ctx);
  const filter: Record<string, unknown> = { ...scope };
  if (query.includeArchived !== "true") filter.archivedAt = null;
  if (query.status) filter.status = query.status;
  if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
  if (query.q) filter.name = { $regex: query.q, $options: "i" };
  const dal = scoped(Project, ctx);
  const [total, rows] = await Promise.all([
    dal.countDocuments(filter),
    dal.find(filter).sort(toSort(query.sort, "-createdAt")).skip(skipFor(query)).limit(query.limit).populate(pop("clientId", "name")).populate(pop("managerId", "name avatarUrl")).populate(pop("memberIds", "name avatarUrl")).lean(),
  ]);
  const progress = await projectProgressMap(ctx, rows.map((r) => r._id));
  return { data: rows.map((r) => serializeProject(r as Record<string, unknown>, progress.get(String(r._id)), ctx.company!.timezone)), meta: pageMeta(query, total) };
}

export async function getProject(ctx: CompanyContext, id: string) {
  const scope = await projectScopeFilter(ctx);
  const project = await scoped(Project, ctx).findOne({ ...scope, _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId() })
    .populate(pop("clientId", "name")).populate(pop("managerId", "name avatarUrl")).populate(pop("memberIds", "name avatarUrl")).lean();
  if (!project) throw Errors.notFound("Project");
  const progress = await projectProgressMap(ctx, [project._id]);
  const [tasks, members, activity] = await Promise.all([
    scoped(Task, ctx).find({ projectId: project._id, archivedAt: null }).sort({ createdAt: -1 }).populate(pop("assignedTo", "name avatarUrl")).populate(pop("projectId", "name")).lean(),
    scoped(User, ctx).find({ _id: { $in: project.memberIds }, archivedAt: null }).sort({ name: 1 }).populate(pop("teamId", "name")).lean(),
    AuditLog.find({ companyId: project.companyId, $or: [{ entity: "project", entityId: String(project._id) }, { entity: "task", "after.projectId": String(project._id) }] }).sort({ createdAt: -1 }).limit(25).lean(),
  ]);
  return {
    ...serializeProject(project as Record<string, unknown>, progress.get(String(project._id)), ctx.company!.timezone),
    tasks: tasks.map((t) => serializeTask(t as Record<string, unknown>, ctx.company!.timezone)),
    team: members.map((m) => serializeEmployee(m as Record<string, unknown>)),
    activity: activity.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, createdAt: a.createdAt })),
  };
}

async function validateRefs(ctx: CompanyContext, input: { clientId?: string; managerId?: string | null; memberIds?: string[] }) {
  if (input.clientId && !(await scoped(Client, ctx).exists({ _id: input.clientId, archivedAt: null }))) throw Errors.notFound("Client");
  if (input.managerId && !(await scoped(User, ctx).exists({ _id: input.managerId, archivedAt: null, status: "active" }))) throw Errors.notFound("Manager");
  if (input.memberIds?.length) {
    const n = await scoped(User, ctx).countDocuments({ _id: { $in: input.memberIds.map((m) => new Types.ObjectId(m)) }, archivedAt: null, status: { $ne: "deactivated" } });
    if (n !== new Set(input.memberIds).size) throw Errors.notFound("Member");
  }
}

export async function createProject(ctx: CompanyContext, input: CreateProjectInput, ip: string | null) {
  await validateRefs(ctx, input);
  await checkLimit(ctx.companyId, "projects");
  const tz = ctx.company!.timezone;
  const project = await scoped(Project, ctx).create({
    ...input, startDate: parseDateInput(input.startDate, tz), deadline: parseDateInput(input.deadline, tz), clientId: new Types.ObjectId(input.clientId), managerId: input.managerId ? new Types.ObjectId(input.managerId) : new Types.ObjectId(ctx.userId),
    memberIds: [...new Set(input.memberIds)].map((m) => new Types.ObjectId(m)), createdBy: new Types.ObjectId(ctx.userId),
  });
  await audit({ ctx, companyId: ctx.companyId, entity: "project", entityId: project._id, action: "project.created", summary: `Project "${project.name}" created`, after: { name: project.name, clientId: String(project.clientId), status: project.status }, ip });
  return serializeProject(project.toObject() as Record<string, unknown>, undefined, ctx.company!.timezone);
}

export async function updateProject(ctx: CompanyContext, id: string, input: UpdateProjectInput, ip: string | null) {
  const project = await scoped(Project, ctx).findById(id);
  if (!project) throw Errors.notFound("Project");
  await validateRefs(ctx, input);
  const before = { name: project.name, status: project.status, deadline: project.deadline, memberIds: project.memberIds.map(String), managerId: project.managerId };
  const { archived, memberIds, clientId, managerId, startDate, deadline, ...fields } = input;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) project.set(k, v);
  const tz = ctx.company!.timezone;
  if (startDate !== undefined) project.startDate = parseDateInput(startDate, tz);
  if (deadline !== undefined) project.deadline = parseDateInput(deadline, tz);
  if (clientId !== undefined) {
    project.clientId = new Types.ObjectId(clientId);
    await scoped(Task, ctx).updateMany({ projectId: project._id }, { $set: { clientId: project.clientId } });
  }
  if (managerId !== undefined) project.managerId = managerId ? new Types.ObjectId(managerId) : null;
  if (memberIds !== undefined) project.set("memberIds", [...new Set(memberIds)].map((m) => new Types.ObjectId(m)));
  let action = "project.updated";
  if (archived === true && !project.archivedAt) { project.archivedAt = new Date(); action = "project.archived"; }
  if (archived === false && project.archivedAt) { project.archivedAt = null; action = "project.restored"; }
  await project.save();
  const after = { name: project.name, status: project.status, deadline: project.deadline, memberIds: project.memberIds.map(String), managerId: project.managerId };
  await audit({ ctx, companyId: ctx.companyId, entity: "project", entityId: project._id, action, summary: `Project "${project.name}" ${action.split(".")[1]}`, before, after, ip });
  if (before.status !== project.status || before.deadline?.getTime() !== project.deadline?.getTime()) {
    const recipients = [...project.memberIds.map(String), project.managerId ? String(project.managerId) : ""].filter(Boolean);
    await notifyMany(ctx.companyId, recipients, { type: "PROJECT_UPDATE", title: `Project "${project.name}" updated`, body: before.status !== project.status ? `Status is now ${project.status}` : "Deadline changed", link: `/projects/${project._id}`, actorId: ctx.userId });
  }
  realtime().emitToCompany(ctx.companyId, "project:updated", { projectId: String(project._id), status: project.status });
  return serializeProject(project.toObject() as Record<string, unknown>, undefined, ctx.company!.timezone);
}
