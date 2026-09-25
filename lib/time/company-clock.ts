import { Types } from "mongoose";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Company } from "@/models/Company";
import { Holiday } from "@/models/Holiday";
import { Shift } from "@/models/Shift";
import { User } from "@/models/User";
import { Errors } from "@/lib/api/errors";
import { dayKey } from "@/lib/utils/dates";
import { WEEKDAYS } from "@/types";

export interface CompanyClock {
  timezone: string;
  workingHours: { start: string; end: string };
  workingDays: string[];
  lateThresholdMinutes: number;
  /** Day key of an instant in the company timezone. */
  dayOf(d: Date): string;
  /** Instant for HH:MM on a given day key in the company timezone. */
  at(day: string, hhmm: string): Date;
  workStart(day: string): Date;
  workEnd(day: string): Date;
  /** Forgotten clock-outs are auto-closed here (spec 7.5): end-of-day + 2 hours. */
  autoCloseAt(day: string): Date;
  scheduledSeconds: number;
  isWorkingDay(day: string): boolean;
  /** Company holidays as day keys (A90). A holiday is never a working day. */
  holidays: Set<string>;
  /** The shift this clock was built from, or null when the company defaults apply. */
  shiftName: string | null;
  /** Day keys between two keys, inclusive. */
  days(from: string, to: string): string[];
}

/** All attendance/timer math happens in the company timezone (spec 7.5, 14). */
export async function companyClock(companyId: string): Promise<CompanyClock> {
  const c = await Company.findById(companyId).select("timezone workingHours workingDays lateThresholdMinutes").lean();
  if (!c) throw Errors.notFound("Company");
  const holidays = await Holiday.find({ companyId: new Types.ObjectId(companyId) }).select("date").lean();
  return buildClock({
    timezone: c.timezone,
    workingHours: c.workingHours ?? { start: "09:00", end: "18:00" },
    workingDays: c.workingDays,
    lateThresholdMinutes: c.lateThresholdMinutes,
    holidays: holidays.map((h) => h.date as string),
  });
}

/**
 * The same clock, but through one person's shift (A90).
 *
 * Lateness and a half day are judged against the hours that person is actually expected to work,
 * not the company average. Somebody with no shift gets the company defaults, so this is safe to
 * call everywhere `companyClock` was called.
 */
export async function personClock(companyId: string, userId: string): Promise<CompanyClock> {
  const [base, user] = await Promise.all([
    companyClock(companyId),
    User.findById(userId).select("shiftId").lean(),
  ]);
  if (!user?.shiftId) return base;
  const shift = await Shift.findOne({ _id: user.shiftId, companyId: new Types.ObjectId(companyId), active: true })
    .select("name startTime endTime workingDays lateThresholdMinutes").lean();
  if (!shift) return base;
  return buildClock({
    timezone: base.timezone,
    workingHours: { start: shift.startTime as string, end: shift.endTime as string },
    workingDays: shift.workingDays as string[],
    lateThresholdMinutes: shift.lateThresholdMinutes as number,
    holidays: [...base.holidays],
    shiftName: shift.name as string,
  });
}

export function buildClock(c: { timezone: string; workingHours: { start: string; end: string }; workingDays: string[]; lateThresholdMinutes: number; holidays?: string[]; shiftName?: string }): CompanyClock {
  const tz = c.timezone;
  const at = (day: string, hhmm: string) => fromZonedTime(`${day}T${hhmm}:00`, tz);
  const toSec = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 3600 + m * 60; };
  // A night shift ends on the following day, so its length wraps rather than going negative.
  const rawLength = toSec(c.workingHours.end) - toSec(c.workingHours.start);
  const scheduledSeconds = rawLength >= 0 ? rawLength : rawLength + 24 * 3600;
  const holidays = new Set(c.holidays ?? []);
  return {
    timezone: tz, workingHours: c.workingHours, workingDays: c.workingDays, lateThresholdMinutes: c.lateThresholdMinutes,
    dayOf: (d) => dayKey(d, tz),
    at,
    workStart: (day) => at(day, c.workingHours.start),
    workEnd: (day) => at(day, c.workingHours.end),
    autoCloseAt: (day) => new Date(at(day, c.workingHours.end).getTime() + 2 * 3600 * 1000),
    scheduledSeconds,
    holidays,
    shiftName: c.shiftName ?? null,
    isWorkingDay: (day) => !holidays.has(day) && c.workingDays.includes(WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]),
    days: (from, to) => {
      const out: string[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); formatInTimeZone(d, "UTC", "yyyy-MM-dd") <= to; d = new Date(d.getTime() + 86_400_000)) out.push(formatInTimeZone(d, "UTC", "yyyy-MM-dd"));
      return out;
    },
  };
}
