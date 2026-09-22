import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { Company } from "@/models/Company";
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
  /** Day keys between two keys, inclusive. */
  days(from: string, to: string): string[];
}

/** All attendance/timer math happens in the company timezone (spec 7.5, 14). */
export async function companyClock(companyId: string): Promise<CompanyClock> {
  const c = await Company.findById(companyId).select("timezone workingHours workingDays lateThresholdMinutes").lean();
  if (!c) throw Errors.notFound("Company");
  return buildClock({ timezone: c.timezone, workingHours: c.workingHours ?? { start: "09:00", end: "18:00" }, workingDays: c.workingDays, lateThresholdMinutes: c.lateThresholdMinutes });
}

export function buildClock(c: { timezone: string; workingHours: { start: string; end: string }; workingDays: string[]; lateThresholdMinutes: number }): CompanyClock {
  const tz = c.timezone;
  const at = (day: string, hhmm: string) => fromZonedTime(`${day}T${hhmm}:00`, tz);
  const toSec = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 3600 + m * 60; };
  const scheduledSeconds = Math.max(0, toSec(c.workingHours.end) - toSec(c.workingHours.start));
  return {
    timezone: tz, workingHours: c.workingHours, workingDays: c.workingDays, lateThresholdMinutes: c.lateThresholdMinutes,
    dayOf: (d) => dayKey(d, tz),
    at,
    workStart: (day) => at(day, c.workingHours.start),
    workEnd: (day) => at(day, c.workingHours.end),
    autoCloseAt: (day) => new Date(at(day, c.workingHours.end).getTime() + 2 * 3600 * 1000),
    scheduledSeconds,
    isWorkingDay: (day) => c.workingDays.includes(WEEKDAYS[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]),
    days: (from, to) => {
      const out: string[] = [];
      for (let d = new Date(`${from}T12:00:00Z`); formatInTimeZone(d, "UTC", "yyyy-MM-dd") <= to; d = new Date(d.getTime() + 86_400_000)) out.push(formatInTimeZone(d, "UTC", "yyyy-MM-dd"));
      return out;
    },
  };
}
