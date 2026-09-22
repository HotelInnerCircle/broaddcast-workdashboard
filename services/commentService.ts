import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Task } from "@/models/Task";
import { TaskComment } from "@/models/TaskComment";
import { User } from "@/models/User";
import { Project } from "@/models/Project";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { realtime } from "@/lib/realtime";
import { storage } from "@/lib/storage";
import type { CompanyContext } from "@/lib/auth/context";
import { taskScopeFilter } from "./scope";
import { notify, notifyMany } from "./notificationService";

const author = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);

async function serialize(c: Record<string, unknown>) {
  const atts = (c.attachments as { _id: unknown; key: string; name: string; size: number; mime: string }[]) ?? [];
  return { id: String(c._id), taskId: String(c.taskId), author: author(c.authorId), body: c.body as string, mentions: ((c.mentions as unknown[]) ?? []).map(String), attachments: await Promise.all(atts.map(async (a) => ({ id: String(a._id), name: a.name, size: a.size, mime: a.mime, url: await storage().getSignedUrl(a.key, 3600) }))), createdAt: c.createdAt as Date };
}

async function taskInScope(ctx: CompanyContext, taskId: string) {
  const task = await scoped(Task, ctx).findOne({ ...(await taskScopeFilter(ctx)), _id: Types.ObjectId.isValid(taskId) ? new Types.ObjectId(taskId) : new Types.ObjectId(), archivedAt: null }).select("title assignedTo createdBy projectId").lean();
  if (!task) throw Errors.notFound("Task");
  return task;
}

/** People who may be @mentioned on a task: anyone who can see it - project members, manager, assignee, creator, admins/managers. */
export async function mentionCandidates(ctx: CompanyContext, taskId: string) {
  const task = await taskInScope(ctx, taskId);
  const project = await scoped(Project, ctx).findById(String(task.projectId)).select("memberIds managerId").lean();
  const ids = [...(project?.memberIds ?? []), project?.managerId, task.assignedTo, task.createdBy].filter(Boolean);
  const users = await scoped(User, ctx).find({ $or: [{ _id: { $in: ids } }, { role: { $in: ["COMPANY_ADMIN", "MANAGER"] } }], archivedAt: null, status: "active" }).select("name avatarUrl").sort({ name: 1 }).lean();
  return users.map((u) => ({ id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null }));
}

export async function listComments(ctx: CompanyContext, taskId: string) {
  const task = await taskInScope(ctx, taskId);
  const rows = await scoped(TaskComment, ctx).find({ taskId: task._id, deletedAt: null }).sort({ createdAt: 1 }).populate(pop("authorId", "name avatarUrl")).lean();
  return { comments: await Promise.all(rows.map((r) => serialize(r as Record<string, unknown>))), candidates: await mentionCandidates(ctx, taskId) };
}

/** Comment thread (spec 12.9) with mentions: notifies mentioned people and the task's assignee/creator. */
export async function addComment(ctx: CompanyContext, taskId: string, input: { body: string; mentions?: string[]; attachment?: { key: string; name: string; size: number; mime: string } }, ip: string | null) {
  const task = await taskInScope(ctx, taskId);
  const candidates = new Set((await mentionCandidates(ctx, taskId)).map((c) => c.id));
  const mentions = (input.mentions ?? []).filter((m) => candidates.has(m) && m !== ctx.userId);
  const created = await scoped(TaskComment, ctx).create({ taskId: task._id, authorId: new Types.ObjectId(ctx.userId), body: input.body.trim(), mentions: mentions.map((m) => new Types.ObjectId(m)), attachments: input.attachment ? [input.attachment] : [] });
  const full = await scoped(TaskComment, ctx).findById(String(created._id)).populate(pop("authorId", "name avatarUrl")).lean();
  const dto = await serialize(full as Record<string, unknown>);
  await audit({ ctx, companyId: ctx.companyId, entity: "task", entityId: task._id, action: "task.commented", summary: `${ctx.name} commented on "${task.title}"`, after: { commentId: dto.id, mentions }, ip });
  const link = `/tasks/${task._id}`;
  await notifyMany(ctx.companyId, mentions, { type: "MENTION", title: `${ctx.name} mentioned you on "${task.title}"`, body: input.body.trim().slice(0, 140), link, actorId: ctx.userId });
  const others = [task.assignedTo, task.createdBy].filter(Boolean).map(String).filter((u) => !mentions.includes(u));
  await notifyMany(ctx.companyId, others, { type: "TASK_COMMENT", title: `${ctx.name} commented on "${task.title}"`, body: input.body.trim().slice(0, 140), link, actorId: ctx.userId });
  realtime().emitToCompany(ctx.companyId, "task:comment", { taskId: String(task._id), commentId: dto.id, authorId: ctx.userId });
  return dto;
}

export async function deleteComment(ctx: CompanyContext, taskId: string, commentId: string) {
  const task = await taskInScope(ctx, taskId);
  const filter: Record<string, unknown> = { _id: Types.ObjectId.isValid(commentId) ? new Types.ObjectId(commentId) : new Types.ObjectId(), taskId: task._id, deletedAt: null };
  if (ctx.role === "EMPLOYEE" || ctx.role === "TEAM_LEAD") filter.authorId = new Types.ObjectId(ctx.userId);
  const c = await scoped(TaskComment, ctx).findOneAndUpdate(filter, { $set: { deletedAt: new Date() } });
  if (!c) throw Errors.notFound("Comment");
  realtime().emitToCompany(ctx.companyId, "task:comment", { taskId: String(task._id), commentId: String(c._id), deleted: true });
  return { deleted: true };
}
