import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { personClock } from "@/lib/time/company-clock";
import { Attendance } from "@/models/Attendance";
import { Holiday } from "@/models/Holiday";
import { LeaveRequest } from "@/models/LeaveRequest";
import { User } from "@/models/User";
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
}

export interface Ledger {
  userId: string; userName: string; month: string; shiftName: string | null;
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
  const first = `${month}-01`;
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const uid = new Types.ObjectId(userId);
  const today = clock.dayOf(new Date());
  // Nobody is absent for days before they existed here. Without this, a person who joined on the
  // 25th shows twenty-four absences and a payslip built on it would be wrong.
  const joined = clock.dayOf(new Date((user.joiningDate ?? user.createdAt) as unknown as string));

  const [rows, holidays, leaves] = await Promise.all([
    scoped(Attendance, ctx).find({ userId: uid, date: { $gte: first, $lte: last } }).lean(),
    scoped(Holiday, ctx).find({ date: { $gte: first, $lte: last } }).lean(),
    scoped(LeaveRequest, ctx).find({
      userId: uid, status: "APPROVED", startDate: { $lte: last }, endDate: { $gte: first },
    }).lean(),
  ]);
  const byDate = new Map(rows.map((r) => [r.date as string, r]));
  const holidayBy = new Map(holidays.map((h) => [h.date as string, h.name as string]));
  const leaveOn = (day: string) => leaves.find((l) => (l.startDate as string) <= day && (l.endDate as string) >= day);

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

    days.push({
      date, weekday, kind, detail,
      clockIn: rec?.clockIn ? new Date(rec.clockIn as unknown as string).toISOString() : null,
      clockOut: rec?.clockOut ? new Date(rec.clockOut as unknown as string).toISOString() : null,
      workSeconds: (rec?.workSeconds as number) ?? 0,
      payable,
    });
  }

  s.totalHours = Math.round((s.totalHours / 3600) * 10) / 10;
  return { userId, userName: user.name as string, month, shiftName: clock.shiftName, joinedOn: joined, days, summary: s };
}
