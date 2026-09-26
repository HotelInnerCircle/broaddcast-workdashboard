import { Types } from "mongoose";
import { scoped, pop, unscopedOptions } from "@/lib/db/scoped";
import { Attendance, type AttendanceDoc } from "@/models/Attendance";
import type { HydratedDocument } from "mongoose";
import { Break } from "@/models/Break";
import { TimeEntry } from "@/models/TimeEntry";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { Errors, ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { buildClock, companyClock, personClock, type CompanyClock } from "@/lib/time/company-clock";
import type { CompanyContext } from "@/lib/auth/context";
import type { AttendanceStatus } from "@/types";
import { employeeScopeFilter, requireVisibleEmployee } from "./scope";
import { finalizeEntry } from "./timerService";

type Doc = HydratedDocument<AttendanceDoc>;
const person = (v: unknown) => (v && typeof v === "object" && "name" in v ? { id: String((v as unknown as { _id: unknown })._id), name: (v as { name: string }).name, avatarUrl: (v as { avatarUrl?: string | null }).avatarUrl ?? null } : null);

export function serializeAttendance(a: Record<string, unknown>) {
  const flags = (a.flags as { autoClosed?: boolean; reviewed?: boolean } | undefined) ?? {};
  return {
    id: String(a._id), userId: a.userId && typeof a.userId === "object" && "name" in (a.userId as object) ? String((a.userId as { _id: unknown })._id) : String(a.userId), user: person(a.userId),
    date: a.date as string, clockIn: (a.clockIn as Date | null) ?? null, clockOut: (a.clockOut as Date | null) ?? null,
    breakSeconds: (a.breakSeconds as number) ?? 0, workSeconds: (a.workSeconds as number) ?? 0, status: a.status as AttendanceStatus,
    autoClosed: Boolean(flags.autoClosed), reviewed: Boolean(flags.reviewed), note: (a.note as string | null) ?? null, virtual: false,
  };
}

/** Late = clock-in more than lateThresholdMinutes after company start (spec 7.5). */
export function lateStatus(clock: CompanyClock, day: string, clockIn: Date): "Present" | "Late" {
  return clockIn.getTime() > clock.workStart(day).getTime() + clock.lateThresholdMinutes * 60_000 ? "Late" : "Present";
}

/** Closes the record: break time = breaks of the day; work = session - breaks; Half Day when work < 50% of schedule. */
async function closeRecord(companyId: Types.ObjectId, clock: CompanyClock, rec: Doc, at: Date, autoClosed: boolean) {
  const breaks = await Break.find({ companyId, userId: rec.userId, date: rec.date }).lean();
  const now = at;
  const breakSeconds = breaks.reduce((s, b) => s + (b.end ? b.durationSeconds : Math.max(0, Math.floor((now.getTime() - b.start.getTime()) / 1000))), 0);
  const session = Math.max(0, Math.floor((at.getTime() - rec.clockIn!.getTime()) / 1000));
  rec.clockOut = at;
  rec.breakSeconds = breakSeconds;
  rec.workSeconds = Math.max(0, session - breakSeconds);
  const late = lateStatus(clock, rec.date, rec.clockIn!);
  rec.status = clock.scheduledSeconds > 0 && rec.workSeconds < clock.scheduledSeconds / 2 ? "Half Day" : late;
  if (autoClosed) rec.set("flags.autoClosed", true);
  await rec.save();
}

export async function clockIn(ctx: CompanyContext, ip: string | null) {
  const clock = await personClock(ctx.companyId, ctx.userId);
  const now = new Date();
  const day = clock.dayOf(now);
  const uid = new Types.ObjectId(ctx.userId);
  const existing = await scoped(Attendance, ctx).findOne({ userId: uid, date: day });
  if (existing?.clockIn) throw new ApiError(409, "ALREADY_CLOCKED_IN", existing.clockOut ? "You have already clocked out for today" : "You are already clocked in", {});
  let rec: Doc;
  if (existing) {
    existing.clockIn = now; existing.status = lateStatus(clock, day, now); await existing.save(); rec = existing as Doc;
  } else {
    rec = (await scoped(Attendance, ctx).create({ userId: uid, date: day, clockIn: now, status: lateStatus(clock, day, now) })) as unknown as Doc;
  }
  await audit({ ctx, companyId: ctx.companyId, entity: "attendance", entityId: rec._id, action: "attendance.clock_in", summary: `${ctx.name} clocked in (${rec.status})`, after: { date: day, status: rec.status }, ip });
  return serializeAttendance(rec.toObject() as Record<string, unknown>);
}

/** Clock-out also stops a running timer and ends an open break: the working session is over. */
export async function clockOut(ctx: CompanyContext, ip: string | null) {
  const clock = await personClock(ctx.companyId, ctx.userId);
  const now = new Date();
  const uid = new Types.ObjectId(ctx.userId);
  const rec = await scoped(Attendance, ctx).findOne({ userId: uid, clockIn: { $ne: null }, clockOut: null }).sort({ date: -1 });
  if (!rec) throw Errors.bad("NOT_CLOCKED_IN", "You are not clocked in");
  const active = await scoped(TimeEntry, ctx).findOne({ userId: uid, status: { $in: ["RUNNING", "PAUSED"] } });
  if (active) await finalizeEntry(ctx, active as never, now, { ip });
  const openBreak = await scoped(Break, ctx).findOne({ userId: uid, end: null });
  if (openBreak) { openBreak.end = now; openBreak.durationSeconds = Math.floor((now.getTime() - openBreak.start.getTime()) / 1000); await openBreak.save(); }
  await closeRecord(new Types.ObjectId(ctx.companyId), clock, rec as Doc, now, false);
  await audit({ ctx, companyId: ctx.companyId, entity: "attendance", entityId: rec._id, action: "attendance.clock_out", summary: `${ctx.name} clocked out (${rec.status}, ${Math.round(rec.workSeconds / 3600 * 10) / 10}h)`, after: { date: rec.date, status: rec.status, workSeconds: rec.workSeconds }, ip });
  return serializeAttendance(rec.toObject() as Record<string, unknown>);
}

/**
 * Attendance list (spec 12.13). Working days without a record become virtual "Absent" rows for
 * active users who had joined by then (spec 7.5). Today is never marked absent before the day ends.
 */
export async function listAttendance(ctx: CompanyContext, q: { from: string; to: string; userId?: string; flagged?: boolean }) {
  const clock = await companyClock(ctx.companyId);
  const scope = await employeeScopeFilter(ctx);
  const userFilter: Record<string, unknown> = { ...scope, archivedAt: null, status: { $ne: "deactivated" } };
  // Asking about one person must be checked, not merely filtered: an employee
  // may only ask about themselves, and gets a 403 rather than an empty table.
  if (q.userId) userFilter._id = await requireVisibleEmployee(ctx, q.userId);
  const users = await scoped(User, ctx).find(userFilter).select("name avatarUrl joiningDate createdAt role").sort({ name: 1 }).lean();
  const userIds = users.map((u) => u._id);
  const records = await scoped(Attendance, ctx).find({ userId: { $in: userIds }, date: { $gte: q.from, $lte: q.to }, ...(q.flagged ? { "flags.autoClosed": true, "flags.reviewed": false } : {}) }).populate(pop("userId", "name avatarUrl")).sort({ date: -1 }).lean();
  const rows = records.map((r) => serializeAttendance(r as Record<string, unknown>));
  if (!q.flagged) {
    const today = clock.dayOf(new Date());
    const have = new Set(rows.map((r) => `${r.userId}:${r.date}`));
    for (const day of clock.days(q.from, q.to)) {
      if (day >= today || !clock.isWorkingDay(day)) continue;
      for (const u of users) {
        const joined = clock.dayOf(u.joiningDate ?? u.createdAt);
        if (joined > day || have.has(`${u._id}:${day}`)) continue;
        rows.push({ id: `absent-${u._id}-${day}`, userId: String(u._id), user: { id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null }, date: day, clockIn: null, clockOut: null, breakSeconds: 0, workSeconds: 0, status: "Absent", autoClosed: false, reviewed: false, note: null, virtual: true });
      }
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date) || (a.user?.name ?? "").localeCompare(b.user?.name ?? ""));
  const summary = { present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, flagged: 0 };
  for (const r of rows) {
    if (r.status === "Present") summary.present++; else if (r.status === "Late") summary.late++; else if (r.status === "Half Day") summary.halfDay++; else if (r.status === "Absent") summary.absent++; else summary.leave++;
    if (r.autoClosed && !r.reviewed) summary.flagged++;
  }
  return { rows, summary, scheduledSeconds: clock.scheduledSeconds };
}

/** Leave is set manually by an admin/manager (spec 7.5, no request workflow). */
export async function setLeave(ctx: CompanyContext, input: { userId: string; date: string; note?: string | null }, ip: string | null) {
  const id = await requireVisibleEmployee(ctx, input.userId);
  const user = await scoped(User, ctx).findOne({ _id: id, archivedAt: null }).select("name").lean();
  if (!user) throw Errors.notFound("Employee");
  const rec = await scoped(Attendance, ctx).findOneAndUpdate(
    { userId: user._id, date: input.date },
    { $set: { status: "Leave", note: input.note ?? null, setBy: new Types.ObjectId(ctx.userId) }, $setOnInsert: { clockIn: null, clockOut: null, breakSeconds: 0, workSeconds: 0 } },
    { upsert: true },
  );
  await audit({ ctx, companyId: ctx.companyId, entity: "attendance", entityId: rec!._id, action: "attendance.leave_set", summary: `${ctx.name} marked ${user.name} on leave for ${input.date}`, after: { date: input.date }, ip });
  return serializeAttendance(rec!.toObject() as Record<string, unknown>);
}

export async function markReviewed(ctx: CompanyContext, id: string, ip: string | null) {
  const scope = await employeeScopeFilter(ctx);
  const userIds = (await scoped(User, ctx).find({ ...scope }).select("_id").lean()).map((u) => u._id);
  const rec = await scoped(Attendance, ctx).findOneAndUpdate({ _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : new Types.ObjectId(), userId: { $in: userIds } }, { $set: { "flags.reviewed": true } });
  if (!rec) throw Errors.notFound("Attendance record");
  await audit({ ctx, companyId: ctx.companyId, entity: "attendance", entityId: rec._id, action: "attendance.reviewed", summary: `${ctx.name} reviewed an auto-closed attendance record`, ip });
  return serializeAttendance(rec.toObject() as Record<string, unknown>);
}

/**
 * Background job (spec 7.5): any record still open after company end-of-day + 2h is closed at
 * that instant and flagged for manager review. Running timers and open breaks of that day are
 * closed at the same instant so durations cannot grow overnight (ASSUMPTIONS A24).
 */
export async function autoCloseForgotten(now = new Date()): Promise<{ attendance: number; timers: number; breaks: number }> {
  const result = { attendance: 0, timers: 0, breaks: 0 };
  const companies = await Company.find({ status: "active" }).select("timezone workingHours workingDays lateThresholdMinutes").lean();
  for (const c of companies) {
    const clock = buildClock({ timezone: c.timezone, workingHours: c.workingHours ?? { start: "09:00", end: "18:00" }, workingDays: c.workingDays, lateThresholdMinutes: c.lateThresholdMinutes });
    const open = await Attendance.find({ companyId: c._id, clockIn: { $ne: null }, clockOut: null }).setOptions(unscopedOptions);
    for (const rec of open) {
      const cutoff = clock.autoCloseAt(rec.date);
      if (now < cutoff) continue;
      const ctx = { companyId: String(c._id) };
      const timers = await TimeEntry.find({ companyId: c._id, userId: rec.userId, status: { $in: ["RUNNING", "PAUSED"] } }).setOptions(unscopedOptions);
      for (const t of timers) { await finalizeEntry(ctx, t as never, cutoff, { autoClosed: true }); result.timers++; }
      const breaks = await Break.find({ companyId: c._id, userId: rec.userId, end: null }).setOptions(unscopedOptions);
      for (const b of breaks) { b.end = cutoff > b.start ? cutoff : b.start; b.durationSeconds = Math.floor((b.end.getTime() - b.start.getTime()) / 1000); b.set("flags.autoClosed", true); await b.save(); result.breaks++; }
      await closeRecord(c._id, clock, rec as Doc, cutoff, true);
      await audit({ ctx: null, companyId: c._id, entity: "attendance", entityId: rec._id, action: "attendance.auto_closed", summary: `Forgotten clock-out auto-closed for ${rec.date}; flagged for review`, after: { date: rec.date, status: rec.status, workSeconds: rec.workSeconds } });
      result.attendance++;
    }
  }
  return result;
}
