import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { Task } from "@/models/Task";
import { Project } from "@/models/Project";
import { Client } from "@/models/Client";
import { TimeEntry } from "@/models/TimeEntry";
import { DailyReport } from "@/models/DailyReport";
import { companyClock } from "@/lib/time/company-clock";
import { dayKey } from "@/lib/utils/dates";
import { formatInTimeZone } from "date-fns-tz";
import type { CompanyContext } from "@/lib/auth/context";
import type { ExportTable } from "@/lib/export";
import { listTimeEntries, scopedUsers } from "./timesheetService";
import { listAttendance } from "./attendanceService";
import { projectScopeFilter, taskScopeFilter, clientScopeFilter } from "./scope";
import { projectProgressMap } from "./projectService";
import { isOverdue } from "./taskService";

export interface Filter { from: string; to: string; userId?: string; teamId?: string; clientId?: string; projectId?: string }

const hours = (s: number) => Math.round((s / 3600) * 100) / 100;
const label = (v: unknown) => (v && typeof v === "object" && "name" in v ? (v as { name: string }).name : null);

/**
 * All hour figures below come from listTimeEntries with the same filters the timesheet uses,
 * so report totals reconcile exactly with the timesheet (spec 12.18).
 */
async function timeBase(ctx: CompanyContext, f: Filter) {
  return listTimeEntries(ctx, { from: f.from, to: f.to, userId: f.userId, teamId: f.teamId, clientId: f.clientId, projectId: f.projectId });
}

async function rangeBounds(ctx: CompanyContext, f: Filter) {
  const clock = await companyClock(ctx.companyId);
  return { clock, start: clock.at(f.from, "00:00"), end: new Date(clock.at(f.to, "00:00").getTime() + 86_400_000) };
}

// ---------------------------------------------------------------- Time report
export async function timeReport(ctx: CompanyContext, f: Filter) {
  const base = await timeBase(ctx, f);
  const days = Object.entries(base.totals.byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, seconds]) => ({ date, hours: hours(seconds), seconds }));
  const byUser = base.users.map((u) => ({ id: u.id, name: u.name, seconds: base.totals.byUser[u.id] ?? 0, hours: hours(base.totals.byUser[u.id] ?? 0) })).filter((u) => u.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const byClient = Object.entries(base.totals.byClient).map(([id, v]) => ({ id, name: v.name, seconds: v.seconds, hours: hours(v.seconds) })).sort((a, b) => b.seconds - a.seconds);
  const byProject = Object.entries(base.totals.byProject).map(([id, v]) => ({ id, name: v.name, seconds: v.seconds, hours: hours(v.seconds) })).sort((a, b) => b.seconds - a.seconds);
  return { totals: { seconds: base.totals.seconds, hours: hours(base.totals.seconds), entries: base.entries.length, people: byUser.length, days: days.length }, days, byUser, byClient, byProject, entries: base.entries };
}
export function timeReportTable(r: Awaited<ReturnType<typeof timeReport>>, f: Filter, tz: string): ExportTable {
  return {
    title: "Time report", subtitle: `${f.from} to ${f.to}`,
    columns: [{ key: "date", label: "Date", width: 12 }, { key: "user", label: "Employee", width: 20 }, { key: "client", label: "Client", width: 16 }, { key: "project", label: "Project", width: 22 }, { key: "task", label: "Task / notes", width: 36 }, { key: "start", label: "Start", width: 10 }, { key: "end", label: "End", width: 10 }, { key: "hours", label: "Hours", width: 8, align: "right" }, { key: "status", label: "Status", width: 10 }],
    rows: r.entries.map((e) => ({ date: e.date, user: e.user?.name ?? "", client: e.client?.name ?? "", project: e.project?.name ?? "", task: [e.task?.name, e.notes].filter(Boolean).join(" - "), start: toTime(e.start, tz), end: e.end ? toTime(e.end, tz) : "", hours: hours(e.elapsedSeconds), status: e.status.toLowerCase() })),
    totals: { task: "Total", hours: r.totals.hours },
  };
}
const toTime = (d: Date | string, tz: string) => formatInTimeZone(new Date(d), tz, "hh:mm a");

