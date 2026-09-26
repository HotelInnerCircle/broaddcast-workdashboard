import { Types } from "mongoose";
import { scoped, pop } from "@/lib/db/scoped";
import { TimeEntry, type TimeEntryDoc } from "@/models/TimeEntry";
import type { HydratedDocument } from "mongoose";
import { Break } from "@/models/Break";
import { Task } from "@/models/Task";
import { Project } from "@/models/Project";
import { Client } from "@/models/Client";
import { Errors, ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { companyClock } from "@/lib/time/company-clock";
import { realtime } from "@/lib/realtime";
import type { CompanyContext } from "@/lib/auth/context";
import { clientScopeFilter, projectScopeFilter, taskScopeFilter } from "./scope";

type Segment = { start: Date; end: Date | null };
const ref = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name } : v ? { id: String(v), name: null } : null);
const titleRef = (v: unknown) => (v && typeof v === "object" && "title" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { title: string }).title } : v ? { id: String(v), name: null } : null);

/** Closed-segment seconds; the open segment (if any) is measured against `now`. */
export function elapsedSeconds(segments: Segment[], now = new Date()): number {
  return segments.reduce((sum, s) => sum + Math.max(0, Math.floor(((s.end ?? now).getTime() - s.start.getTime()) / 1000)), 0);
}
export function closedSeconds(segments: Segment[]): number {
  return segments.reduce((sum, s) => (s.end ? sum + Math.max(0, Math.floor((s.end.getTime() - s.start.getTime()) / 1000)) : sum), 0);
}

export const TIMER_POPULATE = [pop("clientId", "name"), pop("projectId", "name"), pop("taskId", "title status")];

export function serializeEntry(e: Record<string, unknown>, now = new Date()) {
  const segments = (e.segments as Segment[]) ?? [];
  const open = segments.find((s) => !s.end) ?? null;
  const status = e.status as string;
  const first = segments[0]?.start ?? (e.createdAt as Date);
  const last = [...segments].reverse().find((s) => s.end)?.end ?? null;
  return {
    id: String(e._id), userId: String(e.userId), client: ref(e.clientId), project: ref(e.projectId), task: titleRef(e.taskId),
    status, date: e.date as string, notes: (e.notes as string | null) ?? null,
    /** Whether a picture of the work is attached (A105); the link is fetched on demand. */
    hasProof: Boolean(e.proofKey),
    segments: segments.map((s) => ({ start: s.start, end: s.end })),
    start: first, end: status === "COMPLETED" ? last : null,
    closedSeconds: closedSeconds(segments), openSince: open?.start ?? null,
    elapsedSeconds: status === "COMPLETED" ? (e.durationSeconds as number) : elapsedSeconds(segments, now),
    durationSeconds: e.durationSeconds as number, autoClosed: Boolean((e.flags as { autoClosed?: boolean } | undefined)?.autoClosed),
    serverNow: now,
  };
}

async function findActive(ctx: CompanyContext, userId = ctx.userId) {
  return scoped(TimeEntry, ctx).findOne({ userId: new Types.ObjectId(userId), status: { $in: ["RUNNING", "PAUSED"] } }).populate(TIMER_POPULATE);
}

/** Restores the timer widget on login / app load (spec 7.1). */
export async function getActiveTimer(ctx: CompanyContext) {
  const [entry, openBreak] = await Promise.all([findActive(ctx), scoped(Break, ctx).findOne({ userId: new Types.ObjectId(ctx.userId), end: null }).lean()]);
  return {
    entry: entry ? serializeEntry(entry.toObject() as Record<string, unknown>) : null,
    break: openBreak ? { id: String(openBreak._id), start: openBreak.start, resumeEntryId: openBreak.resumeEntryId ? String(openBreak.resumeEntryId) : null } : null,
    serverNow: new Date(),
  };
}

