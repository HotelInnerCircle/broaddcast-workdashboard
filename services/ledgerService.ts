import { Types } from "mongoose";
import { formatInTimeZone } from "date-fns-tz";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { personClock } from "@/lib/time/company-clock";
import { Attendance } from "@/models/Attendance";
import { Holiday } from "@/models/Holiday";
import { LeaveRequest } from "@/models/LeaveRequest";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { payrollPeriod } from "@/lib/time/payroll-period";
import { LEAVE_TYPE_LABEL, type LeaveType } from "@/types";
import type { CompanyContext } from "@/lib/auth/context";

export type DayKind = "Present" | "Late" | "Half Day" | "Absent" | "Leave" | "Holiday" | "Week off" | "Upcoming" | "Before joining";

export interface LedgerDay {
  date: string; weekday: string; kind: DayKind;
  detail: string | null;
  clockIn: string | null; clockOut: string | null;
  workSeconds: number;
  /** Does this day earn pay? Loss of Pay and unexplained absence do not. */
  payable: boolean;
  /** Minutes after the shift start that the person clocked in; null when there is no clock-in. */
  lateByMinutes: number | null;
  /** Minutes before the shift end that they clocked out; null while the day is still open. */
  earlyByMinutes: number | null;
  /** How many swipes were recorded, so the screen knows the day has something to show. */
  swipes: number;
}

export interface Ledger {
  userId: string; userName: string; month: string; shiftName: string | null;
  /** The days this month actually covers - not the calendar month on a 26th cycle. */
  periodFrom: string; periodTo: string; periodLabel: string;
  /** The shift window the late/early figures are measured against, as "HH:mm". */
  shiftStart: string; shiftEnd: string;
  /** The day this person started; everything before it is outside their employment. */
  joinedOn: string;
  days: LedgerDay[];
  summary: {
    workingDays: number; present: number; late: number; halfDay: number; absent: number;
    leave: number; lossOfPay: number; holidays: number; weekOffs: number;
    payableDays: number; totalHours: number;
  };
}

const MONTH = /^\d{4}-\d{2}$/;

/**
 * One person, one month, day by day (A94).
 *
 * This is the single place that decides what a day was worth, so the ledger a person reads and
 * the payslip they are paid from can never disagree - payroll asks this, it does not recount.
 *
 * A day is payable unless it was Loss of Pay or an unexplained absence. Holidays and week-offs are
 * payable and always were: nobody is docked for a Sunday.
 */
