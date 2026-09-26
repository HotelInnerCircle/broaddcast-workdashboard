import { Types } from "mongoose";
import { escapeRegex } from "@/lib/utils/regex";
import { scoped, pop } from "@/lib/db/scoped";
import { Project } from "@/models/Project";
import { Task, type TaskAttachment } from "@/models/Task";
import { User } from "@/models/User";
import { AuditLog } from "@/models/AuditLog";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { realtime } from "@/lib/realtime";
import { notify } from "./notificationService";
import { paginationSchema, toSort, skipFor, meta as pageMeta } from "@/lib/api/pagination";
import { fromZonedTime } from "date-fns-tz";
import { dayKey, parseDateInput } from "@/lib/utils/dates";
import { TASK_DONE_STATUSES, type TaskStatus } from "@/types";
import type { z } from "zod";
import type { CompanyContext } from "@/lib/auth/context";
import type { CreateTaskInput, UpdateTaskInput, listTasksSchema } from "@/lib/validation/tasks";
import { projectScopeFilter, taskScopeFilter, teamMemberIds } from "./scope";

const person = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);
const ref = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name } : v ? { id: String(v), name: null } : null);

/** Overdue (spec 7.7): due day (company tz) is before today and status not Completed/Cancelled. */
export function isOverdue(dueDate: Date | null | undefined, status: string, tz: string, now = new Date()): boolean {
  if (!dueDate || TASK_DONE_STATUSES.includes(status as TaskStatus)) return false;
  return dayKey(dueDate, tz) < dayKey(now, tz);
}

export function serializeTask(t: Record<string, unknown>, tz: string) {
  const dueDate = (t.dueDate as Date | null) ?? null;
  const status = t.status as string;
  return {
    id: String(t._id), title: t.title as string, description: (t.description as string | null) ?? null, status, priority: t.priority as string,
    client: ref(t.clientId), project: ref(t.projectId), assignee: person(t.assignedTo), assignedTo: t.assignedTo ? String((t.assignedTo as { _id?: unknown })._id ?? t.assignedTo) : null,
    createdBy: t.createdBy ? String((t.createdBy as { _id?: unknown })._id ?? t.createdBy) : null,
    dueDate, dueKey: dueDate ? dayKey(dueDate, tz) : null, overdue: isOverdue(dueDate, status, tz),
    estimatedMinutes: (t.estimatedMinutes as number | null) ?? null, actualMinutes: (t.actualMinutes as number) ?? 0,
    attachmentCount: ((t.attachments as unknown[]) ?? []).length, completedAt: (t.completedAt as Date | null) ?? null,
    archivedAt: (t.archivedAt as Date | null) ?? null, createdAt: t.createdAt as Date, updatedAt: t.updatedAt as Date,
  };
}

const TASK_POPULATE = [pop("assignedTo", "name avatarUrl"), pop("projectId", "name"), pop("clientId", "name")];

export async function listTasks(ctx: CompanyContext, query: z.infer<typeof listTasksSchema> & z.infer<typeof paginationSchema>) {
  const tz = ctx.company!.timezone;
  const scope = await taskScopeFilter(ctx);
  const filter: Record<string, unknown> = { ...scope };
  if (query.includeArchived !== "true") filter.archivedAt = null;
  if (query.mine === "true") filter.assignedTo = new Types.ObjectId(ctx.userId);
  if (query.assignedTo) filter.assignedTo = new Types.ObjectId(query.assignedTo);
  if (query.projectId) filter.projectId = new Types.ObjectId(query.projectId);
  if (query.clientId) filter.clientId = new Types.ObjectId(query.clientId);
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.q) filter.title = { $regex: escapeRegex(query.q), $options: "i" };
  if (query.dueFrom || query.dueTo) filter.dueDate = { ...(query.dueFrom ? { $gte: query.dueFrom } : {}), ...(query.dueTo ? { $lte: query.dueTo } : {}) };
  if (query.overdue === "true") {
    // dueKey < today  <=>  dueDate < start of today in the company timezone (exact, so totals stay correct)
    filter.dueDate = { $lt: fromZonedTime(`${dayKey(new Date(), tz)}T00:00:00`, tz) };
    filter.status = { $nin: TASK_DONE_STATUSES };
  }
  const dal = scoped(Task, ctx);
  const [total, rows] = await Promise.all([
    dal.countDocuments(filter),
    dal.find(filter).sort(toSort(query.sort, "-createdAt")).skip(skipFor(query)).limit(query.limit).populate(TASK_POPULATE).lean(),
  ]);
  return { data: rows.map((r) => serializeTask(r as Record<string, unknown>, tz)), meta: pageMeta(query, total) };
}