/** Recompute the cached tracked minutes on a task from COMPLETED entries (spec section 8, actualMinutes). */
export async function refreshTaskActualMinutes(ctx: { companyId: string }, taskId: Types.ObjectId) {
  const rows = await scoped(TimeEntry, ctx).aggregate<{ total: number }>([{ $match: { taskId, status: "COMPLETED" } }, { $group: { _id: null, total: { $sum: "$durationSeconds" } } }]);
  await scoped(Task, ctx).updateOne({ _id: taskId }, { $set: { actualMinutes: Math.round((rows[0]?.total ?? 0) / 60) } });
}

/** Stop helper shared by stop/switch/auto-close. Closes the open segment at `at` and finalizes. */
export async function finalizeEntry(ctx: { companyId: string; userId?: string; role?: string; name?: string }, entry: HydratedDocument<TimeEntryDoc>, at: Date, opts: { notes?: string | null; autoClosed?: boolean; ip?: string | null } = {}) {
  for (const s of entry.segments as Segment[]) if (!s.end) s.end = at > s.start ? at : s.start;
  entry.status = "COMPLETED";
  entry.durationSeconds = closedSeconds(entry.segments as Segment[]);
  if (opts.notes !== undefined) entry.notes = opts.notes;
  if (opts.autoClosed) entry.set("flags.autoClosed", true);
  await entry.save();
  // taskId is optional (A53) and may be populated (findActive populates it); reduce to the plain id.
  const taskId = entry.taskId ? new Types.ObjectId(String((entry.taskId as { _id?: unknown })?._id ?? entry.taskId)) : null;
  const projectId = entry.projectId ? String((entry.projectId as { _id?: unknown })?._id ?? entry.projectId) : null;
  if (taskId) await refreshTaskActualMinutes(ctx, taskId);
  const actor = ctx.userId && ctx.role && ctx.name ? { userId: ctx.userId, role: ctx.role as never, name: ctx.name } : null;
  realtime().emitToCompany(ctx.companyId, "timer:stopped", { userId: String(entry.userId), entryId: String(entry._id), durationSeconds: entry.durationSeconds, at });
  if (opts.autoClosed) { const { notify } = await import("./notificationService"); await notify(ctx.companyId, { userId: String(entry.userId), type: "TIMER", title: "Your timer was closed automatically", body: "It was still running after the end of the day, so it was stopped at end-of-day + 2h. Please review your timesheet.", link: "/timesheets" }); }
  await audit({ ctx: actor, companyId: ctx.companyId, entity: "timeEntry", entityId: entry._id, action: opts.autoClosed ? "timer.auto_closed" : "timer.stopped", summary: `${actor?.name ?? "System"} stopped a timer (${Math.round(entry.durationSeconds / 60)} min)`, after: { projectId, taskId: taskId ? String(taskId) : null, durationSeconds: entry.durationSeconds, autoClosed: Boolean(opts.autoClosed) }, ip: opts.ip ?? null });
}

/**
 * Start (spec 7.1-7.3, amended by A53/A58): a timer runs against a Client with notes describing the
 * work; project and task are attached only when started from a task page. A second active timer is
 * refused with TIMER_ACTIVE unless `force` + `previousNotes` (confirm-and-switch) are set. Starting
 * a timer ends an open break.
 */
