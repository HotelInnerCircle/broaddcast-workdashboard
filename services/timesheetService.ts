import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { TimeEntry } from "@/models/TimeEntry";
import { User } from "@/models/User";
import { companyClock } from "@/lib/time/company-clock";
import type { CompanyContext } from "@/lib/auth/context";
import { employeeScopeFilter } from "./scope";
import { serializeEntry, TIMER_POPULATE, elapsedSeconds } from "./timerService";

export interface TimesheetQuery { from: string; to: string; userId?: string; teamId?: string; clientId?: string; projectId?: string; taskId?: string; status?: string }

/** Users visible to the caller, narrowed by optional employee/team filters. Every report starts here. */
export async function scopedUsers(ctx: CompanyContext, q: { userId?: string; teamId?: string; includeDeactivated?: boolean }) {
  // Scope and request filters are ANDed: a team lead asking for another team gets nothing, never that team.
  const scope = await employeeScopeFilter(ctx);
  const extra: Record<string, unknown> = { archivedAt: null };
  if (!q.includeDeactivated) extra.status = { $ne: "deactivated" };
  if (q.userId) extra._id = new Types.ObjectId(q.userId);
  if (q.teamId) extra.teamId = new Types.ObjectId(q.teamId);
  const filter: Record<string, unknown> = { $and: [scope, extra] };
  const { pop } = await import("@/lib/db/scoped");
  const users = await scoped(User, ctx).find(filter).select("name avatarUrl teamId role joiningDate createdAt").sort({ name: 1 }).populate(pop("teamId", "name")).lean();
  return users.map((u) => ({ _id: u._id, id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null, role: u.role, team: u.teamId && typeof u.teamId === "object" && "name" in u.teamId ? (u.teamId as { name: string }).name : null, joiningDate: u.joiningDate ?? u.createdAt }));
}

/**
 * Timesheets (spec 12.14): entries in a company-timezone day range, within the caller's people
 * scope. Durations are always server-derived from segments (never client-supplied).
 */
export async function listTimeEntries(ctx: CompanyContext, q: TimesheetQuery) {
  const users = await scopedUsers(ctx, { userId: q.userId, teamId: q.teamId, includeDeactivated: true });
  const userMap = new Map(users.map((u) => [u.id, { id: u.id, name: u.name, avatarUrl: u.avatarUrl }]));
  const filter: Record<string, unknown> = { userId: { $in: users.map((u) => u._id) }, date: { $gte: q.from, $lte: q.to } };
  if (q.clientId) filter.clientId = new Types.ObjectId(q.clientId);
  if (q.projectId) filter.projectId = new Types.ObjectId(q.projectId);
  if (q.taskId) filter.taskId = new Types.ObjectId(q.taskId);
  if (q.status) filter.status = q.status;
  const rows = await scoped(TimeEntry, ctx).find(filter).sort({ date: -1, "segments.0.start": -1 }).limit(2000).populate(TIMER_POPULATE).lean();
  const now = new Date();
  const entries = rows.map((r) => ({ ...serializeEntry(r as Record<string, unknown>, now), user: userMap.get(String(r.userId)) ?? null }));
  const byDay: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  const byClient: Record<string, { name: string; seconds: number }> = {};
  const byProject: Record<string, { name: string; seconds: number }> = {};
  const byTask: Record<string, { name: string; seconds: number }> = {};
  let total = 0;
  for (const e of entries) {
    const s = e.elapsedSeconds;
    total += s;
    byDay[e.date] = (byDay[e.date] ?? 0) + s;
    byUser[e.userId] = (byUser[e.userId] ?? 0) + s;
    if (e.client) { const c = (byClient[e.client.id] ??= { name: e.client.name ?? "", seconds: 0 }); c.seconds += s; }
    if (e.project) { const p = (byProject[e.project.id] ??= { name: e.project.name ?? "", seconds: 0 }); p.seconds += s; }
    if (e.task) { const t = (byTask[e.task.id] ??= { name: e.task.name ?? "", seconds: 0 }); t.seconds += s; }
  }
  return { entries, totals: { seconds: total, byDay, byUser, byClient, byProject, byTask }, users: [...userMap.values()] };
}

/** Hours today / this week / this month for one user (spec 12.4 stats). */
export async function hoursSummary(ctx: CompanyContext, userId: string) {
  const clock = await companyClock(ctx.companyId);
  const today = clock.dayOf(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const weekStart = new Date(d.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const rows = await scoped(TimeEntry, ctx).find({ userId: new Types.ObjectId(userId), date: { $gte: monthStart < weekStart ? monthStart : weekStart, $lte: today } }).select("date status durationSeconds segments").lean();
  const now = new Date();
  const sum = (from: string) => rows.filter((r) => r.date >= from).reduce((s, r) => s + (r.status === "COMPLETED" ? r.durationSeconds : elapsedSeconds(r.segments as never, now)), 0);
  return { todaySeconds: sum(today), weekSeconds: sum(weekStart), monthSeconds: sum(monthStart) };
}

