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
import { TASK_DONE_STATUSES } from "@/types";
import type { z } from "zod";
import type { CompanyContext } from "@/lib/auth/context";
import type { CreateClientInput, UpdateClientInput, listClientsSchema } from "@/lib/validation/clients";
import { clientScopeFilter } from "./scope";
import { serializeProject, projectProgressMap } from "./projectService";
import { serializeTask } from "./taskService";
import { serializeEmployee } from "./employeeService";

export function serializeClient(c: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: String(c._id), name: c.name as string, contactPerson: (c.contactPerson as string | null) ?? null, email: (c.email as string | null) ?? null,
    phone: (c.phone as string | null) ?? null, website: (c.website as string | null) ?? null, industry: (c.industry as string | null) ?? null, sharedWithCompany: Boolean(c.sharedWithCompany), services: ((c.services as string[] | undefined) ?? []),
    status: c.status as string, notes: (c.notes as string | null) ?? null, archivedAt: (c.archivedAt as Date | null) ?? null,
    createdAt: c.createdAt as Date, updatedAt: c.updatedAt as Date, ...extra,
  };
}

export async function listClients(ctx: CompanyContext, query: z.infer<typeof listClientsSchema> & z.infer<typeof paginationSchema>) {
  const scope = await clientScopeFilter(ctx);
  const filter: Record<string, unknown> = { ...scope };
  if (query.includeArchived !== "true") filter.archivedAt = null;
  if (query.status) filter.status = query.status;
  if (query.q) filter.$or = [{ name: { $regex: query.q, $options: "i" } }, { contactPerson: { $regex: query.q, $options: "i" } }, { email: { $regex: query.q, $options: "i" } }];
  const dal = scoped(Client, ctx);
  const [total, rows] = await Promise.all([dal.countDocuments(filter), dal.find(filter).sort(toSort(query.sort, "name")).skip(skipFor(query)).limit(query.limit).lean()]);
  const ids = rows.map((r) => r._id);
  const [projectCounts, taskCounts] = await Promise.all([
    scoped(Project, ctx).aggregate<{ _id: Types.ObjectId; n: number; active: number }>([
      { $match: { clientId: { $in: ids }, archivedAt: null } },
      { $group: { _id: "$clientId", n: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$status", "Active"] }, 1, 0] } } } },
    ]),
    scoped(Task, ctx).aggregate<{ _id: Types.ObjectId; open: number }>([
      { $match: { clientId: { $in: ids }, archivedAt: null, status: { $nin: TASK_DONE_STATUSES } } },
      { $group: { _id: "$clientId", open: { $sum: 1 } } },
    ]),
  ]);
  const pc = new Map(projectCounts.map((p) => [String(p._id), p]));
  const tc = new Map(taskCounts.map((t) => [String(t._id), t.open]));
  return {
    data: rows.map((r) => serializeClient(r as Record<string, unknown>, { projects: pc.get(String(r._id))?.n ?? 0, activeProjects: pc.get(String(r._id))?.active ?? 0, openTasks: tc.get(String(r._id)) ?? 0 })),
    meta: pageMeta(query, total),
  };
}

/** Client detail (spec 12.10): info, projects, assigned employees, tasks, activity. Hours arrive in Phase 3. */
export async function getClient(ctx: CompanyContext, id: string) {
  const scope = await clientScopeFilter(ctx);
  const client = await scoped(Client, ctx).findOne({ ...scope, _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId() }).lean();
  if (!client) throw Errors.notFound("Client");
  const projects = await scoped(Project, ctx).find({ clientId: client._id, archivedAt: null }).sort({ createdAt: -1 }).populate(pop("managerId", "name avatarUrl")).lean();
  const progress = await projectProgressMap(ctx, projects.map((p) => p._id));
  const memberIds = [...new Set(projects.flatMap((p) => p.memberIds.map(String)))].map((s) => new Types.ObjectId(s));
  const [members, tasks, activity] = await Promise.all([
    scoped(User, ctx).find({ _id: { $in: memberIds }, archivedAt: null }).sort({ name: 1 }).populate(pop("teamId", "name")).lean(),
    scoped(Task, ctx).find({ clientId: client._id, archivedAt: null }).sort({ createdAt: -1 }).limit(50).populate(pop("assignedTo", "name avatarUrl")).populate(pop("projectId", "name")).lean(),
    AuditLog.find({ companyId: client.companyId, $or: [{ entity: "client", entityId: String(client._id) }, { entity: "project", entityId: { $in: projects.map((p) => String(p._id)) } }] }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const openTasks = tasks.filter((t) => !TASK_DONE_STATUSES.includes(t.status as never)).length;
  return {
    ...serializeClient(client as Record<string, unknown>),
    stats: { projects: projects.length, activeProjects: projects.filter((p) => p.status === "Active").length, tasks: tasks.length, openTasks, trackedMinutes: 0 },
    projects: projects.map((p) => serializeProject(p as Record<string, unknown>, progress.get(String(p._id)), ctx.company!.timezone)),
    members: members.map((m) => serializeEmployee(m as Record<string, unknown>)),
    tasks: tasks.map((t) => serializeTask(t as Record<string, unknown>, ctx.company!.timezone)),
    activity: activity.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, createdAt: a.createdAt })),
  };
}

export async function createClient(ctx: CompanyContext, input: CreateClientInput, ip: string | null) {
  if (await scoped(Client, ctx).exists({ name: input.name, archivedAt: null })) throw Errors.conflict("CLIENT_EXISTS", "A client with this name already exists");
  await checkLimit(ctx.companyId, "clients");
  // A70: a client the admin creates has no owning manager, so it is shared with the whole company.
  const client = await scoped(Client, ctx).create({ ...input, createdBy: new Types.ObjectId(ctx.userId), sharedWithCompany: ctx.role === "COMPANY_ADMIN" });
  await audit({ ctx, companyId: ctx.companyId, entity: "client", entityId: client._id, action: "client.created", summary: `Client "${client.name}" created`, after: { name: client.name, status: client.status }, ip });
  return serializeClient(client.toObject() as Record<string, unknown>);
}

export async function updateClient(ctx: CompanyContext, id: string, input: UpdateClientInput, ip: string | null) {
  const client = await scoped(Client, ctx).findById(id);
  if (!client) throw Errors.notFound("Client");
  const before = serializeClient(client.toObject() as Record<string, unknown>);
  if (input.name && input.name !== client.name && (await scoped(Client, ctx).exists({ name: input.name, archivedAt: null, _id: { $ne: client._id } }))) {
    throw Errors.conflict("CLIENT_EXISTS", "A client with this name already exists");
  }
  const { archived, ...fields } = input;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) client.set(k, v);
  let action = "client.updated";
  if (archived === true && !client.archivedAt) { client.archivedAt = new Date(); action = "client.archived"; }
  if (archived === false && client.archivedAt) { client.archivedAt = null; action = "client.restored"; }
  await client.save();
  const after = serializeClient(client.toObject() as Record<string, unknown>);
  await audit({ ctx, companyId: ctx.companyId, entity: "client", entityId: client._id, action, summary: `Client "${client.name}" ${action.split(".")[1]}`, before, after, ip });
  return after;
}
