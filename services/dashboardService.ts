import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { serializeEmployee } from "./employeeService";
import { employeeScopeFilter } from "./scope";
import type { CompanyContext } from "@/lib/auth/context";

/**
 * Live employee status table (spec 12.2 / 7.6): Break = open break, Working = heartbeat + RUNNING
 * timer, Online = heartbeat within 90s, otherwise Offline. Heartbeats come from the socket layer.
 */
export async function teamStatusRows(ctx: CompanyContext) {
  const { TimeEntry } = await import("@/models/TimeEntry");
  const { Break } = await import("@/models/Break");
  const { elapsedSeconds, TIMER_POPULATE } = await import("./timerService");
  const { companyClock } = await import("@/lib/time/company-clock");
  const scope = await employeeScopeFilter(ctx);
  const rows = await scoped(User, ctx).find({ ...scope, archivedAt: null, status: "active", _id: { $ne: new Types.ObjectId(ctx.userId) } })
    .sort({ name: 1 }).limit(50).populate(pop("teamId", "name")).lean();
  const ids = rows.map((r) => r._id);
  const clock = await companyClock(ctx.companyId);
  const today = clock.dayOf(new Date());
  const now = new Date();
  const [active, breaks, todayEntries] = await Promise.all([
    scoped(TimeEntry, ctx).find({ userId: { $in: ids }, status: { $in: ["RUNNING", "PAUSED"] } }).populate(TIMER_POPULATE).lean(),
    scoped(Break, ctx).find({ userId: { $in: ids }, end: null }).lean(),
    scoped(TimeEntry, ctx).find({ userId: { $in: ids }, date: today }).select("userId status durationSeconds segments").lean(),
  ]);
  const activeBy = new Map(active.map((a) => [String(a.userId), a]));
  const breakBy = new Map(breaks.map((b) => [String(b.userId), b]));
  const hoursBy = new Map<string, number>();
  for (const e of todayEntries) hoursBy.set(String(e.userId), (hoursBy.get(String(e.userId)) ?? 0) + (e.status === "COMPLETED" ? e.durationSeconds : elapsedSeconds(e.segments as never, now)));
  const { isOnlineUser } = await import("@/lib/realtime/presence");
  const name = (v: unknown) => (v && typeof v === "object" && ("name" in v || "title" in v) ? ((v as { name?: string; title?: string }).name ?? (v as { title?: string }).title ?? null) : null);
  const id = (v: unknown) => (v && typeof v === "object" && "_id" in v ? String((v as { _id: unknown })._id) : null);
  return rows.map((r) => {
    const e = serializeEmployee(r as Record<string, unknown>);
    const a = activeBy.get(e.id);
    const b = breakBy.get(e.id);
    const online = isOnlineUser(e.id, (r as { lastActiveAt?: Date | null }).lastActiveAt);
    const state: "working" | "break" | "online" | "offline" = b ? "break" : a?.status === "RUNNING" && online ? "working" : online ? "online" : "offline";
    return {
      ...e, presence: state,
      current: a ? { client: name(a.clientId), project: name(a.projectId), task: name(a.taskId), taskId: id(a.taskId), notes: (a.notes as string | null) ?? null, status: a.status, elapsedSeconds: elapsedSeconds(a.segments as never, now) } : null,
      breakSince: b?.start ?? null,
      todaySeconds: hoursBy.get(e.id) ?? 0,
    };
  });
}

export async function scopeCounts(ctx: CompanyContext) {
  const scope = await employeeScopeFilter(ctx);
  const users = scoped(User, ctx);
  const [total, invited, teams] = await Promise.all([
    users.countDocuments({ ...scope, archivedAt: null, status: "active" }),
    users.countDocuments({ ...scope, archivedAt: null, status: "invited" }),
    ctx.role === "MANAGER" ? scoped(Team, ctx).countDocuments({ managerId: new Types.ObjectId(ctx.userId), archivedAt: null }) : ctx.teamId ? 1 : 0,
  ]);
  return { total, invited, teams };
}