export async function startTimer(ctx: CompanyContext, input: { clientId: string; projectId?: string; taskId?: string; notes: string; force?: boolean; previousNotes?: string }, ip: string | null) {
  const client = await scoped(Client, ctx).findOne({ ...(await clientScopeFilter(ctx)), _id: new Types.ObjectId(input.clientId), archivedAt: null }).select("name status").lean();
  if (!client) throw Errors.notFound("Client");
  if (client.status !== "active") throw Errors.bad("CLIENT_INACTIVE", "This client is inactive. Reactivate it before tracking time.");
  // Optional project/task (started from a task page): must belong to the client and be open.
  let project: { _id: Types.ObjectId; name: string; status: string } | null = null;
  if (input.projectId) {
    project = await scoped(Project, ctx).findOne({ ...(await projectScopeFilter(ctx)), _id: new Types.ObjectId(input.projectId), clientId: client._id, archivedAt: null }).select("name status").lean();
    if (!project) throw Errors.notFound("Project");
    if (project.status === "Completed" || project.status === "Cancelled") throw Errors.bad("PROJECT_CLOSED", "This project is completed or cancelled. Reopen it before tracking time.");
  }
  let task: { _id: Types.ObjectId; title: string; status: string } | null = null;
  if (input.taskId) {
    if (!project) throw Errors.bad("PROJECT_REQUIRED", "A task timer needs its project");
    task = await scoped(Task, ctx).findOne({ ...(await taskScopeFilter(ctx)), _id: new Types.ObjectId(input.taskId), projectId: project._id, archivedAt: null }).select("title status").lean();
    if (!task) throw Errors.notFound("Task");
    if (task.status === "Completed" || task.status === "Cancelled") throw Errors.bad("TASK_CLOSED", "This task is completed or cancelled. Reopen it before tracking time.");
  }
  const now = new Date();
  const active = await findActive(ctx);
  if (active) {
    if (!input.force) {
      throw new ApiError(409, "TIMER_ACTIVE", "You already have a timer running. Stop the current timer and start this one?", { entry: serializeEntry(active.toObject() as Record<string, unknown>, now) });
    }
    // Switching closes the running entry, which needs its work notes like any other stop (A53).
    if (!input.previousNotes) throw Errors.bad("NOTES_REQUIRED", "Describe the work you completed on the running timer before switching");
    /*
     * A105: switching closes a timer, so it would be a way round the picture -
     * start anything at all and the running entry ends with no proof of it. When
     * a picture is required the switch is refused and they are sent to Stop,
     * which is the one place that asks for it. A requirement with a way around it
     * is not a requirement.
     */
    const { proofRequired } = await import("@/lib/storage/work-proof");
    if (await proofRequired(ctx.companyId, "timer")) {
      throw Errors.bad("STOP_FIRST", "Stop the running timer first - it needs a picture of the work you finished.");
    }
    await finalizeEntry(ctx, active as never, now, { notes: input.previousNotes, ip });
  }
  const openBreak = await scoped(Break, ctx).findOne({ userId: new Types.ObjectId(ctx.userId), end: null });
  if (openBreak) { openBreak.end = now; openBreak.durationSeconds = Math.floor((now.getTime() - openBreak.start.getTime()) / 1000); await openBreak.save(); }
  const clock = await companyClock(ctx.companyId);
  let entry;
  try {
    entry = await scoped(TimeEntry, ctx).create({
      userId: new Types.ObjectId(ctx.userId), clientId: client._id, projectId: project?._id ?? null, taskId: task?._id ?? null,
      segments: [{ start: now, end: null }], status: "RUNNING", durationSeconds: 0, date: clock.dayOf(now), notes: input.notes,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ApiError(409, "TIMER_ACTIVE", "You already have a timer running.", {});
    throw e;
  }
  if (task && (task.status === "To Do" || task.status === "Backlog")) await scoped(Task, ctx).updateOne({ _id: task._id }, { $set: { status: "In Progress" } });
  await audit({ ctx, companyId: ctx.companyId, entity: "timeEntry", entityId: entry._id, action: "timer.started", summary: `${ctx.name} started a timer on "${task ? task.title : project ? project.name : client.name}"`, after: { clientId: String(client._id), projectId: project ? String(project._id) : null, taskId: task ? String(task._id) : null, notes: input.notes }, ip });
  const full = await scoped(TimeEntry, ctx).findById(String(entry._id)).populate(TIMER_POPULATE);
  const dto = serializeEntry(full!.toObject() as Record<string, unknown>, now);
  realtime().emitToCompany(ctx.companyId, "timer:started", { userId: ctx.userId, entryId: dto.id, clientId: dto.client?.id ?? null, projectId: dto.project?.id ?? null, taskId: dto.task?.id ?? null, at: now });
  return dto;
}

export async function pauseTimer(ctx: CompanyContext) {
  const entry = await findActive(ctx);
  if (!entry) throw Errors.notFound("Active timer");
  if (entry.status !== "RUNNING") throw Errors.bad("TIMER_NOT_RUNNING", "The timer is already paused");
  const now = new Date();
  for (const s of entry.segments as Segment[]) if (!s.end) s.end = now;
  entry.status = "PAUSED";
  entry.durationSeconds = closedSeconds(entry.segments as Segment[]);
  await entry.save();
  realtime().emitToCompany(ctx.companyId, "timer:paused", { userId: ctx.userId, entryId: String(entry._id), at: now });
  return serializeEntry(entry.toObject() as Record<string, unknown>, now);
}

export async function resumeTimer(ctx: CompanyContext) {
  const entry = await findActive(ctx);
  if (!entry) throw Errors.notFound("Active timer");
  if (entry.status !== "PAUSED") throw Errors.bad("TIMER_NOT_PAUSED", "The timer is already running");
  const now = new Date();
  const openBreak = await scoped(Break, ctx).findOne({ userId: new Types.ObjectId(ctx.userId), end: null });
  if (openBreak) { openBreak.end = now; openBreak.durationSeconds = Math.floor((now.getTime() - openBreak.start.getTime()) / 1000); await openBreak.save(); }
  entry.segments.push({ start: now, end: null } as never);
  entry.status = "RUNNING";
  await entry.save();
  realtime().emitToCompany(ctx.companyId, "timer:started", { userId: ctx.userId, entryId: String(entry._id), resumed: true, at: now });
  return serializeEntry(entry.toObject() as Record<string, unknown>, now);
}

export async function stopTimer(
  ctx: CompanyContext,
  input: { notes: string; proof?: { proofKey: string; proofName: string; proofSize: number; proofType: string } | null },
  ip: string | null,
) {
  const entry = await findActive(ctx);
  if (!entry) throw Errors.notFound("Active timer");
  const now = new Date();
  // Set before finalising, so the picture and the entry are saved together
  // rather than the entry closing and the proof going missing if the write fails.
  if (input.proof) entry.set(input.proof);
  await finalizeEntry(ctx, entry as never, now, { notes: input.notes, ip });
  return serializeEntry(entry.toObject() as Record<string, unknown>, now);
}

/** Work / break / session totals for a day and the running week (spec 7.4 daily summary). */
export async function daySummary(ctx: CompanyContext, userId: string, day?: string) {
  const clock = await companyClock(ctx.companyId);
  const today = day ?? clock.dayOf(new Date());
  const uid = new Types.ObjectId(userId);
  const now = new Date();
  const weekStart = (() => { const d = new Date(`${today}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); })();
  const [entries, breaks, weekAgg, { Attendance }] = await Promise.all([
    scoped(TimeEntry, ctx).find({ userId: uid, date: today }).lean(),
    scoped(Break, ctx).find({ userId: uid, date: today }).lean(),
    scoped(TimeEntry, ctx).find({ userId: uid, date: { $gte: weekStart, $lte: today } }).select("segments status durationSeconds").lean(),
    import("@/models/Attendance"),
  ]);
  const attendance = await scoped(Attendance, ctx).findOne({ userId: uid, date: today }).lean();
  const workSeconds = entries.reduce((s, e) => s + (e.status === "COMPLETED" ? e.durationSeconds : elapsedSeconds(e.segments as Segment[], now)), 0);
  const breakSeconds = breaks.reduce((s, b) => s + (b.end ? b.durationSeconds : Math.floor((now.getTime() - b.start.getTime()) / 1000)), 0);
  const sessionSeconds = attendance?.clockIn ? Math.max(0, Math.floor(((attendance.clockOut ?? now).getTime() - attendance.clockIn.getTime()) / 1000)) : 0;
  const weekSeconds = weekAgg.reduce((s, e) => s + (e.status === "COMPLETED" ? e.durationSeconds : elapsedSeconds(e.segments as Segment[], now)), 0);
  return { date: today, workSeconds, breakSeconds, sessionSeconds, weekSeconds, entries: entries.length, attendance: attendance ? { clockIn: attendance.clockIn, clockOut: attendance.clockOut, status: attendance.status } : null };
}
