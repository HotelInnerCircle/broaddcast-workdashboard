import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { User } from "@/models/User";
import { Client } from "@/models/Client";
import { Project } from "@/models/Project";
import { Task } from "@/models/Task";
import { AuditLog } from "@/models/AuditLog";
import type { CompanyContext } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { employeeScopeFilter, clientScopeFilter, projectScopeFilter, taskScopeFilter } from "./scope";
import { searchMessages } from "./chatService";

const rx = (q: string) => ({ $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" });
const name = (v: unknown) => (v && typeof v === "object" && "name" in v ? (v as { name: string }).name : null);

/**
 * Global search (spec 12.22): grouped results across employees, clients, projects, tasks and
 * messages - each group filtered by the caller's scope, so an employee only finds what they may see.
 */
export async function globalSearch(ctx: CompanyContext, q: string) {
  const term = q.trim();
  if (term.length < 2) return { employees: [], clients: [], projects: [], tasks: [], messages: [] };
  const [employees, clients, projects, tasks, messages] = await Promise.all([
    can(ctx.role, "employees", "view") ? scoped(User, ctx).find({ ...(await employeeScopeFilter(ctx)), archivedAt: null, status: "active", $or: [{ name: rx(term) }, { email: rx(term) }] }).select("name email avatarUrl role").limit(6).lean() : [],
    can(ctx.role, "clients", "view") ? scoped(Client, ctx).find({ ...(await clientScopeFilter(ctx)), archivedAt: null, $or: [{ name: rx(term) }, { contactPerson: rx(term) }, { industry: rx(term) }] }).select("name industry status").limit(6).lean() : [],
    can(ctx.role, "projects", "view") ? scoped(Project, ctx).find({ ...(await projectScopeFilter(ctx)), archivedAt: null, name: rx(term) }).select("name status clientId").populate(pop("clientId", "name")).limit(6).lean() : [],
    can(ctx.role, "tasks", "view") ? scoped(Task, ctx).find({ ...(await taskScopeFilter(ctx)), archivedAt: null, title: rx(term) }).select("title status priority projectId").populate(pop("projectId", "name")).limit(8).lean() : [],
    can(ctx.role, "chat", "view") ? searchMessages(ctx, term, 6) : [],
  ]);
  // Client name matches also surface that client's projects and tasks (spec 12.22 "Amaya" example).
  const clientIds = clients.map((c) => c._id);
  const [clientProjects, clientTasks] = clientIds.length ? await Promise.all([
    scoped(Project, ctx).find({ ...(await projectScopeFilter(ctx)), archivedAt: null, clientId: { $in: clientIds } }).select("name status clientId").populate(pop("clientId", "name")).limit(6).lean(),
    scoped(Task, ctx).find({ ...(await taskScopeFilter(ctx)), archivedAt: null, clientId: { $in: clientIds } }).select("title status priority projectId").populate(pop("projectId", "name")).limit(8).lean(),
  ]) : [[], []];
  const dedupe = <T extends { _id: Types.ObjectId }>(a: T[], b: T[]) => { const seen = new Set(a.map((x) => String(x._id))); return [...a, ...b.filter((x) => !seen.has(String(x._id)))]; };
  return {
    employees: employees.map((u) => ({ id: String(u._id), name: u.name, email: u.email, avatarUrl: u.avatarUrl ?? null, role: u.role, href: `/employees/${u._id}` })),
    clients: clients.map((c) => ({ id: String(c._id), name: c.name, industry: c.industry ?? null, status: c.status, href: `/clients/${c._id}` })),
    projects: dedupe(projects, clientProjects).slice(0, 8).map((p) => ({ id: String(p._id), name: p.name, status: p.status, client: name(p.clientId), href: `/projects/${p._id}` })),
    tasks: dedupe(tasks, clientTasks).slice(0, 10).map((t) => ({ id: String(t._id), title: t.title, status: t.status, priority: t.priority, project: name(t.projectId), href: `/tasks/${t._id}` })),
    messages: messages.map((m) => ({ id: m.id, body: m.body.slice(0, 140), sender: m.sender, conversation: m.conversation, href: `/chat?c=${m.conversationId}&m=${m.id}`, createdAt: m.createdAt })),
  };
}

/** Activity feed (spec 12.1): audit entries in the caller's people scope, newest first. */
export async function activityFeed(ctx: CompanyContext, limit = 25) {
  const filter: Record<string, unknown> = { companyId: new Types.ObjectId(ctx.companyId), crossTenant: false };
  if (ctx.role !== "COMPANY_ADMIN" && ctx.role !== "MANAGER") {
    const users = await scoped(User, ctx).find({ ...(await employeeScopeFilter(ctx)) }).select("_id").lean();
    filter.actorId = { $in: users.map((u) => u._id) };
  }
  const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorId: a.actorId ? String(a.actorId) : null, actorName: a.actorName ?? null, entity: a.entity, entityId: a.entityId ?? null, createdAt: a.createdAt }));
}