// ------------------------------------------------------------ Employee report
export async function employeeReport(ctx: CompanyContext, f: Filter) {
  const [base, users, { clock, start, end }] = await Promise.all([timeBase(ctx, f), scopedUsers(ctx, { userId: f.userId, teamId: f.teamId }), rangeBounds(ctx, f)]);
  const ids = users.map((u) => u._id);
  const taskScope = await taskScopeFilter(ctx);
  const tz = clock.timezone;
  const extra: Record<string, unknown> = {};
  if (f.clientId) extra.clientId = new Types.ObjectId(f.clientId);
  if (f.projectId) extra.projectId = new Types.ObjectId(f.projectId);
  const [tasks, dailyCounts, attendance] = await Promise.all([
    scoped(Task, ctx).find({ ...taskScope, ...extra, assignedTo: { $in: ids }, archivedAt: null }).select("assignedTo status dueDate completedAt estimatedMinutes actualMinutes").lean(),
    scoped(DailyReport, ctx).aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { userId: { $in: ids }, date: { $gte: f.from, $lte: f.to } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]),
    listAttendance(ctx, { from: f.from, to: f.to, userId: f.userId }),
  ]);
  const daily = new Map(dailyCounts.map((d) => [String(d._id), d.n]));
  const workingDays = clock.days(f.from, f.to).filter((d) => clock.isWorkingDay(d) && d < clock.dayOf(new Date())).length;
  const rows = users.map((u) => {
    const mine = tasks.filter((t) => String(t.assignedTo) === u.id);
    const completed = mine.filter((t) => t.completedAt && t.completedAt >= start && t.completedAt < end);
    const overdue = mine.filter((t) => isOverdue(t.dueDate, t.status, tz)).length;
    const open = mine.filter((t) => !["Completed", "Cancelled"].includes(t.status)).length;
    const est = completed.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
    const act = completed.reduce((s, t) => s + (t.actualMinutes ?? 0), 0);
    const entries = base.entries.filter((e) => e.userId === u.id);
    const att = attendance.rows.filter((r) => r.userId === u.id);
    const count = (s: string) => att.filter((r) => r.status === s).length;
    return {
      id: u.id, name: u.name, avatarUrl: u.avatarUrl, team: u.team, role: u.role,
      trackedSeconds: base.totals.byUser[u.id] ?? 0, trackedHours: hours(base.totals.byUser[u.id] ?? 0),
      tasksCompleted: completed.length, tasksOpen: open, tasksOverdue: overdue,
      estimatedMinutes: est, actualMinutes: act,
      projectsWorked: new Set(entries.map((e) => e.project?.id).filter(Boolean)).size, clientsWorked: new Set(entries.map((e) => e.client?.id).filter(Boolean)).size,
      dailyReports: daily.get(u.id) ?? 0, workingDays,
      attendance: { present: count("Present"), late: count("Late"), halfDay: count("Half Day"), absent: count("Absent"), leave: count("Leave") },
    };
  });
  const totals = rows.reduce((t, r) => ({ trackedSeconds: t.trackedSeconds + r.trackedSeconds, tasksCompleted: t.tasksCompleted + r.tasksCompleted, tasksOverdue: t.tasksOverdue + r.tasksOverdue, dailyReports: t.dailyReports + r.dailyReports }), { trackedSeconds: 0, tasksCompleted: 0, tasksOverdue: 0, dailyReports: 0 });
  return { rows, totals: { ...totals, trackedHours: hours(totals.trackedSeconds), people: rows.length, workingDays }, byDay: Object.entries(base.totals.byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({ date, hours: hours(s) })) };
}
export function employeeReportTable(r: Awaited<ReturnType<typeof employeeReport>>, f: Filter): ExportTable {
  return {
    title: "Employee report", subtitle: `${f.from} to ${f.to} - transparent metrics only`,
    columns: [{ key: "name", label: "Employee", width: 22 }, { key: "team", label: "Team", width: 14 }, { key: "trackedHours", label: "Tracked hours", width: 10, align: "right" }, { key: "tasksCompleted", label: "Completed", width: 9, align: "right" }, { key: "tasksOpen", label: "Open", width: 8, align: "right" }, { key: "tasksOverdue", label: "Overdue", width: 8, align: "right" }, { key: "estVsAct", label: "Est vs actual (min)", width: 14 }, { key: "projectsWorked", label: "Projects", width: 8, align: "right" }, { key: "clientsWorked", label: "Clients", width: 8, align: "right" }, { key: "dailyReports", label: "Daily reports", width: 10, align: "right" }, { key: "attendance", label: "Attendance P/L/H/A/Lv", width: 16 }],
    rows: r.rows.map((x) => ({ name: x.name, team: x.team ?? "", trackedHours: x.trackedHours, tasksCompleted: x.tasksCompleted, tasksOpen: x.tasksOpen, tasksOverdue: x.tasksOverdue, estVsAct: `${x.estimatedMinutes} / ${x.actualMinutes}`, projectsWorked: x.projectsWorked, clientsWorked: x.clientsWorked, dailyReports: `${x.dailyReports}/${x.workingDays}`, attendance: `${x.attendance.present}/${x.attendance.late}/${x.attendance.halfDay}/${x.attendance.absent}/${x.attendance.leave}` })),
    totals: { name: "Total", trackedHours: r.totals.trackedHours, tasksCompleted: r.totals.tasksCompleted, tasksOverdue: r.totals.tasksOverdue },
  };
}

