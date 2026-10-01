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
import type { Role } from "@/types";
import { onTheClock } from "@/lib/permissions";
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
    /** How many swipes made this day (A132) - two is normal, one never closed. */
    swipeCount: (a.swipeCount as number) ?? 0,
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

/*
 * Clocking in and out lived here (A121). Both are gone: the swipe is the record
 * now - it carries a photograph, a place, a face check and an approval trail,
 * and the day is derived from it by syncAttendanceFromSwipes below. Keeping a
 * second way in would have meant payroll counting whichever of the two somebody
 * happened to remember, and the one with no evidence behind it was the one
 * feeding the pay.
 *
 * What they did that still has to happen somewhere: a forgotten clock-out was
 * closed by autoCloseForgotten, which still runs; and clocking out stopped a
 * running timer, which it no longer does - stopping a timer needs its picture
 * and its description (A105), and doing it silently was a way around that.
 */

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
        /*
         * Nobody is marked absent for not doing something they are not asked to
         * do (A139). The admin does not swipe, so inventing an absence for each
         * of their working days would fill the one report that is meant to be
         * read carefully with rows nobody can act on. Any real record they do
         * have - a leave, or a swipe from before this rule - still shows above.
         */
        if (!onTheClock(u.role as Role)) continue;
        const joined = clock.dayOf(u.joiningDate ?? u.createdAt);
        if (joined > day || have.has(`${u._id}:${day}`)) continue;
        rows.push({ id: `absent-${u._id}-${day}`, userId: String(u._id), user: { id: String(u._id), name: u.name, avatarUrl: u.avatarUrl ?? null }, date: day, clockIn: null, clockOut: null, breakSeconds: 0, workSeconds: 0, status: "Absent", swipeCount: 0, autoClosed: false, reviewed: false, note: null, virtual: true });
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

/**
 * The day's attendance, worked out from that day's swipes (A121).
 *
 * Clocking in and out used to be a second, separate thing people had to
 * remember on top of swiping - two buttons for one fact, and the one that fed
 * payroll was the one with no photograph, no location and no approval behind
 * it. The swipes are the record now and this derives the rest from them.
 *
 * Recomputed from scratch every time rather than nudged, which is what makes it
 * safe to call after a swipe is approved, rejected, or arrives late: the answer
 * depends only on the swipes that currently stand, so it cannot drift.
 *
 * A rejected swipe is not counted. A day whose swipes are all rejected goes back
 * to having no record at all, exactly as if nobody had swiped.
 */
export async function syncAttendanceFromSwipes(ctx: CompanyContext, userId: string, date: string): Promise<void> {
  const { AttendanceSwipe } = await import("@/models/AttendanceSwipe");
  const uid = new Types.ObjectId(userId);
  const clock = await personClock(ctx.companyId, userId);

  const swipes = await scoped(AttendanceSwipe, ctx)
    .find({ userId: uid, date, status: { $ne: "REJECTED" } })
    .select("type at").sort({ at: 1 }).lean();

  const existing = await scoped(Attendance, ctx).findOne({ userId: uid, date });

  /*
   * Anything a person set by hand wins. Leave, and any day an admin has written
   * a note or a status onto, is a decision somebody made about that day -
   * recomputing over it would silently undo them.
   */
  if (existing && (existing.status === "Leave" || existing.setBy)) return;

  if (swipes.length === 0) {
    if (existing) await existing.deleteOne();
    return;
  }

  // In, from the first swipe that says on duty - or simply the first, for
  // somebody who forgot to swipe in and only swiped out.
  /*
   * The first swipe and the last swipe, whatever they say (A132).
   *
   * It used to take the first *on duty* and the last *off duty*, which read
   * well and behaved badly: somebody who forgot to swipe off had no end to
   * their day at all, so the hours came out as nothing and the record looked
   * like they had never left. What a person reviewing a day actually wants is
   * the two ends of it - the earliest thing that happened and the latest - and
   * the count beside them to say whether those two are the whole story.
   */
  const clockIn = swipes[0].at as Date;
  const lastSwipe = swipes.length > 1 ? swipes[swipes.length - 1] : null;
  const lastOff = lastSwipe && (lastSwipe.at as Date).getTime() > clockIn.getTime() ? lastSwipe : null;

  const rec = existing ?? (await scoped(Attendance, ctx).create({
    userId: uid, date, clockIn, status: lateStatus(clock, date, clockIn),
  })) as unknown as Doc;

  rec.clockIn = clockIn;
  rec.set("swipeCount", swipes.length);
  if (lastOff) {
    await closeRecord(new Types.ObjectId(ctx.companyId), clock, rec as Doc, lastOff.at as Date, false);
    return;
  }
  // Still on duty: no clock-out, and the status is only about arriving on time.
  rec.clockOut = null;
  rec.workSeconds = 0;
  rec.status = lateStatus(clock, date, clockIn);
  await rec.save();
}