async function idInScope(ctx: CompanyContext, id: string) {
  const scope = await taskScopeFilter(ctx);
  return { ...scope, _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId() };
}
async function findInScope(ctx: CompanyContext, id: string) {
  return scoped(Task, ctx).findOne(await idInScope(ctx, id));
}

export async function getTask(ctx: CompanyContext, id: string) {
  const task = await scoped(Task, ctx).findOne(await idInScope(ctx, id)).populate(TASK_POPULATE);
  if (!task) throw Errors.notFound("Task");
  const t = task.toObject() as Record<string, unknown>;
  const [activity, attachments, createdBy] = await Promise.all([
    AuditLog.find({ companyId: task.companyId, entity: "task", entityId: String(task._id) }).sort({ createdAt: -1 }).limit(30).lean(),
    Promise.all((task.attachments as TaskAttachment[]).map(async (a) => ({ id: String(a._id), name: a.name, size: a.size, mime: a.mime, uploadedBy: String(a.uploadedBy), createdAt: a.createdAt, url: await storage().getSignedUrl(a.key, 3600) }))),
    task.createdBy ? scoped(User, ctx).findById(String(task.createdBy)).select("name avatarUrl").lean() : null,
  ]);
  return {
    ...serializeTask(t, ctx.company!.timezone),
    creator: createdBy ? { id: String(createdBy._id), name: createdBy.name, avatarUrl: createdBy.avatarUrl ?? null } : null,
    attachments,
    activity: activity.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, before: a.before, after: a.after, createdAt: a.createdAt })),
    permissions: { canEdit: ctx.role !== "EMPLOYEE", canAssign: ctx.role !== "EMPLOYEE", canChangeStatus: true },
  };
}

/** Team leads may only assign within their own team; employees cannot assign at all. */
async function assertAssignable(ctx: CompanyContext, assignedTo: string | null | undefined) {
  if (!assignedTo) return;
  if (!(await scoped(User, ctx).exists({ _id: assignedTo, archivedAt: null, status: { $ne: "deactivated" } }))) throw Errors.notFound("Assignee");
  if (ctx.role === "TEAM_LEAD") {
    const ids = await teamMemberIds(ctx);
    if (!ids.some((i) => String(i) === assignedTo)) throw Errors.forbidden("Team leads can only assign tasks to their own team");
  }
}

export async function createTask(ctx: CompanyContext, input: CreateTaskInput, ip: string | null) {
  const projectScope = await projectScopeFilter(ctx);
  const project = await scoped(Project, ctx).findOne({ ...projectScope, _id: new Types.ObjectId(input.projectId), archivedAt: null }).select("clientId memberIds name").lean();
  if (!project) throw Errors.notFound("Project");
  await assertAssignable(ctx, input.assignedTo);
  const assignedTo = input.assignedTo ? new Types.ObjectId(input.assignedTo) : null;
  const task = await scoped(Task, ctx).create({
    ...input, dueDate: parseDateInput(input.dueDate, ctx.company!.timezone), projectId: project._id, clientId: project.clientId, assignedTo, createdBy: new Types.ObjectId(ctx.userId),
    status: input.status ?? "To Do", completedAt: input.status === "Completed" ? new Date() : null,
  });
  // Assignees automatically become project members so they can see the project (ASSUMPTIONS A16).
  if (assignedTo && !project.memberIds.some((m) => m.equals(assignedTo))) await scoped(Project, ctx).updateOne({ _id: project._id }, { $addToSet: { memberIds: assignedTo } });
  await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: "task.created", summary: `Task "${task.title}" created in ${project.name}`, after: { title: task.title, projectId: String(project._id), status: task.status, assignedTo: assignedTo ? String(assignedTo) : null }, ip });
  if (assignedTo) {
    const who = await scoped(User, ctx).findById(String(assignedTo)).select("name").lean();
    await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: "task.assigned", summary: `Task "${task.title}" assigned to ${who?.name ?? "someone"}`, after: { projectId: String(project._id), assignedTo: String(assignedTo) }, ip });
    await notify(ctx.companyId, { userId: assignedTo, type: "TASK_ASSIGNED", title: `${ctx.name} assigned you "${task.title}"`, body: project.name, link: `/tasks/${task._id}`, actorId: ctx.userId });
  }
  realtime().emitToCompany(ctx.companyId, "task:updated", { taskId: String(task._id), projectId: String(project._id), status: task.status, assignedTo: assignedTo ? String(assignedTo) : null, kind: "created" });
  return serializeTask(task.toObject() as Record<string, unknown>, ctx.company!.timezone);
}