// ---------------------------------------------------------------- Task report
export async function taskReport(ctx: CompanyContext, f: Filter) {
  const [base, users, { clock, start, end }] = await Promise.all([timeBase(ctx, f), scopedUsers(ctx, { userId: f.userId, teamId: f.teamId }), rangeBounds(ctx, f)]);
  const filter: Record<string, unknown> = { ...(await taskScopeFilter(ctx)), archivedAt: null, createdAt: { $lt: end }, $or: [{ completedAt: null }, { completedAt: { $gte: start } }, { createdAt: { $gte: start } }] };
  if (f.userId || f.teamId) filter.assignedTo = { $in: users.map((u) => u._id) };
  if (f.clientId) filter.clientId = new Types.ObjectId(f.clientId);
  if (f.projectId) filter.projectId = new Types.ObjectId(f.projectId);
  const tasks = await scoped(Task, ctx).find(filter).sort({ createdAt: -1 }).limit(1000).populate([pop("assignedTo", "name"), pop("projectId", "name"), pop("clientId", "name")]).lean();
  const tz = clock.timezone;
  const rows = tasks.map((t) => {
    const overdue = isOverdue(t.dueDate, t.status, tz);
    return { id: String(t._id), title: t.title, status: t.status, priority: t.priority, assignee: label(t.assignedTo), project: label(t.projectId), client: label(t.clientId), dueDate: t.dueDate ? dayKey(t.dueDate, tz) : null, overdue, estimatedMinutes: t.estimatedMinutes ?? null, actualMinutes: t.actualMinutes ?? 0, trackedInRangeSeconds: base.totals.byTask[String(t._id)]?.seconds ?? 0, completedInRange: Boolean(t.completedAt && t.completedAt >= start && t.completedAt < end), createdInRange: t.createdAt >= start && t.createdAt < end };
  });
  const byStatus: Record<string, number> = {}; const byPriority: Record<string, number> = {};
  for (const r of rows) { byStatus[r.status] = (byStatus[r.status] ?? 0) + 1; byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1; }
  return { rows, summary: { total: rows.length, completedInRange: rows.filter((r) => r.completedInRange).length, createdInRange: rows.filter((r) => r.createdInRange).length, overdue: rows.filter((r) => r.overdue).length, open: rows.filter((r) => !["Completed", "Cancelled"].includes(r.status)).length, trackedHours: hours(base.totals.seconds), estimatedMinutes: rows.reduce((s, r) => s + (r.estimatedMinutes ?? 0), 0), actualMinutes: rows.reduce((s, r) => s + r.actualMinutes, 0) }, byStatus, byPriority };
}
export function taskReportTable(r: Awaited<ReturnType<typeof taskReport>>, f: Filter): ExportTable {
  return {
    title: "Task report", subtitle: `${f.from} to ${f.to}`,
    columns: [{ key: "title", label: "Task", width: 30 }, { key: "client", label: "Client", width: 14 }, { key: "project", label: "Project", width: 22 }, { key: "assignee", label: "Assignee", width: 18 }, { key: "status", label: "Status", width: 12 }, { key: "priority", label: "Priority", width: 9 }, { key: "dueDate", label: "Due", width: 11 }, { key: "overdue", label: "Overdue", width: 8 }, { key: "estimated", label: "Est (h)", width: 8, align: "right" }, { key: "tracked", label: "Tracked in range (h)", width: 12, align: "right" }, { key: "total", label: "Tracked total (h)", width: 12, align: "right" }],
    rows: r.rows.map((x) => ({ title: x.title, client: x.client ?? "", project: x.project ?? "", assignee: x.assignee ?? "Unassigned", status: x.status, priority: x.priority, dueDate: x.dueDate ?? "", overdue: x.overdue ? "yes" : "", estimated: x.estimatedMinutes != null ? hours(x.estimatedMinutes * 60) : "", tracked: hours(x.trackedInRangeSeconds), total: hours(x.actualMinutes * 60) })),
    totals: { title: "Total", tracked: r.summary.trackedHours },
  };
}