/** Work KPIs for manager / team-lead / admin dashboards (spec 12.1, 12.6, 12.7), within the caller's scope. */
export async function workKpis(ctx: CompanyContext) {
  const { Task } = await import("@/models/Task");
  const { Project } = await import("@/models/Project");
  const { Client } = await import("@/models/Client");
  const { taskScopeFilter, projectScopeFilter, clientScopeFilter } = await import("./scope");
  const { dayKey } = await import("@/lib/utils/dates");
  const tz = ctx.company!.timezone;
  const today = dayKey(new Date(), tz);
  const [taskAgg, projectsByStatus, activeClients] = await Promise.all([
    scoped(Task, ctx).aggregate<{ total: number; completed: number; pending: number; overdue: number }>([
      { $match: { ...(await taskScopeFilter(ctx)), archivedAt: null } },
      { $addFields: { dueKey: { $cond: [{ $ifNull: ["$dueDate", false] }, { $dateToString: { format: "%Y-%m-%d", date: "$dueDate", timezone: tz } }, null] } } },
      { $group: {
        _id: null, total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $in: ["$status", ["Completed", "Cancelled"]] }, 0, 1] } },
        overdue: { $sum: { $cond: [{ $and: [{ $ne: ["$dueKey", null] }, { $lt: ["$dueKey", today] }, { $not: [{ $in: ["$status", ["Completed", "Cancelled"]] }] }] }, 1, 0] } },
      } },
    ]),
    scoped(Project, ctx).aggregate<{ _id: string; n: number }>([{ $match: { ...(await projectScopeFilter(ctx)), archivedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    scoped(Client, ctx).countDocuments({ ...(await clientScopeFilter(ctx)), archivedAt: null, status: "active" }),
  ]);
  const t = taskAgg[0] ?? { total: 0, completed: 0, pending: 0, overdue: 0 };
  const byStatus = Object.fromEntries(projectsByStatus.map((p) => [p._id, p.n])) as Record<string, number>;
  return { tasks: { total: t.total, completed: t.completed, pending: t.pending, overdue: t.overdue }, projects: { active: byStatus.Active ?? 0, byStatus, total: projectsByStatus.reduce((s, p) => s + p.n, 0) }, activeClients };
}

/** Employee dashboard (spec 12.5): today's tasks grouped by status, upcoming deadlines, open count. */
export async function myWork(ctx: CompanyContext) {
  const { Task } = await import("@/models/Task");
  const { serializeTask } = await import("./taskService");
  const { pop } = await import("@/lib/db/scoped");
  const { dayKey } = await import("@/lib/utils/dates");
  const { fromZonedTime } = await import("date-fns-tz");
  const tz = ctx.company!.timezone;
  const me = new Types.ObjectId(ctx.userId);
  const startOfToday = fromZonedTime(`${dayKey(new Date(), tz)}T00:00:00`, tz);
  const in7 = new Date(startOfToday.getTime() + 8 * 86_400_000);
  const populate = [pop("projectId", "name"), pop("clientId", "name"), pop("assignedTo", "name avatarUrl")];
  const [open, upcoming] = await Promise.all([
    scoped(Task, ctx).find({ assignedTo: me, archivedAt: null, status: { $nin: ["Completed", "Cancelled"] } }).sort({ dueDate: 1, priority: -1 }).limit(100).populate(populate).lean(),
    scoped(Task, ctx).find({ assignedTo: me, archivedAt: null, status: { $nin: ["Completed", "Cancelled"] }, dueDate: { $gte: startOfToday, $lt: in7 } }).sort({ dueDate: 1 }).limit(10).populate(populate).lean(),
  ]);
  const tasks = open.map((t) => serializeTask(t as Record<string, unknown>, tz));
  const today = dayKey(new Date(), tz);
  const focus = tasks.filter((t) => t.status === "In Progress" || t.status === "Review" || t.overdue || t.dueKey === today);
  const grouped: Record<string, typeof tasks> = {};
  for (const t of focus) (grouped[t.status] ??= []).push(t);
  return { openCount: tasks.length, overdueCount: tasks.filter((t) => t.overdue).length, grouped, upcoming: upcoming.map((t) => serializeTask(t as Record<string, unknown>, tz)) };
}