export async function attendanceLedger(ctx: CompanyContext, userId: string, month: string): Promise<Ledger> {
  if (!MONTH.test(month)) throw Errors.bad("BAD_MONTH", "Pick a month");
  const user = await scoped(User, ctx).findById(userId).select("name joiningDate createdAt").lean();
  if (!user) throw Errors.notFound("Employee");

  const clock = await personClock(ctx.companyId, userId);
  /*
   * The month follows the company's payroll cycle, not the calendar (A102). On a
   * 26th-to-25th cycle, "September" runs from 26 August - and it has to, because
   * an absence counted in one month and the deduction for it applied in another
   * is how a payslip and an attendance record come to disagree.
   */
  const company = await Company.findById(ctx.companyId).select("payrollStartDay").lean();
  const period = payrollPeriod((company?.payrollStartDay as number | undefined) ?? 1, month);
  const first = period.from;
  const last = period.to;
  const uid = new Types.ObjectId(userId);
  const today = clock.dayOf(new Date());
  // Nobody is absent for days before they existed here. Without this, a person who joined on the
  // 25th shows twenty-four absences and a payslip built on it would be wrong.
  const joined = clock.dayOf(new Date((user.joiningDate ?? user.createdAt) as unknown as string));

  const { AttendanceSwipe } = await import("@/models/AttendanceSwipe");
  const [rows, holidays, leaves, swipeCounts] = await Promise.all([
    scoped(Attendance, ctx).find({ userId: uid, date: { $gte: first, $lte: last } }).lean(),
    scoped(Holiday, ctx).find({ date: { $gte: first, $lte: last } }).lean(),
    scoped(LeaveRequest, ctx).find({
      userId: uid, status: "APPROVED", startDate: { $lte: last }, endDate: { $gte: first },
    }).lean(),
    // Only the count: the photos and coordinates are fetched for the one day
    // somebody opens, not for all thirty-one of them.
    scoped(AttendanceSwipe, ctx).aggregate<{ _id: string; n: number }>([
      { $match: { userId: uid, date: { $gte: first, $lte: last } } },
      { $group: { _id: "$date", n: { $sum: 1 } } },
    ]),
  ]);
  const swipesBy = new Map(swipeCounts.map((c) => [c._id, c.n]));
  const byDate = new Map(rows.map((r) => [r.date as string, r]));
  const holidayBy = new Map(holidays.map((h) => [h.date as string, h.name as string]));
  const leaveOn = (day: string) => leaves.find((l) => (l.startDate as string) <= day && (l.endDate as string) >= day);

  /**
   * Minutes into the day that the shift starts and ends, for measuring lateness.
   * An overnight shift ends on the next calendar day, so its end is past midnight
   * and comparing raw clock times would make every night worker hours early.
   */
  const atMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const shiftStart = atMinutes(clock.workingHours.start);
  const shiftEndRaw = atMinutes(clock.workingHours.end);
  const overnight = shiftEndRaw <= shiftStart;
  const shiftEnd = overnight ? shiftEndRaw + 24 * 60 : shiftEndRaw;
  /** Minutes into the company-timezone day that this instant falls on. */
  const minutesOf = (iso: Date | string) => {
    const [hh, mm] = formatInTimeZone(new Date(iso), clock.timezone, "HH:mm").split(":").map(Number);
    return hh * 60 + mm;
  };

  const days: LedgerDay[] = [];
  const s = { workingDays: 0, present: 0, late: 0, halfDay: 0, absent: 0, leave: 0, lossOfPay: 0, holidays: 0, weekOffs: 0, payableDays: 0, totalHours: 0 };

  for (const date of clock.days(first, last)) {
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    const holiday = holidayBy.get(date);
    const rec = byDate.get(date);
    const leave = leaveOn(date);
    const working = clock.isWorkingDay(date);
    const future = date > today;

    let kind: DayKind;
    let detail: string | null = null;
    let payable = true;

    if (date < joined) { kind = "Before joining"; payable = false; }
    else if (holiday) { kind = "Holiday"; detail = holiday; s.holidays++; }
    else if (!working) { kind = "Week off"; s.weekOffs++; }
    else if (leave) {
      kind = "Leave";
      detail = LEAVE_TYPE_LABEL[leave.type as LeaveType];
      s.leave++;
      if (leave.type === "LOP") { payable = false; s.lossOfPay++; }
      s.workingDays++;
    } else if (rec?.clockIn) {
      kind = (rec.status as DayKind) ?? "Present";
      if (kind === "Late") s.late++; else if (kind === "Half Day") s.halfDay++; else { kind = "Present"; s.present++; }
      s.workingDays++;
    } else if (future) {
      kind = "Upcoming";
      s.workingDays++;
    } else {
      kind = "Absent"; payable = false; s.absent++; s.workingDays++;
    }

    if (payable && kind !== "Upcoming" && kind !== "Before joining") s.payableDays++;
    s.totalHours += (rec?.workSeconds as number) ?? 0;

    // Late in / early out, in minutes, and only where both ends of the
    // comparison exist - a day with no clock-out is unfinished, not early.
    let lateByMinutes: number | null = null;
    let earlyByMinutes: number | null = null;
    if (rec?.clockIn && kind !== "Week off" && kind !== "Holiday") {
      const inAt = minutesOf(rec.clockIn as unknown as string);
      lateByMinutes = Math.max(0, inAt - shiftStart);
      if (rec.clockOut) {
        let outAt = minutesOf(rec.clockOut as unknown as string);
        if (overnight && outAt < inAt) outAt += 24 * 60;
        earlyByMinutes = Math.max(0, shiftEnd - outAt);
      }
    }

    days.push({
      date, weekday, kind, detail,
      clockIn: rec?.clockIn ? new Date(rec.clockIn as unknown as string).toISOString() : null,
      clockOut: rec?.clockOut ? new Date(rec.clockOut as unknown as string).toISOString() : null,
      workSeconds: (rec?.workSeconds as number) ?? 0,
      payable,
      lateByMinutes,
      earlyByMinutes,
      swipes: swipesBy.get(date) ?? 0,
    });
  }

  s.totalHours = Math.round((s.totalHours / 3600) * 10) / 10;
  return {
    userId, userName: user.name as string, month,
    periodFrom: period.from, periodTo: period.to, periodLabel: period.label,
    shiftName: clock.shiftName, shiftStart: clock.workingHours.start, shiftEnd: clock.workingHours.end,
    joinedOn: joined, days, summary: s,
  };
}