// ------------------------------------------------------------- Project report
export async function projectReport(ctx: CompanyContext, f: Filter) {
  const base = await timeBase(ctx, f);
  // Archived projects stay in historical reports (spec 7.8); they are flagged, not hidden.
  const filter: Record<string, unknown> = { ...(await projectScopeFilter(ctx)) };
  if (f.clientId) filter.clientId = new Types.ObjectId(f.clientId);
  if (f.projectId) filter._id = new Types.ObjectId(f.projectId);
  const projects = await scoped(Project, ctx).find(filter).sort({ name: 1 }).populate([pop("clientId", "name"), pop("managerId", "name")]).lean();
  const [progress, allTime] = await Promise.all([
    projectProgressMap(ctx, projects.map((p) => p._id)),
    scoped(TimeEntry, ctx).aggregate<{ _id: Types.ObjectId; seconds: number }>([{ $match: { projectId: { $in: projects.map((p) => p._id) }, status: "COMPLETED" } }, { $group: { _id: "$projectId", seconds: { $sum: "$durationSeconds" } } }]),
  ]);
  const allTimeMap = new Map(allTime.map((a) => [String(a._id), a.seconds]));
  const rows = projects.map((p) => {
    const pr = progress.get(String(p._id)) ?? { total: 0, completed: 0, cancelled: 0, overdue: 0, open: 0, progress: 0, estimatedMinutes: 0, actualMinutes: 0 };
    const estimatedHours = p.estimatedHours ?? (pr.estimatedMinutes ? hours(pr.estimatedMinutes * 60) : null);
    return { id: String(p._id), name: p.name, client: label(p.clientId), manager: label(p.managerId), status: p.status, archived: Boolean(p.archivedAt), deadline: p.deadline ?? null, tasks: pr, estimatedHours, trackedInRangeHours: hours(base.totals.byProject[String(p._id)]?.seconds ?? 0), trackedTotalHours: hours(allTimeMap.get(String(p._id)) ?? 0), members: p.memberIds.length };
  }).filter((r) => (!(f.userId || f.teamId) || r.trackedInRangeHours > 0) && (!r.archived || r.trackedInRangeHours > 0 || Boolean(f.projectId)));
  return { rows, summary: { projects: rows.length, tasks: rows.reduce((s, r) => s + r.tasks.total, 0), completed: rows.reduce((s, r) => s + r.tasks.completed, 0), overdue: rows.reduce((s, r) => s + r.tasks.overdue, 0), trackedHours: hours(base.totals.seconds) } };
}
export function projectReportTable(r: Awaited<ReturnType<typeof projectReport>>, f: Filter): ExportTable {
  return {
    title: "Project report", subtitle: `${f.from} to ${f.to}`,
    columns: [{ key: "name", label: "Project", width: 26 }, { key: "client", label: "Client", width: 14 }, { key: "status", label: "Status", width: 10 }, { key: "total", label: "Tasks", width: 7, align: "right" }, { key: "completed", label: "Completed", width: 9, align: "right" }, { key: "pending", label: "Pending", width: 8, align: "right" }, { key: "overdue", label: "Overdue", width: 8, align: "right" }, { key: "progress", label: "Progress %", width: 9, align: "right" }, { key: "estimated", label: "Estimated (h)", width: 10, align: "right" }, { key: "trackedRange", label: "Tracked in range (h)", width: 12, align: "right" }, { key: "trackedTotal", label: "Tracked total (h)", width: 12, align: "right" }],
    rows: r.rows.map((x) => ({ name: x.name, client: x.client ?? "", status: x.archived ? "archived" : x.status, total: x.tasks.total, completed: x.tasks.completed, pending: x.tasks.open, overdue: x.tasks.overdue, progress: x.tasks.progress, estimated: x.estimatedHours ?? "", trackedRange: x.trackedInRangeHours, trackedTotal: x.trackedTotalHours })),
    totals: { name: "Total", total: r.summary.tasks, completed: r.summary.completed, overdue: r.summary.overdue, trackedRange: r.summary.trackedHours },
  };
}