/**
 * Update rules (spec section 5): admin/manager edit anything; team lead edits within team;
 * employee may only change the status of tasks assigned to them (spec: "update own").
 */
export async function updateTask(ctx: CompanyContext, id: string, input: UpdateTaskInput, ip: string | null) {
  const task = await findInScope(ctx, id);
  if (!task || (task.archivedAt && input.archived !== false)) throw Errors.notFound("Task");
  const { archived, assignedTo, status, dueDate, ...fields } = input;
  if (ctx.role === "EMPLOYEE") {
    const attempted = Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined);
    if (attempted.length || assignedTo !== undefined || archived !== undefined || dueDate !== undefined) throw Errors.forbidden("You can only update the status of your own tasks");
  }
  const before = { title: task.title, status: task.status, priority: task.priority, assignedTo: task.assignedTo ? String(task.assignedTo) : null, dueDate: task.dueDate };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) task.set(k, v);
  if (dueDate !== undefined) task.dueDate = parseDateInput(dueDate, ctx.company!.timezone);
  const events: { action: string; summary: string }[] = [];
  if (assignedTo !== undefined && (assignedTo ?? null) !== before.assignedTo) {
    await assertAssignable(ctx, assignedTo);
    task.assignedTo = assignedTo ? new Types.ObjectId(assignedTo) : null;
    if (task.assignedTo) {
      await scoped(Project, ctx).updateOne({ _id: task.projectId }, { $addToSet: { memberIds: task.assignedTo } });
      const who = await scoped(User, ctx).findById(assignedTo!).select("name").lean();
      events.push({ action: "task.assigned", summary: `Task "${task.title}" assigned to ${who?.name ?? "someone"}` });
    } else events.push({ action: "task.unassigned", summary: `Task "${task.title}" unassigned` });
  }
  if (status !== undefined && status !== task.status) {
    task.status = status;
    task.completedAt = status === "Completed" ? new Date() : null;
    events.push({ action: "task.status_changed", summary: `Task "${task.title}" moved from ${before.status} to ${status}` });
  }
  if (archived === true && !task.archivedAt) { task.archivedAt = new Date(); events.push({ action: "task.archived", summary: `Task "${task.title}" archived` }); }
  if (archived === false && task.archivedAt) { task.archivedAt = null; events.push({ action: "task.restored", summary: `Task "${task.title}" restored` }); }
  if (events.length === 0) events.push({ action: "task.updated", summary: `Task "${task.title}" updated` });
  await task.save();
  const after = { title: task.title, status: task.status, priority: task.priority, assignedTo: task.assignedTo ? String(task.assignedTo) : null, dueDate: task.dueDate, projectId: String(task.projectId) };
  for (const e of events) await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: e.action, summary: e.summary, before, after, ip });
  const link = `/tasks/${task._id}`;
  if (events.some((e) => e.action === "task.assigned") && task.assignedTo) await notify(ctx.companyId, { userId: String(task.assignedTo), type: "TASK_ASSIGNED", title: `${ctx.name} assigned you "${task.title}"`, link, actorId: ctx.userId });
  if (events.some((e) => e.action === "task.status_changed") && task.status === "Completed") {
    const project = await scoped(Project, ctx).findById(String(task.projectId)).select("managerId").lean();
    for (const uid of new Set([String(task.createdBy), project?.managerId ? String(project.managerId) : ""].filter(Boolean))) await notify(ctx.companyId, { userId: uid, type: "TASK_COMPLETED", title: `${ctx.name} completed "${task.title}"`, link, actorId: ctx.userId });
  }
  realtime().emitToCompany(ctx.companyId, "task:updated", { taskId: String(task._id), projectId: String(task.projectId), status: task.status, assignedTo: task.assignedTo ? String(task.assignedTo) : null, kind: events[0].action.replace("task.", "") });
  return serializeTask(task.toObject() as Record<string, unknown>, ctx.company!.timezone);
}

