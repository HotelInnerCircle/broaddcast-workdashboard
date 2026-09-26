/**
 * The stretch of days a month's pay covers.
 *
 * A payroll month is not always a calendar month. Plenty of companies run the
 * 26th to the 25th, so that attendance is closed with a few days in hand to
 * process the payroll before payday. The period is named after the month it
 * *ends* in: "September 2026" on a 26th cycle means 26 August to 25 September,
 * which is the payslip an employee expects to receive in September.
 *
 * Everything downstream - the attendance ledger, payslips, loss of pay - has to
 * agree on this, or a person's absences land in one month and the deduction for
 * them lands in another.
 */

export interface PayrollPeriod {
  /** The month this period is named after, "YYYY-MM". */
  key: string;
  /** First day, inclusive, "YYYY-MM-DD". */
  from: string;
  /** Last day, inclusive, "YYYY-MM-DD". */
  to: string;
  /** For a heading: "26 Aug - 25 Sep 2026", or "September 2026" on a calendar cycle. */
  label: string;
  /** True when the cycle is a plain calendar month. */
  calendar: boolean;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Days in a month, 1-indexed month. Leap years included. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A day key, with the day clamped to the end of the month. */
function dayKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(Math.min(day, daysInMonth(year, month)))}`;
}

function nextDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The day a month's cycle closes - the single rule everything else derives from.
 *
 * A period *ends* on the day before the next one opens, and *starts* the day
 * after the previous one ended. Defining it that way, rather than computing the
 * start and the end independently, is what makes gaps and overlaps impossible.
 *
 * It matters at the edges. A cycle starting on the 31st has to mean something in
 * February: the close is clamped to the 28th, and because March's period starts
 * the day *after* that, the 28th belongs to February alone. Computing March's
 * start as "the 31st of February, clamped" instead would have handed the 28th to
 * both months - one day of one person's pay, counted twice, every leap-year
 * February. A test caught exactly that.
 */
function closesOn(startDay: number, year: number, month: number): string {
  if (startDay === 1) return dayKey(year, month, daysInMonth(year, month));
  return dayKey(year, month, startDay - 1);
}

/**
 * The period that pay for `monthKey` covers.
 *
 * `startDay` is the day of the month a cycle opens: 1 for calendar months, 26
 * for a 26th-to-25th cycle.
 */
export function payrollPeriod(startDay: number, monthKey: string): PayrollPeriod {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Not a month: ${monthKey}`);
  const start = Math.min(Math.max(Math.trunc(startDay) || 1, 1), 31);

  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const to = closesOn(start, y, m);
  const from = nextDay(closesOn(start, prevYear, prevMonth));

  if (start === 1) return { key: monthKey, from, to, label: `${MONTH_NAMES[m - 1]} ${y}`, calendar: true };

  const [fy, fm, fd] = from.split("-").map(Number);
  const td = Number(to.slice(8));
  const label = fy !== y
    ? `${fd} ${SHORT[fm - 1]} ${fy} - ${td} ${SHORT[m - 1]} ${y}`
    : fm === m
      // A clamped cycle can start and end inside one month, e.g. a 31st cycle in March.
      ? `${fd} - ${td} ${SHORT[m - 1]} ${y}`
      : `${fd} ${SHORT[fm - 1]} - ${td} ${SHORT[m - 1]} ${y}`;

  return { key: monthKey, from, to, label, calendar: false };
}

/**
 * Which payroll month a given day falls in - the inverse of the above, and
 * derived from the same `closesOn` rule so the two cannot drift apart.
 */
export function payrollMonthOf(startDay: number, day: string): string {
  const [y, m] = day.split("-").map(Number);
  const start = Math.min(Math.max(Math.trunc(startDay) || 1, 1), 31);
  // On or before its own month's close it belongs there; after it, to the next.
  if (day <= closesOn(start, y, m)) return `${y}-${pad(m)}`;
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/** The payroll month containing today, in the company's timezone day key. */
export function currentPayrollMonth(startDay: number, today: string): string {
  return payrollMonthOf(startDay, today);
}