// -------------------------------------------------------------- Client report
export async function clientReport(ctx: CompanyContext, f: Filter) {
  const base = await timeBase(ctx, f);
  // Archived clients stay in historical reports (spec 7.8) whenever they have hours in the range.
  const filter: Record<string, unknown> = { ...(await clientScopeFilter(ctx)) };
  if (f.clientId) filter._id = new Types.ObjectId(f.clientId);
  const clients = (await scoped(Client, ctx).find(filter).sort({ name: 1 }).lean()).filter((c) => !c.archivedAt || f.clientId || (base.totals.byClient[String(c._id)]?.seconds ?? 0) > 0);
  const cids = clients.map((c) => c._id);
  const [projectCounts, taskCounts, allTime] = await Promise.all([
    scoped(Project, ctx).aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { clientId: { $in: cids }, archivedAt: null } }, { $group: { _id: "$clientId", n: { $sum: 1 } } }]),
    scoped(Task, ctx).aggregate<{ _id: Types.ObjectId; n: number; open: number }>([{ $match: { clientId: { $in: cids }, archivedAt: null } }, { $group: { _id: "$clientId", n: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ["$status", ["Completed", "Cancelled"]] }, 0, 1] } } } }]),
    scoped(TimeEntry, ctx).aggregate<{ _id: Types.ObjectId; seconds: number }>([{ $match: { clientId: { $in: cids }, status: "COMPLETED" } }, { $group: { _id: "$clientId", seconds: { $sum: "$durationSeconds" } } }]),
  ]);
  const pc = new Map(projectCounts.map((p) => [String(p._id), p.n])); const tc = new Map(taskCounts.map((t) => [String(t._id), t])); const at = new Map(allTime.map((a) => [String(a._id), a.seconds]));
  const rows = clients.map((c) => ({ id: String(c._id), name: c.name, industry: c.industry ?? null, status: c.status, archived: Boolean(c.archivedAt), projects: pc.get(String(c._id)) ?? 0, tasks: tc.get(String(c._id))?.n ?? 0, openTasks: tc.get(String(c._id))?.open ?? 0, trackedInRangeSeconds: base.totals.byClient[String(c._id)]?.seconds ?? 0, trackedInRangeHours: hours(base.totals.byClient[String(c._id)]?.seconds ?? 0), trackedTotalHours: hours(at.get(String(c._id)) ?? 0) }));
  let detail: null | { byEmployee: { id: string; name: string; hours: number; seconds: number }[]; byProject: { id: string; name: string; hours: number }[]; tasksByStatus: Record<string, number>; workOverTime: { date: string; hours: number }[] } = null;
  if (f.clientId) {
    const entries = base.entries.filter((e) => e.client?.id === f.clientId);
    const byE: Record<string, { name: string; seconds: number }> = {}; const byP: Record<string, { name: string; seconds: number }> = {}; const byD: Record<string, number> = {};
    for (const e of entries) {
      if (e.user) { (byE[e.user.id] ??= { name: e.user.name, seconds: 0 }).seconds += e.elapsedSeconds; }
      if (e.project) { (byP[e.project.id] ??= { name: e.project.name ?? "", seconds: 0 }).seconds += e.elapsedSeconds; }
      byD[e.date] = (byD[e.date] ?? 0) + e.elapsedSeconds;
    }
    const statusAgg = await scoped(Task, ctx).aggregate<{ _id: string; n: number }>([{ $match: { clientId: new Types.ObjectId(f.clientId), archivedAt: null } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
    detail = { byEmployee: Object.entries(byE).map(([id, v]) => ({ id, name: v.name, seconds: v.seconds, hours: hours(v.seconds) })).sort((a, b) => b.seconds - a.seconds), byProject: Object.entries(byP).map(([id, v]) => ({ id, name: v.name, hours: hours(v.seconds) })).sort((a, b) => b.hours - a.hours), tasksByStatus: Object.fromEntries(statusAgg.map((s) => [s._id, s.n])), workOverTime: Object.entries(byD).sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({ date, hours: hours(s) })) };
  }
  return { rows, summary: { clients: rows.length, projects: rows.reduce((s, r) => s + r.projects, 0), tasks: rows.reduce((s, r) => s + r.tasks, 0), trackedHours: hours(rows.reduce((s, r) => s + r.trackedInRangeSeconds, 0)) }, detail };
}
export function clientReportTable(r: Awaited<ReturnType<typeof clientReport>>, f: Filter): ExportTable {
  return {
    title: "Client report", subtitle: `${f.from} to ${f.to}`,
    columns: [{ key: "name", label: "Client", width: 22 }, { key: "industry", label: "Industry", width: 16 }, { key: "status", label: "Status", width: 9 }, { key: "projects", label: "Projects", width: 8, align: "right" }, { key: "tasks", label: "Tasks", width: 7, align: "right" }, { key: "openTasks", label: "Open tasks", width: 9, align: "right" }, { key: "trackedRange", label: "Hours in range", width: 11, align: "right" }, { key: "trackedTotal", label: "Hours total", width: 10, align: "right" }],
    rows: r.rows.map((x) => ({ name: x.name, industry: x.industry ?? "", status: x.archived ? "archived" : x.status, projects: x.projects, tasks: x.tasks, openTasks: x.openTasks, trackedRange: x.trackedInRangeHours, trackedTotal: x.trackedTotalHours })),
    totals: { name: "Total", projects: r.summary.projects, tasks: r.summary.tasks, trackedRange: r.summary.trackedHours },
  };
}

// ---------------------------------------------------------- Attendance report
export async function attendanceReport(ctx: CompanyContext, f: Filter) {
  const users = await scopedUsers(ctx, { userId: f.userId, teamId: f.teamId });
  const ids = new Set(users.map((u) => u.id));
  const data = await listAttendance(ctx, { from: f.from, to: f.to, userId: f.userId });
  const rows = data.rows.filter((r) => ids.has(r.userId));
  const perUser = users.map((u) => {
    const mine = rows.filter((r) => r.userId === u.id);
    const c = (s: string) => mine.filter((r) => r.status === s).length;
    return { id: u.id, name: u.name, team: u.team, present: c("Present"), late: c("Late"), halfDay: c("Half Day"), absent: c("Absent"), leave: c("Leave"), workSeconds: mine.reduce((s, r) => s + r.workSeconds, 0), workHours: hours(mine.reduce((s, r) => s + r.workSeconds, 0)), autoClosed: mine.filter((r) => r.autoClosed).length };
  });
  const summary = { present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, flagged: 0 };
  for (const r of rows) { if (r.status === "Present") summary.present++; else if (r.status === "Late") summary.late++; else if (r.status === "Half Day") summary.halfDay++; else if (r.status === "Absent") summary.absent++; else summary.leave++; if (r.autoClosed && !r.reviewed) summary.flagged++; }
  return { rows, perUser, summary, scheduledSeconds: data.scheduledSeconds };
}
export function attendanceReportTable(r: Awaited<ReturnType<typeof attendanceReport>>, f: Filter, tz: string): ExportTable {
  return {
    title: "Attendance report", subtitle: `${f.from} to ${f.to}`,
    columns: [{ key: "name", label: "Employee", width: 22 }, { key: "date", label: "Date", width: 12 }, { key: "clockIn", label: "Clock in", width: 10 }, { key: "clockOut", label: "Clock out", width: 10 }, { key: "break", label: "Break (h)", width: 8, align: "right" }, { key: "work", label: "Work (h)", width: 8, align: "right" }, { key: "status", label: "Status", width: 10 }, { key: "flag", label: "Auto-closed", width: 9 }],
    rows: r.rows.map((x) => ({ name: x.user?.name ?? "", date: x.date, clockIn: x.clockIn ? toTime(x.clockIn, tz) : "", clockOut: x.clockOut ? toTime(x.clockOut, tz) : "", break: hours(x.breakSeconds), work: hours(x.workSeconds), status: x.status, flag: x.autoClosed ? "yes" : "" })),
  };
}

// --------------------------------------------------------- Daily report view
/** Manager view (spec 12.17): each employee's report beside their tracked hours and per-client split. */
/**
 * Daily reports over a date range (A79), grouped by day, newest first.
 *
 * Everything is fetched once for the whole window rather than per day: a fortnight used to mean a
 * fortnight of round-trips. Days are listed even when nobody submitted, because "nobody filed on
 * the 12th" is exactly what a lead opens this page to find out.
 */
export async function dailyReportsForRange(ctx: CompanyContext, from: string, to: string, q: { userId?: string; teamId?: string; status?: "submitted" | "missing" }) {
  const clock = await companyClock(ctx.companyId);
  const [users, base, reports] = await Promise.all([
    scopedUsers(ctx, q),
    listTimeEntries(ctx, { from, to, userId: q.userId, teamId: q.teamId }),
    scoped(DailyReport, ctx).find({ date: { $gte: from, $lte: to }, ...(q.userId ? { userId: new Types.ObjectId(q.userId) } : {}) }).lean(),
  ]);

  const reportBy = new Map(reports.map((r) => [String(r.userId) + "|" + r.date, r]));
  const secondsBy = new Map<string, number>();
  const clientsBy = new Map<string, Record<string, number>>();
  for (const e of base.entries) {
    const k = e.userId + "|" + e.date;
    secondsBy.set(k, (secondsBy.get(k) ?? 0) + e.elapsedSeconds);
    if (e.client?.name) {
      const split = clientsBy.get(k) ?? {};
      split[e.client.name] = (split[e.client.name] ?? 0) + e.elapsedSeconds;
      clientsBy.set(k, split);
    }
  }

  const days = clock.days(from, to).reverse().map((date) => {
    const rows = users.map((u) => {
      const k = u.id + "|" + date;
      const r = reportBy.get(k);
      return {
        user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl, team: u.team },
        trackedSeconds: secondsBy.get(k) ?? 0,
        byClient: Object.entries(clientsBy.get(k) ?? {}).map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds),
        report: r ? { id: String(r._id), completed: r.completed as string, submittedAt: r.submittedAt as Date } : null,
      };
    });
    const submitted = rows.filter((r) => r.report).length;
    // The status filter narrows what is shown, never the counts - "3 of 9" has to stay honest.
    const shown = q.status === "submitted" ? rows.filter((r) => r.report) : q.status === "missing" ? rows.filter((r) => !r.report) : rows;
    return { date, rows: shown, submitted, total: rows.length, isWorkingDay: clock.isWorkingDay(date) };
  });

  return {
    from, to, days,
    submitted: days.reduce((n, d) => n + d.submitted, 0),
    total: days.reduce((n, d) => n + d.total, 0),
    trackedSeconds: base.entries.reduce((n, e) => n + e.elapsedSeconds, 0),
    people: users.length,
  };
}