/**
 * Settling one day, by hand, with a reason (A130).
 *
 * The step that was missing between a swipe and a payslip. Everything else in
 * the chain is automatic - the swipe carries a photograph and a face, the day
 * is derived from the swipes, payroll counts the payable days - and nowhere in
 * it did a person look at a month and say "yes, this is right". A day somebody
 * forgot to swipe off, or was genuinely away for, went into the pay run either
 * way with nobody in between.
 *
 * Three things are deliberate:
 *
 * - **The reason is required.** A day changed by hand, months later, with no
 *   note is indistinguishable from a mistake - and it is the entries that move
 *   money which get asked about.
 * - **It wins over the swipes.** `syncAttendanceFromSwipes` leaves alone any
 *   day with `setBy` on it, so a decision somebody made is never quietly
 *   recomputed away by a swipe arriving late.
 * - **Leave goes through the balance.** Marking somebody on casual leave here
 *   has to spend a casual leave day, or the balance on their screen and the
 *   deduction on their payslip stop agreeing.
 */
export async function settleDay(
  ctx: CompanyContext,
  input: { userId: string; date: string; status: AttendanceStatus; note: string; leaveType?: string | null },
  ip: string | null,
) {
  const id = await requireVisibleEmployee(ctx, input.userId);
  const note = input.note.trim();
  if (!note) throw Errors.bad("NOTE_REQUIRED", "Say why this day is being changed - it is what somebody will read months from now.");

  const user = await scoped(User, ctx).findOne({ _id: id, archivedAt: null }).select("name").lean();
  if (!user) throw Errors.notFound("Employee");

  const before = await scoped(Attendance, ctx).findOne({ userId: id, date: input.date }).lean();

  const rec = await scoped(Attendance, ctx).findOneAndUpdate(
    { userId: id, date: input.date },
    {
      $set: {
        status: input.status,
        note,
        setBy: new Types.ObjectId(ctx.userId),
        setAt: new Date(),
      },
      $setOnInsert: { clockIn: null, clockOut: null, breakSeconds: 0, workSeconds: 0 },
    },
    { upsert: true, new: true },
  );

  await audit({
    ctx, companyId: ctx.companyId, entity: "attendance", entityId: rec!._id,
    action: "attendance.settled",
    summary: `${ctx.name} marked ${user.name} ${input.status} on ${input.date}`,
    before: before ? { status: before.status, note: before.note ?? null } : null,
    after: { status: input.status, note, leaveType: input.leaveType ?? null },
    ip,
  });

  const { notify } = await import("./notificationService");
  await notify(ctx.companyId, {
    userId: input.userId,
    type: "ATTENDANCE_SWIPE",
    title: `${ctx.name} marked you ${input.status} on ${input.date}`,
    body: note,
    link: "/attendance",
    actorId: ctx.userId,
  });

  return serializeAttendance(rec!.toObject() as Record<string, unknown>);
}
