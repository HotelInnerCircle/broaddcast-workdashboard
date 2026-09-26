import { format, formatDistanceToNowStrict } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/** Display conventions (spec section 14): DD MMM YYYY, 12-hour times, week starts Monday. */
export const DATE_FMT = "dd MMM yyyy";
export const TIME_FMT = "hh:mm a";
export const DATETIME_FMT = "dd MMM yyyy, hh:mm a";

/**
 * Anything that might be a moment, turned into a usable Date or null.
 *
 * Every formatter below goes through this, and the reason is worth stating: a
 * date formatter that throws takes down whichever page rendered it. `date-fns`
 * raises `RangeError: Invalid time value` on an unparseable date, and calling
 * `.toISOString()` on one does the same - so a single bad timestamp anywhere in
 * a page's data was enough to replace the whole page with a server-side
 * exception. A record with a bad date should look wrong, not be unreachable.
 *
 * Accepts a number too: timestamps arrive from JSON and from older records, and
 * calling a Date method on one is a TypeError rather than anything useful.
 */
function asDate(d: Date | string | number | null | undefined): Date | null {
  if (d === null || d === undefined || d === "") return null;
  const date = d instanceof Date ? d : new Date(d as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(d: Date | string | number | null | undefined, tz?: string): string {
  const date = asDate(d);
  if (!date) return "-";
  return tz ? formatInTimeZone(date, tz, DATE_FMT) : format(date, DATE_FMT);
}

export function formatDateTime(d: Date | string | number | null | undefined, tz?: string): string {
  const date = asDate(d);
  if (!date) return "-";
  return tz ? formatInTimeZone(date, tz, DATETIME_FMT) : format(date, DATETIME_FMT);
}

export function relativeTime(d: Date | string | number | null | undefined): string {
  const date = asDate(d);
  if (!date) return "never";
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "Just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

/** The ISO form, or null when there is no usable moment. Never throws. */
export function isoOrNull(d: Date | string | number | null | undefined): string | null {
  return asDate(d)?.toISOString() ?? null;
}

/** Day key (yyyy-MM-dd) in the company timezone. */
export function dayKey(d: Date, tz: string): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

export function greeting(tz: string, now = new Date()): string {
  const hour = toZonedTime(now, tz).getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

/**
 * Date inputs arrive from <input type="date"> as YYYY-MM-DD; interpret them as midnight in the
 * company timezone (spec 14: convert at the edges) so the day key never shifts across offsets.
 */
export function parseDateInput(v: string | Date | null | undefined, tz: string): Date | null {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fromZonedTime(`${v}T00:00:00`, tz);
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d;
}