export async function dailyReportsForDay(ctx: CompanyContext, date: string, q: { userId?: string; teamId?: string }) {
  const [users, base, reports] = await Promise.all([
    scopedUsers(ctx, q),
    listTimeEntries(ctx, { from: date, to: date, userId: q.userId, teamId: q.teamId }),
    scoped(DailyReport, ctx).find({ date, ...(q.userId ? { userId: new Types.ObjectId(q.userId) } : {}) }).lean(),
  ]);
  const byUser = new Map(reports.map((r) => [String(r.userId), r]));
  const rows = users.map((u) => {
    const entries = base.entries.filter((e) => e.userId === u.id);
    const split: Record<string, number> = {};
    for (const e of entries) if (e.client?.name) split[e.client.name] = (split[e.client.name] ?? 0) + e.elapsedSeconds;
    const r = byUser.get(u.id);
    return { user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl, team: u.team }, trackedSeconds: entries.reduce((s, e) => s + e.elapsedSeconds, 0), byClient: Object.entries(split).map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds), report: r ? { id: String(r._id), completed: r.completed, inProgress: r.inProgress, pending: r.pending, blockers: r.blockers, tomorrow: r.tomorrow, submittedAt: r.submittedAt } : null };
  });
  return { date, rows, submitted: rows.filter((r) => r.report).length, total: rows.length };
}