export async function addAttachment(ctx: CompanyContext, id: string, file: { buffer: Buffer; name: string; mime: string; ext: string }, ip: string | null) {
  const task = await findInScope(ctx, id);
  if (!task || task.archivedAt) throw Errors.notFound("Task");
  const key = `companies/${ctx.companyId}/tasks/${task._id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await storage().put({ key, body: file.buffer, contentType: file.mime });
  task.attachments.push({ key, name: file.name, size: file.buffer.length, mime: file.mime, uploadedBy: new Types.ObjectId(ctx.userId) } as never);
  await task.save();
  const att = task.attachments[task.attachments.length - 1] as TaskAttachment;
  await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: "task.attachment_added", summary: `${ctx.name} attached ${file.name}`, after: { name: file.name, size: file.buffer.length }, ip });
  return { id: String(att._id), name: att.name, size: att.size, mime: att.mime, uploadedBy: String(att.uploadedBy), createdAt: att.createdAt, url: await storage().getSignedUrl(key, 3600) };
}

export async function removeAttachment(ctx: CompanyContext, id: string, attachmentId: string, ip: string | null) {
  const task = await findInScope(ctx, id);
  if (!task) throw Errors.notFound("Task");
  const att = (task.attachments as TaskAttachment[]).find((a) => String(a._id) === attachmentId);
  if (!att) throw Errors.notFound("Attachment");
  if (ctx.role === "EMPLOYEE" && String(att.uploadedBy) !== ctx.userId) throw Errors.forbidden("You can only remove your own attachments");
  await storage().delete(att.key);
  task.set("attachments", (task.attachments as TaskAttachment[]).filter((a) => String(a._id) !== attachmentId));
  await task.save();
  await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: "task.attachment_removed", summary: `${ctx.name} removed ${att.name}`, ip });
}

/** Calendar feed (spec 12.19): task due dates + project start/deadline milestones within scope. */
export async function calendarEvents(ctx: CompanyContext, from: Date, to: Date) {
  const tz = ctx.company!.timezone;
  const [tasks, projects] = await Promise.all([
    scoped(Task, ctx).find({ ...(await taskScopeFilter(ctx)), archivedAt: null, dueDate: { $gte: from, $lte: to } }).sort({ dueDate: 1 }).limit(500).populate(TASK_POPULATE).lean(),
    scoped(Project, ctx).find({ ...(await projectScopeFilter(ctx)), archivedAt: null, $or: [{ deadline: { $gte: from, $lte: to } }, { startDate: { $gte: from, $lte: to } }] }).populate(pop("clientId", "name")).lean(),
  ]);
  const events: { id: string; kind: "task" | "deadline" | "start"; date: string; title: string; subtitle: string | null; status: string; priority: string | null; overdue: boolean; href: string }[] = [];
  for (const t of tasks) {
    const s = serializeTask(t as Record<string, unknown>, tz);
    events.push({ id: `task-${s.id}`, kind: "task", date: s.dueKey!, title: s.title, subtitle: s.project?.name ?? null, status: s.status, priority: s.priority, overdue: s.overdue, href: `/tasks/${s.id}` });
  }
  for (const p of projects) {
    const client = ref(p.clientId)?.name ?? null;
    if (p.deadline && p.deadline >= from && p.deadline <= to) events.push({ id: `deadline-${p._id}`, kind: "deadline", date: dayKey(p.deadline, tz), title: `${p.name} deadline`, subtitle: client, status: p.status, priority: p.priority, overdue: isOverdue(p.deadline, p.status === "Completed" || p.status === "Cancelled" ? "Completed" : "Active", tz), href: `/projects/${p._id}` });
    if (p.startDate && p.startDate >= from && p.startDate <= to) events.push({ id: `start-${p._id}`, kind: "start", date: dayKey(p.startDate, tz), title: `${p.name} starts`, subtitle: client, status: p.status, priority: null, overdue: false, href: `/projects/${p._id}` });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
